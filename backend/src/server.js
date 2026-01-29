require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const webpush = require('web-push');
const { getCandles, getUsdtPerpetualMarkets, getTopGainers, getVolumeSurgers } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');
const { buildDcaPlan, DEFAULT_DCA_SYMBOLS } = require('./dcaPlanner');
const { executeTrade, closePosition, monitorAllPositions, getStatus: getTradingStatus, updateSettings, TRADING_ENABLED, MIN_CONFIDENCE } = require('./trading');
const { handleChatMessage } = require('./chatHandler');
const { getStats: getPatternStats, recordMissedOpportunity } = require('./patternMemory');
const { startSpotDcaEngine, getSpotDcaStatus } = require('./spotDcaEngine');

// AI Trading System modules
const { detectChartPatterns } = require('./chartPatterns');
const { generateMLSignal, addTrainingSample, getModelStats, getFeatureImportance, trainModel } = require('./mlSignalGenerator');
const { analyzeSniperSetup, detectKillzone } = require('./sniperEngine');
const { runBacktest, loadBacktestHistory, runMonteCarloSimulation } = require('./backtesting');
const { calculatePositionSize, getRiskStatus, recordTrade, checkTradingAllowed, calculateKellySize, resetLimits, setRiskMultiplier } = require('./riskManager');
const { learnFromTrade, getLearningInsights, getLearnedRecommendation, getOptimalTradingHours, getOptimalTradingDays } = require('./aiLearning');

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
    const spotStatus = getSpotDcaStatus();
    res.json({ ...plan, spotDca: spotStatus });
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

// ============ AI TRADING SYSTEM ENDPOINTS ============

// Chart Pattern Detection
app.get('/api/ai/patterns/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = (req.query.interval || '1h').toString();
    const key = buildKey(symbol, interval);

    let candles = latestCandles.get(key);
    if (!candles || candles.length < 50) {
      candles = await getCandles(symbol, interval, 200);
    }

    const patterns = detectChartPatterns(candles);
    res.json({ symbol, interval, ...patterns });
  } catch (error) {
    res.status(500).json({ error: 'Failed to detect patterns', message: error.message });
  }
});

// ML Signal Generation
app.get('/api/ai/ml-signal/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = (req.query.interval || '15m').toString();
    const key = buildKey(symbol, interval);

    let candles = latestCandles.get(key);
    if (!candles || candles.length < 50) {
      candles = await getCandles(symbol, interval, 200);
    }

    const indicators = calculateIndicators(candles);
    const mlSignal = generateMLSignal(indicators);
    const standardSignal = predictNextMove(indicators);

    res.json({
      symbol,
      interval,
      mlSignal,
      standardSignal: {
        signal: standardSignal.signal,
        confidence: standardSignal.confidence,
        direction: standardSignal.direction
      },
      combined: {
        signal: mlSignal.confidence > standardSignal.confidence ? mlSignal.signal : standardSignal.signal,
        confidence: Math.max(mlSignal.confidence, standardSignal.confidence),
        agreement: mlSignal.direction === standardSignal.direction
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate ML signal', message: error.message });
  }
});

// ML Model Stats
app.get('/api/ai/ml-stats', (_req, res) => {
  try {
    const stats = getModelStats();
    const importance = getFeatureImportance();
    res.json({ stats, featureImportance: importance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get ML stats', message: error.message });
  }
});

// Trigger ML Training
app.post('/api/ai/ml-train', (_req, res) => {
  try {
    trainModel();
    const stats = getModelStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: 'Training failed', message: error.message });
  }
});

// Sniper Entry Analysis
app.get('/api/ai/sniper/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = (req.query.interval || '15m').toString();
    const key = buildKey(symbol, interval);

    let candles = latestCandles.get(key);
    if (!candles || candles.length < 50) {
      candles = await getCandles(symbol, interval, 200);
    }

    const indicators = calculateIndicators(candles);
    const sniperAnalysis = analyzeSniperSetup(candles, indicators);
    const killzone = detectKillzone();

    res.json({
      symbol,
      interval,
      ...sniperAnalysis,
      killzone
    });
  } catch (error) {
    res.status(500).json({ error: 'Sniper analysis failed', message: error.message });
  }
});

// Killzone Status
app.get('/api/ai/killzone', (_req, res) => {
  const killzone = detectKillzone();
  res.json(killzone);
});

// Backtesting
app.post('/api/ai/backtest', async (req, res) => {
  try {
    const { symbol, interval = '1h', options = {} } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    // Fetch historical candles (max available)
    const candles = await getCandles(symbol.toUpperCase(), interval, 1000);

    if (!candles || candles.length < 200) {
      return res.status(400).json({ error: 'Insufficient historical data' });
    }

    const result = await runBacktest(candles, { name: `${symbol}_${interval}` }, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Backtest failed', message: error.message });
  }
});

// Backtest History
app.get('/api/ai/backtest-history', (_req, res) => {
  try {
    const history = loadBacktestHistory();
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load backtest history', message: error.message });
  }
});

// Monte Carlo Simulation
app.post('/api/ai/monte-carlo', async (req, res) => {
  try {
    const { symbol, interval = '1h', simulations = 1000, options = {} } = req.body;

    // First run a backtest to get trades
    const candles = await getCandles(symbol.toUpperCase(), interval, 1000);
    const backtestResult = await runBacktest(candles, { name: `${symbol}_monte_carlo` }, options);

    if (!backtestResult.trades || backtestResult.trades.length < 10) {
      return res.status(400).json({ error: 'Not enough trades for Monte Carlo simulation' });
    }

    const monteCarloResult = runMonteCarloSimulation(
      backtestResult.trades,
      options.initialCapital || 10000,
      simulations
    );

    res.json({
      backtest: backtestResult.summary,
      monteCarlo: monteCarloResult
    });
  } catch (error) {
    res.status(500).json({ error: 'Monte Carlo simulation failed', message: error.message });
  }
});

// Risk Management Status
app.get('/api/ai/risk-status', (_req, res) => {
  try {
    const status = getRiskStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get risk status', message: error.message });
  }
});

// Calculate Position Size
app.post('/api/ai/position-size', (req, res) => {
  try {
    const {
      accountBalance,
      entryPrice,
      stopLossPrice,
      confidence = 0.6,
      signal = {},
      historicalStats = {}
    } = req.body;

    if (!accountBalance || !entryPrice || !stopLossPrice) {
      return res.status(400).json({ error: 'accountBalance, entryPrice, and stopLossPrice are required' });
    }

    const result = calculatePositionSize({
      accountBalance,
      entryPrice,
      stopLossPrice,
      confidence,
      signal,
      historicalStats
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Position sizing failed', message: error.message });
  }
});

// Kelly Criterion Calculator
app.post('/api/ai/kelly', (req, res) => {
  try {
    const { winRate, avgWin, avgLoss } = req.body;

    if (winRate === undefined || avgWin === undefined || avgLoss === undefined) {
      return res.status(400).json({ error: 'winRate, avgWin, and avgLoss are required' });
    }

    const kellyFraction = calculateKellySize(winRate, avgWin, avgLoss);

    res.json({
      kellyFraction: Math.round(kellyFraction * 10000) / 100, // As percentage
      quarterKelly: Math.round(kellyFraction * 25 * 100) / 100,
      halfKelly: Math.round(kellyFraction * 50 * 100) / 100,
      recommendation: kellyFraction > 0.25 ? 'HIGH_EDGE' : kellyFraction > 0.1 ? 'MODERATE_EDGE' : 'LOW_EDGE'
    });
  } catch (error) {
    res.status(500).json({ error: 'Kelly calculation failed', message: error.message });
  }
});

// Reset Risk Limits
app.post('/api/ai/risk-reset', (req, res) => {
  try {
    const { type = 'daily' } = req.body;
    const status = resetLimits(type);
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset limits', message: error.message });
  }
});

// Set Risk Multiplier
app.post('/api/ai/risk-multiplier', (req, res) => {
  try {
    const { multiplier } = req.body;
    if (multiplier === undefined) {
      return res.status(400).json({ error: 'multiplier is required' });
    }
    const newMultiplier = setRiskMultiplier(multiplier);
    res.json({ success: true, riskMultiplier: newMultiplier });
  } catch (error) {
    res.status(500).json({ error: 'Failed to set risk multiplier', message: error.message });
  }
});

// AI Learning Insights
app.get('/api/ai/learning', (_req, res) => {
  try {
    const insights = getLearningInsights();
    res.json(insights);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get learning insights', message: error.message });
  }
});

// AI Learned Recommendation
app.get('/api/ai/recommendation/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = (req.query.interval || '15m').toString();
    const key = buildKey(symbol, interval);

    let candles = latestCandles.get(key);
    if (!candles || candles.length < 50) {
      candles = await getCandles(symbol, interval, 200);
    }

    const indicators = calculateIndicators(candles);
    const learned = getLearnedRecommendation(indicators);
    const standard = predictNextMove(indicators);

    res.json({
      symbol,
      interval,
      learned,
      standard: {
        signal: standard.signal,
        confidence: standard.confidence,
        direction: standard.direction,
        reasons: standard.reasons
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recommendation', message: error.message });
  }
});

// Optimal Trading Times
app.get('/api/ai/optimal-times', (_req, res) => {
  try {
    const hours = getOptimalTradingHours();
    const days = getOptimalTradingDays();
    const killzone = detectKillzone();

    res.json({
      hours,
      days,
      currentKillzone: killzone
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get optimal times', message: error.message });
  }
});

// Combined AI Analysis (all systems)
app.get('/api/ai/full-analysis/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const interval = (req.query.interval || '15m').toString();

    const candles = await getCandles(symbol, interval, 200);
    if (!candles || candles.length < 50) {
      return res.status(400).json({ error: 'Insufficient data' });
    }

    const indicators = calculateIndicators(candles);
    const standardAI = predictNextMove(indicators);
    const mlSignal = generateMLSignal(indicators);
    const patterns = detectChartPatterns(candles);
    const sniper = analyzeSniperSetup(candles, indicators);
    const learned = getLearnedRecommendation(indicators);
    const killzone = detectKillzone();
    const riskStatus = getRiskStatus();

    // Consensus signal
    const signals = [
      { source: 'standard', direction: standardAI.direction, confidence: standardAI.confidence },
      { source: 'ml', direction: mlSignal.direction, confidence: mlSignal.confidence },
      { source: 'patterns', direction: patterns.summary?.dominantDirection, confidence: patterns.patterns[0]?.confidence / 100 || 0 },
      { source: 'sniper', direction: sniper.bestEntry?.direction, confidence: sniper.bestEntry?.confidence / 100 || 0 },
      { source: 'learned', direction: learned.action === 'LONG' ? 'long' : learned.action === 'SHORT' ? 'short' : 'neutral', confidence: learned.confidence }
    ].filter(s => s.direction && s.direction !== 'neutral');

    const bullishVotes = signals.filter(s => s.direction === 'bullish' || s.direction === 'long').length;
    const bearishVotes = signals.filter(s => s.direction === 'bearish' || s.direction === 'short').length;
    const avgConfidence = signals.length > 0 ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length : 0;

    res.json({
      symbol,
      interval,
      timestamp: Date.now(),

      consensus: {
        direction: bullishVotes > bearishVotes ? 'LONG' : bearishVotes > bullishVotes ? 'SHORT' : 'HOLD',
        bullishVotes,
        bearishVotes,
        avgConfidence: Math.round(avgConfidence * 100),
        agreement: Math.abs(bullishVotes - bearishVotes) >= 3 ? 'STRONG' : Math.abs(bullishVotes - bearishVotes) >= 2 ? 'MODERATE' : 'WEAK'
      },

      analysis: {
        standard: {
          signal: standardAI.signal,
          confidence: standardAI.confidence,
          reasons: standardAI.reasons?.slice(0, 3)
        },
        ml: {
          signal: mlSignal.signal,
          confidence: mlSignal.confidence,
          topFeatures: mlSignal.topFeatures?.slice(0, 3)
        },
        patterns: {
          detected: patterns.patterns.length,
          best: patterns.summary?.bestPattern,
          direction: patterns.summary?.dominantDirection
        },
        sniper: {
          hasSetup: sniper.hasSetup,
          entries: sniper.entries?.length || 0,
          best: sniper.bestEntry ? {
            type: sniper.bestEntry.type,
            confidence: sniper.bestEntry.confidence,
            entry: sniper.bestEntry.entryZone
          } : null
        },
        learned: {
          action: learned.action,
          confidence: learned.confidence,
          regime: learned.regime
        }
      },

      timing: {
        killzone,
        isOptimalTime: killzone.isOptimalTime
      },

      risk: {
        tradingAllowed: riskStatus.tradingAllowed,
        riskLevel: riskStatus.riskLevel,
        currentDrawdown: riskStatus.currentState?.currentDrawdown
      },

      tradeLevels: standardAI.trade ? {
        entry: standardAI.trade.entry,
        stopLoss: standardAI.trade.stopLoss,
        takeProfit: standardAI.trade.takeProfit,
        riskPercent: standardAI.trade.riskPercent
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Full analysis failed', message: error.message });
  }
});

// ============ END AI TRADING SYSTEM ENDPOINTS ============

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
      // Volume surge signals use even lower gates (20% less for explosive)
      const isSniper = ai.trade?.isSniper || signal.signal?.includes('SNIPER') || ai.sniperAnalysis?.isSniper;
      const isVolumeSurge = ai.sniperAnalysis?.isVolumeSurge || indicators?.volumeSurge?.detected;
      const isExplosiveSurge = ai.sniperAnalysis?.volumeSurge?.isExplosive || indicators?.volumeSurge?.isExplosive;
      let entryThreshold = MIN_CONFIDENCE;
      if (isExplosiveSurge) {
        entryThreshold = Math.max(0.45, MIN_CONFIDENCE - 0.20);
      } else if (isVolumeSurge) {
        entryThreshold = Math.max(0.50, MIN_CONFIDENCE - 0.15);
      } else if (isSniper) {
        entryThreshold = Math.max(0.50, MIN_CONFIDENCE - 0.15);
      }
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
        const tag = isExplosiveSurge ? ', explosive surge' : isVolumeSurge ? ', surge' : isSniper ? ', sniper' : '';
        console.log(`[TRADE SKIPPED] ${symbol} ${interval}: confidence ${(ai.confidence * 100).toFixed(0)}% < threshold ${(entryThreshold * 100).toFixed(0)}% (signal: ${signal.signal}${tag})`);
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

// Proactive volume surge scanner — finds coins with emerging volume surges BEFORE the pump
// This is the key to catching meme/alpha like PIPPIN, BTR, PTB, HYPE, 1000RATS early
const surgeCooldown = new Map(); // symbol -> last surge scan timestamp

async function scanVolumeSurges() {
  try {
    const surgers = await getVolumeSurgers(20);
    const now = Date.now();
    const cooldownMs = 15 * 60 * 1000; // 15 min cooldown per symbol
    let scanned = 0;
    let alerted = 0;

    for (const surger of surgers) {
      // Skip recently scanned
      const lastScan = surgeCooldown.get(surger.symbol);
      if (lastScan && (now - lastScan) < cooldownMs) continue;

      // Skip if already tracked with a recent signal
      const existing5m = latestSignals.get(buildKey(surger.symbol, '5m'));
      const existing15m = latestSignals.get(buildKey(surger.symbol, '15m'));
      const hasActiveSignal = (existing5m && existing5m.signal !== 'NEUTRAL' && existing5m.signal !== 'HOLD') ||
                              (existing15m && existing15m.signal !== 'NEUTRAL' && existing15m.signal !== 'HOLD');

      try {
        // Fetch short-term candles to analyze the surge
        const candles5m = await getCandles(surger.symbol, '5m', 50);
        const indicators5m = calculateIndicators(candles5m);

        if (!indicators5m) {
          surgeCooldown.set(surger.symbol, now);
          continue;
        }

        // Check if this coin actually has a volume surge in its candle data
        const volumeSurge = indicators5m.sniperSignals?.volumeSurge || indicators5m.volumeSurge;
        if (!volumeSurge?.detected) {
          surgeCooldown.set(surger.symbol, now);
          continue;
        }

        // Run AI prediction to understand WHY it's moving
        const ai = predictNextMove(indicators5m);
        scanned++;

        // Record the surge pattern for learning
        if (volumeSurge.detected) {
          const direction = surger.priceChangePercent > 0 ? 'long' : 'short';
          recordMissedOpportunity(indicators5m, surger.symbol, '5m', surger.priceChangePercent, direction);
        }

        // If AI finds a signal AND there's a volume surge, dynamically add to tracking
        const isActionable = ai.confidence >= 0.45 && ai.signal !== 'HOLD' && volumeSurge.strength >= 40;

        if (isActionable) {
          // Add to tracked symbols if not already tracked
          if (!trackedSymbols.includes(surger.symbol)) {
            // Add it (temporarily displacing the last non-priority symbol)
            trackedSymbols.push(surger.symbol);
            // Start polling this symbol immediately
            trackedIntervals.forEach((interval) => {
              pollSymbol(surger.symbol, interval);
              const id = setInterval(() => pollSymbol(surger.symbol, interval), POLL_MS);
              pollers.push(id);
            });
            console.log(`[SURGE SCANNER] Dynamically added ${surger.symbol} to tracking (surge: ${volumeSurge.intensity.toFixed(1)}x, AI: ${ai.signal} ${(ai.confidence * 100).toFixed(0)}%)`);
          }

          // Emit surge alert
          const signal = deriveSignal(surger.symbol, '5m', indicators5m, ai);
          if (signal) {
            latestSignals.set(buildKey(surger.symbol, '5m'), signal);
            io.emit('signal', signal);
            io.emit('surge', {
              type: 'volume_surge',
              symbol: surger.symbol,
              price: surger.lastPrice,
              change: surger.priceChangePercent,
              volumeIntensity: volumeSurge.intensity,
              surgeStrength: volumeSurge.strength,
              isExplosive: volumeSurge.isExplosive,
              aiSignal: ai.signal,
              aiConfidence: ai.confidence,
              reasons: ai.reasons?.slice(0, 4) || [],
              timestamp: now
            });
            alerted++;

            // Auto-execute if trading is enabled and meets threshold
            const isSniper = ai.trade?.isSniper || signal.signal?.includes('SNIPER') || ai.sniperAnalysis?.isSniper;
            const isSurge = volumeSurge.isExplosive;
            // Volume surge trades get aggressive threshold: 45% for explosive, 50% for regular surge
            const surgeThreshold = isSurge ? 0.45 : (isSniper ? Math.max(0.50, MIN_CONFIDENCE - 0.15) : MIN_CONFIDENCE);

            if (TRADING_ENABLED && ai.confidence >= surgeThreshold && ai.trade) {
              const tradeResult = await executeTrade(signal);
              if (tradeResult.executed) {
                io.emit('trade', { type: 'SURGE_ENTRY', ...tradeResult.order });
                sendPushNotification(
                  `SURGE TRADE: ${ai.trade.type} ${surger.symbol}`,
                  `Vol ${volumeSurge.intensity.toFixed(1)}x | ${surger.priceChangePercent.toFixed(1)}% | ${ai.reasons?.[0] || ''}`
                );
                console.log(`[SURGE TRADE] ${ai.trade.type} ${surger.symbol} - vol ${volumeSurge.intensity.toFixed(1)}x, conf ${(ai.confidence * 100).toFixed(0)}%`);
              }
            }
          }
        }

        surgeCooldown.set(surger.symbol, now);

        // Max 8 symbols per scan to avoid API rate limits
        if (scanned >= 8) break;
      } catch (err) {
        console.error(`[SURGE] Failed to analyze ${surger.symbol}:`, err.message);
        surgeCooldown.set(surger.symbol, now);
      }
    }

    if (scanned > 0) {
      console.log(`[SURGE SCANNER] Scanned ${scanned} volume surgers, ${alerted} alerts generated`);
    }

    // Clean old cooldown entries
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;
    for (const [symbol, ts] of surgeCooldown) {
      if (ts < twoHoursAgo) surgeCooldown.delete(symbol);
    }
  } catch (err) {
    console.error('[SURGE SCANNER] Failed:', err.message);
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

  // Proactive volume surge scanner — runs every 2 minutes to catch meme/alpha early
  const surgeId = setInterval(() => scanVolumeSurges(), 2 * 60 * 1000);
  pollers.push(surgeId);
  // First surge scan after 30 seconds
  setTimeout(() => scanVolumeSurges(), 30 * 1000);

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
