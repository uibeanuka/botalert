/**
 * AI Learning Engine
 * Continuously learns from trades, market conditions, and outcomes
 * Implements reinforcement learning concepts for strategy improvement
 */

const fs = require('fs');
const path = require('path');

const LEARNING_DATA_FILE = path.join(__dirname, '../data/ai_learning.json');

// Learning state
let learningState = {
  // Market regime detection
  marketRegimes: {
    trending: { count: 0, winRate: 0, avgReturn: 0 },
    ranging: { count: 0, winRate: 0, avgReturn: 0 },
    volatile: { count: 0, winRate: 0, avgReturn: 0 },
    quiet: { count: 0, winRate: 0, avgReturn: 0 }
  },

  // Signal performance tracking
  signalPerformance: {
    LONG: { count: 0, wins: 0, avgReturn: 0 },
    SHORT: { count: 0, wins: 0, avgReturn: 0 },
    STRONG_LONG: { count: 0, wins: 0, avgReturn: 0 },
    STRONG_SHORT: { count: 0, wins: 0, avgReturn: 0 },
    SNIPER_LONG: { count: 0, wins: 0, avgReturn: 0 },
    SNIPER_SHORT: { count: 0, wins: 0, avgReturn: 0 }
  },

  // Time-based performance
  hourlyPerformance: {},
  dailyPerformance: {
    Monday: { count: 0, wins: 0 },
    Tuesday: { count: 0, wins: 0 },
    Wednesday: { count: 0, wins: 0 },
    Thursday: { count: 0, wins: 0 },
    Friday: { count: 0, wins: 0 },
    Saturday: { count: 0, wins: 0 },
    Sunday: { count: 0, wins: 0 }
  },

  // Indicator effectiveness
  indicatorScores: {
    rsi: { accuracy: 0.5, samples: 0 },
    macd: { accuracy: 0.5, samples: 0 },
    bollinger: { accuracy: 0.5, samples: 0 },
    ema: { accuracy: 0.5, samples: 0 },
    kdj: { accuracy: 0.5, samples: 0 },
    volume: { accuracy: 0.5, samples: 0 },
    divergence: { accuracy: 0.5, samples: 0 },
    patterns: { accuracy: 0.5, samples: 0 }
  },

  // Symbol-specific learning
  symbolStats: {},

  // Adaptive thresholds
  adaptiveThresholds: {
    minConfidence: 0.65,
    sniperConfidence: 0.50,
    volumeSurgeConfidence: 0.45,
    optimalRSIBuy: 30,
    optimalRSISell: 70
  },

  // Q-learning state-action values
  qTable: {},

  // Learning parameters
  learningRate: 0.1,
  discountFactor: 0.95,
  explorationRate: 0.1,

  // Statistics
  totalLearnings: 0,
  lastUpdate: null,
  version: 1
};

// Load learning data on startup
function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_DATA_FILE)) {
      const data = fs.readFileSync(LEARNING_DATA_FILE, 'utf-8');
      learningState = { ...learningState, ...JSON.parse(data) };
      console.log(`[AI LEARN] Loaded ${learningState.totalLearnings} learnings`);
    }
  } catch (err) {
    console.warn('[AI LEARN] Could not load learning data:', err.message);
  }
}

// Save learning data
function saveLearningData() {
  try {
    const dir = path.dirname(LEARNING_DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    learningState.lastUpdate = Date.now();
    fs.writeFileSync(LEARNING_DATA_FILE, JSON.stringify(learningState, null, 2));
  } catch (err) {
    console.warn('[AI LEARN] Could not save learning data:', err.message);
  }
}

/**
 * Detect current market regime
 */
function detectMarketRegime(indicators) {
  if (!indicators) return 'unknown';

  const { atr, currentPrice, bollinger, trend, volumeRatio } = indicators;

  // Calculate volatility
  const atrPercent = atr && currentPrice ? (atr / currentPrice) * 100 : 1.5;
  const bbWidth = bollinger?.upper && bollinger?.lower && bollinger?.middle
    ? (bollinger.upper - bollinger.lower) / bollinger.middle * 100
    : 4;

  // Determine regime
  if (trend?.direction?.includes('STRONG')) {
    if (atrPercent > 3 || volumeRatio > 2) return 'trending';
    return 'trending';
  }

  if (atrPercent > 3.5 || bbWidth > 6) {
    return 'volatile';
  }

  if (atrPercent < 1 || bbWidth < 2) {
    return 'quiet';
  }

  return 'ranging';
}

/**
 * Create state representation for Q-learning
 */
function createState(indicators) {
  if (!indicators) return 'unknown';

  const { rsi, macd, bollinger, trend, volumeRatio, sniperSignals } = indicators;

  // Discretize continuous values
  const rsiState = rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral';
  const macdState = macd?.histogram > 0 ? 'bullish' : 'bearish';
  const bbState = bollinger?.pb < 0.2 ? 'lower' : bollinger?.pb > 0.8 ? 'upper' : 'middle';
  const trendState = trend?.direction || 'NEUTRAL';
  const volumeState = volumeRatio > 2 ? 'high' : volumeRatio < 0.5 ? 'low' : 'normal';
  const sniperState = sniperSignals?.score?.isSniper ? 'sniper' : 'normal';

  return `${rsiState}_${macdState}_${bbState}_${trendState}_${volumeState}_${sniperState}`;
}

/**
 * Get Q-value for state-action pair
 */
function getQValue(state, action) {
  if (!learningState.qTable[state]) {
    learningState.qTable[state] = {
      LONG: 0,
      SHORT: 0,
      HOLD: 0
    };
  }
  return learningState.qTable[state][action] || 0;
}

/**
 * Update Q-value using Q-learning update rule
 */
function updateQValue(state, action, reward, nextState) {
  const currentQ = getQValue(state, action);

  // Get max Q-value for next state
  const nextQValues = learningState.qTable[nextState] || { LONG: 0, SHORT: 0, HOLD: 0 };
  const maxNextQ = Math.max(...Object.values(nextQValues));

  // Q-learning update
  const newQ = currentQ + learningState.learningRate * (
    reward + learningState.discountFactor * maxNextQ - currentQ
  );

  if (!learningState.qTable[state]) {
    learningState.qTable[state] = { LONG: 0, SHORT: 0, HOLD: 0 };
  }
  learningState.qTable[state][action] = newQ;
}

/**
 * Learn from a completed trade
 */
function learnFromTrade(tradeData) {
  const {
    indicators,
    signal,
    direction,
    pnlPercent,
    result,
    symbol,
    timestamp
  } = tradeData;

  // Calculate reward
  const reward = calculateReward(pnlPercent, result);

  // Update Q-table
  const state = createState(indicators);
  const action = direction === 'long' ? 'LONG' : direction === 'short' ? 'SHORT' : 'HOLD';
  updateQValue(state, action, reward, state); // Simplified: same state

  // Update market regime stats
  const regime = detectMarketRegime(indicators);
  updateRegimeStats(regime, result, pnlPercent);

  // Update signal performance
  if (signal && learningState.signalPerformance[signal]) {
    const perf = learningState.signalPerformance[signal];
    perf.count++;
    if (result === 'win' || pnlPercent > 0) perf.wins++;
    perf.avgReturn = (perf.avgReturn * (perf.count - 1) + pnlPercent) / perf.count;
  }

  // Update time-based performance
  const date = new Date(timestamp);
  const hour = date.getUTCHours();
  const day = date.toLocaleDateString('en-US', { weekday: 'long' });

  if (!learningState.hourlyPerformance[hour]) {
    learningState.hourlyPerformance[hour] = { count: 0, wins: 0 };
  }
  learningState.hourlyPerformance[hour].count++;
  if (result === 'win' || pnlPercent > 0) {
    learningState.hourlyPerformance[hour].wins++;
  }

  if (learningState.dailyPerformance[day]) {
    learningState.dailyPerformance[day].count++;
    if (result === 'win' || pnlPercent > 0) {
      learningState.dailyPerformance[day].wins++;
    }
  }

  // Update indicator effectiveness
  updateIndicatorScores(indicators, result);

  // Update symbol-specific stats
  if (symbol) {
    if (!learningState.symbolStats[symbol]) {
      learningState.symbolStats[symbol] = {
        trades: 0,
        wins: 0,
        totalReturn: 0,
        avgReturn: 0,
        bestHour: null,
        worstHour: null
      };
    }
    const symStats = learningState.symbolStats[symbol];
    symStats.trades++;
    if (result === 'win' || pnlPercent > 0) symStats.wins++;
    symStats.totalReturn += pnlPercent;
    symStats.avgReturn = symStats.totalReturn / symStats.trades;
  }

  // Update adaptive thresholds
  updateAdaptiveThresholds();

  // Track learning
  learningState.totalLearnings++;

  // Save periodically
  if (learningState.totalLearnings % 10 === 0) {
    saveLearningData();
  }

  return {
    state,
    action,
    reward,
    regime,
    qValue: getQValue(state, action)
  };
}

/**
 * Calculate reward for Q-learning
 */
function calculateReward(pnlPercent, result) {
  // Base reward from PnL
  let reward = pnlPercent;

  // Bonus for big wins
  if (pnlPercent > 5) reward *= 1.5;

  // Extra penalty for big losses
  if (pnlPercent < -5) reward *= 1.5;

  // Small penalty for hold when should have traded
  if (result === 'missed') reward = -1;

  return round(reward, 2);
}

/**
 * Update market regime statistics
 */
function updateRegimeStats(regime, result, pnlPercent) {
  if (!learningState.marketRegimes[regime]) {
    learningState.marketRegimes[regime] = { count: 0, winRate: 0, avgReturn: 0 };
  }

  const regimeStats = learningState.marketRegimes[regime];
  regimeStats.count++;

  const wins = regimeStats.winRate * (regimeStats.count - 1);
  regimeStats.winRate = (wins + (result === 'win' || pnlPercent > 0 ? 1 : 0)) / regimeStats.count;
  regimeStats.avgReturn = (regimeStats.avgReturn * (regimeStats.count - 1) + pnlPercent) / regimeStats.count;
}

/**
 * Update indicator effectiveness scores
 */
function updateIndicatorScores(indicators, result) {
  const isWin = result === 'win';

  // RSI accuracy
  if (indicators.rsi !== undefined) {
    const rsiCorrect = (indicators.rsi < 30 && isWin) || (indicators.rsi > 70 && !isWin);
    updateAccuracy('rsi', rsiCorrect ? 1 : 0);
  }

  // MACD accuracy
  if (indicators.macd?.histogram) {
    const macdCorrect = (indicators.macd.histogram > 0 && isWin) ||
                        (indicators.macd.histogram < 0 && !isWin);
    updateAccuracy('macd', macdCorrect ? 1 : 0);
  }

  // Bollinger accuracy
  if (indicators.bollinger?.pb !== undefined) {
    const bbCorrect = (indicators.bollinger.pb < 0.2 && isWin) ||
                      (indicators.bollinger.pb > 0.8 && !isWin);
    updateAccuracy('bollinger', bbCorrect ? 1 : 0);
  }

  // Trend accuracy
  if (indicators.trend?.direction) {
    const trendCorrect = indicators.trend.direction.includes('UP') && isWin;
    updateAccuracy('ema', trendCorrect ? 1 : 0);
  }

  // Volume accuracy
  if (indicators.volumeSpike !== undefined) {
    updateAccuracy('volume', indicators.volumeSpike && isWin ? 1 : 0);
  }

  // Divergence accuracy
  if (indicators.sniperSignals?.divergence?.type) {
    const divCorrect = (indicators.sniperSignals.divergence.type === 'bullish' && isWin);
    updateAccuracy('divergence', divCorrect ? 1 : 0);
  }

  // Pattern accuracy
  if (indicators.patterns?.length > 0) {
    const bullishPatterns = ['BULLISH_ENGULFING', 'HAMMER', 'MORNING_STAR'];
    const hasBullish = indicators.patterns.some(p => bullishPatterns.includes(p));
    updateAccuracy('patterns', hasBullish && isWin ? 1 : 0);
  }
}

/**
 * Update accuracy score with exponential moving average
 */
function updateAccuracy(indicator, correct) {
  const score = learningState.indicatorScores[indicator];
  if (!score) return;

  score.samples++;
  const alpha = 0.1; // Smoothing factor
  score.accuracy = score.accuracy * (1 - alpha) + correct * alpha;
}

/**
 * Update adaptive thresholds based on performance
 */
function updateAdaptiveThresholds() {
  const totalTrades = Object.values(learningState.signalPerformance)
    .reduce((sum, p) => sum + p.count, 0);

  if (totalTrades < 50) return; // Need more data

  // Adjust confidence thresholds based on signal performance
  const longPerf = learningState.signalPerformance.LONG;
  const shortPerf = learningState.signalPerformance.SHORT;
  const sniperLongPerf = learningState.signalPerformance.SNIPER_LONG;

  // If sniper signals are performing well, lower threshold
  if (sniperLongPerf.count > 10 && sniperLongPerf.wins / sniperLongPerf.count > 0.6) {
    learningState.adaptiveThresholds.sniperConfidence = Math.max(0.45, learningState.adaptiveThresholds.sniperConfidence - 0.01);
  }

  // If regular signals are underperforming, raise threshold
  const avgWinRate = (longPerf.wins + shortPerf.wins) / Math.max(longPerf.count + shortPerf.count, 1);
  if (avgWinRate < 0.5) {
    learningState.adaptiveThresholds.minConfidence = Math.min(0.75, learningState.adaptiveThresholds.minConfidence + 0.01);
  } else if (avgWinRate > 0.6) {
    learningState.adaptiveThresholds.minConfidence = Math.max(0.60, learningState.adaptiveThresholds.minConfidence - 0.01);
  }

  // Adjust RSI thresholds based on indicator accuracy
  const rsiAccuracy = learningState.indicatorScores.rsi.accuracy;
  if (rsiAccuracy > 0.6) {
    learningState.adaptiveThresholds.optimalRSIBuy = Math.min(35, learningState.adaptiveThresholds.optimalRSIBuy + 0.5);
    learningState.adaptiveThresholds.optimalRSISell = Math.max(65, learningState.adaptiveThresholds.optimalRSISell - 0.5);
  }
}

/**
 * Get AI-recommended action based on learning
 */
function getLearnedRecommendation(indicators) {
  const state = createState(indicators);
  const regime = detectMarketRegime(indicators);

  // Get Q-values for current state
  const qValues = learningState.qTable[state] || { LONG: 0, SHORT: 0, HOLD: 0 };

  // Exploration vs exploitation
  if (Math.random() < learningState.explorationRate) {
    // Random action (exploration)
    const actions = ['LONG', 'SHORT', 'HOLD'];
    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    return {
      action: randomAction,
      confidence: 0.5,
      source: 'exploration',
      regime
    };
  }

  // Choose best action (exploitation)
  const bestAction = Object.entries(qValues)
    .sort((a, b) => b[1] - a[1])[0];

  // Calculate confidence from Q-value difference
  const qTotal = Object.values(qValues).reduce((a, b) => a + Math.abs(b), 0);
  const confidence = qTotal > 0 ? Math.abs(bestAction[1]) / qTotal : 0.5;

  // Adjust for market regime
  const regimeMultiplier = getRegimeMultiplier(regime);

  return {
    action: bestAction[0],
    qValue: round(bestAction[1], 2),
    confidence: round(Math.min(confidence * regimeMultiplier, 0.95), 2),
    source: 'learned',
    regime,
    regimeStats: learningState.marketRegimes[regime],
    allQValues: qValues
  };
}

/**
 * Get multiplier based on historical regime performance
 */
function getRegimeMultiplier(regime) {
  const stats = learningState.marketRegimes[regime];
  if (!stats || stats.count < 10) return 1.0;

  // Better performing regimes get higher multiplier
  if (stats.winRate > 0.6) return 1.1;
  if (stats.winRate > 0.5) return 1.0;
  if (stats.winRate > 0.4) return 0.9;
  return 0.8;
}

/**
 * Get optimal trading hours based on historical performance
 */
function getOptimalTradingHours() {
  const hourStats = Object.entries(learningState.hourlyPerformance)
    .filter(([, stats]) => stats.count >= 5)
    .map(([hour, stats]) => ({
      hour: parseInt(hour),
      winRate: stats.wins / stats.count,
      trades: stats.count
    }))
    .sort((a, b) => b.winRate - a.winRate);

  return {
    bestHours: hourStats.slice(0, 3).map(h => h.hour),
    worstHours: hourStats.slice(-3).map(h => h.hour),
    allHours: hourStats
  };
}

/**
 * Get optimal trading days based on historical performance
 */
function getOptimalTradingDays() {
  const dayStats = Object.entries(learningState.dailyPerformance)
    .filter(([, stats]) => stats.count >= 5)
    .map(([day, stats]) => ({
      day,
      winRate: stats.wins / stats.count,
      trades: stats.count
    }))
    .sort((a, b) => b.winRate - a.winRate);

  return {
    bestDays: dayStats.filter(d => d.winRate > 0.5).map(d => d.day),
    worstDays: dayStats.filter(d => d.winRate < 0.5).map(d => d.day),
    allDays: dayStats
  };
}

/**
 * Get symbol-specific recommendations
 */
function getSymbolRecommendations(symbol) {
  const stats = learningState.symbolStats[symbol];

  if (!stats || stats.trades < 5) {
    return { hasData: false, symbol };
  }

  return {
    hasData: true,
    symbol,
    winRate: round(stats.wins / stats.trades * 100, 1),
    avgReturn: round(stats.avgReturn, 2),
    trades: stats.trades,
    recommendation: stats.wins / stats.trades > 0.5 ? 'FAVORABLE' : 'CAUTIOUS'
  };
}

/**
 * Get learning insights for dashboard
 */
function getLearningInsights() {
  const optimalHours = getOptimalTradingHours();
  const optimalDays = getOptimalTradingDays();

  // Top performing signals
  const signalRanking = Object.entries(learningState.signalPerformance)
    .filter(([, stats]) => stats.count >= 5)
    .map(([signal, stats]) => ({
      signal,
      winRate: round(stats.wins / stats.count * 100, 1),
      avgReturn: round(stats.avgReturn, 2),
      trades: stats.count
    }))
    .sort((a, b) => b.winRate - a.winRate);

  // Indicator effectiveness ranking
  const indicatorRanking = Object.entries(learningState.indicatorScores)
    .filter(([, stats]) => stats.samples >= 10)
    .map(([indicator, stats]) => ({
      indicator,
      accuracy: round(stats.accuracy * 100, 1),
      samples: stats.samples
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  // Market regime analysis
  const regimeAnalysis = Object.entries(learningState.marketRegimes)
    .filter(([, stats]) => stats.count >= 5)
    .map(([regime, stats]) => ({
      regime,
      winRate: round(stats.winRate * 100, 1),
      avgReturn: round(stats.avgReturn, 2),
      trades: stats.count
    }))
    .sort((a, b) => b.winRate - a.winRate);

  return {
    totalLearnings: learningState.totalLearnings,
    lastUpdate: learningState.lastUpdate,
    version: learningState.version,

    signalPerformance: signalRanking.slice(0, 5),
    indicatorEffectiveness: indicatorRanking,
    marketRegimes: regimeAnalysis,

    optimalHours: optimalHours.bestHours,
    optimalDays: optimalDays.bestDays,
    hoursToAvoid: optimalHours.worstHours,
    daysToAvoid: optimalDays.worstDays,

    adaptiveThresholds: learningState.adaptiveThresholds,

    topSymbols: Object.entries(learningState.symbolStats)
      .filter(([, stats]) => stats.trades >= 5)
      .map(([symbol, stats]) => ({
        symbol,
        winRate: round(stats.wins / stats.trades * 100, 1),
        avgReturn: round(stats.avgReturn, 2),
        trades: stats.trades
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10),

    recommendations: generateLearningRecommendations()
  };
}

/**
 * Generate actionable recommendations from learning
 */
function generateLearningRecommendations() {
  const recommendations = [];

  // Check indicator effectiveness
  const indicators = learningState.indicatorScores;
  const bestIndicator = Object.entries(indicators)
    .filter(([, s]) => s.samples >= 10)
    .sort((a, b) => b[1].accuracy - a[1].accuracy)[0];

  if (bestIndicator && bestIndicator[1].accuracy > 0.6) {
    recommendations.push({
      type: 'INDICATOR',
      message: `${bestIndicator[0].toUpperCase()} is most reliable (${round(bestIndicator[1].accuracy * 100, 1)}% accuracy)`,
      priority: 'high'
    });
  }

  // Check market regime
  const bestRegime = Object.entries(learningState.marketRegimes)
    .filter(([, s]) => s.count >= 10)
    .sort((a, b) => b[1].winRate - a[1].winRate)[0];

  if (bestRegime && bestRegime[1].winRate > 0.55) {
    recommendations.push({
      type: 'REGIME',
      message: `Best performance in ${bestRegime[0]} markets (${round(bestRegime[1].winRate * 100, 1)}% win rate)`,
      priority: 'medium'
    });
  }

  // Check time-based patterns
  const hours = getOptimalTradingHours();
  if (hours.bestHours.length > 0) {
    recommendations.push({
      type: 'TIMING',
      message: `Best hours: ${hours.bestHours.join(':00, ')}:00 UTC`,
      priority: 'medium'
    });
  }

  // Check signal types
  const signalPerf = learningState.signalPerformance;
  if (signalPerf.SNIPER_LONG.count >= 5 && signalPerf.SNIPER_LONG.wins / signalPerf.SNIPER_LONG.count > 0.6) {
    recommendations.push({
      type: 'SIGNAL',
      message: 'Sniper signals showing strong performance',
      priority: 'high'
    });
  }

  return recommendations;
}

function round(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Initialize on load
loadLearningData();

module.exports = {
  detectMarketRegime,
  learnFromTrade,
  getLearnedRecommendation,
  getOptimalTradingHours,
  getOptimalTradingDays,
  getSymbolRecommendations,
  getLearningInsights,
  saveLearningData,
  loadLearningData,
  createState,
  getQValue
};
