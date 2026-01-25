const axios = require('axios');

const API_BASE = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
const API_FALLBACK = process.env.BINANCE_API_FALLBACK || '';
const API_KEY = process.env.BINANCE_API_KEY || '';
const DEFAULT_INTERVAL = process.env.BINANCE_INTERVAL || '1m';
const DEFAULT_LIMIT = Number(process.env.BINANCE_LIMIT || 150);

const baseUrls = [API_BASE].concat(API_FALLBACK ? [API_FALLBACK] : []);

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

async function getFuturesSymbols() {
  const res = await withFallback((client) => client.get('/fapi/v1/exchangeInfo'));
  return res.data.symbols
    .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
    .map((s) => s.symbol);
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

module.exports = {
  getFuturesSymbols,
  getUsdtPerpetualMarkets,
  getCandles
};
