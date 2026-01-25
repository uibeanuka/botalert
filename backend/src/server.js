require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { getCandles, getUsdtPerpetualMarkets } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');
const { executeTrade, closePosition, getStatus: getTradingStatus, TRADING_ENABLED, MIN_CONFIDENCE } = require('./trading');

const PORT = Number(process.env.PORT || 5000);
const POLL_MS = Number(process.env.POLL_MS || 15_000);
// If SYMBOLS is "ALL" or empty, auto-discover all futures symbols
const SYMBOLS_RAW = (process.env.SYMBOLS || '').trim();
const DEFAULT_SYMBOLS = SYMBOLS_RAW.toUpperCase() === 'ALL' ? [] : SYMBOLS_RAW.split(',').map((s) => s.trim()).filter(Boolean);
const MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 25);
const VALID_INTERVALS = new Set([
  '1s',
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M'
]);

const DEFAULT_INTERVALS = (process.env.POLL_INTERVALS || process.env.BINANCE_INTERVAL || '1m,5m,15m,1h,4h')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => VALID_INTERVALS.has(s));
const PUSH_CONTACT = process.env.PUSH_CONTACT || 'mailto:you@example.com';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const subscriptions = [];
const latestSignals = new Map(); // key: symbol-interval
const latestCandles = new Map(); // key: symbol-interval
let trackedSymbols = [...DEFAULT_SYMBOLS];
let trackedIntervals = [...DEFAULT_INTERVALS];
let pollers = [];

configureWebPush();
bootstrapTracking();

io.on('connection', (socket) => {
  socket.emit('bootstrap', {
    signals: Array.from(latestSignals.values()),
    symbols: trackedSymbols,
    intervals: trackedIntervals
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/signals', (_req, res) => {
  res.json({ signals: Array.from(latestSignals.values()) });
});

app.get('/api/candles/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const interval = (req.query.interval || trackedIntervals[0] || '1m').toString();
  const key = buildKey(symbol, interval);
  res.json({ symbol, interval, candles: latestCandles.get(key) || [] });
});

app.get('/api/markets', async (_req, res) => {
  try {
    const markets = await getUsdtPerpetualMarkets();
    res.json({ markets });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load markets', message: error.message });
  }
});

app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  const exists = subscriptions.find((s) => s.endpoint === subscription.endpoint);
  if (!exists) subscriptions.push(subscription);
  res.status(201).json({ ok: true });
});

app.post('/api/user-alerts', (req, res) => {
  // Placeholder for persistence; currently handled client-side via websocket feed.
  res.status(201).json({ ok: true, note: 'Server stores subscriptions only in memory.' });
});

app.get('/api/meta', (_req, res) => {
  res.json({ symbols: trackedSymbols, intervals: trackedIntervals });
});

app.get('/api/tracking', (_req, res) => {
  res.json({ symbols: trackedSymbols, intervals: trackedIntervals });
});

app.post('/api/tracking', async (req, res) => {
  const { symbols, intervals } = req.body || {};
  const nextSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols.map((s) => s.toUpperCase()) : trackedSymbols;
  const nextIntervals = Array.isArray(intervals) && intervals.length > 0 ? intervals : trackedIntervals;
  await updateTracking(nextSymbols, nextIntervals);
  res.json({ symbols: trackedSymbols, intervals: trackedIntervals });
});

// Trading endpoints
app.get('/api/trading/status', (_req, res) => {
  res.json(getTradingStatus());
});

app.post('/api/trading/close/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const result = await closePosition(symbol, 'API request');
  res.json(result);
});

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

async function pollSymbol(symbol, interval) {
  try {
    const candles = await getCandles(symbol, interval);
    const key = buildKey(symbol, interval);
    latestCandles.set(key, candles);

    const indicators = calculateIndicators(candles);
    const ai = predictNextMove(indicators);
    const signal = deriveSignal(symbol, interval, indicators, ai);

    if (signal) {
      latestSignals.set(buildKey(symbol, interval), signal);
      io.emit('signal', signal);

      if (ai.confidence >= 0.7) {
        sendPushNotification(`${symbol}: ${signal.signal}`, buildPushBody(signal));
      }

      // Auto-execute trade if enabled and meets criteria
      if (TRADING_ENABLED && ai.confidence >= MIN_CONFIDENCE && ai.trade) {
        const tradeResult = await executeTrade(signal);
        if (tradeResult.executed) {
          io.emit('trade', { type: 'OPENED', ...tradeResult.order });
          sendPushNotification(
            `TRADE: ${signal.ai.trade.type} ${symbol}`,
            `Entry: ${signal.ai.trade.entry} | SL: ${tradeResult.order.stopLoss} | TP: ${tradeResult.order.takeProfit}`
          );
        }
      }
    } else {
      latestSignals.set(key, {
        symbol,
        signal: 'NEUTRAL',
        ai,
        indicators,
        interval,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error(`Failed to poll ${symbol} ${interval}`, error.message);
  }
}

function deriveSignal(symbol, interval, indicators, ai) {
  if (!indicators || !ai) return null;
  const timestamp = Date.now();

  let signal = null;
  const direction = ai.direction;

  if (direction === 'long' && ai.confidence >= 0.55) signal = 'LONG';
  if (direction === 'short' && ai.confidence >= 0.55) signal = 'SHORT';
  if (indicators.breakout?.direction === 'up') signal = 'BREAKOUT_UP';
  if (indicators.breakout?.direction === 'down') signal = 'BREAKOUT_DOWN';

  if (!signal) return null;

  return {
    symbol,
    signal,
    ai,
    indicators,
    interval,
    timestamp
  };
}

async function bootstrapTracking() {
  if (trackedSymbols.length === 0) {
    try {
      const { getFuturesSymbols } = require('./binance');
      const discovered = await getFuturesSymbols();
      trackedSymbols = discovered.slice(0, MAX_SYMBOLS);
      console.log(`Discovered ${trackedSymbols.length} futures symbols`);
    } catch (error) {
      console.warn('Falling back to BTCUSDT only; discovery failed:', error.message);
      trackedSymbols = ['BTCUSDT'];
    }
  }
  // Ensure symbols are unique and trimmed
  trackedSymbols = Array.from(new Set(trackedSymbols.map((s) => s.trim().toUpperCase()))).slice(0, MAX_SYMBOLS);

  // Ensure intervals are valid and deduped
  trackedIntervals = Array.from(new Set(trackedIntervals.filter((i) => VALID_INTERVALS.has(i))));
  schedulePolling();
}

async function updateTracking(symbols, intervals) {
  trackedSymbols = symbols;
  trackedIntervals = intervals;
  schedulePolling();
}

function configureWebPush() {
  const hasKeys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;
  if (!hasKeys) {
    console.warn('Web push disabled: missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY');
    return;
  }

  webpush.setVapidDetails(PUSH_CONTACT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

function sendPushNotification(title, body) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const payload = JSON.stringify({ title, body });
  subscriptions.forEach((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      console.error('Push send failed:', err.message);
    });
  });
}

function buildPushBody(signal) {
  const { indicators } = signal;
  const rsi = indicators?.rsi ? indicators.rsi.toFixed(2) : 'n/a';
  const macd = indicators?.macd?.histogram ? indicators.macd.histogram.toFixed(4) : 'n/a';
  return `AI ${Math.round(signal.ai.confidence * 100)}% | ${signal.interval} | RSI ${rsi} | MACD hist ${macd}`;
}

function buildKey(symbol, interval) {
  return `${symbol}-${interval}`;
}

function clearPollers() {
  pollers.forEach((id) => clearInterval(id));
  pollers = [];
}

function schedulePolling() {
  clearPollers();
  trackedSymbols.forEach((symbol) => {
    trackedIntervals.forEach((interval) => {
      pollSymbol(symbol, interval);
      const id = setInterval(() => pollSymbol(symbol, interval), POLL_MS);
      pollers.push(id);
    });
  });
}
