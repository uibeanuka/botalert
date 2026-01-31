/**
 * Deep Trade Analyzer - Understands WHY trades succeed or fail
 *
 * Analyzes every trade to learn:
 * - Trading style effectiveness (scalp, intraday, swing)
 * - Root cause of wins and losses
 * - Optimal exit timing
 * - Market condition patterns
 * - When to use which strategy
 */

const mongo = require('./mongoStorage');

// Trade style thresholds (in milliseconds)
const STYLE_THRESHOLDS = {
  SCALP: 30 * 60 * 1000,        // < 30 minutes
  INTRADAY: 4 * 60 * 60 * 1000, // 30 min - 4 hours
  SWING: 24 * 60 * 60 * 1000,   // 4 hours - 24 hours
  POSITION: Infinity            // > 24 hours
};

// Analysis state - learns patterns over time
let analysisState = {
  // Style performance tracking
  stylePerformance: {
    SCALP: { trades: 0, wins: 0, totalPnl: 0, avgHoldTime: 0, bestConditions: [], worstConditions: [] },
    INTRADAY: { trades: 0, wins: 0, totalPnl: 0, avgHoldTime: 0, bestConditions: [], worstConditions: [] },
    SWING: { trades: 0, wins: 0, totalPnl: 0, avgHoldTime: 0, bestConditions: [], worstConditions: [] },
    POSITION: { trades: 0, wins: 0, totalPnl: 0, avgHoldTime: 0, bestConditions: [], worstConditions: [] }
  },

  // Root cause tracking - WHY trades failed
  lossReasons: {
    prematureExit: { count: 0, avgLoss: 0, examples: [] },       // Exited too early, would have been profitable
    lateExit: { count: 0, avgLoss: 0, examples: [] },            // Held too long, gave back profits
    wrongDirection: { count: 0, avgLoss: 0, examples: [] },       // Direction was simply wrong
    stopHunted: { count: 0, avgLoss: 0, examples: [] },           // Hit SL then reversed
    newsEvent: { count: 0, avgLoss: 0, examples: [] },            // Sudden move from news
    overtrading: { count: 0, avgLoss: 0, examples: [] },          // Too many trades, fatigue
    lowVolume: { count: 0, avgLoss: 0, examples: [] },            // Entered during low liquidity
    rangeTrapped: { count: 0, avgLoss: 0, examples: [] },         // Got chopped in range
    trendExhausted: { count: 0, avgLoss: 0, examples: [] },       // Entered at end of trend
    fundingCrushed: { count: 0, avgLoss: 0, examples: [] },       // Funding against position
    leverageTooHigh: { count: 0, avgLoss: 0, examples: [] },      // Position too large
    ignoredDivergence: { count: 0, avgLoss: 0, examples: [] },    // Ignored warning signals
    chaseEntry: { count: 0, avgLoss: 0, examples: [] },           // Chased after move started
    counterTrend: { count: 0, avgLoss: 0, examples: [] }          // Traded against strong trend
  },

  // Win reasons - WHY trades succeeded
  winReasons: {
    perfectTiming: { count: 0, avgWin: 0, examples: [] },         // Entry and exit spot on
    trendRiding: { count: 0, avgWin: 0, examples: [] },           // Caught and rode a trend
    reversalCatch: { count: 0, avgWin: 0, examples: [] },         // Caught reversal early
    breakoutCapture: { count: 0, avgWin: 0, examples: [] },       // Breakout trade worked
    divergencePlay: { count: 0, avgWin: 0, examples: [] },        // Divergence signal paid off
    volumeConfirm: { count: 0, avgWin: 0, examples: [] },         // Volume confirmed move
    sniperEntry: { count: 0, avgWin: 0, examples: [] },           // Sniper signals worked
    fundingPlay: { count: 0, avgWin: 0, examples: [] },           // Faded extreme funding
    supportBounce: { count: 0, avgWin: 0, examples: [] },         // Bought support
    resistanceReject: { count: 0, avgWin: 0, examples: [] }       // Shorted resistance
  },

  // Exit quality tracking
  exitQuality: {
    perfect: { count: 0, avgPnl: 0 },      // Exited within 5% of optimal
    good: { count: 0, avgPnl: 0 },         // Exited within 15% of optimal
    acceptable: { count: 0, avgPnl: 0 },   // Exited within 30% of optimal
    early: { count: 0, avgPnl: 0 },        // Exited too early (left >30% on table)
    late: { count: 0, avgPnl: 0 }          // Exited too late (gave back >30%)
  },

  // Condition-to-style mapping (learns which style works in which condition)
  conditionStyleMap: {},  // "trending+highVolume" -> { bestStyle: "SWING", winRate: 0.7 }

  // Time-based style recommendations
  hourlyStyleSuccess: {},  // hour -> { SCALP: winRate, INTRADAY: winRate, SWING: winRate }

  // Symbol-specific style learning
  symbolStyleMap: {},  // symbol -> { bestStyle, avgHoldTime, winRateByStyle }

  // Recent analyses for dashboard
  recentAnalyses: [],

  // Overall statistics
  totalAnalyzed: 0,
  lastAnalysis: null
};

/**
 * Determine trading style from hold time
 */
function getTradeStyle(holdTimeMs) {
  if (holdTimeMs < STYLE_THRESHOLDS.SCALP) return 'SCALP';
  if (holdTimeMs < STYLE_THRESHOLDS.INTRADAY) return 'INTRADAY';
  if (holdTimeMs < STYLE_THRESHOLDS.SWING) return 'SWING';
  return 'POSITION';
}

/**
 * Deep analyze a completed trade - understand WHY it succeeded or failed
 */
function analyzeCompletedTrade(tradeData) {
  const {
    symbol,
    direction,
    entryPrice,
    exitPrice,
    pnlPercent,
    result,
    holdTime,
    entryIndicators,
    exitIndicators,
    peakPnlPercent,
    troughPnlPercent,
    entryConditions,
    signal,
    closeReason
  } = tradeData;

  const style = getTradeStyle(holdTime);
  const isWin = result === 'win' || pnlPercent > 0;

  const analysis = {
    symbol,
    direction,
    style,
    pnlPercent,
    holdTimeMinutes: Math.round(holdTime / 60000),
    isWin,
    rootCauses: [],
    exitQuality: 'unknown',
    shouldHaveUsedStyle: null,
    lessonsLearned: [],
    timestamp: Date.now()
  };

  // === ANALYZE ROOT CAUSE ===

  if (isWin) {
    // Analyze WHY we won
    analysis.rootCauses = analyzeWinCause(tradeData, entryIndicators, exitIndicators);
  } else {
    // Analyze WHY we lost
    analysis.rootCauses = analyzeLossCause(tradeData, entryIndicators, exitIndicators);
  }

  // === ANALYZE EXIT QUALITY ===
  if (peakPnlPercent !== undefined && pnlPercent !== undefined) {
    analysis.exitQuality = analyzeExitQuality(pnlPercent, peakPnlPercent, troughPnlPercent);
  }

  // === DETERMINE OPTIMAL STYLE ===
  analysis.shouldHaveUsedStyle = determineOptimalStyle(tradeData, entryIndicators);

  // === EXTRACT LESSONS ===
  analysis.lessonsLearned = extractLessons(analysis);

  // === UPDATE LEARNING STATE ===
  updateAnalysisState(analysis, tradeData);

  // === STORE IN MONGODB ===
  if (mongo.isAvailable()) {
    mongo.storeMarketSnapshot({
      type: 'trade_analysis',
      ...analysis,
      entryConditions,
      indicators: {
        entryRsi: entryIndicators?.rsi,
        exitRsi: exitIndicators?.rsi,
        entryTrend: entryIndicators?.trend?.direction,
        exitTrend: exitIndicators?.trend?.direction,
        volumeRatio: entryIndicators?.volumeRatio
      }
    }).catch(() => {});
  }

  // Add to recent analyses
  analysisState.recentAnalyses.unshift(analysis);
  if (analysisState.recentAnalyses.length > 50) {
    analysisState.recentAnalyses = analysisState.recentAnalyses.slice(0, 50);
  }

  analysisState.totalAnalyzed++;
  analysisState.lastAnalysis = Date.now();

  return analysis;
}

/**
 * Analyze WHY a winning trade succeeded
 */
function analyzeWinCause(tradeData, entryInd, exitInd) {
  const causes = [];
  const { direction, pnlPercent, holdTime, peakPnlPercent } = tradeData;

  // Perfect timing - captured most of the move
  if (peakPnlPercent && pnlPercent >= peakPnlPercent * 0.8) {
    causes.push({ reason: 'perfectTiming', confidence: 0.9, detail: 'Captured 80%+ of peak move' });
    analysisState.winReasons.perfectTiming.count++;
    analysisState.winReasons.perfectTiming.avgWin =
      (analysisState.winReasons.perfectTiming.avgWin * (analysisState.winReasons.perfectTiming.count - 1) + pnlPercent) /
      analysisState.winReasons.perfectTiming.count;
  }

  // Trend riding
  if (entryInd?.trend?.direction?.includes('STRONG') &&
      ((direction === 'long' && entryInd.trend.direction.includes('UP')) ||
       (direction === 'short' && entryInd.trend.direction.includes('DOWN')))) {
    causes.push({ reason: 'trendRiding', confidence: 0.85, detail: 'Traded with strong trend' });
    analysisState.winReasons.trendRiding.count++;
    analysisState.winReasons.trendRiding.avgWin =
      (analysisState.winReasons.trendRiding.avgWin * (analysisState.winReasons.trendRiding.count - 1) + pnlPercent) /
      analysisState.winReasons.trendRiding.count;
  }

  // Divergence play worked
  if (entryInd?.sniperSignals?.divergence?.detected) {
    const divType = entryInd.sniperSignals.divergence.type;
    if ((direction === 'long' && divType === 'bullish') || (direction === 'short' && divType === 'bearish')) {
      causes.push({ reason: 'divergencePlay', confidence: 0.9, detail: `${divType} divergence confirmed` });
      analysisState.winReasons.divergencePlay.count++;
    }
  }

  // Sniper entry worked
  if (entryInd?.sniperSignals?.score?.isSniper) {
    causes.push({ reason: 'sniperEntry', confidence: 0.85, detail: `Sniper score ${entryInd.sniperSignals.score.score}` });
    analysisState.winReasons.sniperEntry.count++;
  }

  // Volume confirmed the move
  if (entryInd?.volumeSpike || entryInd?.sniperSignals?.volumeSurge?.detected) {
    causes.push({ reason: 'volumeConfirm', confidence: 0.8, detail: 'Volume surge confirmed entry' });
    analysisState.winReasons.volumeConfirm.count++;
  }

  // Breakout capture
  if (entryInd?.breakout?.detected) {
    causes.push({ reason: 'breakoutCapture', confidence: 0.85, detail: `Breakout ${entryInd.breakout.direction}` });
    analysisState.winReasons.breakoutCapture.count++;
  }

  // Funding play (faded extreme funding)
  if (entryInd?.fundingRate) {
    if ((direction === 'short' && entryInd.fundingRate >= 0.001) ||
        (direction === 'long' && entryInd.fundingRate <= -0.001)) {
      causes.push({ reason: 'fundingPlay', confidence: 0.9, detail: 'Faded extreme funding' });
      analysisState.winReasons.fundingPlay.count++;
    }
  }

  // Support bounce / resistance reject
  if (direction === 'long' && entryInd?.support) {
    const distToSupport = (entryInd.currentPrice - entryInd.support) / entryInd.currentPrice * 100;
    if (distToSupport < 2) {
      causes.push({ reason: 'supportBounce', confidence: 0.8, detail: 'Bought near support' });
      analysisState.winReasons.supportBounce.count++;
    }
  }
  if (direction === 'short' && entryInd?.resistance) {
    const distToResistance = (entryInd.resistance - entryInd.currentPrice) / entryInd.currentPrice * 100;
    if (distToResistance < 2) {
      causes.push({ reason: 'resistanceReject', confidence: 0.8, detail: 'Shorted near resistance' });
      analysisState.winReasons.resistanceReject.count++;
    }
  }

  return causes.length > 0 ? causes : [{ reason: 'unknown', confidence: 0.5, detail: 'No clear pattern identified' }];
}

/**
 * Analyze WHY a losing trade failed
 */
function analyzeLossCause(tradeData, entryInd, exitInd) {
  const causes = [];
  const { direction, pnlPercent, holdTime, peakPnlPercent, closeReason, entryPrice, exitPrice } = tradeData;

  // Premature exit - was profitable but exited too early
  if (peakPnlPercent && peakPnlPercent > 1 && pnlPercent < 0) {
    causes.push({
      reason: 'prematureExit',
      confidence: 0.9,
      detail: `Was +${peakPnlPercent.toFixed(1)}% but exited at ${pnlPercent.toFixed(1)}%`
    });
    updateLossReason('prematureExit', pnlPercent);
  }

  // Late exit - gave back too much
  if (peakPnlPercent && peakPnlPercent > 3 && pnlPercent < peakPnlPercent * 0.3) {
    causes.push({
      reason: 'lateExit',
      confidence: 0.85,
      detail: `Peak was +${peakPnlPercent.toFixed(1)}%, gave back ${(peakPnlPercent - pnlPercent).toFixed(1)}%`
    });
    updateLossReason('lateExit', pnlPercent);
  }

  // Counter-trend trade
  if (entryInd?.trend?.direction?.includes('STRONG')) {
    if ((direction === 'long' && entryInd.trend.direction.includes('DOWN')) ||
        (direction === 'short' && entryInd.trend.direction.includes('UP'))) {
      causes.push({ reason: 'counterTrend', confidence: 0.95, detail: `Traded against ${entryInd.trend.direction}` });
      updateLossReason('counterTrend', pnlPercent);
    }
  }

  // Trend exhausted - entered too late
  if ((direction === 'long' && entryInd?.rsi > 70) ||
      (direction === 'short' && entryInd?.rsi < 30)) {
    causes.push({
      reason: 'trendExhausted',
      confidence: 0.8,
      detail: `RSI ${entryInd.rsi.toFixed(0)} at entry - trend may be exhausted`
    });
    updateLossReason('trendExhausted', pnlPercent);
  }

  // Chased entry - entered after move started
  if (entryInd?.sniperSignals?.momentumBuilding?.detected &&
      entryInd.sniperSignals.momentumBuilding.strength > 70) {
    causes.push({ reason: 'chaseEntry', confidence: 0.75, detail: 'Entered after momentum already strong' });
    updateLossReason('chaseEntry', pnlPercent);
  }

  // Stop hunted
  if (closeReason?.includes('SL') || closeReason?.includes('stop')) {
    if (holdTime < 30 * 60 * 1000) { // Hit SL within 30 minutes
      causes.push({ reason: 'stopHunted', confidence: 0.7, detail: 'Quick stop-out, possible liquidity grab' });
      updateLossReason('stopHunted', pnlPercent);
    }
  }

  // Low volume entry
  if (entryInd?.volumeRatio && entryInd.volumeRatio < 0.5) {
    causes.push({ reason: 'lowVolume', confidence: 0.75, detail: `Volume ratio ${entryInd.volumeRatio.toFixed(2)} at entry` });
    updateLossReason('lowVolume', pnlPercent);
  }

  // Funding crushed
  if (entryInd?.fundingRate) {
    if ((direction === 'long' && entryInd.fundingRate >= 0.001) ||
        (direction === 'short' && entryInd.fundingRate <= -0.001)) {
      causes.push({
        reason: 'fundingCrushed',
        confidence: 0.85,
        detail: `Funding ${(entryInd.fundingRate * 100).toFixed(3)}% against position`
      });
      updateLossReason('fundingCrushed', pnlPercent);
    }
  }

  // Ignored divergence warning
  if (entryInd?.sniperSignals?.divergence?.detected) {
    const divType = entryInd.sniperSignals.divergence.type;
    if ((direction === 'long' && divType === 'bearish') || (direction === 'short' && divType === 'bullish')) {
      causes.push({ reason: 'ignoredDivergence', confidence: 0.9, detail: `Ignored ${divType} divergence` });
      updateLossReason('ignoredDivergence', pnlPercent);
    }
  }

  // Range trapped (no clear direction)
  if (!entryInd?.trend?.direction?.includes('STRONG') && !entryInd?.breakout?.detected) {
    if (entryInd?.bollinger?.pb && entryInd.bollinger.pb > 0.3 && entryInd.bollinger.pb < 0.7) {
      causes.push({ reason: 'rangeTrapped', confidence: 0.7, detail: 'Entered in range without breakout confirmation' });
      updateLossReason('rangeTrapped', pnlPercent);
    }
  }

  // Wrong direction entirely
  if (causes.length === 0) {
    causes.push({ reason: 'wrongDirection', confidence: 0.6, detail: 'Market moved opposite to prediction' });
    updateLossReason('wrongDirection', pnlPercent);
  }

  return causes;
}

function updateLossReason(reason, pnlPercent) {
  if (analysisState.lossReasons[reason]) {
    const r = analysisState.lossReasons[reason];
    r.count++;
    r.avgLoss = (r.avgLoss * (r.count - 1) + pnlPercent) / r.count;
  }
}

/**
 * Analyze exit quality - did we exit at the right time?
 */
function analyzeExitQuality(actualPnl, peakPnl, troughPnl) {
  if (!peakPnl || peakPnl <= 0) return 'unknown';

  const captureRatio = actualPnl / peakPnl;

  if (captureRatio >= 0.95) {
    analysisState.exitQuality.perfect.count++;
    analysisState.exitQuality.perfect.avgPnl =
      (analysisState.exitQuality.perfect.avgPnl * (analysisState.exitQuality.perfect.count - 1) + actualPnl) /
      analysisState.exitQuality.perfect.count;
    return 'perfect';
  }
  if (captureRatio >= 0.85) {
    analysisState.exitQuality.good.count++;
    return 'good';
  }
  if (captureRatio >= 0.70) {
    analysisState.exitQuality.acceptable.count++;
    return 'acceptable';
  }
  if (captureRatio < 0.70 && actualPnl > 0) {
    analysisState.exitQuality.early.count++;
    return 'early';
  }
  if (actualPnl < peakPnl * 0.3) {
    analysisState.exitQuality.late.count++;
    return 'late';
  }

  return 'unknown';
}

/**
 * Determine what trading style SHOULD have been used
 */
function determineOptimalStyle(tradeData, entryInd) {
  const { holdTime, pnlPercent, peakPnlPercent } = tradeData;

  // If trade was profitable, current style might be fine
  if (pnlPercent > 0 && peakPnlPercent && pnlPercent >= peakPnlPercent * 0.7) {
    return getTradeStyle(holdTime); // Current style worked
  }

  // Strong trend = SWING or INTRADAY
  if (entryInd?.trend?.direction?.includes('STRONG')) {
    return 'SWING';
  }

  // High volatility = SCALP (quick in and out)
  if (entryInd?.atr && entryInd.currentPrice) {
    const atrPercent = (entryInd.atr / entryInd.currentPrice) * 100;
    if (atrPercent > 3) return 'SCALP';
  }

  // Range-bound = SCALP at extremes
  if (entryInd?.bollinger?.pb !== undefined) {
    if (entryInd.bollinger.pb < 0.1 || entryInd.bollinger.pb > 0.9) {
      return 'SCALP';
    }
  }

  // Volume surge = INTRADAY (capture the move)
  if (entryInd?.sniperSignals?.volumeSurge?.detected) {
    return 'INTRADAY';
  }

  // Default
  return 'INTRADAY';
}

/**
 * Extract actionable lessons from the analysis
 */
function extractLessons(analysis) {
  const lessons = [];

  // Style mismatch lesson
  if (analysis.shouldHaveUsedStyle !== analysis.style) {
    lessons.push({
      type: 'style',
      message: `Consider ${analysis.shouldHaveUsedStyle} instead of ${analysis.style} in these conditions`,
      importance: 'high'
    });
  }

  // Root cause lessons
  for (const cause of analysis.rootCauses) {
    if (cause.confidence >= 0.8) {
      if (analysis.isWin) {
        lessons.push({
          type: 'pattern',
          message: `${cause.reason} contributed to win: ${cause.detail}`,
          importance: 'medium'
        });
      } else {
        lessons.push({
          type: 'avoid',
          message: `Avoid ${cause.reason}: ${cause.detail}`,
          importance: 'high'
        });
      }
    }
  }

  // Exit quality lesson
  if (analysis.exitQuality === 'early') {
    lessons.push({
      type: 'exit',
      message: 'Consider using trailing stop to capture more of the move',
      importance: 'medium'
    });
  }
  if (analysis.exitQuality === 'late') {
    lessons.push({
      type: 'exit',
      message: 'Set tighter take-profit or use trailing stop',
      importance: 'high'
    });
  }

  return lessons;
}

/**
 * Update analysis state with new trade data
 */
function updateAnalysisState(analysis, tradeData) {
  const style = analysis.style;
  const styleStats = analysisState.stylePerformance[style];

  if (styleStats) {
    styleStats.trades++;
    if (analysis.isWin) styleStats.wins++;
    styleStats.totalPnl += tradeData.pnlPercent;
    styleStats.avgHoldTime = (styleStats.avgHoldTime * (styleStats.trades - 1) + tradeData.holdTime) / styleStats.trades;
  }

  // Update symbol-style map
  const symbol = tradeData.symbol;
  if (!analysisState.symbolStyleMap[symbol]) {
    analysisState.symbolStyleMap[symbol] = {
      SCALP: { trades: 0, wins: 0 },
      INTRADAY: { trades: 0, wins: 0 },
      SWING: { trades: 0, wins: 0 },
      POSITION: { trades: 0, wins: 0 }
    };
  }
  analysisState.symbolStyleMap[symbol][style].trades++;
  if (analysis.isWin) analysisState.symbolStyleMap[symbol][style].wins++;

  // Update hourly style success
  const hour = new Date().getUTCHours();
  if (!analysisState.hourlyStyleSuccess[hour]) {
    analysisState.hourlyStyleSuccess[hour] = {
      SCALP: { trades: 0, wins: 0 },
      INTRADAY: { trades: 0, wins: 0 },
      SWING: { trades: 0, wins: 0 },
      POSITION: { trades: 0, wins: 0 }
    };
  }
  analysisState.hourlyStyleSuccess[hour][style].trades++;
  if (analysis.isWin) analysisState.hourlyStyleSuccess[hour][style].wins++;
}

/**
 * Get recommended trading style for current conditions
 */
function getRecommendedStyle(symbol, indicators) {
  const recommendations = [];

  // Check symbol-specific history
  const symbolHistory = analysisState.symbolStyleMap[symbol];
  if (symbolHistory) {
    let bestStyle = null;
    let bestWinRate = 0;

    for (const [style, stats] of Object.entries(symbolHistory)) {
      if (stats.trades >= 3) {
        const winRate = stats.wins / stats.trades;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestStyle = style;
        }
      }
    }

    if (bestStyle && bestWinRate >= 0.5) {
      recommendations.push({
        source: 'symbol_history',
        style: bestStyle,
        confidence: Math.min(0.9, 0.5 + bestWinRate * 0.4),
        reason: `${symbol} has ${(bestWinRate * 100).toFixed(0)}% win rate with ${bestStyle}`
      });
    }
  }

  // Check current market conditions
  if (indicators?.trend?.direction?.includes('STRONG')) {
    recommendations.push({
      source: 'conditions',
      style: 'SWING',
      confidence: 0.8,
      reason: 'Strong trend detected - ride it'
    });
  } else if (indicators?.atr && indicators.currentPrice) {
    const atrPercent = (indicators.atr / indicators.currentPrice) * 100;
    if (atrPercent > 3) {
      recommendations.push({
        source: 'conditions',
        style: 'SCALP',
        confidence: 0.75,
        reason: 'High volatility - quick trades safer'
      });
    }
  }

  // Check time-based patterns
  const hour = new Date().getUTCHours();
  const hourlyStats = analysisState.hourlyStyleSuccess[hour];
  if (hourlyStats) {
    let bestHourStyle = null;
    let bestHourWinRate = 0;

    for (const [style, stats] of Object.entries(hourlyStats)) {
      if (stats.trades >= 5) {
        const winRate = stats.wins / stats.trades;
        if (winRate > bestHourWinRate) {
          bestHourWinRate = winRate;
          bestHourStyle = style;
        }
      }
    }

    if (bestHourStyle && bestHourWinRate >= 0.5) {
      recommendations.push({
        source: 'time_pattern',
        style: bestHourStyle,
        confidence: 0.7,
        reason: `Hour ${hour} favors ${bestHourStyle} (${(bestHourWinRate * 100).toFixed(0)}% win rate)`
      });
    }
  }

  // Return best recommendation or default
  if (recommendations.length === 0) {
    return {
      style: 'INTRADAY',
      confidence: 0.5,
      reason: 'Default recommendation - insufficient data',
      alternatives: []
    };
  }

  // Sort by confidence
  recommendations.sort((a, b) => b.confidence - a.confidence);

  return {
    style: recommendations[0].style,
    confidence: recommendations[0].confidence,
    reason: recommendations[0].reason,
    alternatives: recommendations.slice(1, 3)
  };
}

/**
 * Get analysis statistics for dashboard
 */
function getAnalysisStats() {
  return {
    totalAnalyzed: analysisState.totalAnalyzed,
    lastAnalysis: analysisState.lastAnalysis,

    stylePerformance: Object.entries(analysisState.stylePerformance).map(([style, stats]) => ({
      style,
      trades: stats.trades,
      winRate: stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) : 0,
      avgPnl: stats.trades > 0 ? (stats.totalPnl / stats.trades).toFixed(2) : 0,
      avgHoldMinutes: Math.round(stats.avgHoldTime / 60000)
    })),

    topLossReasons: Object.entries(analysisState.lossReasons)
      .filter(([, stats]) => stats.count > 0)
      .map(([reason, stats]) => ({
        reason,
        count: stats.count,
        avgLoss: stats.avgLoss.toFixed(2)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),

    topWinReasons: Object.entries(analysisState.winReasons)
      .filter(([, stats]) => stats.count > 0)
      .map(([reason, stats]) => ({
        reason,
        count: stats.count,
        avgWin: stats.avgWin.toFixed(2)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),

    exitQuality: analysisState.exitQuality,
    recentAnalyses: analysisState.recentAnalyses.slice(0, 10)
  };
}

/**
 * Get learning insights - what has the bot learned?
 */
function getLearningInsights() {
  const insights = [];

  // Style insights
  for (const [style, stats] of Object.entries(analysisState.stylePerformance)) {
    if (stats.trades >= 5) {
      const winRate = stats.wins / stats.trades;
      if (winRate >= 0.6) {
        insights.push({
          type: 'style_success',
          message: `${style} trading has ${(winRate * 100).toFixed(0)}% win rate over ${stats.trades} trades`,
          importance: 'high'
        });
      } else if (winRate < 0.4) {
        insights.push({
          type: 'style_avoid',
          message: `${style} trading only ${(winRate * 100).toFixed(0)}% win rate - consider avoiding`,
          importance: 'high'
        });
      }
    }
  }

  // Loss pattern insights
  for (const [reason, stats] of Object.entries(analysisState.lossReasons)) {
    if (stats.count >= 3) {
      insights.push({
        type: 'loss_pattern',
        message: `"${reason}" caused ${stats.count} losses (avg ${stats.avgLoss.toFixed(1)}%) - add protection`,
        importance: stats.count >= 5 ? 'critical' : 'high'
      });
    }
  }

  // Win pattern insights
  for (const [reason, stats] of Object.entries(analysisState.winReasons)) {
    if (stats.count >= 3) {
      insights.push({
        type: 'win_pattern',
        message: `"${reason}" led to ${stats.count} wins (avg +${stats.avgWin.toFixed(1)}%) - seek more of these`,
        importance: 'medium'
      });
    }
  }

  // Exit quality insights
  const totalExits = Object.values(analysisState.exitQuality).reduce((sum, q) => sum + q.count, 0);
  if (totalExits >= 10) {
    const earlyRate = analysisState.exitQuality.early.count / totalExits;
    const lateRate = analysisState.exitQuality.late.count / totalExits;

    if (earlyRate > 0.3) {
      insights.push({
        type: 'exit_timing',
        message: `${(earlyRate * 100).toFixed(0)}% of exits are too early - use trailing stops`,
        importance: 'high'
      });
    }
    if (lateRate > 0.3) {
      insights.push({
        type: 'exit_timing',
        message: `${(lateRate * 100).toFixed(0)}% of exits are too late - tighten take-profits`,
        importance: 'high'
      });
    }
  }

  return insights.sort((a, b) => {
    const priority = { critical: 0, high: 1, medium: 2, low: 3 };
    return (priority[a.importance] || 3) - (priority[b.importance] || 3);
  });
}

module.exports = {
  analyzeCompletedTrade,
  getRecommendedStyle,
  getAnalysisStats,
  getLearningInsights,
  getTradeStyle,
  STYLE_THRESHOLDS
};
