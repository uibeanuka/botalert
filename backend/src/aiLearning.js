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

  // CRITICAL: Liquidation and severe loss tracking
  liquidations: [],
  severeLosses: [], // Losses > 5%
  dangerousConditions: {}, // Conditions that led to liquidation/severe loss

  // Entry condition tracking (what conditions led to bad entries)
  badEntryConditions: {
    highFunding: { count: 0, losses: 0 },
    lowVolume: { count: 0, losses: 0 },
    againstTrend: { count: 0, losses: 0 },
    overboughtEntry: { count: 0, losses: 0 },
    oversoldEntry: { count: 0, losses: 0 },
    noSniperConfirm: { count: 0, losses: 0 }
  },

  // SPECIFIC FAILURE PATTERNS - Learn from exact mistakes
  failurePatterns: {
    fakeout: { count: 0, symbols: [], description: 'Entered on breakout that immediately reversed' },
    resistanceReject: { count: 0, symbols: [], description: 'Bought into resistance, got rejected' },
    supportReject: { count: 0, symbols: [], description: 'Shorted into support, got bounced' },
    lateTrend: { count: 0, symbols: [], description: 'Entered too late in move, trend exhausted' },
    volumeTrap: { count: 0, symbols: [], description: 'High volume entry but was distribution/accumulation against position' },
    rangeBreakFail: { count: 0, symbols: [], description: 'Range breakout failed, price returned to range' },
    divergenceIgnored: { count: 0, symbols: [], description: 'Entered despite bearish/bullish divergence warning' },
    newsReversal: { count: 0, symbols: [], description: 'News event caused sudden reversal' },
    liquidationHunt: { count: 0, symbols: [], description: 'Stop hunted before reversal (liquidity grab)' },
    overleveraged: { count: 0, symbols: [], description: 'Extreme funding indicated overleveraged market' }
  },

  // Pattern sequence tracking - what happened before and after entry
  tradeSequences: [], // Stores last 100 trade sequences for pattern analysis

  // === ENTRY CONDITION LEARNING ===
  // Track what conditions triggered successful vs failed trades
  entryConditions: {
    // RSI conditions
    rsiOversold: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    rsiOverbought: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    rsiNeutral: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // MACD conditions
    macdBullish: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    macdBearish: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    macdCrossUp: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    macdCrossDown: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Trend conditions
    strongUptrend: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    strongDowntrend: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    weakTrend: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    noTrend: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Volume conditions
    volumeSpike: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    volumeSurge: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    lowVolume: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    normalVolume: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Sniper conditions
    sniperActive: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    divergenceDetected: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    squeezeBreakout: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    momentumBuilding: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Support/Resistance
    nearSupport: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    nearResistance: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    breakoutUp: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    breakoutDown: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Funding rate conditions
    extremeFundingLong: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    extremeFundingShort: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    normalFunding: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },

    // Pattern conditions
    bullishPattern: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] },
    bearishPattern: { trades: 0, wins: 0, avgReturn: 0, bestWith: [] }
  },

  // Combo tracking - which combinations of conditions work best
  entryComboPerformance: {}, // "rsiOversold+volumeSpike+divergenceDetected" -> { trades, wins, avgReturn }

  // Best performing entry setups (auto-updated)
  bestEntrySetups: [], // Sorted by win rate, top 10
  worstEntrySetups: [], // Sorted by loss rate, bottom 10

  // Statistics
  totalLearnings: 0,
  totalLiquidations: 0,
  worstLoss: 0,
  lastUpdate: null,
  version: 2
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

  // SEVERE penalty for big losses (exponential punishment)
  if (pnlPercent < -5) reward *= 2.0;
  if (pnlPercent < -10) reward *= 3.0;
  if (pnlPercent < -20) reward *= 5.0; // Liquidation territory

  // Small penalty for hold when should have traded
  if (result === 'missed') reward = -1;

  // Liquidation = massive negative reward
  if (result === 'liquidation') reward = -100;

  return round(reward, 2);
}

/**
 * CRITICAL: Learn from liquidation event
 * This creates extremely strong negative associations
 */
function learnFromLiquidation(liquidationData) {
  const {
    symbol,
    indicators,
    entryPrice,
    liquidationPrice,
    direction,
    fundingRate,
    volumeAtEntry,
    timestamp
  } = liquidationData;

  console.log(`🚨 [AI LEARN] CRITICAL LEARNING: Liquidation on ${symbol}`);

  // Record liquidation
  learningState.totalLiquidations++;
  learningState.liquidations.push({
    symbol,
    timestamp,
    direction,
    entryPrice,
    liquidationPrice,
    fundingRate,
    state: createState(indicators)
  });

  // Keep only last 50 liquidations
  if (learningState.liquidations.length > 50) {
    learningState.liquidations = learningState.liquidations.slice(-50);
  }

  // Learn from the state that led to liquidation
  const state = createState(indicators);
  const action = direction === 'long' ? 'LONG' : 'SHORT';

  // MASSIVE negative Q-value update
  updateQValue(state, action, -100, state);

  // Track dangerous conditions
  if (!learningState.dangerousConditions[state]) {
    learningState.dangerousConditions[state] = { liquidations: 0, symbols: [] };
  }
  learningState.dangerousConditions[state].liquidations++;
  learningState.dangerousConditions[state].symbols.push(symbol);

  // Track specific bad entry conditions
  if (fundingRate && Math.abs(fundingRate) > 0.001) {
    learningState.badEntryConditions.highFunding.count++;
    learningState.badEntryConditions.highFunding.losses++;
    console.log(`[AI LEARN] High funding (${(fundingRate * 100).toFixed(3)}%) led to liquidation`);
  }

  if (indicators?.rsi > 70 && direction === 'long') {
    learningState.badEntryConditions.overboughtEntry.count++;
    learningState.badEntryConditions.overboughtEntry.losses++;
    console.log(`[AI LEARN] Overbought entry (RSI: ${indicators.rsi.toFixed(1)}) led to liquidation`);
  }

  if (indicators?.rsi < 30 && direction === 'short') {
    learningState.badEntryConditions.oversoldEntry.count++;
    learningState.badEntryConditions.oversoldEntry.losses++;
    console.log(`[AI LEARN] Oversold entry (RSI: ${indicators.rsi.toFixed(1)}) led to liquidation`);
  }

  if (indicators?.trend?.direction?.includes('DOWN') && direction === 'long') {
    learningState.badEntryConditions.againstTrend.count++;
    learningState.badEntryConditions.againstTrend.losses++;
    console.log(`[AI LEARN] Entry against trend led to liquidation`);
  }

  if (indicators?.trend?.direction?.includes('UP') && direction === 'short') {
    learningState.badEntryConditions.againstTrend.count++;
    learningState.badEntryConditions.againstTrend.losses++;
    console.log(`[AI LEARN] Entry against trend led to liquidation`);
  }

  // Save immediately after liquidation learning
  saveLearningData();

  return {
    learned: true,
    severity: 'CRITICAL',
    state,
    qValueNow: getQValue(state, action),
    message: `Liquidation on ${symbol} recorded. State "${state}" now has strong negative association.`
  };
}

/**
 * Learn from severe loss (> 5%)
 */
function learnFromSevereLoss(lossData) {
  const { symbol, pnlPercent, indicators, direction } = lossData;

  console.log(`⚠️ [AI LEARN] Severe loss on ${symbol}: ${pnlPercent.toFixed(1)}%`);

  // Track worst loss
  if (pnlPercent < learningState.worstLoss) {
    learningState.worstLoss = pnlPercent;
  }

  // Record severe loss
  learningState.severeLosses.push({
    symbol,
    pnlPercent,
    timestamp: Date.now(),
    state: createState(indicators)
  });

  // Keep only last 100 severe losses
  if (learningState.severeLosses.length > 100) {
    learningState.severeLosses = learningState.severeLosses.slice(-100);
  }

  // Update Q-value with severity-weighted penalty
  const state = createState(indicators);
  const action = direction === 'long' ? 'LONG' : 'SHORT';
  const severity = Math.abs(pnlPercent) / 5; // 10% loss = 2x penalty
  updateQValue(state, action, pnlPercent * severity, state);

  return { learned: true, severity: pnlPercent < -10 ? 'HIGH' : 'MEDIUM' };
}

/**
 * CRITICAL: Analyze what went wrong in a trade
 * Detects specific failure patterns for learning
 */
function analyzeTradeFailure(tradeData) {
  const {
    symbol,
    direction,
    entryPrice,
    exitPrice,
    pnlPercent,
    entryIndicators,
    exitIndicators,
    holdTime
  } = tradeData;

  const failures = [];

  // 1. FAKEOUT DETECTION
  // Entered on breakout but price reversed quickly (within 30 min to 2 hours)
  if (entryIndicators?.breakout?.detected && holdTime < 2 * 60 * 60 * 1000 && pnlPercent < -2) {
    failures.push({
      type: 'fakeout',
      confidence: 0.8,
      details: `Breakout ${entryIndicators.breakout.direction} failed within ${Math.round(holdTime / 60000)} min`
    });
    learningState.failurePatterns.fakeout.count++;
    learningState.failurePatterns.fakeout.symbols.push(symbol);
    console.log(`📊 [LEARN] FAKEOUT detected on ${symbol}: Breakout failed`);
  }

  // 2. RESISTANCE REJECTION
  // Bought near resistance and got rejected
  if (direction === 'long' && entryIndicators?.resistance) {
    const distToResistance = (entryIndicators.resistance - entryPrice) / entryPrice * 100;
    if (distToResistance < 1.5 && pnlPercent < -2) {
      failures.push({
        type: 'resistanceReject',
        confidence: 0.85,
        details: `Entered LONG only ${distToResistance.toFixed(1)}% below resistance`
      });
      learningState.failurePatterns.resistanceReject.count++;
      learningState.failurePatterns.resistanceReject.symbols.push(symbol);
      console.log(`📊 [LEARN] RESISTANCE REJECTION on ${symbol}`);
    }
  }

  // 3. SUPPORT REJECTION
  // Shorted near support and got bounced
  if (direction === 'short' && entryIndicators?.support) {
    const distToSupport = (entryPrice - entryIndicators.support) / entryPrice * 100;
    if (distToSupport < 1.5 && pnlPercent < -2) {
      failures.push({
        type: 'supportReject',
        confidence: 0.85,
        details: `Entered SHORT only ${distToSupport.toFixed(1)}% above support`
      });
      learningState.failurePatterns.supportReject.count++;
      learningState.failurePatterns.supportReject.symbols.push(symbol);
      console.log(`📊 [LEARN] SUPPORT REJECTION on ${symbol}`);
    }
  }

  // 4. LATE TREND ENTRY
  // RSI already extreme, trend exhausted
  if ((direction === 'long' && entryIndicators?.rsi > 65) ||
      (direction === 'short' && entryIndicators?.rsi < 35)) {
    failures.push({
      type: 'lateTrend',
      confidence: 0.75,
      details: `RSI was already ${entryIndicators.rsi.toFixed(0)} at entry (trend exhausted)`
    });
    learningState.failurePatterns.lateTrend.count++;
    learningState.failurePatterns.lateTrend.symbols.push(symbol);
    console.log(`📊 [LEARN] LATE TREND ENTRY on ${symbol}: RSI ${entryIndicators.rsi.toFixed(0)}`);
  }

  // 5. VOLUME TRAP
  // High volume at entry but was distribution (longs) or accumulation (shorts)
  if (entryIndicators?.volumeSpike && entryIndicators?.sniperSignals?.volumeAccumulation?.detected) {
    const accumDir = entryIndicators.sniperSignals.volumeAccumulation.direction;
    if ((direction === 'long' && accumDir === 'bearish') ||
        (direction === 'short' && accumDir === 'bullish')) {
      failures.push({
        type: 'volumeTrap',
        confidence: 0.9,
        details: `Volume spike was ${accumDir} accumulation (against position)`
      });
      learningState.failurePatterns.volumeTrap.count++;
      learningState.failurePatterns.volumeTrap.symbols.push(symbol);
      console.log(`📊 [LEARN] VOLUME TRAP on ${symbol}: ${accumDir} accumulation`);
    }
  }

  // 6. DIVERGENCE IGNORED
  // Entered despite divergence warning
  if (entryIndicators?.sniperSignals?.divergence?.detected) {
    const divType = entryIndicators.sniperSignals.divergence.type;
    if ((direction === 'long' && divType === 'bearish') ||
        (direction === 'short' && divType === 'bullish')) {
      failures.push({
        type: 'divergenceIgnored',
        confidence: 0.85,
        details: `Ignored ${divType} divergence warning at entry`
      });
      learningState.failurePatterns.divergenceIgnored.count++;
      learningState.failurePatterns.divergenceIgnored.symbols.push(symbol);
      console.log(`📊 [LEARN] DIVERGENCE IGNORED on ${symbol}: ${divType}`);
    }
  }

  // 7. LIQUIDITY GRAB / STOP HUNT
  // Price spiked against position then reversed (we got stopped before the move)
  if (exitIndicators && entryIndicators) {
    const priceMovedAgainst = direction === 'long'
      ? (entryPrice - exitPrice) / entryPrice * 100
      : (exitPrice - entryPrice) / entryPrice * 100;

    // If we got stopped and then price would have been profitable
    if (pnlPercent < -3 && holdTime < 60 * 60 * 1000) { // Lost > 3% within 1 hour
      failures.push({
        type: 'liquidationHunt',
        confidence: 0.7,
        details: `Quick stop-out (${Math.round(holdTime / 60000)} min), possible liquidity grab`
      });
      learningState.failurePatterns.liquidationHunt.count++;
      learningState.failurePatterns.liquidationHunt.symbols.push(symbol);
      console.log(`📊 [LEARN] LIQUIDITY GRAB on ${symbol}: Stopped within ${Math.round(holdTime / 60000)} min`);
    }
  }

  // 8. OVERLEVERAGED MARKET (Extreme Funding)
  if (entryIndicators?.fundingRate) {
    const rate = entryIndicators.fundingRate;
    if ((direction === 'long' && rate > 0.001) || (direction === 'short' && rate < -0.001)) {
      failures.push({
        type: 'overleveraged',
        confidence: 0.8,
        details: `Funding was ${(rate * 100).toFixed(3)}% (overleveraged ${direction === 'long' ? 'longs' : 'shorts'})`
      });
      learningState.failurePatterns.overleveraged.count++;
      learningState.failurePatterns.overleveraged.symbols.push(symbol);
      console.log(`📊 [LEARN] OVERLEVERAGED on ${symbol}: Funding ${(rate * 100).toFixed(3)}%`);
    }
  }

  // Store this trade sequence for pattern learning
  learningState.tradeSequences.push({
    symbol,
    direction,
    pnlPercent,
    holdTime,
    failures: failures.map(f => f.type),
    timestamp: Date.now(),
    entryState: createState(entryIndicators),
    exitState: exitIndicators ? createState(exitIndicators) : null
  });

  // Keep only last 100 sequences
  if (learningState.tradeSequences.length > 100) {
    learningState.tradeSequences = learningState.tradeSequences.slice(-100);
  }

  return failures;
}

/**
 * Check if current entry would match known failure patterns
 */
function checkFailurePatternRisk(symbol, direction, indicators) {
  const risks = [];

  // Check fakeout risk
  if (indicators?.breakout?.detected) {
    const fakeoutRate = learningState.failurePatterns.fakeout.count > 5
      ? learningState.failurePatterns.fakeout.count / Math.max(learningState.totalLearnings, 1)
      : 0;
    if (fakeoutRate > 0.15) {
      risks.push({ pattern: 'fakeout', risk: 'high', reason: 'Breakouts have high fakeout rate' });
    }
  }

  // Check resistance risk for longs
  if (direction === 'long' && indicators?.resistance) {
    const distToResistance = (indicators.resistance - indicators.currentPrice) / indicators.currentPrice * 100;
    if (distToResistance < 1.5 && learningState.failurePatterns.resistanceReject.count > 3) {
      risks.push({ pattern: 'resistanceReject', risk: 'high', reason: `Only ${distToResistance.toFixed(1)}% to resistance` });
    }
  }

  // Check support risk for shorts
  if (direction === 'short' && indicators?.support) {
    const distToSupport = (indicators.currentPrice - indicators.support) / indicators.currentPrice * 100;
    if (distToSupport < 1.5 && learningState.failurePatterns.supportReject.count > 3) {
      risks.push({ pattern: 'supportReject', risk: 'high', reason: `Only ${distToSupport.toFixed(1)}% to support` });
    }
  }

  // Check late trend risk
  if ((direction === 'long' && indicators?.rsi > 65) || (direction === 'short' && indicators?.rsi < 35)) {
    if (learningState.failurePatterns.lateTrend.count > 3) {
      risks.push({ pattern: 'lateTrend', risk: 'medium', reason: `RSI ${indicators.rsi.toFixed(0)} suggests late entry` });
    }
  }

  // Check divergence warning
  if (indicators?.sniperSignals?.divergence?.detected) {
    const divType = indicators.sniperSignals.divergence.type;
    if ((direction === 'long' && divType === 'bearish') || (direction === 'short' && divType === 'bullish')) {
      if (learningState.failurePatterns.divergenceIgnored.count > 2) {
        risks.push({ pattern: 'divergenceIgnored', risk: 'high', reason: `${divType} divergence detected` });
      }
    }
  }

  // Check funding rate risk
  if (indicators?.fundingRate) {
    const rate = indicators.fundingRate;
    if ((direction === 'long' && rate > 0.0008) || (direction === 'short' && rate < -0.0008)) {
      risks.push({ pattern: 'overleveraged', risk: 'high', reason: `Extreme funding ${(rate * 100).toFixed(3)}%` });
    }
  }

  return {
    hasRisk: risks.length > 0,
    highRisk: risks.some(r => r.risk === 'high'),
    risks,
    recommendation: risks.length > 2 ? 'AVOID' : risks.some(r => r.risk === 'high') ? 'CAUTION' : 'OK'
  };
}

/**
 * Get failure pattern statistics for dashboard
 */
function getFailurePatternStats() {
  const stats = {};
  for (const [pattern, data] of Object.entries(learningState.failurePatterns)) {
    stats[pattern] = {
      count: data.count,
      description: data.description,
      recentSymbols: data.symbols.slice(-5)
    };
  }
  return stats;
}

/**
 * Check if current conditions are dangerous based on past liquidations
 */
function isDangerousCondition(indicators) {
  const state = createState(indicators);

  // Check if this state has led to liquidations before
  if (learningState.dangerousConditions[state]) {
    const danger = learningState.dangerousConditions[state];
    if (danger.liquidations >= 1) {
      return {
        dangerous: true,
        reason: `State "${state}" has caused ${danger.liquidations} liquidation(s)`,
        liquidations: danger.liquidations
      };
    }
  }

  // Check Q-values - if very negative, it's dangerous
  const qLong = getQValue(state, 'LONG');
  const qShort = getQValue(state, 'SHORT');

  if (qLong < -20 || qShort < -20) {
    return {
      dangerous: true,
      reason: `State has very negative Q-values (LONG: ${qLong.toFixed(1)}, SHORT: ${qShort.toFixed(1)})`,
      qValues: { LONG: qLong, SHORT: qShort }
    };
  }

  return { dangerous: false };
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

// ============================================================
// === ENTRY CONDITION LEARNING - Learn what works best ===
// ============================================================

/**
 * Extract all entry conditions present in current indicators
 * Returns array of condition names that are active
 */
function extractEntryConditions(indicators) {
  if (!indicators) return [];

  const conditions = [];

  // RSI conditions
  if (indicators.rsi !== undefined) {
    if (indicators.rsi < 30) conditions.push('rsiOversold');
    else if (indicators.rsi > 70) conditions.push('rsiOverbought');
    else conditions.push('rsiNeutral');
  }

  // MACD conditions
  if (indicators.macd) {
    if (indicators.macd.histogram > 0) conditions.push('macdBullish');
    else if (indicators.macd.histogram < 0) conditions.push('macdBearish');

    // MACD cross detection (simplified)
    if (indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0 && indicators.macd.histogram < 0.5) {
      conditions.push('macdCrossUp');
    } else if (indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0 && indicators.macd.histogram > -0.5) {
      conditions.push('macdCrossDown');
    }
  }

  // Trend conditions
  if (indicators.trend?.direction) {
    if (indicators.trend.direction.includes('STRONG_UP')) conditions.push('strongUptrend');
    else if (indicators.trend.direction.includes('STRONG_DOWN')) conditions.push('strongDowntrend');
    else if (indicators.trend.direction.includes('UP') || indicators.trend.direction.includes('DOWN')) conditions.push('weakTrend');
    else conditions.push('noTrend');
  }

  // Volume conditions
  if (indicators.volumeSpike) conditions.push('volumeSpike');
  if (indicators.sniperSignals?.volumeSurge?.detected) {
    conditions.push('volumeSurge');
    if (indicators.sniperSignals.volumeSurge.isExplosive) conditions.push('explosiveVolume');
  }
  if (indicators.volumeRatio !== undefined) {
    if (indicators.volumeRatio < 0.5) conditions.push('lowVolume');
    else if (indicators.volumeRatio >= 0.5 && indicators.volumeRatio <= 1.5) conditions.push('normalVolume');
  }

  // Sniper conditions
  if (indicators.sniperSignals?.score?.isSniper) conditions.push('sniperActive');
  if (indicators.sniperSignals?.divergence?.detected) {
    conditions.push('divergenceDetected');
    conditions.push(`divergence_${indicators.sniperSignals.divergence.type}`);
  }
  if (indicators.sniperSignals?.squeeze?.inSqueeze) conditions.push('inSqueeze');
  if (indicators.sniperSignals?.squeeze?.breakoutReady) conditions.push('squeezeBreakout');
  if (indicators.sniperSignals?.momentumBuilding?.detected) conditions.push('momentumBuilding');
  if (indicators.sniperSignals?.volumeAccumulation?.detected) conditions.push('volumeAccumulation');

  // Support/Resistance
  if (indicators.support && indicators.currentPrice) {
    const distToSupport = (indicators.currentPrice - indicators.support) / indicators.currentPrice * 100;
    if (distToSupport < 2) conditions.push('nearSupport');
  }
  if (indicators.resistance && indicators.currentPrice) {
    const distToResistance = (indicators.resistance - indicators.currentPrice) / indicators.currentPrice * 100;
    if (distToResistance < 2) conditions.push('nearResistance');
  }
  if (indicators.breakout?.detected) {
    if (indicators.breakout.direction === 'up') conditions.push('breakoutUp');
    else if (indicators.breakout.direction === 'down') conditions.push('breakoutDown');
  }

  // Funding rate
  if (indicators.fundingRate !== undefined) {
    if (indicators.fundingRate >= 0.001) conditions.push('extremeFundingLong');
    else if (indicators.fundingRate <= -0.001) conditions.push('extremeFundingShort');
    else conditions.push('normalFunding');
  }

  // Candlestick patterns
  if (indicators.patterns?.length > 0) {
    const bullishPatterns = ['BULLISH_ENGULFING', 'HAMMER', 'MORNING_STAR', 'PIERCING', 'THREE_WHITE_SOLDIERS'];
    const bearishPatterns = ['BEARISH_ENGULFING', 'SHOOTING_STAR', 'EVENING_STAR', 'DARK_CLOUD', 'THREE_BLACK_CROWS'];

    if (indicators.patterns.some(p => bullishPatterns.includes(p))) conditions.push('bullishPattern');
    if (indicators.patterns.some(p => bearishPatterns.includes(p))) conditions.push('bearishPattern');
  }

  // Bollinger Band position
  if (indicators.bollinger?.pb !== undefined) {
    if (indicators.bollinger.pb < 0.1) conditions.push('bbLowerBand');
    else if (indicators.bollinger.pb > 0.9) conditions.push('bbUpperBand');
    else if (indicators.bollinger.pb >= 0.4 && indicators.bollinger.pb <= 0.6) conditions.push('bbMiddle');
  }

  return conditions;
}

/**
 * Update entry condition performance after trade closes
 */
function updateEntryConditionPerformance(entryConditions, result, pnlPercent) {
  if (!entryConditions || entryConditions.length === 0) return;

  const isWin = result === 'win' || pnlPercent > 0;

  // Update individual conditions
  for (const condition of entryConditions) {
    if (learningState.entryConditions[condition]) {
      const ec = learningState.entryConditions[condition];
      ec.trades++;
      if (isWin) ec.wins++;
      ec.avgReturn = (ec.avgReturn * (ec.trades - 1) + pnlPercent) / ec.trades;

      // Track which other conditions this worked well with
      if (isWin && pnlPercent > 1) {
        for (const other of entryConditions) {
          if (other !== condition && !ec.bestWith.includes(other)) {
            ec.bestWith.push(other);
            if (ec.bestWith.length > 5) ec.bestWith.shift(); // Keep last 5
          }
        }
      }
    }
  }

  // Update combo performance
  if (entryConditions.length >= 2) {
    const comboKey = entryConditions.sort().join('+');
    if (!learningState.entryComboPerformance[comboKey]) {
      learningState.entryComboPerformance[comboKey] = { trades: 0, wins: 0, avgReturn: 0 };
    }
    const combo = learningState.entryComboPerformance[comboKey];
    combo.trades++;
    if (isWin) combo.wins++;
    combo.avgReturn = (combo.avgReturn * (combo.trades - 1) + pnlPercent) / combo.trades;
  }

  // Update best/worst entry setups
  updateBestWorstSetups();
}

/**
 * Update the best and worst entry setups lists
 */
function updateBestWorstSetups() {
  // Get all entry conditions with enough samples
  const conditionStats = Object.entries(learningState.entryConditions)
    .filter(([, stats]) => stats.trades >= 5)
    .map(([name, stats]) => ({
      name,
      winRate: stats.wins / stats.trades,
      avgReturn: stats.avgReturn,
      trades: stats.trades,
      bestWith: stats.bestWith
    }));

  // Sort by win rate for best setups
  learningState.bestEntrySetups = conditionStats
    .filter(c => c.winRate >= 0.5)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10);

  // Sort by loss rate for worst setups
  learningState.worstEntrySetups = conditionStats
    .filter(c => c.winRate < 0.5)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 10);

  // Also check combos
  const comboStats = Object.entries(learningState.entryComboPerformance)
    .filter(([, stats]) => stats.trades >= 3)
    .map(([name, stats]) => ({
      name,
      winRate: stats.wins / stats.trades,
      avgReturn: stats.avgReturn,
      trades: stats.trades,
      isCombo: true
    }));

  // Add top combos to best setups
  const topCombos = comboStats
    .filter(c => c.winRate >= 0.6)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  learningState.bestEntrySetups = [
    ...topCombos,
    ...learningState.bestEntrySetups
  ].slice(0, 10);
}

/**
 * Check entry quality against learned patterns
 * Returns recommendation: EXCELLENT, GOOD, FAIR, POOR, AVOID
 */
function checkEntryQuality(indicators, direction) {
  const conditions = extractEntryConditions(indicators);

  if (conditions.length === 0) {
    return { quality: 'UNKNOWN', reason: 'No entry conditions detected', conditions: [] };
  }

  // Check how many conditions match best setups
  const bestConditions = learningState.bestEntrySetups
    .filter(s => !s.isCombo)
    .map(s => s.name);
  const worstConditions = learningState.worstEntrySetups.map(s => s.name);

  const matchingBest = conditions.filter(c => bestConditions.includes(c));
  const matchingWorst = conditions.filter(c => worstConditions.includes(c));

  // Calculate expected win rate based on matching conditions
  let expectedWinRate = 0.5; // Neutral baseline
  let sampleCount = 0;

  for (const condition of conditions) {
    if (learningState.entryConditions[condition]?.trades >= 5) {
      const ec = learningState.entryConditions[condition];
      const conditionWinRate = ec.wins / ec.trades;
      expectedWinRate = (expectedWinRate * sampleCount + conditionWinRate) / (sampleCount + 1);
      sampleCount++;
    }
  }

  // Check combo performance
  const comboKey = conditions.sort().join('+');
  const comboStats = learningState.entryComboPerformance[comboKey];
  if (comboStats?.trades >= 3) {
    const comboWinRate = comboStats.wins / comboStats.trades;
    expectedWinRate = (expectedWinRate + comboWinRate) / 2; // Blend with combo rate
  }

  // Determine quality
  let quality, reason;

  if (matchingWorst.length >= 2 || expectedWinRate < 0.35) {
    quality = 'AVOID';
    reason = `Matches ${matchingWorst.length} losing patterns: ${matchingWorst.join(', ')}`;
  } else if (matchingWorst.length >= 1 && matchingBest.length === 0) {
    quality = 'POOR';
    reason = `Matches losing pattern: ${matchingWorst.join(', ')}`;
  } else if (matchingBest.length >= 2 || expectedWinRate >= 0.65) {
    quality = 'EXCELLENT';
    reason = `Matches ${matchingBest.length} winning patterns (${(expectedWinRate * 100).toFixed(0)}% expected win rate)`;
  } else if (matchingBest.length >= 1 || expectedWinRate >= 0.55) {
    quality = 'GOOD';
    reason = `Matches winning pattern: ${matchingBest.join(', ')}`;
  } else {
    quality = 'FAIR';
    reason = `Neutral conditions (${(expectedWinRate * 100).toFixed(0)}% expected win rate)`;
  }

  return {
    quality,
    reason,
    conditions,
    matchingBest,
    matchingWorst,
    expectedWinRate: round(expectedWinRate, 2),
    comboStats: comboStats || null
  };
}

/**
 * Get best entry conditions for a direction
 */
function getBestEntryConditions(direction = 'long') {
  const best = learningState.bestEntrySetups.slice(0, 5);
  const worst = learningState.worstEntrySetups.slice(0, 5);

  return {
    recommended: best.map(s => ({
      condition: s.name,
      winRate: round(s.winRate * 100, 1),
      avgReturn: round(s.avgReturn, 2),
      trades: s.trades,
      bestWith: s.bestWith || []
    })),
    avoid: worst.map(s => ({
      condition: s.name,
      winRate: round(s.winRate * 100, 1),
      avgReturn: round(s.avgReturn, 2),
      trades: s.trades
    })),
    topCombos: Object.entries(learningState.entryComboPerformance)
      .filter(([, stats]) => stats.trades >= 3 && stats.wins / stats.trades >= 0.6)
      .map(([name, stats]) => ({
        combo: name,
        winRate: round((stats.wins / stats.trades) * 100, 1),
        avgReturn: round(stats.avgReturn, 2),
        trades: stats.trades
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 5)
  };
}

/**
 * Get entry condition statistics for dashboard
 */
function getEntryConditionStats() {
  const stats = {};

  for (const [name, data] of Object.entries(learningState.entryConditions)) {
    if (data.trades > 0) {
      stats[name] = {
        trades: data.trades,
        wins: data.wins,
        winRate: round((data.wins / data.trades) * 100, 1),
        avgReturn: round(data.avgReturn, 2),
        bestWith: data.bestWith.slice(0, 3)
      };
    }
  }

  return {
    conditions: stats,
    bestSetups: learningState.bestEntrySetups,
    worstSetups: learningState.worstEntrySetups,
    topCombos: Object.entries(learningState.entryComboPerformance)
      .filter(([, s]) => s.trades >= 3)
      .map(([name, s]) => ({
        combo: name,
        winRate: round((s.wins / s.trades) * 100, 1),
        avgReturn: round(s.avgReturn, 2),
        trades: s.trades
      }))
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 20)
  };
}

// Initialize on load
loadLearningData();

module.exports = {
  detectMarketRegime,
  learnFromTrade,
  learnFromLiquidation,
  learnFromSevereLoss,
  analyzeTradeFailure,
  checkFailurePatternRisk,
  getFailurePatternStats,
  isDangerousCondition,
  getLearnedRecommendation,
  getOptimalTradingHours,
  getOptimalTradingDays,
  getSymbolRecommendations,
  getLearningInsights,
  saveLearningData,
  loadLearningData,
  createState,
  getQValue,
  // Entry condition learning
  extractEntryConditions,
  updateEntryConditionPerformance,
  checkEntryQuality,
  getBestEntryConditions,
  getEntryConditionStats
};
