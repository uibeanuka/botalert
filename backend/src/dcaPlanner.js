const { getSpotCandles, getCandles } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');

const DEFAULT_DCA_SYMBOLS = [
  // Spot coins
  { symbol: 'ASTERUSDT', category: 'spot' },
  { symbol: 'GIGGLEUSDT', category: 'spot' },
  { symbol: 'ORDIUSDT', category: 'spot' },
  // Alpha/Meme coins
  { symbol: 'FARTCOINUSDT', category: 'alpha' },
  { symbol: 'TRADOORUSDT', category: 'alpha' },
  { symbol: '1000BONKUSDT', category: 'alpha' },
  // User-requested coins
  { symbol: '42USDT', category: 'spot' },
  { symbol: 'BULLAUSDT', category: 'spot' },
  { symbol: 'SENTUSDT', category: 'spot' },
  { symbol: 'BLUAUSDT', category: 'spot' },
  // Popular trending coins
  { symbol: 'PEPEUSDT', category: 'alpha' },
  { symbol: 'FLOKIUSDT', category: 'alpha' },
  { symbol: 'WIFUSDT', category: 'alpha' },
  { symbol: 'SHIBUSDT', category: 'alpha' },
];

const DEFAULT_INTERVAL = '1h';
const MIN_TRADE_AMOUNT = 12;

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
      base: symbol.replace(/USD[CT]$/, ''),
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
    base: symbol.replace(/USD[CT]$/, ''),
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
  const investableAmount = (budget * investablePct) / 100;

  // Calculate weights for each actionable item
  const weightMap = new Map();
  for (const item of actionable) {
    if (item.action === 'ACCUMULATE') {
      let w = 1.1 + (item.confidence ?? 0.5);
      if (item.isSniper && item.sniperDirection === 'bullish') w += 0.4;
      weightMap.set(item.symbol, w);
    } else if (item.action === 'WAIT') {
      weightMap.set(item.symbol, 0.4 + (item.confidence ?? 0.5) * 0.3);
    } else {
      weightMap.set(item.symbol, 0);
    }
  }

  // Iteratively remove items that would get less than $12 until all remaining get $12+
  const eligibleSymbols = new Set(actionable.map((i) => i.symbol));
  let iterations = 0;
  while (iterations < 10) {
    iterations++;
    const eligibleItems = actionable.filter((i) => eligibleSymbols.has(i.symbol) && weightMap.get(i.symbol) > 0);
    const totalWeight = eligibleItems.reduce((sum, i) => sum + weightMap.get(i.symbol), 0) || 1;

    let removedAny = false;
    for (const item of eligibleItems) {
      const weight = weightMap.get(item.symbol);
      const weeklyAmount = (investableAmount * weight) / totalWeight;
      const dailyAmount = weeklyAmount / 7;
      const tradeAmount = item.cadence === 'daily' ? dailyAmount : weeklyAmount;

      if (tradeAmount < MIN_TRADE_AMOUNT) {
        eligibleSymbols.delete(item.symbol);
        removedAny = true;
      }
    }
    if (!removedAny) break;
  }

  // Final allocation only to eligible items
  const finalEligible = actionable.filter((i) => eligibleSymbols.has(i.symbol) && weightMap.get(i.symbol) > 0);
  const finalTotalWeight = finalEligible.reduce((sum, i) => sum + weightMap.get(i.symbol), 0) || 1;

  const enriched = items.map((item) => {
    if (item.action === 'NO_DATA' || item.action === 'SWAP_TO_USDC') {
      return {
        ...item,
        allocationPct: 0,
        weeklyAmount: 0,
        dailyAmount: 0
      };
    }

    const isEligible = eligibleSymbols.has(item.symbol) && weightMap.get(item.symbol) > 0;
    if (!isEligible) {
      return {
        ...item,
        allocationPct: 0,
        weeklyAmount: 0,
        dailyAmount: 0
      };
    }

    const weight = weightMap.get(item.symbol);
    const allocationPct = (investablePct * weight) / finalTotalWeight;
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

async function buildDcaPlan({ symbols, interval, usdcBalance, latestCandles }) {
  const resolvedSymbols = normalizeSymbols(symbols);
  const targetSymbols = resolvedSymbols.length ? resolvedSymbols : DEFAULT_DCA_SYMBOLS;
  const resolvedInterval = interval || DEFAULT_INTERVAL;
  // Use actual USDC balance for allocation (fallback to 0 if not provided)
  const availableBalance = Number.isFinite(usdcBalance) ? usdcBalance : 0;

  const items = [];
  for (const entry of targetSymbols) {
    const sym = typeof entry === 'object' ? entry.symbol : entry;
    const category = typeof entry === 'object' ? entry.category : 'spot';
    const key = `${sym}-${resolvedInterval}`;
    let candles = latestCandles?.get(key);
    if (!candles || candles.length < 20) {
      try {
        // Alpha coins live on futures; spot coins on spot market
        candles = category === 'alpha'
          ? await getCandles(sym, resolvedInterval)
          : await getSpotCandles(sym, resolvedInterval);
      } catch (err) {
        // Fallback: try the other API
        try {
          candles = category === 'alpha'
            ? await getSpotCandles(sym, resolvedInterval)
            : await getCandles(sym, resolvedInterval);
        } catch {
          candles = null;
        }
      }
    }

    const indicators = candles ? calculateIndicators(candles) : null;
    const ai = indicators ? predictNextMove(indicators) : null;
    items.push(buildDcaItem(sym, resolvedInterval, candles, indicators, ai, category));
  }

  const allocation = allocateBudget(items, availableBalance);

  return {
    interval: resolvedInterval,
    usdcBalance: roundMoney(availableBalance, 2),
    updatedAt: Date.now(),
    items: allocation.items,
    reserve: allocation.reserve
  };
}

module.exports = {
  buildDcaPlan,
  DEFAULT_DCA_SYMBOLS
};
