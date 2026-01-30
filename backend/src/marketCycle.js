/**
 * Market Cycle Analysis Module
 *
 * Provides historical context for trading decisions:
 * 1. Bitcoin Halving Cycle Position
 * 2. Monthly Seasonality Patterns
 * 3. Macro Trend Context
 */

// Bitcoin Halving Dates (approximate block times)
const HALVING_DATES = [
  new Date('2012-11-28'), // 1st halving
  new Date('2016-07-09'), // 2nd halving
  new Date('2020-05-11'), // 3rd halving
  new Date('2024-04-20'), // 4th halving (approximate)
  new Date('2028-04-01'), // 5th halving (estimated)
];

// Average cycle length in days (~4 years)
const CYCLE_LENGTH_DAYS = 1461; // ~4 years

// Historical monthly performance (average returns based on BTC data 2013-2024)
// Positive = historically bullish, Negative = historically bearish
const MONTHLY_SEASONALITY = {
  1:  -0.02,  // January: Often bearish (tax selling, post-holiday)
  2:   0.08,  // February: Historically strong
  3:   0.03,  // March: Slightly bullish
  4:   0.05,  // April: Often bullish (halving month 2024)
  5:  -0.01,  // May: "Sell in May" - mixed
  6:  -0.03,  // June: Often weak
  7:   0.02,  // July: Recovery month
  8:  -0.02,  // August: Summer doldrums
  9:  -0.05,  // September: Historically worst month ("Septembear")
  10:  0.10,  // October: "Uptober" - historically strong
  11:  0.15,  // November: Historically best month
  12:  0.08,  // December: Strong finish to year
};

// Halving cycle phases (months after halving)
const CYCLE_PHASES = {
  // 0-6 months: Post-halving accumulation
  ACCUMULATION: { start: 0, end: 6, bias: 'neutral_bullish', description: 'Post-halving accumulation' },
  // 6-12 months: Early bull market
  EARLY_BULL: { start: 6, end: 12, bias: 'bullish', description: 'Early bull market' },
  // 12-18 months: Peak bull market
  PEAK_BULL: { start: 12, end: 18, bias: 'very_bullish', description: 'Peak bull market phase' },
  // 18-24 months: Distribution/Top
  DISTRIBUTION: { start: 18, end: 24, bias: 'cautious', description: 'Distribution phase - potential top' },
  // 24-36 months: Bear market
  BEAR: { start: 24, end: 36, bias: 'bearish', description: 'Bear market phase' },
  // 36-48 months: Accumulation/Bottom
  BOTTOM: { start: 36, end: 48, bias: 'accumulation', description: 'Bottom accumulation phase' },
};

/**
 * Get the most recent halving date before the given date
 */
function getLastHalving(date = new Date()) {
  const past = HALVING_DATES.filter(h => h <= date);
  return past.length > 0 ? past[past.length - 1] : HALVING_DATES[0];
}

/**
 * Get months since last halving
 */
function getMonthsSinceHalving(date = new Date()) {
  const lastHalving = getLastHalving(date);
  const diffMs = date - lastHalving;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.floor(diffDays / 30.44); // Average days per month
}

/**
 * Get current halving cycle phase
 */
function getCyclePhase(date = new Date()) {
  const monthsSince = getMonthsSinceHalving(date);

  for (const [phaseName, phase] of Object.entries(CYCLE_PHASES)) {
    if (monthsSince >= phase.start && monthsSince < phase.end) {
      return {
        phase: phaseName,
        monthsSinceHalving: monthsSince,
        ...phase
      };
    }
  }

  // Default to BOTTOM if beyond 48 months (approaching next halving)
  return {
    phase: 'BOTTOM',
    monthsSinceHalving: monthsSince,
    ...CYCLE_PHASES.BOTTOM
  };
}

/**
 * Get monthly seasonality data
 */
function getSeasonality(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const seasonalBias = MONTHLY_SEASONALITY[month];

  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  let sentiment = 'neutral';
  if (seasonalBias >= 0.08) sentiment = 'very_bullish';
  else if (seasonalBias >= 0.03) sentiment = 'bullish';
  else if (seasonalBias <= -0.04) sentiment = 'very_bearish';
  else if (seasonalBias <= -0.01) sentiment = 'bearish';

  return {
    month,
    monthName: monthNames[month],
    historicalBias: seasonalBias,
    sentiment,
    description: getSeasonalityDescription(month, seasonalBias)
  };
}

function getSeasonalityDescription(month, bias) {
  const descriptions = {
    1: 'January often sees tax-related selling and post-holiday correction',
    2: 'February historically shows recovery and renewed interest',
    3: 'March typically continues the Q1 momentum',
    4: 'April often bullish, especially in halving years',
    5: '"Sell in May" - traditionally weaker period begins',
    6: 'June often sees consolidation or weakness',
    7: 'July typically starts summer recovery',
    8: 'August sees summer doldrums with lower volume',
    9: 'September historically the worst month for crypto ("Septembear")',
    10: '"Uptober" - historically one of the strongest months',
    11: 'November historically the best month for crypto',
    12: 'December often strong as year-end rally continues',
  };
  return descriptions[month] || `Month ${month} bias: ${(bias * 100).toFixed(1)}%`;
}

/**
 * Calculate overall market cycle bias
 * Returns a score from -1 (very bearish) to +1 (very bullish)
 */
function getMarketCycleBias(date = new Date()) {
  const cyclePhase = getCyclePhase(date);
  const seasonality = getSeasonality(date);

  // Convert phase bias to numeric
  const phaseBiasMap = {
    'very_bullish': 0.8,
    'bullish': 0.5,
    'neutral_bullish': 0.2,
    'cautious': -0.1,
    'bearish': -0.5,
    'accumulation': 0.3,
  };

  // Convert seasonal sentiment to numeric
  const seasonalBiasMap = {
    'very_bullish': 0.4,
    'bullish': 0.2,
    'neutral': 0,
    'bearish': -0.2,
    'very_bearish': -0.4,
  };

  const phaseBias = phaseBiasMap[cyclePhase.bias] || 0;
  const seasonalBias = seasonalBiasMap[seasonality.sentiment] || 0;

  // Weighted combination (halving cycle more important than monthly)
  const combinedBias = (phaseBias * 0.7) + (seasonalBias * 0.3);

  return Math.max(-1, Math.min(1, combinedBias));
}

/**
 * Get full market cycle analysis
 */
function getMarketCycleAnalysis(date = new Date()) {
  const cyclePhase = getCyclePhase(date);
  const seasonality = getSeasonality(date);
  const overallBias = getMarketCycleBias(date);

  // Trading recommendations based on cycle
  let recommendation = 'NEUTRAL';
  let riskLevel = 'medium';
  let longBias = 0.5; // 0-1 scale, 0.5 = neutral

  if (overallBias >= 0.5) {
    recommendation = 'FAVOR_LONGS';
    riskLevel = 'aggressive';
    longBias = 0.7 + (overallBias - 0.5) * 0.4; // 0.7-0.9
  } else if (overallBias >= 0.2) {
    recommendation = 'SLIGHT_LONG_BIAS';
    riskLevel = 'medium';
    longBias = 0.55 + (overallBias - 0.2) * 0.5; // 0.55-0.7
  } else if (overallBias <= -0.3) {
    recommendation = 'FAVOR_SHORTS';
    riskLevel = 'defensive';
    longBias = 0.3 + (overallBias + 0.3) * 0.3; // 0.1-0.3
  } else if (overallBias <= -0.1) {
    recommendation = 'SLIGHT_SHORT_BIAS';
    riskLevel = 'cautious';
    longBias = 0.4 + (overallBias + 0.1) * 0.5; // 0.3-0.45
  }

  return {
    timestamp: date.toISOString(),
    cyclePhase,
    seasonality,
    overallBias: Math.round(overallBias * 100) / 100,
    recommendation,
    riskLevel,
    longBias: Math.round(longBias * 100) / 100,

    // For AI integration
    aiAdjustments: {
      // Confidence adjustment based on alignment with cycle
      confidenceBonus: Math.abs(overallBias) * 0.05, // Up to 5% bonus
      // Score adjustment for long/short
      longScoreBonus: Math.round(overallBias * 10), // -10 to +10 points
      shortScoreBonus: Math.round(-overallBias * 10), // Opposite of long
      // Should we be more aggressive or defensive?
      aggressiveness: overallBias > 0.3 ? 'high' : overallBias < -0.3 ? 'low' : 'normal',
    },

    summary: buildSummary(cyclePhase, seasonality, overallBias, recommendation)
  };
}

function buildSummary(cyclePhase, seasonality, bias, recommendation) {
  const biasWord = bias >= 0.3 ? 'bullish' : bias <= -0.3 ? 'bearish' : 'neutral';
  return `${cyclePhase.description}. ${seasonality.monthName}: ${seasonality.description}. Overall ${biasWord} bias (${(bias * 100).toFixed(0)}%). Recommendation: ${recommendation}.`;
}

/**
 * Check if current market cycle aligns with a proposed trade
 * Returns { aligned: boolean, adjustment: number, reason: string }
 */
function checkCycleAlignment(direction, date = new Date()) {
  const analysis = getMarketCycleAnalysis(date);
  const { longBias, overallBias, cyclePhase, seasonality } = analysis;

  const isLong = direction === 'long';
  const aligned = isLong ? longBias >= 0.5 : longBias <= 0.5;

  let adjustment = 0;
  let reason = '';

  if (isLong) {
    if (longBias >= 0.7) {
      adjustment = 0.05;
      reason = `CYCLE BOOST: ${cyclePhase.phase} + ${seasonality.monthName} favor longs`;
    } else if (longBias <= 0.35) {
      adjustment = -0.10;
      reason = `CYCLE WARNING: ${cyclePhase.phase} + ${seasonality.monthName} unfavorable for longs`;
    }
  } else {
    // Short direction
    if (longBias <= 0.3) {
      adjustment = 0.05;
      reason = `CYCLE BOOST: ${cyclePhase.phase} + ${seasonality.monthName} favor shorts`;
    } else if (longBias >= 0.65) {
      adjustment = -0.10;
      reason = `CYCLE WARNING: ${cyclePhase.phase} + ${seasonality.monthName} unfavorable for shorts`;
    }
  }

  return {
    aligned,
    adjustment,
    reason,
    longBias,
    phase: cyclePhase.phase,
    month: seasonality.monthName
  };
}

module.exports = {
  getLastHalving,
  getMonthsSinceHalving,
  getCyclePhase,
  getSeasonality,
  getMarketCycleBias,
  getMarketCycleAnalysis,
  checkCycleAlignment,
  HALVING_DATES,
  CYCLE_PHASES,
  MONTHLY_SEASONALITY
};
