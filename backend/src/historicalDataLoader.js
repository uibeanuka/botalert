/**
 * Historical Data Loader
 *
 * Fetches historical candle data from Binance (2017+) and processes
 * it through the AI/indicator system to accelerate learning.
 *
 * This allows the bot to learn from years of market history instead
 * of just recent data, understanding patterns from bull/bear markets,
 * flash crashes, and various market conditions.
 */

const axios = require('axios');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');
const mongo = require('./mongoStorage');

const API_BASE = 'https://fapi.binance.com';
const SPOT_API_BASE = 'https://api.binance.com';

// Historical learning config
const BATCH_SIZE = 1000; // Max candles per request
const BATCH_DELAY_MS = 500; // Delay between batches to avoid rate limits
const SYMBOLS_PER_BATCH = 3; // Process 3 symbols at a time

// Key symbols for historical learning (major coins with data back to 2017+)
const HISTORICAL_SYMBOLS = [
  // Major coins (data from 2017-2018)
  { symbol: 'BTCUSDT', startYear: 2017, type: 'spot' },
  { symbol: 'ETHUSDT', startYear: 2017, type: 'spot' },
  { symbol: 'BNBUSDT', startYear: 2017, type: 'spot' },
  { symbol: 'XRPUSDT', startYear: 2018, type: 'spot' },
  { symbol: 'LTCUSDT', startYear: 2017, type: 'spot' },
  { symbol: 'ADAUSDT', startYear: 2018, type: 'spot' },
  { symbol: 'DOGEUSDT', startYear: 2019, type: 'spot' },
  { symbol: 'SOLUSDT', startYear: 2020, type: 'spot' },
  { symbol: 'DOTUSDT', startYear: 2020, type: 'spot' },
  { symbol: 'AVAXUSDT', startYear: 2020, type: 'spot' },
  { symbol: 'MATICUSDT', startYear: 2019, type: 'spot' },
  { symbol: 'LINKUSDT', startYear: 2019, type: 'spot' },
  { symbol: 'ATOMUSDT', startYear: 2019, type: 'spot' },
  { symbol: 'UNIUSDT', startYear: 2020, type: 'spot' },
  { symbol: 'AAVEUSDT', startYear: 2020, type: 'spot' },
  // Futures (started 2019-2020)
  { symbol: 'BTCUSDT', startYear: 2019, type: 'futures' },
  { symbol: 'ETHUSDT', startYear: 2019, type: 'futures' },
  { symbol: 'BNBUSDT', startYear: 2020, type: 'futures' },
  { symbol: 'SOLUSDT', startYear: 2021, type: 'futures' },
  { symbol: 'XRPUSDT', startYear: 2020, type: 'futures' },
  { symbol: 'DOGEUSDT', startYear: 2021, type: 'futures' },
];

// Intervals to learn from (multiple timeframes)
const LEARNING_INTERVALS = ['1h', '4h', '1d'];

// Learning state
let learningProgress = {
  isRunning: false,
  currentSymbol: null,
  currentInterval: null,
  progress: 0,
  totalSymbols: 0,
  processedSymbols: 0,
  candlesProcessed: 0,
  patternsLearned: 0,
  tradesSimulated: 0,
  startTime: null,
  errors: [],
  marketEvents: [], // Major events detected
};

/**
 * Fetch historical candles from Binance
 */
async function fetchHistoricalCandles(symbol, interval, startTime, endTime, type = 'spot') {
  const baseUrl = type === 'futures' ? API_BASE : SPOT_API_BASE;
  const endpoint = type === 'futures' ? '/fapi/v1/klines' : '/api/v3/klines';

  try {
    const res = await axios.get(`${baseUrl}${endpoint}`, {
      params: {
        symbol,
        interval,
        startTime,
        endTime,
        limit: BATCH_SIZE
      },
      timeout: 15000
    });

    return res.data.map(candle => ({
      openTime: candle[0],
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5]),
      closeTime: candle[6]
    }));
  } catch (err) {
    // Handle rate limits
    if (err.response?.status === 429) {
      console.log('[HISTORICAL] Rate limited, waiting 60s...');
      await sleep(60000);
      return fetchHistoricalCandles(symbol, interval, startTime, endTime, type);
    }
    throw err;
  }
}

/**
 * Process candles through indicators and detect patterns
 */
function processCandles(candles, symbol) {
  if (candles.length < 50) return null;

  try {
    const indicators = calculateIndicators(candles);
    return indicators;
  } catch (err) {
    return null;
  }
}

/**
 * Simulate trades on historical data to learn what works
 */
function simulateHistoricalTrades(candleHistory, symbol) {
  const trades = [];
  const minCandles = 150; // Need enough history for indicators

  if (candleHistory.length < minCandles) return trades;

  let position = null;
  let peakPrice = 0;
  let troughPrice = Infinity;

  for (let i = minCandles; i < candleHistory.length - 1; i++) {
    const lookback = candleHistory.slice(i - minCandles, i);
    const currentCandle = candleHistory[i];
    const nextCandle = candleHistory[i + 1];

    try {
      const indicators = calculateIndicators(lookback);
      if (!indicators) continue;

      // Simulate AI prediction (simplified for historical)
      const prediction = simulateHistoricalPrediction(indicators);

      if (!position) {
        // Entry logic
        if (prediction.direction === 'long' && prediction.confidence > 0.6) {
          position = {
            type: 'long',
            entryPrice: currentCandle.close,
            entryTime: currentCandle.openTime,
            entryIndicators: { ...indicators },
            entryConditions: extractHistoricalConditions(indicators)
          };
          peakPrice = currentCandle.close;
          troughPrice = currentCandle.close;
        } else if (prediction.direction === 'short' && prediction.confidence > 0.6) {
          position = {
            type: 'short',
            entryPrice: currentCandle.close,
            entryTime: currentCandle.openTime,
            entryIndicators: { ...indicators },
            entryConditions: extractHistoricalConditions(indicators)
          };
          peakPrice = currentCandle.close;
          troughPrice = currentCandle.close;
        }
      } else {
        // Track peaks/troughs
        peakPrice = Math.max(peakPrice, currentCandle.high);
        troughPrice = Math.min(troughPrice, currentCandle.low);

        // Exit logic
        const pnlPercent = position.type === 'long'
          ? ((currentCandle.close - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - currentCandle.close) / position.entryPrice) * 100;

        const holdTime = currentCandle.openTime - position.entryTime;
        const holdHours = holdTime / (1000 * 60 * 60);

        let shouldExit = false;
        let exitReason = '';

        // Stop loss
        if (pnlPercent <= -3) {
          shouldExit = true;
          exitReason = 'stop_loss';
        }
        // Take profit
        else if (pnlPercent >= 5) {
          shouldExit = true;
          exitReason = 'take_profit';
        }
        // Trend reversal
        else if (position.type === 'long' && prediction.direction === 'short' && prediction.confidence > 0.65) {
          shouldExit = true;
          exitReason = 'trend_reversal';
        }
        else if (position.type === 'short' && prediction.direction === 'long' && prediction.confidence > 0.65) {
          shouldExit = true;
          exitReason = 'trend_reversal';
        }
        // Max hold time (24h for hourly, longer for daily)
        else if (holdHours > 24) {
          shouldExit = true;
          exitReason = 'max_hold';
        }

        if (shouldExit) {
          const peakPnl = position.type === 'long'
            ? ((peakPrice - position.entryPrice) / position.entryPrice) * 100
            : ((position.entryPrice - troughPrice) / position.entryPrice) * 100;

          trades.push({
            symbol,
            type: position.type,
            entryPrice: position.entryPrice,
            exitPrice: currentCandle.close,
            entryTime: position.entryTime,
            exitTime: currentCandle.openTime,
            pnlPercent,
            peakPnlPercent: peakPnl,
            holdTimeMs: holdTime,
            result: pnlPercent > 0 ? 'win' : 'loss',
            exitReason,
            entryIndicators: position.entryIndicators,
            exitIndicators: indicators,
            entryConditions: position.entryConditions
          });

          position = null;
          peakPrice = 0;
          troughPrice = Infinity;
        }
      }
    } catch (err) {
      continue;
    }
  }

  return trades;
}

/**
 * Simplified prediction for historical simulation
 */
function simulateHistoricalPrediction(indicators) {
  let bullScore = 0;
  let bearScore = 0;

  // RSI
  if (indicators.rsi < 30) bullScore += 2;
  else if (indicators.rsi > 70) bearScore += 2;
  else if (indicators.rsi < 45) bullScore += 1;
  else if (indicators.rsi > 55) bearScore += 1;

  // MACD
  if (indicators.macd?.histogram > 0) bullScore += 1;
  else if (indicators.macd?.histogram < 0) bearScore += 1;

  // Trend
  if (indicators.trend?.direction?.includes('UP')) bullScore += 2;
  else if (indicators.trend?.direction?.includes('DOWN')) bearScore += 2;

  // EMA crossover
  if (indicators.ema9 > indicators.ema21) bullScore += 1;
  else if (indicators.ema9 < indicators.ema21) bearScore += 1;

  // Bollinger Bands
  if (indicators.bollinger?.pb < 0.2) bullScore += 1;
  else if (indicators.bollinger?.pb > 0.8) bearScore += 1;

  // Sniper signals
  if (indicators.sniperSignals?.score?.isSniper) {
    if (indicators.sniperSignals.score.direction === 'long') bullScore += 3;
    else if (indicators.sniperSignals.score.direction === 'short') bearScore += 3;
  }

  const totalScore = bullScore + bearScore;
  const confidence = totalScore > 0 ? Math.max(bullScore, bearScore) / (totalScore + 2) : 0.5;

  return {
    direction: bullScore > bearScore ? 'long' : bearScore > bullScore ? 'short' : 'neutral',
    confidence: Math.min(confidence, 0.95)
  };
}

/**
 * Extract entry conditions from indicators
 */
function extractHistoricalConditions(indicators) {
  const conditions = [];

  if (indicators.rsi < 30) conditions.push('rsiOversold');
  else if (indicators.rsi > 70) conditions.push('rsiOverbought');

  if (indicators.macd?.histogram > 0) conditions.push('macdBullish');
  else if (indicators.macd?.histogram < 0) conditions.push('macdBearish');

  if (indicators.trend?.direction?.includes('STRONG_UP')) conditions.push('strongUptrend');
  else if (indicators.trend?.direction?.includes('STRONG_DOWN')) conditions.push('strongDowntrend');

  if (indicators.volumeSpike) conditions.push('volumeSpike');
  if (indicators.sniperSignals?.score?.isSniper) conditions.push('sniperActive');
  if (indicators.sniperSignals?.divergence?.detected) conditions.push('divergenceDetected');

  if (indicators.bollinger?.pb < 0.1) conditions.push('bbLowerBand');
  else if (indicators.bollinger?.pb > 0.9) conditions.push('bbUpperBand');

  return conditions;
}

/**
 * Detect major market events in historical data
 */
function detectMarketEvents(candles, symbol) {
  const events = [];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const change = ((curr.close - prev.close) / prev.close) * 100;

    // Flash crash (>10% drop in one candle)
    if (change <= -10) {
      events.push({
        type: 'flash_crash',
        symbol,
        timestamp: curr.openTime,
        change,
        price: curr.close,
        volume: curr.volume
      });
    }
    // Massive pump (>15% gain in one candle)
    else if (change >= 15) {
      events.push({
        type: 'massive_pump',
        symbol,
        timestamp: curr.openTime,
        change,
        price: curr.close,
        volume: curr.volume
      });
    }
    // High volatility (>8% move)
    else if (Math.abs(change) >= 8) {
      events.push({
        type: 'high_volatility',
        symbol,
        timestamp: curr.openTime,
        change,
        price: curr.close,
        volume: curr.volume
      });
    }
  }

  return events;
}

/**
 * Learn from historical trades and store in MongoDB
 */
async function learnFromHistoricalTrades(trades, symbol, interval) {
  if (!mongo.isAvailable()) {
    console.warn('[HISTORICAL] MongoDB not available, skipping storage');
    return;
  }

  // Aggregate learnings
  const learnings = {
    symbol,
    interval,
    totalTrades: trades.length,
    wins: trades.filter(t => t.result === 'win').length,
    losses: trades.filter(t => t.result === 'loss').length,
    avgPnl: trades.reduce((sum, t) => sum + t.pnlPercent, 0) / trades.length || 0,
    avgHoldTime: trades.reduce((sum, t) => sum + t.holdTimeMs, 0) / trades.length || 0,

    // Exit reason analysis
    exitReasons: {},

    // Entry condition analysis
    conditionPerformance: {},

    // Best/worst trades
    bestTrade: null,
    worstTrade: null,

    // Time patterns
    hourlyPerformance: {},
    dayOfWeekPerformance: {},

    processedAt: Date.now()
  };

  // Analyze trades
  let bestPnl = -Infinity;
  let worstPnl = Infinity;

  for (const trade of trades) {
    // Exit reasons
    learnings.exitReasons[trade.exitReason] = (learnings.exitReasons[trade.exitReason] || 0) + 1;

    // Entry conditions
    for (const condition of trade.entryConditions || []) {
      if (!learnings.conditionPerformance[condition]) {
        learnings.conditionPerformance[condition] = { trades: 0, wins: 0, totalPnl: 0 };
      }
      const cp = learnings.conditionPerformance[condition];
      cp.trades++;
      if (trade.result === 'win') cp.wins++;
      cp.totalPnl += trade.pnlPercent;
    }

    // Best/worst
    if (trade.pnlPercent > bestPnl) {
      bestPnl = trade.pnlPercent;
      learnings.bestTrade = trade;
    }
    if (trade.pnlPercent < worstPnl) {
      worstPnl = trade.pnlPercent;
      learnings.worstTrade = trade;
    }

    // Time patterns
    const entryDate = new Date(trade.entryTime);
    const hour = entryDate.getUTCHours();
    const dayOfWeek = entryDate.getUTCDay();

    if (!learnings.hourlyPerformance[hour]) {
      learnings.hourlyPerformance[hour] = { trades: 0, wins: 0, totalPnl: 0 };
    }
    learnings.hourlyPerformance[hour].trades++;
    if (trade.result === 'win') learnings.hourlyPerformance[hour].wins++;
    learnings.hourlyPerformance[hour].totalPnl += trade.pnlPercent;

    if (!learnings.dayOfWeekPerformance[dayOfWeek]) {
      learnings.dayOfWeekPerformance[dayOfWeek] = { trades: 0, wins: 0, totalPnl: 0 };
    }
    learnings.dayOfWeekPerformance[dayOfWeek].trades++;
    if (trade.result === 'win') learnings.dayOfWeekPerformance[dayOfWeek].wins++;
    learnings.dayOfWeekPerformance[dayOfWeek].totalPnl += trade.pnlPercent;
  }

  // Calculate win rates
  learnings.winRate = learnings.totalTrades > 0
    ? (learnings.wins / learnings.totalTrades) * 100
    : 0;

  for (const condition in learnings.conditionPerformance) {
    const cp = learnings.conditionPerformance[condition];
    cp.winRate = cp.trades > 0 ? (cp.wins / cp.trades) * 100 : 0;
    cp.avgPnl = cp.trades > 0 ? cp.totalPnl / cp.trades : 0;
  }

  // Store in MongoDB
  try {
    await mongo.storeHistoricalLearning(learnings);
    learningProgress.patternsLearned++;
  } catch (err) {
    console.error('[HISTORICAL] Failed to store learnings:', err.message);
  }
}

/**
 * Process a single symbol's historical data
 */
async function processSymbolHistory(symbolConfig, interval) {
  const { symbol, startYear, type } = symbolConfig;

  console.log(`[HISTORICAL] Processing ${symbol} (${type}) from ${startYear}, interval: ${interval}`);

  const startTime = new Date(`${startYear}-01-01`).getTime();
  const endTime = Date.now();
  const intervalMs = getIntervalMs(interval);

  let allCandles = [];
  let currentStart = startTime;
  let batchCount = 0;

  // Fetch all historical candles
  while (currentStart < endTime) {
    try {
      const candles = await fetchHistoricalCandles(
        symbol,
        interval,
        currentStart,
        Math.min(currentStart + (BATCH_SIZE * intervalMs), endTime),
        type
      );

      if (candles.length === 0) break;

      allCandles = allCandles.concat(candles);
      currentStart = candles[candles.length - 1].closeTime + 1;
      batchCount++;

      learningProgress.candlesProcessed += candles.length;

      // Rate limit protection
      await sleep(BATCH_DELAY_MS);

      // Progress update every 10 batches
      if (batchCount % 10 === 0) {
        const years = ((currentStart - startTime) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1);
        console.log(`[HISTORICAL] ${symbol} ${interval}: ${allCandles.length} candles loaded (~${years} years)`);
      }
    } catch (err) {
      console.error(`[HISTORICAL] Error fetching ${symbol}:`, err.message);
      learningProgress.errors.push({ symbol, interval, error: err.message, time: Date.now() });
      break;
    }
  }

  if (allCandles.length < 200) {
    console.log(`[HISTORICAL] ${symbol} ${interval}: Not enough data (${allCandles.length} candles)`);
    return;
  }

  console.log(`[HISTORICAL] ${symbol} ${interval}: Processing ${allCandles.length} candles...`);

  // Detect market events
  const events = detectMarketEvents(allCandles, symbol);
  if (events.length > 0) {
    console.log(`[HISTORICAL] ${symbol}: Detected ${events.length} market events`);
    learningProgress.marketEvents.push(...events.slice(0, 10)); // Store top 10

    // Store events in MongoDB
    if (mongo.isAvailable()) {
      try {
        await mongo.storeMarketEvents(symbol, events);
      } catch (err) {
        // Ignore storage errors
      }
    }
  }

  // Simulate trades and learn
  const trades = simulateHistoricalTrades(allCandles, symbol);
  learningProgress.tradesSimulated += trades.length;

  if (trades.length > 0) {
    const wins = trades.filter(t => t.result === 'win').length;
    const winRate = ((wins / trades.length) * 100).toFixed(1);
    const avgPnl = (trades.reduce((s, t) => s + t.pnlPercent, 0) / trades.length).toFixed(2);
    console.log(`[HISTORICAL] ${symbol} ${interval}: ${trades.length} trades, ${winRate}% win rate, avg PnL: ${avgPnl}%`);

    // Store learnings
    await learnFromHistoricalTrades(trades, symbol, interval);
  }
}

/**
 * Run full historical learning
 */
async function runHistoricalLearning(options = {}) {
  if (learningProgress.isRunning) {
    console.log('[HISTORICAL] Learning already in progress');
    return learningProgress;
  }

  // Check MongoDB
  if (!mongo.isAvailable()) {
    try {
      await mongo.connect();
    } catch (err) {
      console.error('[HISTORICAL] MongoDB required for historical learning:', err.message);
      return { error: 'MongoDB not available' };
    }
  }

  const symbols = options.symbols || HISTORICAL_SYMBOLS;
  const intervals = options.intervals || LEARNING_INTERVALS;

  learningProgress = {
    isRunning: true,
    currentSymbol: null,
    currentInterval: null,
    progress: 0,
    totalSymbols: symbols.length,
    processedSymbols: 0,
    candlesProcessed: 0,
    patternsLearned: 0,
    tradesSimulated: 0,
    startTime: Date.now(),
    errors: [],
    marketEvents: [],
  };

  console.log(`[HISTORICAL] Starting learning: ${symbols.length} symbols, ${intervals.length} intervals`);
  console.log(`[HISTORICAL] Timeframes: ${intervals.join(', ')}`);

  try {
    for (const symbolConfig of symbols) {
      learningProgress.currentSymbol = symbolConfig.symbol;

      for (const interval of intervals) {
        learningProgress.currentInterval = interval;

        await processSymbolHistory(symbolConfig, interval);

        // Small delay between intervals
        await sleep(1000);
      }

      learningProgress.processedSymbols++;
      learningProgress.progress = Math.round((learningProgress.processedSymbols / learningProgress.totalSymbols) * 100);

      console.log(`[HISTORICAL] Progress: ${learningProgress.progress}% (${learningProgress.processedSymbols}/${learningProgress.totalSymbols})`);
    }

    // Generate summary
    const duration = Date.now() - learningProgress.startTime;
    console.log(`[HISTORICAL] Learning complete!`);
    console.log(`[HISTORICAL] Duration: ${(duration / 60000).toFixed(1)} minutes`);
    console.log(`[HISTORICAL] Candles processed: ${learningProgress.candlesProcessed.toLocaleString()}`);
    console.log(`[HISTORICAL] Trades simulated: ${learningProgress.tradesSimulated.toLocaleString()}`);
    console.log(`[HISTORICAL] Patterns learned: ${learningProgress.patternsLearned}`);
    console.log(`[HISTORICAL] Market events: ${learningProgress.marketEvents.length}`);

    // Store summary in MongoDB
    if (mongo.isAvailable()) {
      try {
        await mongo.storeLearningSummary({
          type: 'historical',
          duration,
          candlesProcessed: learningProgress.candlesProcessed,
          tradesSimulated: learningProgress.tradesSimulated,
          patternsLearned: learningProgress.patternsLearned,
          marketEvents: learningProgress.marketEvents.length,
          errors: learningProgress.errors.length,
          completedAt: Date.now()
        });
      } catch (err) {
        // Ignore
      }
    }

  } catch (err) {
    console.error('[HISTORICAL] Learning failed:', err.message);
    learningProgress.errors.push({ error: err.message, fatal: true });
  } finally {
    learningProgress.isRunning = false;
  }

  return learningProgress;
}

/**
 * Get learning progress
 */
function getProgress() {
  return { ...learningProgress };
}

/**
 * Get historical insights from MongoDB
 */
async function getHistoricalInsights() {
  if (!mongo.isAvailable()) {
    return { error: 'MongoDB not available' };
  }

  try {
    return await mongo.getHistoricalInsights();
  } catch (err) {
    return { error: err.message };
  }
}

// Helper functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getIntervalMs(interval) {
  const map = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000,
  };
  return map[interval] || 60 * 60 * 1000;
}

module.exports = {
  runHistoricalLearning,
  getProgress,
  getHistoricalInsights,
  HISTORICAL_SYMBOLS,
  LEARNING_INTERVALS
};
