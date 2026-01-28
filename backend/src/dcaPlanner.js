const { getSpotCandles } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');

const DEFAULT_DCA_SYMBOLS = [
  { symbol: 'ASTERUSDC', category: 'spot' },
  { symbol: 'GIGGLEUSDC', category: 'spot' },
  { symbol: 'ORDIUSDC', category: 'spot' },
  { symbol: 'FARTCOINUSDC', category: 'alpha' },
  { symbol: 'TRADOORUSDC', category: 'alpha' },
  { symbol: '1000BONKUSDC', category: 'alpha' }
];

const DEFAULT_INTERVAL = '1h';
const DEFAULT_BUDGET = 100;

function normalizeSymbols(rawSymbols) {
  if (!rawSymbols) return [];
  return rawSymbols
    .map((s) => {
      if (typeof s === 'object' && s.symbol) {
        return { symbol: s.symbol.trim().toUpperCase(), category: s.category || 'spot' };
      }
      const sym = (s || '').trim().toUpperCase();
      return sym ? { symbol: sym, category: 'spot' } : null;
    })
    .filter(Boolean);
}

function roundMoney(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function buildAction(ai, sniperSignals) {
  const confidence = ai?.confidence ?? 0.5;
  const isSniper = sniperSignals?.score?.isSniper || false;
  const sniperDir = sniperSignals?.score?.direction;

  if (ai?.direction === 'long') {
    const threshold = (isSniper && sniperDir === 'bullish') ? 0.48 : 0.55;
    if (confidence >= threshold) return { action: 'ACCUMULATE', confidence };
  }
  if (ai?.direction === 'short') {
    const threshold = (isSniper && sniperDir === 'bearish') ? 0.48 : 0.55;
    if (confidence >= threshold) return { action: 'SWAP_TO_USDC', confidence };
  }
  return { action: 'WAIT', confidence };
}

function pickCadence(indicators) {
  const atrPct = indicators?.tradeLevels?.atrPct;
  if (atrPct === null || atrPct === undefined) return 'weekly';
  return atrPct >= 2.5 ? 'daily' : 'weekly';
}

function buildReasons(indicators, ai, action) {
  const reasons = [];
  if (action === 'ACCUMULATE') reasons.push('Flow supports DCA entries');
  if (action === 'SWAP_TO_USDC') reasons.push('Downside flow, park in USDC');
  if (ai?.reasons?.length) {
    reasons.push(...ai.reasons.slice(0, 2));
  }
  if (indicators?.midweekReversal?.detected) {
    const shape = indicators.midweekReversal.shape || 'reversal';
    reasons.push(`Midweek ${shape}-shape caution`);
  }
  return reasons.slice(0, 4);
}

function detectReentry(indicators, action) {
  if (action !== 'ACCUMULATE') return false;
  const trendDir = indicators?.trend?.direction || '';
  const wasDowntrend = trendDir.includes('DOWN');
  const bullishFlip =
    indicators?.sniperSignals?.divergence?.type === 'bullish' ||
    indicators?.midweekReversal?.detected;
  return Boolean(wasDowntrend && bullishFlip);
}

function buildDcaItem(symbol, interval, candles, indicators, ai, category) {
  if (!candles || candles.length < 20 || !indicators || !ai) {
    return {
      symbol,
      base: symbol.replace('USDC', ''),
      category: category || 'spot',
      interval,
      action: 'NO_DATA',
      confidence: null,
      price: null,
      trend: 'UNKNOWN',
      cadence: 'weekly',
      reasons: ['No recent data'],
      reentrySuggested: false
    };
  }

  const { action, confidence } = buildAction(ai, indicators?.sniperSignals);
  const reentrySuggested = detectReentry(indicators, action);
  const trendDir = indicators?.trend?.direction || 'NEUTRAL';
  const sniper = indicators?.sniperSignals;

  return {
    symbol,
    base: symbol.replace('USDC', ''),
    category: category || 'spot',
    interval,
    action,
    confidence: roundMoney(confidence, 2),
    price: roundMoney(indicators.currentPrice, 6),
    trend: trendDir,
    cadence: pickCadence(indicators),
    reasons: buildReasons(indicators, ai, action),
    reentrySuggested,
    midweekReversal: indicators?.midweekReversal?.detected
      ? {
        shape: indicators.midweekReversal.shape,
        strength: indicators.midweekReversal.strength
      }
      : null,
    sniperScore: sniper?.score?.score || 0,
    isSniper: sniper?.score?.isSniper || false,
    sniperDirection: sniper?.score?.direction || null,
    sniperSignals: sniper?.score?.signals || [],
    sniperDetail: {
      divergence: sniper?.divergence || null,
      volumeAccumulation: sniper?.volumeAccumulation || null,
      earlyBreakout: sniper?.earlyBreakout || null,
      momentumBuilding: sniper?.momentumBuilding || null,
      squeeze: sniper?.squeeze || null,
    },
    aiSignal: ai?.signal || 'HOLD',
    aiTrade: ai?.trade || null,
  };
}

function allocateBudget(items, budget) {
  const actionable = items.filter((item) => item.action !== 'NO_DATA');
  const swapCount = actionable.filter((item) => item.action === 'SWAP_TO_USDC').length;
  const waitCount = actionable.filter((item) => item.action === 'WAIT').length;

  const reservePct = Math.min(70, swapCount * 12 + waitCount * 6);
  const investablePct = Math.max(0, 100 - reservePct);

  const weights = actionable.map((item) => {
    if (item.action === 'ACCUMULATE') {
      let w = 1.1 + (item.confidence ?? 0.5);
      if (item.isSniper && item.sniperDirection === 'bullish') w += 0.4;
      return w;
    }
    if (item.action === 'WAIT') return 0.4 + (item.confidence ?? 0.5) * 0.3;
    return 0;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

  const enriched = items.map((item) => {
    if (item.action === 'NO_DATA' || item.action === 'SWAP_TO_USDC') {
      return {
        ...item,
        allocationPct: 0,
        weeklyAmount: 0,
        dailyAmount: 0
      };
    }

    const index = actionable.indexOf(item);
    const weight = index >= 0 ? weights[index] : 0;
    const allocationPct = weight > 0 ? (investablePct * weight) / totalWeight : 0;
    const weeklyAmount = (budget * allocationPct) / 100;
    const dailyAmount = weeklyAmount / 7;

    return {
      ...item,
      allocationPct: roundMoney(allocationPct, 2),
      weeklyAmount: roundMoney(weeklyAmount, 2),
      dailyAmount: roundMoney(dailyAmount, 2)
    };
  });

  const reserveWeekly = (budget * reservePct) / 100;
  const reserveDaily = reserveWeekly / 7;

  return {
    items: enriched,
    reserve: {
      symbol: 'USDC',
      allocationPct: roundMoney(reservePct, 2),
      weeklyAmount: roundMoney(reserveWeekly, 2),
      dailyAmount: roundMoney(reserveDaily, 2),
      action: 'HOLD'
    }
  };
}

async function buildDcaPlan({ symbols, interval, budget, latestCandles }) {
  const resolvedSymbols = normalizeSymbols(symbols);
  const targetSymbols = resolvedSymbols.length ? resolvedSymbols : DEFAULT_DCA_SYMBOLS;
  const resolvedInterval = interval || DEFAULT_INTERVAL;
  const resolvedBudget = Number.isFinite(budget) ? budget : DEFAULT_BUDGET;

  const items = [];
  for (const entry of targetSymbols) {
    const sym = typeof entry === 'object' ? entry.symbol : entry;
    const category = typeof entry === 'object' ? entry.category : 'spot';
    const key = `${sym}-${resolvedInterval}`;
    let candles = latestCandles?.get(key);
    if (!candles || candles.length < 20) {
      try {
        candles = await getSpotCandles(sym, resolvedInterval);
      } catch (err) {
        candles = null;
      }
    }

    const indicators = candles ? calculateIndicators(candles) : null;
    const ai = indicators ? predictNextMove(indicators) : null;
    items.push(buildDcaItem(sym, resolvedInterval, candles, indicators, ai, category));
  }

  const allocation = allocateBudget(items, resolvedBudget);

  return {
    interval: resolvedInterval,
    budget: roundMoney(resolvedBudget, 2),
    updatedAt: Date.now(),
    items: allocation.items,
    reserve: allocation.reserve
  };
}

module.exports = {
  buildDcaPlan,
  DEFAULT_DCA_SYMBOLS
};
