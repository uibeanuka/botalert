const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildDcaPlan, DEFAULT_DCA_SYMBOLS } = require('./dcaPlanner');
const { getSpotExchangeInfo } = require('./binance');

const API_BASE = process.env.BINANCE_SPOT_API_URL || 'https://api.binance.com';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

const SPOT_DCA_ENABLED = process.env.SPOT_DCA_ENABLED === 'true';
const SPOT_DCA_DRY_RUN = process.env.SPOT_DCA_DRY_RUN !== 'false';
const SPOT_DCA_INTERVAL_MS = Number(process.env.SPOT_DCA_INTERVAL_MS || 300_000);
const SPOT_DCA_INTERVAL = process.env.SPOT_DCA_INTERVAL || '1h';
const SPOT_DCA_BUDGET = Number(process.env.SPOT_DCA_BUDGET || 100);
const SPOT_DCA_MIN_USDC = Number(process.env.SPOT_DCA_MIN_USDC || 10);
const SPOT_DCA_MIN_TRADE = Number(process.env.SPOT_DCA_MIN_TRADE || 10);
const SPOT_DCA_SYMBOLS = (process.env.SPOT_DCA_SYMBOLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('Spot DCA: failed to load state:', err.message);
  }
  return { lastBuys: {}, lastSells: {}, costBasis: {} };
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

async function runSpotDca({ latestCandles }) {
  if (!SPOT_DCA_ENABLED) return;

  const symbols = SPOT_DCA_SYMBOLS.length ? SPOT_DCA_SYMBOLS : DEFAULT_DCA_SYMBOLS;
  const plan = await buildDcaPlan({
    symbols,
    interval: SPOT_DCA_INTERVAL,
    budget: SPOT_DCA_BUDGET,
    latestCandles
  });

  const balances = await getSpotBalances();
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
      const desiredSpend = item.cadence === 'daily' ? item.dailyAmount : item.weeklyAmount;
      const spend = Math.min(availableUsdc, desiredSpend || 0);
      if (spend < SPOT_DCA_MIN_TRADE || availableUsdc < SPOT_DCA_MIN_USDC) continue;

      if (item.reentrySuggested) {
        state.costBasis[item.symbol] = item.price;
      }

      if (SPOT_DCA_DRY_RUN) {
        console.log(`[SPOT DCA][DRY] BUY ${item.symbol} for ${spend} USDC`);
      } else {
        await placeSpotOrder({ symbol: item.symbol, side: 'BUY', quoteOrderQty: spend });
      }

      availableUsdc -= spend;
      state.lastBuys[item.symbol] = Date.now();
    } else if (item.action === 'SWAP_TO_USDC') {
      const baseAsset = item.base;
      const free = getFreeBalance(balances, baseAsset);
      if (free <= 0) continue;

      const lotFilter = getLotSizeFilter(info, item.symbol);
      const step = lotFilter ? Number(lotFilter.stepSize || 0) : 0;
      const sellQty = floorToStep(free, step || 0);
      if (sellQty <= 0) continue;

      if (SPOT_DCA_DRY_RUN) {
        console.log(`[SPOT DCA][DRY] SELL ${item.symbol} qty=${sellQty}`);
      } else {
        await placeSpotOrder({ symbol: item.symbol, side: 'SELL', quantity: sellQty });
      }

      state.lastSells[item.symbol] = Date.now();
    }
  }

  saveState(state);
}

function startSpotDcaEngine({ latestCandles }) {
  if (!SPOT_DCA_ENABLED) {
    console.log('[SPOT DCA] Disabled. Set SPOT_DCA_ENABLED=true to activate.');
    return null;
  }

  console.log(`[SPOT DCA] Started (${SPOT_DCA_DRY_RUN ? 'dry-run' : 'live'})`);
  const timer = setInterval(() => {
    runSpotDca({ latestCandles }).catch((err) => {
      console.error('[SPOT DCA] Execution error:', err.message);
    });
  }, SPOT_DCA_INTERVAL_MS);

  return timer;
}

module.exports = {
  startSpotDcaEngine
};
