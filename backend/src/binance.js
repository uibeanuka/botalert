const axios = require('axios');

const API_BASE = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
const API_FALLBACK = process.env.BINANCE_API_FALLBACK || '';
const SPOT_API_BASE = process.env.BINANCE_SPOT_API_URL || 'https://api.binance.com';
const API_KEY = process.env.BINANCE_API_KEY || '';
const DEFAULT_INTERVAL = process.env.BINANCE_INTERVAL || '1m';
const DEFAULT_LIMIT = Number(process.env.BINANCE_LIMIT || 150);

const baseUrls = [API_BASE].concat(API_FALLBACK ? [API_FALLBACK] : []);
const spotClient = buildClient(SPOT_API_BASE);

function buildClient(baseURL) {
  return axios.create({
    baseURL,
    timeout: 12_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DECODE/1.0; +https://github.com/decodecodes)',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip,deflate,br',
      ...(API_KEY ? { 'X-MBX-APIKEY': API_KEY } : {})
    }
  });
}

async function withFallback(fn) {
  let lastError;
  for (const baseURL of baseUrls) {
    try {
      const client = buildClient(baseURL);
      return await fn(client);
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      // retry on common block codes
      if (status === 403 || status === 400 || status === 429 || status === 451) {
        continue;
      } else {
        break;
      }
    }
  }
  throw lastError;
}

// Priority symbols that should always be tracked first
const PRIORITY_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'FARTCOINUSDT', 'PENGUUSDT', 'PIPPINUSDT', 'ASTERUSDT', 'GIGGLEUSDT', 'TRADOORUSDT',
  'WIFUSDT', 'ORDIUSDT', '1000BONKUSDT', '1000PEPEUSDT', '1000SHIBUSDT', '1000FLOKIUSDT',
  'TURTLEUSDT', 'PUMPUSDT', 'CITYUSDT', 'AXLUSDT',
  'BTRUSDT', 'PTBUSDT', 'HYPEUSDT', '1000RATSUSDT'
];

async function getFuturesSymbols() {
  const res = await withFallback((client) => client.get('/fapi/v1/exchangeInfo'));
  const allSymbols = res.data.symbols
    .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
    .map((s) => s.symbol);

  // Ensure priority symbols are at the front so they're always included within MAX_SYMBOLS
  const prioritySet = new Set(PRIORITY_SYMBOLS);
  const prioritized = PRIORITY_SYMBOLS.filter(s => allSymbols.includes(s));
  const rest = allSymbols.filter(s => !prioritySet.has(s));

  return [...prioritized, ...rest];
}

async function getUsdtPerpetualMarkets() {
  const res = await withFallback((client) => client.get('/fapi/v1/exchangeInfo'));
  return res.data.symbols
    .filter(
      (s) =>
        s.contractType === 'PERPETUAL' &&
        s.status === 'TRADING' &&
        s.quoteAsset === 'USDT'
    )
    .map((s) => ({
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
      status: s.status,
      pair: s.pair,
      deliveryDate: s.deliveryDate
    }));
}

async function getCandles(symbol, interval = DEFAULT_INTERVAL, limit = DEFAULT_LIMIT) {
  const res = await withFallback((client) =>
    client.get('/fapi/v1/klines', {
      params: { symbol, interval, limit }
    })
  );

  return res.data.map((candle) => ({
    openTime: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    closeTime: candle[6]
  }));
}

async function getSpotCandles(symbol, interval = DEFAULT_INTERVAL, limit = DEFAULT_LIMIT) {
  const res = await spotClient.get('/api/v3/klines', {
    params: { symbol, interval, limit }
  });

  return res.data.map((candle) => ({
    openTime: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    closeTime: candle[6]
  }));
}

async function getSpotExchangeInfo() {
  const res = await spotClient.get('/api/v3/exchangeInfo');
  return res.data;
}

async function getSpotTickerPrice(symbol) {
  const res = await spotClient.get('/api/v3/ticker/price', { params: { symbol } });
  return Number(res.data?.price || 0);
}

// Get top movers (biggest 24h % change) from futures markets
async function getTopMovers(limit = 30) {
  const res = await withFallback((client) => client.get('/fapi/v1/ticker/24hr'));
  const tickers = res.data
    .filter((t) => t.symbol.endsWith('USDT'))
    .map((t) => ({
      symbol: t.symbol,
      priceChangePercent: Number(t.priceChangePercent),
      lastPrice: Number(t.lastPrice),
      volume: Number(t.quoteVolume), // USDT volume
      highPrice: Number(t.highPrice),
      lowPrice: Number(t.lowPrice)
    }));

  // Sort by absolute price change (biggest movers first)
  tickers.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));

  return tickers.slice(0, limit);
}

// Get top gainers only (pumping coins)
async function getTopGainers(minChange = 5, limit = 20) {
  const movers = await getTopMovers(200);
  return movers
    .filter((t) => t.priceChangePercent >= minChange && t.volume > 1_000_000) // Min $1M volume
    .slice(0, limit);
}

// Get coins with emerging volume surges (high volume increase but price hasn't fully pumped yet)
// This catches meme/alpha coins BEFORE the big move completes
async function getVolumeSurgers(limit = 30) {
  const res = await withFallback((client) => client.get('/fapi/v1/ticker/24hr'));
  const tickers = res.data
    .filter((t) => t.symbol.endsWith('USDT'))
    .map((t) => ({
      symbol: t.symbol,
      priceChangePercent: Number(t.priceChangePercent),
      lastPrice: Number(t.lastPrice),
      volume: Number(t.quoteVolume),
      highPrice: Number(t.highPrice),
      lowPrice: Number(t.lowPrice),
      weightedAvgPrice: Number(t.weightedAvgPrice),
      count: Number(t.count) // Number of trades
    }));

  // Find coins with high volume but modest price change (< 10%)
  // These are potentially accumulating before a bigger move
  const surgers = tickers
    .filter((t) =>
      t.volume > 500_000 && // Min $500K volume
      t.count > 5000 && // Min 5000 trades (active interest)
      Math.abs(t.priceChangePercent) >= 1 && // At least moving
      Math.abs(t.priceChangePercent) <= 15 // But hasn't fully pumped yet
    )
    .map((t) => {
      // Estimate "volume intensity" - high volume relative to modest price change
      // Higher = more volume per unit of price move = accumulation
      const volumePerPctMove = t.volume / Math.max(Math.abs(t.priceChangePercent), 0.1);
      return { ...t, volumePerPctMove };
    })
    .sort((a, b) => b.volumePerPctMove - a.volumePerPctMove);

  return surgers.slice(0, limit);
}

module.exports = {
  getFuturesSymbols,
  getUsdtPerpetualMarkets,
  getCandles,
  getSpotCandles,
  getSpotExchangeInfo,
  getSpotTickerPrice,
  getTopMovers,
  getTopGainers,
  getVolumeSurgers
};
