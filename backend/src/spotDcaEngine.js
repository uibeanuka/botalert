const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildDcaPlan, DEFAULT_DCA_SYMBOLS } = require('./dcaPlanner');
const { getSpotExchangeInfo, getSpotCandles } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');

const API_BASE = process.env.BINANCE_SPOT_API_URL || 'https://api.binance.com';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

const SPOT_DCA_ENABLED = process.env.SPOT_DCA_ENABLED === 'true';
const SPOT_DCA_DRY_RUN = process.env.SPOT_DCA_DRY_RUN !== 'false';
const SPOT_DCA_INTERVAL_MS = Number(process.env.SPOT_DCA_INTERVAL_MS || 300_000);
const SPOT_DCA_INTERVAL = process.env.SPOT_DCA_INTERVAL || '1h';
const SPOT_DCA_BUDGET = Number(process.env.SPOT_DCA_BUDGET || 100);
const SPOT_DCA_MIN_USDC = Number(process.env.SPOT_DCA_MIN_USDC || 12);
const SPOT_DCA_MIN_TRADE = Number(process.env.SPOT_DCA_MIN_TRADE || 12);
const SPOT_DCA_SYMBOLS = (process.env.SPOT_DCA_SYMBOLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Sniper & smart exit config
const SPOT_DCA_SNIPER_ENABLED = process.env.SPOT_DCA_SNIPER_ENABLED !== 'false';
const SPOT_DCA_SNIPER_WAIT_HOURS = Number(process.env.SPOT_DCA_SNIPER_WAIT_HOURS || 6);
const SPOT_DCA_SMART_EXIT_ENABLED = process.env.SPOT_DCA_SMART_EXIT_ENABLED !== 'false';
const SPOT_DCA_TREND_EXIT_CONFIDENCE = Number(process.env.SPOT_DCA_TREND_EXIT_CONFIDENCE || 60) / 100;

const STATE_FILE = path.join(__dirname, '../data/spot_dca_state.json');

let exchangeInfoCache = null;
let exchangeInfoFetchedAt = 0;

function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

function buildClient() {
  return axios.create({
    baseURL: API_BASE,
    timeout: 12000,
    headers: {
      'X-MBX-APIKEY': API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

async function getExchangeInfo() {
  const now = Date.now();
  if (exchangeInfoCache && now - exchangeInfoFetchedAt < 6 * 60 * 60 * 1000) {
    return exchangeInfoCache;
  }
  const info = await getSpotExchangeInfo();
  exchangeInfoCache = info;
  exchangeInfoFetchedAt = now;
  return info;
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        lastBuys: raw.lastBuys || {},
        lastSells: raw.lastSells || {},
        costBasis: raw.costBasis || {},
        sniperWaitStart: raw.sniperWaitStart || {},
        totalSpent: raw.totalSpent || {},
        totalQty: raw.totalQty || {},
      };
    }
  } catch (err) {
    console.warn('Spot DCA: failed to load state:', err.message);
  }
  return { lastBuys: {}, lastSells: {}, costBasis: {}, sniperWaitStart: {}, totalSpent: {}, totalQty: {} };
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('Spot DCA: failed to save state:', err.message);
  }
}

async function getSpotBalances() {
  if (!API_KEY || !API_SECRET) return null;

  const client = buildClient();
  const timestamp = Date.now();
  const params = `timestamp=${timestamp}`;
  const signature = sign(params);
  const res = await client.get(`/api/v3/account?${params}&signature=${signature}`);
  return res.data?.balances || [];
}

function getFreeBalance(balances, asset) {
  const entry = balances.find((b) => b.asset === asset);
  return entry ? Number(entry.free || 0) : 0;
}

function getLotSizeFilter(info, symbol) {
  const s = info?.symbols?.find((item) => item.symbol === symbol);
  if (!s) return null;
  return s.filters?.find((f) => f.filterType === 'LOT_SIZE') || null;
}

function floorToStep(value, stepSize) {
  if (!stepSize || stepSize === 0) return value;
  const precision = Math.max(0, Math.round(-Math.log10(stepSize)));
  const factor = Math.pow(10, precision);
  return Math.floor(value * factor) / factor;
}

async function placeSpotOrder({ symbol, side, quoteOrderQty, quantity }) {
  if (!API_KEY || !API_SECRET) return { status: 'NO_KEYS' };

  const client = buildClient();
  const timestamp = Date.now();
  const params = new URLSearchParams();
  params.set('symbol', symbol);
  params.set('side', side);
  params.set('type', 'MARKET');
  if (quoteOrderQty) params.set('quoteOrderQty', quoteOrderQty.toFixed(2));
  if (quantity) params.set('quantity', quantity.toFixed(6));
  params.set('timestamp', timestamp.toString());

  const signature = sign(params.toString());
  const url = `/api/v3/order?${params.toString()}&signature=${signature}`;
  const res = await client.post(url);
  return res.data;
}

function dueForPurchase(lastBuyAt, cadence) {
  const now = Date.now();
  const elapsed = lastBuyAt ? now - lastBuyAt : Infinity;
  if (cadence === 'daily') return elapsed >= 20 * 60 * 60 * 1000;
  return elapsed >= 6 * 24 * 60 * 60 * 1000;
}

// --- SNIPER ENTRY LOGIC ---

function determineSniperEntry(item, state) {
  if (!SPOT_DCA_SNIPER_ENABLED || item.action !== 'ACCUMULATE') {
    return { useSniper: false, sizeMultiplier: 1.0, reason: 'sniper disabled or not accumulate' };
  }

  const sniperScore = item.sniperScore || 0;
  const isSniper = item.isSniper || false;
  const sniperDir = item.sniperDirection;

  // Active bullish sniper signal -> buy now with boosted size
  if (isSniper && sniperDir === 'bullish') {
    const multiplier = sniperScore >= 70 ? 1.5 : (sniperScore >= 50 ? 1.2 : 1.0);
    return {
      useSniper: true,
      sniperScore,
      sizeMultiplier: multiplier,
      reason: `Sniper bullish (score: ${sniperScore}, ${multiplier}x size)`
    };
  }

  // No sniper signal -- check wait window
  const waitStart = state.sniperWaitStart[item.symbol];
  const maxWaitMs = SPOT_DCA_SNIPER_WAIT_HOURS * 60 * 60 * 1000;

  if (!waitStart) {
    return { useSniper: false, shouldWait: true, sizeMultiplier: 1.0, reason: 'Starting sniper wait window' };
  }

  const waited = Date.now() - waitStart;
  if (waited < maxWaitMs) {
    const hoursWaited = Math.round(waited / 3600000);
    return {
      useSniper: false,
      shouldWait: true,
      sizeMultiplier: 1.0,
      reason: `Waiting for sniper (${hoursWaited}h / ${SPOT_DCA_SNIPER_WAIT_HOURS}h)`
    };
  }

  // Wait expired -> fall back to regular DCA at reduced size
  return {
    useSniper: false,
    shouldWait: false,
    sizeMultiplier: 0.8,
    reason: 'Sniper wait expired, regular DCA at 0.8x'
  };
}

function calculateSpotSpend(item, sniperResult, availableUsdc) {
  const baseSpend = item.cadence === 'daily' ? item.dailyAmount : item.weeklyAmount;
  const multiplier = sniperResult?.sizeMultiplier || 1.0;
  let spend = (baseSpend || 0) * multiplier;
  spend = Math.min(spend, availableUsdc);
  if (spend < SPOT_DCA_MIN_TRADE) return 0;
  return spend;
}

// --- SMART EXIT MONITORING ---

async function monitorSpotHoldings({ latestCandles }) {
  if (!SPOT_DCA_SMART_EXIT_ENABLED || !SPOT_DCA_ENABLED) return;

  let balances;
  try {
    balances = await getSpotBalances();
  } catch (err) {
    console.error('[SPOT DCA] Smart exit: failed to fetch balances:', err.message);
    return;
  }
  if (!balances) return;

  const symbols = SPOT_DCA_SYMBOLS.length ? SPOT_DCA_SYMBOLS : DEFAULT_DCA_SYMBOLS;
  const state = loadState();
  let info;
  try {
    info = await getExchangeInfo();
  } catch (err) {
    return;
  }

  for (const symbol of symbols) {
    const baseAsset = symbol.replace(/USD[CT]$/, '');
    const free = getFreeBalance(balances, baseAsset);
    if (free <= 0) continue;

    // Get fresh candles and indicators for this symbol
    let candles;
    const key = `${symbol}-${SPOT_DCA_INTERVAL}`;
    candles = latestCandles?.get(key);
    if (!candles || candles.length < 20) {
      try {
        candles = await getSpotCandles(symbol, SPOT_DCA_INTERVAL);
      } catch (err) {
        continue;
      }
    }
    if (!candles || candles.length < 20) continue;

    const indicators = calculateIndicators(candles);
    if (!indicators) continue;

    const ai = predictNextMove(indicators);
    let shouldSell = false;
    let sellReason = '';

    // 1. Strong bearish reversal with high confidence
    if (ai?.direction === 'short' && ai.confidence >= SPOT_DCA_TREND_EXIT_CONFIDENCE) {
      shouldSell = true;
      sellReason = `Bearish reversal (${(ai.confidence * 100).toFixed(0)}% conf)`;
    }

    // 2. Sniper bearish signals (early warning)
    const sniper = indicators.sniperSignals;
    if (!shouldSell && sniper) {
      if (sniper.divergence?.type === 'bearish' && sniper.divergence.strength > 60) {
        shouldSell = true;
        sellReason = `SNIPER bearish divergence (str: ${sniper.divergence.strength})`;
      }
      if (!shouldSell && sniper.volumeAccumulation?.detected &&
          sniper.volumeAccumulation.direction === 'bearish' &&
          sniper.volumeAccumulation.strength > 70) {
        shouldSell = true;
        sellReason = `SNIPER bearish vol accumulation (str: ${sniper.volumeAccumulation.strength})`;
      }
      if (!shouldSell && sniper.score?.isSniper &&
          sniper.score.direction === 'bearish' && sniper.score.score > 70) {
        shouldSell = true;
        sellReason = `SNIPER strong bearish (score: ${sniper.score.score})`;
      }
    }

    // 3. RSI overbought in downtrend -> take profit
    if (!shouldSell && indicators.rsi > 75 &&
        (indicators.trend?.direction === 'DOWN' || indicators.trend?.direction === 'STRONG_DOWN')) {
      shouldSell = true;
      sellReason = `RSI overbought (${indicators.rsi.toFixed(1)}) in downtrend`;
    }

    // 4. Breakout below support
    if (!shouldSell && indicators.breakout?.direction === 'down') {
      shouldSell = true;
      sellReason = 'Breakdown below support';
    }

    // 5. Cost-basis stop loss: price drops >15% below avg cost
    const avgCost = state.costBasis[symbol];
    if (!shouldSell && avgCost && indicators.currentPrice < avgCost * 0.85) {
      shouldSell = true;
      const dropPct = ((1 - indicators.currentPrice / avgCost) * 100).toFixed(1);
      sellReason = `Cost-basis stop loss (${dropPct}% below avg cost)`;
    }

    if (!shouldSell) continue;

    const lotFilter = getLotSizeFilter(info, symbol);
    const step = lotFilter ? Number(lotFilter.stepSize || 0) : 0;
    const sellQty = floorToStep(free, step || 0);
    if (sellQty <= 0) continue;

    console.log(`[SPOT DCA][SMART EXIT] ${symbol}: ${sellReason}`);

    if (SPOT_DCA_DRY_RUN) {
      console.log(`[SPOT DCA][DRY] SMART SELL ${symbol} qty=${sellQty}`);
    } else {
      try {
        await placeSpotOrder({ symbol, side: 'SELL', quantity: sellQty });
        state.lastSells[symbol] = Date.now();
        delete state.costBasis[symbol];
        delete state.totalSpent[symbol];
        delete state.totalQty[symbol];
        saveState(state);
      } catch (err) {
        console.error(`[SPOT DCA] Smart exit failed for ${symbol}:`, err.message);
      }
    }
  }
}

// --- MAIN DCA EXECUTION ---

async function runSpotDca({ latestCandles }) {
  if (!SPOT_DCA_ENABLED) return;

  const symbols = SPOT_DCA_SYMBOLS.length ? SPOT_DCA_SYMBOLS : DEFAULT_DCA_SYMBOLS;
  const plan = await buildDcaPlan({
    symbols,
    interval: SPOT_DCA_INTERVAL,
    budget: SPOT_DCA_BUDGET,
    latestCandles
  });

  let balances;
  try {
    balances = await getSpotBalances();
  } catch (err) {
    console.error('[SPOT DCA] Failed to fetch balances:', err.message);
    return;
  }
  if (!balances) {
    console.log('[SPOT DCA] Missing API keys, skipping execution.');
    return;
  }

  const info = await getExchangeInfo();
  const state = loadState();
  let availableUsdc = getFreeBalance(balances, 'USDC');

  for (const item of plan.items) {
    if (item.action === 'ACCUMULATE') {
      if (!dueForPurchase(state.lastBuys[item.symbol], item.cadence)) continue;

      // Sniper entry logic
      const sniperResult = determineSniperEntry(item, state);

      if (sniperResult.shouldWait) {
        if (!state.sniperWaitStart[item.symbol]) {
          state.sniperWaitStart[item.symbol] = Date.now();
        }
        console.log(`[SPOT DCA] ${item.symbol}: ${sniperResult.reason}`);
        continue;
      }

      if (sniperResult.useSniper) {
        console.log(`[SPOT DCA][SNIPER] ${item.symbol}: ${sniperResult.reason}`);
      }

      // Clear sniper wait state since we're executing
      delete state.sniperWaitStart[item.symbol];

      // Smart sizing
      const spend = calculateSpotSpend(item, sniperResult, availableUsdc);
      if (spend < SPOT_DCA_MIN_TRADE || availableUsdc < SPOT_DCA_MIN_USDC) continue;

      // Track cost basis (weighted average)
      const prevSpent = state.totalSpent[item.symbol] || 0;
      const prevQty = state.totalQty[item.symbol] || 0;
      const estimatedQty = item.price ? spend / item.price : 0;

      if (item.reentrySuggested) {
        state.costBasis[item.symbol] = item.price;
        state.totalSpent[item.symbol] = spend;
        state.totalQty[item.symbol] = estimatedQty;
      } else {
        state.totalSpent[item.symbol] = prevSpent + spend;
        state.totalQty[item.symbol] = prevQty + estimatedQty;
        if (state.totalQty[item.symbol] > 0) {
          state.costBasis[item.symbol] = state.totalSpent[item.symbol] / state.totalQty[item.symbol];
        }
      }

      const sniperTag = sniperResult.useSniper ? '[SNIPER] ' : '';
      if (SPOT_DCA_DRY_RUN) {
        console.log(`[SPOT DCA][DRY] ${sniperTag}BUY ${item.symbol} for ${spend.toFixed(2)} USDC (score: ${item.sniperScore || 0})`);
      } else {
        try {
          await placeSpotOrder({ symbol: item.symbol, side: 'BUY', quoteOrderQty: spend });
          console.log(`[SPOT DCA] ${sniperTag}BUY ${item.symbol} for ${spend.toFixed(2)} USDC`);
        } catch (err) {
          console.error(`[SPOT DCA] Buy failed for ${item.symbol}:`, err.message);
          continue;
        }
      }

      availableUsdc -= spend;
      state.lastBuys[item.symbol] = Date.now();

    } else if (item.action === 'SWAP_TO_USDC') {
      // Auto-sell holdings back to USDC
      const baseAsset = item.base;
      const free = getFreeBalance(balances, baseAsset);
      if (free <= 0) continue;

      const lotFilter = getLotSizeFilter(info, item.symbol);
      const step = lotFilter ? Number(lotFilter.stepSize || 0) : 0;
      const sellQty = floorToStep(free, step || 0);
      if (sellQty <= 0) continue;

      if (SPOT_DCA_DRY_RUN) {
        console.log(`[SPOT DCA][DRY] SELL ${item.symbol} qty=${sellQty} (SWAP_TO_USDC)`);
      } else {
        try {
          await placeSpotOrder({ symbol: item.symbol, side: 'SELL', quantity: sellQty });
          console.log(`[SPOT DCA] SELL ${item.symbol} qty=${sellQty} (SWAP_TO_USDC)`);
        } catch (err) {
          console.error(`[SPOT DCA] Sell failed for ${item.symbol}:`, err.message);
          continue;
        }
      }

      state.lastSells[item.symbol] = Date.now();
      delete state.costBasis[item.symbol];
      delete state.totalSpent[item.symbol];
      delete state.totalQty[item.symbol];
      delete state.sniperWaitStart[item.symbol];
    }
  }

  saveState(state);
}

// --- ENGINE STARTUP ---

function startSpotDcaEngine({ latestCandles, latestSignals }) {
  if (!SPOT_DCA_ENABLED) {
    console.log('[SPOT DCA] Disabled. Set SPOT_DCA_ENABLED=true to activate.');
    return null;
  }

  console.log(`[SPOT DCA] Started (${SPOT_DCA_DRY_RUN ? 'dry-run' : 'live'}, sniper: ${SPOT_DCA_SNIPER_ENABLED ? 'on' : 'off'}, smart-exit: ${SPOT_DCA_SMART_EXIT_ENABLED ? 'on' : 'off'})`);

  // Main DCA loop (every 5min default)
  const dcaTimer = setInterval(() => {
    runSpotDca({ latestCandles }).catch((err) => {
      console.error('[SPOT DCA] Execution error:', err.message);
    });
  }, SPOT_DCA_INTERVAL_MS);

  // Smart exit monitoring (every 2min)
  let exitTimer = null;
  if (SPOT_DCA_SMART_EXIT_ENABLED) {
    exitTimer = setInterval(() => {
      monitorSpotHoldings({ latestCandles }).catch((err) => {
        console.error('[SPOT DCA] Smart exit error:', err.message);
      });
    }, 120_000);
  }

  return { dcaTimer, exitTimer };
}

function getSpotDcaStatus() {
  return {
    enabled: SPOT_DCA_ENABLED,
    dryRun: SPOT_DCA_DRY_RUN,
    sniperEnabled: SPOT_DCA_SNIPER_ENABLED,
    smartExitEnabled: SPOT_DCA_SMART_EXIT_ENABLED,
    budget: SPOT_DCA_BUDGET,
    interval: SPOT_DCA_INTERVAL,
    minTrade: SPOT_DCA_MIN_TRADE
  };
}

module.exports = {
  startSpotDcaEngine,
  getSpotDcaStatus,
  getSpotBalances,
  getFreeBalance
};
