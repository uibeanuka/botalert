/**
 * Candle Behavior Simulator
 *
 * Learns candle patterns and market flow from historical data,
 * generates synthetic candles for training, and runs paper trades
 * to accelerate learning without waiting for real market data.
 *
 * Key features:
 * - Learn candle patterns (bullish/bearish sequences)
 * - Generate realistic synthetic candles
 * - Simulate market scenarios (trending, ranging, volatile)
 * - Run paper trades on simulated data
 * - Learn from thousands of simulated trades
 */

const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');
const { learnFromTrade, extractEntryConditions, updateEntryConditionPerformance } = require('./aiLearning');
const { analyzeCompletedTrade } = require('./tradeAnalyzer');
const mongo = require('./mongoStorage');

// Simulation config
const SIM_ENABLED = process.env.CANDLE_SIM_ENABLED !== 'false';
const SIM_INTERVAL_MS = Number(process.env.CANDLE_SIM_INTERVAL_MS || 60_000); // Run every minute
const SIM_CANDLES_PER_RUN = Number(process.env.CANDLE_SIM_CANDLES || 500); // Candles per simulation

// Learned patterns storage
let learnedPatterns = {
  // Candle body patterns (% of candle that is body vs wick)
  bodyRatios: { bullish: [], bearish: [], doji: [] },

  // Sequence patterns (what follows what)
  sequences: {}, // "bullish,bullish,bearish" -> { nextBullish: 45, nextBearish: 55 }

  // Volatility patterns by hour
  hourlyVolatility: {}, // hour -> avg ATR %

  // Volume patterns
  volumePatterns: {
    beforePump: [], // volume levels before big moves
    beforeDump: [],
    normal: []
  },

  // Gap patterns
  gapPatterns: [], // overnight/session gaps

  // Trend continuation probability
  trendContinuation: {
    uptrend: { continues: 0, reverses: 0 },
    downtrend: { continues: 0, reverses: 0 }
  },

  totalCandles: 0,
  lastUpdate: null
};

// Simulation state
let simState = {
  isRunning: false,
  currentScenario: null,
  tradesSimulated: 0,
  patternsLearned: 0,
  lastRun: null
};

/**
 * Learn patterns from real candle data
 */
function learnFromCandles(candles, symbol = 'UNKNOWN') {
  if (!candles || candles.length < 10) return;

  const patterns = [];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    // Classify candle
    const bodySize = Math.abs(curr.close - curr.open);
    const totalSize = curr.high - curr.low;
    const bodyRatio = totalSize > 0 ? bodySize / totalSize : 0;
    const isBullish = curr.close > curr.open;
    const isDoji = bodyRatio < 0.1;

    // Store body ratios
    if (isDoji) {
      learnedPatterns.bodyRatios.doji.push(bodyRatio);
    } else if (isBullish) {
      learnedPatterns.bodyRatios.bullish.push(bodyRatio);
    } else {
      learnedPatterns.bodyRatios.bearish.push(bodyRatio);
    }

    // Trim arrays to prevent memory bloat
    ['bullish', 'bearish', 'doji'].forEach(type => {
      if (learnedPatterns.bodyRatios[type].length > 10000) {
        learnedPatterns.bodyRatios[type] = learnedPatterns.bodyRatios[type].slice(-5000);
      }
    });

    // Learn sequences (last 3 candles -> next)
    if (i >= 3) {
      const seq = [];
      for (let j = i - 3; j < i; j++) {
        seq.push(candles[j].close > candles[j].open ? 'B' : 'R');
      }
      const seqKey = seq.join('');
      const nextType = isBullish ? 'B' : 'R';

      if (!learnedPatterns.sequences[seqKey]) {
        learnedPatterns.sequences[seqKey] = { B: 0, R: 0, total: 0 };
      }
      learnedPatterns.sequences[seqKey][nextType]++;
      learnedPatterns.sequences[seqKey].total++;
    }

    // Learn hourly volatility
    const hour = new Date(curr.openTime).getUTCHours();
    const atrPercent = totalSize / curr.close * 100;
    if (!learnedPatterns.hourlyVolatility[hour]) {
      learnedPatterns.hourlyVolatility[hour] = { sum: 0, count: 0 };
    }
    learnedPatterns.hourlyVolatility[hour].sum += atrPercent;
    learnedPatterns.hourlyVolatility[hour].count++;

    // Learn volume patterns before big moves
    if (i < candles.length - 1) {
      const next = candles[i + 1];
      const nextMove = (next.close - curr.close) / curr.close * 100;
      const volRatio = prev.volume > 0 ? curr.volume / prev.volume : 1;

      if (nextMove > 2) {
        learnedPatterns.volumePatterns.beforePump.push(volRatio);
      } else if (nextMove < -2) {
        learnedPatterns.volumePatterns.beforeDump.push(volRatio);
      } else {
        learnedPatterns.volumePatterns.normal.push(volRatio);
      }

      // Trim volume patterns
      ['beforePump', 'beforeDump', 'normal'].forEach(type => {
        if (learnedPatterns.volumePatterns[type].length > 5000) {
          learnedPatterns.volumePatterns[type] = learnedPatterns.volumePatterns[type].slice(-2500);
        }
      });
    }

    // Learn trend continuation
    if (i >= 5) {
      const trend = detectTrend(candles.slice(i - 5, i));
      if (trend === 'up') {
        if (isBullish) learnedPatterns.trendContinuation.uptrend.continues++;
        else learnedPatterns.trendContinuation.uptrend.reverses++;
      } else if (trend === 'down') {
        if (!isBullish) learnedPatterns.trendContinuation.downtrend.continues++;
        else learnedPatterns.trendContinuation.downtrend.reverses++;
      }
    }

    patterns.push({
      type: isDoji ? 'doji' : (isBullish ? 'bullish' : 'bearish'),
      bodyRatio,
      volRatio: prev.volume > 0 ? curr.volume / prev.volume : 1
    });
  }

  learnedPatterns.totalCandles += candles.length;
  learnedPatterns.lastUpdate = Date.now();

  return patterns;
}

/**
 * Detect trend from candle slice
 */
function detectTrend(candles) {
  if (candles.length < 3) return 'neutral';
  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const change = (last - first) / first * 100;
  if (change > 1) return 'up';
  if (change < -1) return 'down';
  return 'neutral';
}

/**
 * Generate a synthetic candle based on learned patterns
 */
function generateSyntheticCandle(prevCandle, scenario = 'random') {
  const hour = new Date().getUTCHours();

  // Get volatility for this hour
  const hourlyVol = learnedPatterns.hourlyVolatility[hour];
  const avgVolatility = hourlyVol ? hourlyVol.sum / hourlyVol.count : 0.5;

  // Determine if next candle should be bullish or bearish
  let bullishProb = 0.5;

  // Check sequence patterns
  if (prevCandle && prevCandle.history && prevCandle.history.length >= 3) {
    const lastThree = prevCandle.history.slice(-3).map(c => c.close > c.open ? 'B' : 'R').join('');
    const seqPattern = learnedPatterns.sequences[lastThree];
    if (seqPattern && seqPattern.total >= 10) {
      bullishProb = seqPattern.B / seqPattern.total;
    }
  }

  // Adjust based on scenario
  if (scenario === 'uptrend') bullishProb = 0.65;
  else if (scenario === 'downtrend') bullishProb = 0.35;
  else if (scenario === 'volatile') bullishProb = Math.random() > 0.5 ? 0.7 : 0.3;
  else if (scenario === 'ranging') bullishProb = 0.5;

  const isBullish = Math.random() < bullishProb;

  // Get body ratio from learned patterns
  const bodyRatios = isBullish
    ? learnedPatterns.bodyRatios.bullish
    : learnedPatterns.bodyRatios.bearish;
  const avgBodyRatio = bodyRatios.length > 0
    ? bodyRatios[Math.floor(Math.random() * bodyRatios.length)]
    : 0.6;

  // Calculate candle dimensions
  const basePrice = prevCandle ? prevCandle.close : 100;
  const volatility = avgVolatility * (0.5 + Math.random()); // Random volatility variance

  // Generate OHLC
  const totalRange = basePrice * (volatility / 100);
  const bodySize = totalRange * avgBodyRatio;
  const wickSize = (totalRange - bodySize) / 2;

  let open, close, high, low;

  if (isBullish) {
    open = basePrice + (Math.random() - 0.5) * wickSize;
    close = open + bodySize;
    low = open - wickSize * Math.random();
    high = close + wickSize * Math.random();
  } else {
    open = basePrice + (Math.random() - 0.5) * wickSize;
    close = open - bodySize;
    high = open + wickSize * Math.random();
    low = close - wickSize * Math.random();
  }

  // Generate volume based on patterns
  const baseVolume = prevCandle ? prevCandle.volume : 1000000;
  const volPatterns = learnedPatterns.volumePatterns.normal;
  const volMultiplier = volPatterns.length > 0
    ? volPatterns[Math.floor(Math.random() * volPatterns.length)]
    : 1;
  const volume = baseVolume * volMultiplier * (0.8 + Math.random() * 0.4);

  return {
    openTime: Date.now(),
    open,
    high: Math.max(open, close, high),
    low: Math.min(open, close, low),
    close,
    volume,
    closeTime: Date.now() + 60000,
    isSynthetic: true,
    scenario
  };
}

/**
 * Generate a sequence of synthetic candles
 */
function generateCandleSequence(length = 200, scenario = 'random', basePrice = 100) {
  const candles = [];
  let currentPrice = basePrice;

  // Create initial candle
  candles.push({
    openTime: Date.now() - length * 60000,
    open: currentPrice,
    high: currentPrice * 1.005,
    low: currentPrice * 0.995,
    close: currentPrice * (1 + (Math.random() - 0.5) * 0.01),
    volume: 1000000,
    closeTime: Date.now() - (length - 1) * 60000,
    isSynthetic: true,
    history: []
  });

  // Generate sequence
  for (let i = 1; i < length; i++) {
    const prevCandle = candles[i - 1];
    prevCandle.history = candles.slice(Math.max(0, i - 10), i);

    const newCandle = generateSyntheticCandle(prevCandle, scenario);
    newCandle.openTime = Date.now() - (length - i) * 60000;
    newCandle.closeTime = newCandle.openTime + 60000;

    candles.push(newCandle);
    currentPrice = newCandle.close;
  }

  return candles;
}

/**
 * Run a simulated trade on synthetic or historical candles
 */
function simulateTradeOnCandles(candles, symbol = 'SIM_BTCUSDT') {
  if (candles.length < 150) return null;

  const trades = [];
  let position = null;
  let peakPnl = 0;
  let troughPnl = 0;

  for (let i = 150; i < candles.length - 1; i++) {
    const lookback = candles.slice(i - 150, i);
    const current = candles[i];
    const next = candles[i + 1];

    try {
      const indicators = calculateIndicators(lookback);
      if (!indicators) continue;

      // Add current price to indicators
      indicators.currentPrice = current.close;

      const prediction = predictNextMove(indicators, null, symbol);

      if (!position) {
        // Entry logic
        if (prediction.confidence >= 0.6 && prediction.direction !== 'neutral') {
          const entryConditions = extractEntryConditions(indicators);

          position = {
            type: prediction.direction,
            entryPrice: current.close,
            entryTime: current.openTime,
            entryIndicators: { ...indicators },
            entryConditions,
            signal: prediction.signal
          };
          peakPnl = 0;
          troughPnl = 0;
        }
      } else {
        // Calculate current PnL
        const pnlPercent = position.type === 'long'
          ? ((current.close - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - current.close) / position.entryPrice) * 100;

        peakPnl = Math.max(peakPnl, pnlPercent);
        troughPnl = Math.min(troughPnl, pnlPercent);

        // Exit logic
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
        // Trailing stop (if peaked above 3%, don't let it go below 1%)
        else if (peakPnl >= 3 && pnlPercent < 1) {
          shouldExit = true;
          exitReason = 'trailing_stop';
        }
        // Trend reversal
        else if (position.type === 'long' && prediction.direction === 'short' && prediction.confidence > 0.65) {
          shouldExit = true;
          exitReason = 'reversal';
        }
        else if (position.type === 'short' && prediction.direction === 'long' && prediction.confidence > 0.65) {
          shouldExit = true;
          exitReason = 'reversal';
        }
        // Max hold time (2h for 1m candles)
        else if (i - 150 > 120) {
          shouldExit = true;
          exitReason = 'max_hold';
        }

        if (shouldExit) {
          const trade = {
            symbol,
            type: position.type,
            entryPrice: position.entryPrice,
            exitPrice: current.close,
            entryTime: position.entryTime,
            exitTime: current.openTime,
            pnlPercent,
            peakPnl,
            troughPnl,
            result: pnlPercent > 0 ? 'win' : 'loss',
            exitReason,
            entryConditions: position.entryConditions,
            entryIndicators: position.entryIndicators,
            exitIndicators: indicators,
            signal: position.signal,
            isSynthetic: candles[0].isSynthetic
          };

          trades.push(trade);

          // Learn from this trade
          try {
            learnFromTrade({
              symbol,
              direction: position.type,
              signal: position.signal,
              pnlPercent,
              result: trade.result,
              indicators: position.entryIndicators
            });

            if (position.entryConditions.length > 0) {
              updateEntryConditionPerformance(position.entryConditions, trade.result, pnlPercent);
            }

            // Deep analysis
            analyzeCompletedTrade({
              symbol,
              direction: position.type,
              entryPrice: position.entryPrice,
              exitPrice: current.close,
              pnlPercent,
              result: trade.result,
              holdTime: current.openTime - position.entryTime,
              entryIndicators: position.entryIndicators,
              exitIndicators: indicators,
              peakPnlPercent: peakPnl,
              troughPnlPercent: troughPnl,
              entryConditions: position.entryConditions,
              signal: position.signal,
              closeReason: exitReason
            });
          } catch (e) {
            // Learning error - continue
          }

          position = null;
        }
      }
    } catch (e) {
      continue;
    }
  }

  return trades;
}

/**
 * Run a full simulation cycle
 */
async function runSimulationCycle() {
  if (!SIM_ENABLED) return;
  if (simState.isRunning) return;

  simState.isRunning = true;
  simState.lastRun = Date.now();

  const scenarios = ['uptrend', 'downtrend', 'volatile', 'ranging', 'random'];
  const results = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    byScenario: {}
  };

  try {
    for (const scenario of scenarios) {
      simState.currentScenario = scenario;

      // Generate synthetic candles
      const candles = generateCandleSequence(SIM_CANDLES_PER_RUN, scenario, 50000);

      // Learn from candles
      learnFromCandles(candles, `SIM_${scenario.toUpperCase()}`);

      // Run trades
      const trades = simulateTradeOnCandles(candles, `SIM_${scenario.toUpperCase()}`);

      if (trades && trades.length > 0) {
        const scenarioResults = {
          trades: trades.length,
          wins: trades.filter(t => t.result === 'win').length,
          losses: trades.filter(t => t.result === 'loss').length,
          totalPnl: trades.reduce((sum, t) => sum + t.pnlPercent, 0),
          avgPnl: trades.reduce((sum, t) => sum + t.pnlPercent, 0) / trades.length,
          winRate: (trades.filter(t => t.result === 'win').length / trades.length * 100).toFixed(1)
        };

        results.byScenario[scenario] = scenarioResults;
        results.totalTrades += scenarioResults.trades;
        results.wins += scenarioResults.wins;
        results.losses += scenarioResults.losses;
        results.totalPnl += scenarioResults.totalPnl;

        simState.tradesSimulated += trades.length;
      }
    }

    simState.patternsLearned = Object.keys(learnedPatterns.sequences).length;

    // Log results
    const winRate = results.totalTrades > 0 ? (results.wins / results.totalTrades * 100).toFixed(1) : 0;
    const avgPnl = results.totalTrades > 0 ? (results.totalPnl / results.totalTrades).toFixed(2) : 0;
    console.log(`[CANDLE SIM] Cycle complete: ${results.totalTrades} trades, ${winRate}% win rate, avg PnL: ${avgPnl}%`);

    // Store results in MongoDB
    if (mongo.isAvailable()) {
      try {
        await mongo.storeLearningSummary({
          type: 'candle_simulation',
          results,
          patterns: {
            sequences: Object.keys(learnedPatterns.sequences).length,
            totalCandles: learnedPatterns.totalCandles
          },
          completedAt: Date.now()
        });
      } catch (e) {
        // Storage error - continue
      }
    }

    return results;
  } finally {
    simState.isRunning = false;
    simState.currentScenario = null;
  }
}

/**
 * Get simulation status
 */
function getSimStatus() {
  return {
    ...simState,
    patterns: {
      sequences: Object.keys(learnedPatterns.sequences).length,
      totalCandles: learnedPatterns.totalCandles,
      hourlyVolatility: Object.entries(learnedPatterns.hourlyVolatility)
        .map(([hour, data]) => ({
          hour: parseInt(hour),
          avgVolatility: data.count > 0 ? (data.sum / data.count).toFixed(3) : 0
        }))
        .sort((a, b) => parseFloat(b.avgVolatility) - parseFloat(a.avgVolatility))
        .slice(0, 5),
      trendContinuation: {
        uptrend: learnedPatterns.trendContinuation.uptrend.continues + learnedPatterns.trendContinuation.uptrend.reverses > 0
          ? (learnedPatterns.trendContinuation.uptrend.continues / (learnedPatterns.trendContinuation.uptrend.continues + learnedPatterns.trendContinuation.uptrend.reverses) * 100).toFixed(1)
          : 0,
        downtrend: learnedPatterns.trendContinuation.downtrend.continues + learnedPatterns.trendContinuation.downtrend.reverses > 0
          ? (learnedPatterns.trendContinuation.downtrend.continues / (learnedPatterns.trendContinuation.downtrend.continues + learnedPatterns.trendContinuation.downtrend.reverses) * 100).toFixed(1)
          : 0
      }
    },
    sequencePatterns: Object.entries(learnedPatterns.sequences)
      .filter(([, data]) => data.total >= 20)
      .map(([seq, data]) => ({
        sequence: seq,
        bullishProb: (data.B / data.total * 100).toFixed(1),
        bearishProb: (data.R / data.total * 100).toFixed(1),
        samples: data.total
      }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, 10)
  };
}

/**
 * Learn from real candles (called from main app)
 */
function feedRealCandles(candles, symbol) {
  learnFromCandles(candles, symbol);
}

/**
 * Start the candle simulator
 */
function startCandleSimulator() {
  if (!SIM_ENABLED) {
    console.log('[CANDLE SIM] Disabled. Set CANDLE_SIM_ENABLED=true to activate.');
    return null;
  }

  console.log('[CANDLE SIM] Starting candle behavior simulator...');
  console.log(`[CANDLE SIM] Running every ${SIM_INTERVAL_MS / 1000}s, ${SIM_CANDLES_PER_RUN} candles per scenario`);

  // Run initial cycle
  runSimulationCycle().catch(err => {
    console.error('[CANDLE SIM] Initial cycle error:', err.message);
  });

  // Schedule periodic runs
  const timer = setInterval(() => {
    runSimulationCycle().catch(err => {
      console.error('[CANDLE SIM] Cycle error:', err.message);
    });
  }, SIM_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(timer);
      console.log('[CANDLE SIM] Stopped');
    }
  };
}

module.exports = {
  startCandleSimulator,
  runSimulationCycle,
  getSimStatus,
  feedRealCandles,
  generateCandleSequence,
  learnFromCandles,
  learnedPatterns
};
