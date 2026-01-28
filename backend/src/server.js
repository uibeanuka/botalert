require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { getCandles, getUsdtPerpetualMarkets, getTopGainers } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');
const { buildDcaPlan, DEFAULT_DCA_SYMBOLS } = require('./dcaPlanner');
const { executeTrade, closePosition, monitorAllPositions, getStatus: getTradingStatus, updateSettings, TRADING_ENABLED, MIN_CONFIDENCE } = require('./trading');
const { handleChatMessage } = require('./chatHandler');
const { getStats: getPatternStats, recordMissedOpportunity } = require('./patternMemory');
const { startSpotDcaEngine } = require('./spotDcaEngine');

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
startSpotDcaEngine({ latestCandles, latestSignals });

io.on('connection', (socket) => {
  socket.emit('bootstrap', {
    signals: Array.from(latestSignals.values()),
    symbols: trackedSymbols,
    intervals: trackedIntervals
  });

  // Chat handler
  socket.on('chat:message', async (data) => {
    const { message, id } = data || {};
    const context = {
      latestSignals,
      latestCandles,
      trackedSymbols,
      trackedIntervals,
      executeTrade,
      closePosition,
      getTradingStatus,
      updateSettings,
      getPatternStats,
      getTopGainers,
    };

    const reply = await handleChatMessage(message || '', context);
    socket.emit('chat:reply', { id, ...reply, timestamp: Date.now() });
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Get server's outbound IP for Binance API whitelist
app.get('/api/server-ip', async (_req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
    res.json({ ip: response.data.ip, note: 'Add this IP to your Binance API whitelist' });
  } catch (err) {
    res.status(500).json({ error: 'Could not determine server IP', message: err.message });
  }
});

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

app.get('/api/top-movers', async (_req, res) => {
  try {
    const gainers = await getTopGainers(3, 20);
    res.json({ movers: gainers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top movers', message: error.message });
  }
});

app.get('/api/meta', (_req, res) => {
  res.json({ symbols: trackedSymbols, intervals: trackedIntervals });
});

app.get('/api/dca-plan', async (req, res) => {
  const rawSymbols = (req.query.symbols || '').toString();
  const symbols = rawSymbols
    ? rawSymbols.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_DCA_SYMBOLS;
  const intervalRaw = (req.query.interval || '1h').toString();
  const interval = VALID_INTERVALS.has(intervalRaw) ? intervalRaw : '1h';
  const budgetRaw = Number(req.query.budget || 100);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : 100;

  try {
    const plan = await buildDcaPlan({
      symbols,
      interval,
      budget,
      latestCandles
    });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Failed to build DCA plan', message: error.message });
  }
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
      // Sniper signals use a lower confidence gate (15% less) for early entry
      const isSniper = ai.trade?.isSniper || signal.signal?.includes('SNIPER') || ai.sniperAnalysis?.isSniper;
      const entryThreshold = isSniper ? Math.max(0.50, MIN_CONFIDENCE - 0.15) : MIN_CONFIDENCE;
      if (TRADING_ENABLED && ai.confidence >= entryThreshold && ai.trade) {
        const tradeResult = await executeTrade(signal);
        if (tradeResult.executed) {
          io.emit('trade', { type: 'OPENED', ...tradeResult.order });
          sendPushNotification(
            `TRADE: ${signal.ai.trade.type} ${symbol}`,
            `Entry: ${signal.ai.trade.entry} | SL: ${tradeResult.order.stopLoss} | TP: ${tradeResult.order.takeProfit}`
          );
        } else {
          console.log(`[TRADE REJECTED] ${symbol} ${interval}: ${tradeResult.reason} (conf: ${(ai.confidence * 100).toFixed(0)}%, signal: ${signal.signal})`);
        }
      } else if (TRADING_ENABLED && ai.trade && ai.confidence < entryThreshold) {
        console.log(`[TRADE SKIPPED] ${symbol} ${interval}: confidence ${(ai.confidence * 100).toFixed(0)}% < threshold ${(entryThreshold * 100).toFixed(0)}% (signal: ${signal.signal}${isSniper ? ', sniper' : ''})`);
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

  // Use AI's own signal type instead of re-deriving from direction
  let signal = ai.signal;

  // If AI says HOLD, check for breakout-only entries
  if (signal === 'HOLD' || !signal) {
    if (indicators.breakout?.direction === 'up' && ai.confidence >= 0.55) signal = 'LONG';
    else if (indicators.breakout?.direction === 'down' && ai.confidence >= 0.55) signal = 'SHORT';
  }

  // Breakout confluence: upgrade (never override) directional signals
  if (indicators.breakout?.direction === 'up' && ['LONG', 'STRONG_LONG', 'SNIPER_LONG'].includes(signal)) {
    signal = 'STRONG_LONG';
  }
  if (indicators.breakout?.direction === 'down' && ['SHORT', 'STRONG_SHORT', 'SNIPER_SHORT'].includes(signal)) {
    signal = 'STRONG_SHORT';
  }

  if (!signal || signal === 'HOLD') return null;

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

// Track which symbols we've already studied in recent scans (avoid duplicate learning)
const studiedMovers = new Map(); // symbol -> last study timestamp

// Scan top gainers/losers, study what their indicators looked like, and record patterns
async function scanTopMovers() {
  try {
    const gainers = await getTopGainers(5, 20); // Symbols up 5%+ with >$1M volume
    const now = Date.now();
    const cooldown = 30 * 60 * 1000; // Don't re-study same symbol within 30 min

    let studied = 0;
    for (const mover of gainers) {
      // Skip if recently studied
      const lastStudied = studiedMovers.get(mover.symbol);
      if (lastStudied && (now - lastStudied) < cooldown) continue;

      // Skip if already tracked and has a signal (the normal pipeline handles it)
      const existingSignal = latestSignals.get(buildKey(mover.symbol, '15m'));
      if (existingSignal && existingSignal.signal !== 'NEUTRAL' && existingSignal.signal !== 'HOLD') continue;

      try {
        // Fetch candles for this mover on 15m and 1h to study the setup
        const candles15m = await getCandles(mover.symbol, '15m', 100);
        const indicators15m = calculateIndicators(candles15m);

        if (indicators15m) {
          const direction = mover.priceChangePercent > 0 ? 'long' : 'short';
          recordMissedOpportunity(indicators15m, mover.symbol, '15m', mover.priceChangePercent, direction);
          studied++;

          // Also emit this as a learning event so the frontend knows
          io.emit('learn', {
            type: 'missed_opportunity',
            symbol: mover.symbol,
            change: mover.priceChangePercent,
            direction,
            timestamp: now
          });
        }

        studiedMovers.set(mover.symbol, now);

        // Don't overwhelm the API — study max 5 per scan
        if (studied >= 5) break;
      } catch (err) {
        // Skip symbols that fail (might be delisted or API issue)
        console.error(`[SCAN] Failed to study ${mover.symbol}:`, err.message);
      }
    }

    if (studied > 0) {
      console.log(`[SCANNER] Studied ${studied} top movers, learned from missed opportunities`);
    }

    // Clean up old entries from studiedMovers (older than 2 hours)
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    for (const [symbol, ts] of studiedMovers) {
      if (ts < twoHoursAgo) studiedMovers.delete(symbol);
    }
  } catch (err) {
    console.error('[SCANNER] Top movers scan failed:', err.message);
  }
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

  // Scan top movers every 5 minutes to learn from missed opportunities
  const scanId = setInterval(() => scanTopMovers(), 5 * 60 * 1000);
  pollers.push(scanId);
  // Run first scan after 60 seconds (let normal polling populate first)
  setTimeout(() => scanTopMovers(), 60 * 1000);

  // Monitor open positions every 30 seconds for smart exits
  if (TRADING_ENABLED) {
    const monitorId = setInterval(async () => {
      try {
        const results = await monitorAllPositions(latestSignals);
        for (const result of results) {
          if (result.closed) {
            io.emit('trade', { type: 'SMART_EXIT', symbol: result.symbol, reason: result.reason });
            sendPushNotification(
              `SMART EXIT: ${result.symbol}`,
              result.reason
            );
          }
        }
      } catch (err) {
        console.error('Position monitoring error:', err.message);
      }
    }, 30000);
    pollers.push(monitorId);
  }
}
