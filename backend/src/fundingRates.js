/**
 * Funding Rate Analysis
 * Monitors perpetual futures funding rates to detect over-leveraged markets
 *
 * Key insights:
 * - High positive funding = longs paying shorts = market overleveraged long
 * - High negative funding = shorts paying longs = market overleveraged short
 * - Extreme funding often precedes reversals
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BINANCE_API = process.env.BINANCE_API_URL || 'https://fapi.binance.com';

const FUNDING_CACHE_FILE = path.join(__dirname, '../data/funding_rates.json');

// Funding rate state
let fundingState = {
  rates: {},
  history: {},
  extremes: [],
  lastUpdate: 0
};

// Thresholds for extreme funding
const EXTREME_POSITIVE = 0.001; // 0.1% per 8h = very bullish positioning
const EXTREME_NEGATIVE = -0.001; // -0.1% per 8h = very bearish positioning
const HIGH_POSITIVE = 0.0005; // 0.05%
const HIGH_NEGATIVE = -0.0005;

/**
 * Fetch current funding rates for all symbols
 */
async function fetchFundingRates() {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/premiumIndex`, {
      timeout: 10000
    });

    if (response.data) {
      const rates = {};
      const extremes = [];

      for (const item of response.data) {
        const rate = parseFloat(item.lastFundingRate);
        const markPrice = parseFloat(item.markPrice);

        rates[item.symbol] = {
          symbol: item.symbol,
          fundingRate: rate,
          fundingRatePercent: (rate * 100).toFixed(4) + '%',
          nextFundingTime: item.nextFundingTime,
          markPrice,
          indexPrice: parseFloat(item.indexPrice),
          signal: getFundingSignal(rate),
          annualizedRate: (rate * 3 * 365 * 100).toFixed(2) + '%' // 3 times per day * 365 days
        };

        // Track extreme funding
        if (rate >= EXTREME_POSITIVE || rate <= EXTREME_NEGATIVE) {
          extremes.push({
            symbol: item.symbol,
            rate,
            ratePercent: (rate * 100).toFixed(4) + '%',
            direction: rate > 0 ? 'overleveraged_long' : 'overleveraged_short',
            signal: rate > 0 ? 'potential_short_squeeze' : 'potential_long_squeeze',
            severity: Math.abs(rate) >= 0.002 ? 'extreme' : 'high'
          });
        }
      }

      // Sort extremes by absolute rate
      extremes.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

      fundingState.rates = rates;
      fundingState.extremes = extremes;
      fundingState.lastUpdate = Date.now();

      saveFundingCache();

      return {
        rates,
        extremes: extremes.slice(0, 10),
        summary: generateFundingSummary(rates, extremes)
      };
    }
  } catch (err) {
    console.error('[FUNDING] Failed to fetch rates:', err.message);
  }

  return {
    rates: fundingState.rates,
    extremes: fundingState.extremes,
    summary: { error: 'Failed to fetch latest rates' }
  };
}

/**
 * Get funding signal based on rate
 */
function getFundingSignal(rate) {
  if (rate >= EXTREME_POSITIVE) {
    return {
      bias: 'bearish',
      strength: 'strong',
      reason: 'Extreme positive funding - overleveraged longs',
      action: 'FADE_LONGS',
      contrarian: 'Consider shorts on weakness'
    };
  }

  if (rate >= HIGH_POSITIVE) {
    return {
      bias: 'slightly_bearish',
      strength: 'moderate',
      reason: 'High positive funding - crowded long trade',
      action: 'CAUTION_LONGS',
      contrarian: 'Reduce long exposure'
    };
  }

  if (rate <= EXTREME_NEGATIVE) {
    return {
      bias: 'bullish',
      strength: 'strong',
      reason: 'Extreme negative funding - overleveraged shorts',
      action: 'FADE_SHORTS',
      contrarian: 'Consider longs on strength'
    };
  }

  if (rate <= HIGH_NEGATIVE) {
    return {
      bias: 'slightly_bullish',
      strength: 'moderate',
      reason: 'High negative funding - crowded short trade',
      action: 'CAUTION_SHORTS',
      contrarian: 'Reduce short exposure'
    };
  }

  return {
    bias: 'neutral',
    strength: 'weak',
    reason: 'Normal funding rate',
    action: 'NORMAL',
    contrarian: null
  };
}

/**
 * Fetch funding rate history for a symbol
 */
async function fetchFundingHistory(symbol, limit = 100) {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/fundingRate`, {
      params: { symbol, limit },
      timeout: 10000
    });

    if (response.data) {
      const history = response.data.map(item => ({
        timestamp: item.fundingTime,
        rate: parseFloat(item.fundingRate),
        ratePercent: (parseFloat(item.fundingRate) * 100).toFixed(4) + '%'
      }));

      // Calculate statistics
      const rates = history.map(h => h.rate);
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      const max = Math.max(...rates);
      const min = Math.min(...rates);

      // Detect trend
      const recent = rates.slice(0, 10);
      const older = rates.slice(-10);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      let trend = 'stable';
      if (recentAvg > olderAvg * 1.5) trend = 'increasing';
      else if (recentAvg < olderAvg * 0.5) trend = 'decreasing';
      else if (recentAvg > olderAvg * 1.2) trend = 'slightly_increasing';
      else if (recentAvg < olderAvg * 0.8) trend = 'slightly_decreasing';

      const result = {
        symbol,
        history: history.slice(0, 20),
        stats: {
          current: rates[0],
          average: avg,
          max,
          min,
          trend,
          volatility: max - min
        },
        analysis: analyzeFundingHistory(rates, trend)
      };

      fundingState.history[symbol] = result;
      return result;
    }
  } catch (err) {
    console.error(`[FUNDING] Failed to fetch history for ${symbol}:`, err.message);
  }

  return fundingState.history[symbol] || { symbol, history: [], error: 'Failed to fetch' };
}

/**
 * Analyze funding history for patterns
 */
function analyzeFundingHistory(rates, trend) {
  const current = rates[0];
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

  const analysis = {
    currentVsAvg: current > avg ? 'above_average' : current < avg ? 'below_average' : 'at_average',
    deviation: ((current - avg) / Math.abs(avg || 0.0001) * 100).toFixed(1) + '%',
    trend,
    signals: []
  };

  // Generate signals
  if (current >= EXTREME_POSITIVE) {
    analysis.signals.push({
      type: 'CONTRARIAN',
      message: 'Funding at extreme - potential long squeeze incoming',
      action: 'Avoid new longs, consider shorts'
    });
  }

  if (current <= EXTREME_NEGATIVE) {
    analysis.signals.push({
      type: 'CONTRARIAN',
      message: 'Funding at extreme - potential short squeeze incoming',
      action: 'Avoid new shorts, consider longs'
    });
  }

  if (trend === 'increasing' && current > 0) {
    analysis.signals.push({
      type: 'TREND',
      message: 'Funding trending higher - longs getting more crowded',
      action: 'Consider taking profits on longs'
    });
  }

  if (trend === 'decreasing' && current < 0) {
    analysis.signals.push({
      type: 'TREND',
      message: 'Funding trending lower - shorts getting more crowded',
      action: 'Consider taking profits on shorts'
    });
  }

  // Mean reversion signal
  if (Math.abs(current) > Math.abs(avg) * 2) {
    analysis.signals.push({
      type: 'MEAN_REVERSION',
      message: 'Funding significantly deviating from average',
      action: 'Mean reversion trade opportunity'
    });
  }

  return analysis;
}

/**
 * Generate overall funding summary
 */
function generateFundingSummary(rates, extremes) {
  const allRates = Object.values(rates);

  // Count positive vs negative
  const positive = allRates.filter(r => r.fundingRate > 0).length;
  const negative = allRates.filter(r => r.fundingRate < 0).length;
  const neutral = allRates.length - positive - negative;

  // Average funding
  const avgRate = allRates.reduce((sum, r) => sum + r.fundingRate, 0) / allRates.length;

  // Market sentiment based on funding
  let marketSentiment = 'neutral';
  if (avgRate > HIGH_POSITIVE) marketSentiment = 'overleveraged_bullish';
  else if (avgRate > 0.0002) marketSentiment = 'slightly_bullish';
  else if (avgRate < HIGH_NEGATIVE) marketSentiment = 'overleveraged_bearish';
  else if (avgRate < -0.0002) marketSentiment = 'slightly_bearish';

  // Contrarian signal
  let contrarianSignal = null;
  if (extremes.length >= 5) {
    const longExtremes = extremes.filter(e => e.direction === 'overleveraged_long').length;
    const shortExtremes = extremes.filter(e => e.direction === 'overleveraged_short').length;

    if (longExtremes >= 3) {
      contrarianSignal = {
        direction: 'bearish',
        reason: `${longExtremes} symbols with extreme positive funding`,
        action: 'Market may be due for pullback'
      };
    } else if (shortExtremes >= 3) {
      contrarianSignal = {
        direction: 'bullish',
        reason: `${shortExtremes} symbols with extreme negative funding`,
        action: 'Market may be due for bounce'
      };
    }
  }

  return {
    timestamp: Date.now(),
    totalSymbols: allRates.length,
    distribution: {
      positive,
      negative,
      neutral,
      extremeCount: extremes.length
    },
    averageFunding: {
      rate: avgRate,
      ratePercent: (avgRate * 100).toFixed(4) + '%',
      annualized: (avgRate * 3 * 365 * 100).toFixed(2) + '%'
    },
    marketSentiment,
    contrarianSignal,
    topExtremes: extremes.slice(0, 5).map(e => ({
      symbol: e.symbol,
      rate: e.ratePercent,
      signal: e.signal
    }))
  };
}

/**
 * Get funding analysis for specific symbol
 */
async function getSymbolFunding(symbol) {
  const [current, history] = await Promise.all([
    fetchFundingRates(),
    fetchFundingHistory(symbol)
  ]);

  const symbolRate = current.rates[symbol];

  if (!symbolRate) {
    return { symbol, error: 'Symbol not found', available: false };
  }

  return {
    symbol,
    available: true,
    current: {
      rate: symbolRate.fundingRate,
      ratePercent: symbolRate.fundingRatePercent,
      nextFunding: symbolRate.nextFundingTime,
      annualized: symbolRate.annualizedRate,
      signal: symbolRate.signal
    },
    history: history.stats,
    analysis: history.analysis,
    marketContext: {
      sentiment: current.summary.marketSentiment,
      extremesCount: current.extremes.length,
      isExtreme: current.extremes.some(e => e.symbol === symbol)
    },
    recommendations: generateFundingRecommendations(symbolRate, history)
  };
}

/**
 * Generate funding-based recommendations
 */
function generateFundingRecommendations(symbolRate, history) {
  const recommendations = [];

  const signal = symbolRate.signal;

  if (signal.strength === 'strong') {
    recommendations.push({
      type: 'CONTRARIAN',
      priority: 'high',
      message: signal.reason,
      action: signal.contrarian
    });
  }

  if (history.analysis?.signals?.length > 0) {
    for (const sig of history.analysis.signals) {
      recommendations.push({
        type: sig.type,
        priority: 'medium',
        message: sig.message,
        action: sig.action
      });
    }
  }

  // Time until next funding
  const timeUntilFunding = symbolRate.nextFundingTime - Date.now();
  if (timeUntilFunding > 0 && timeUntilFunding < 3600000) { // Within 1 hour
    const minutes = Math.floor(timeUntilFunding / 60000);
    recommendations.push({
      type: 'TIMING',
      priority: 'low',
      message: `Next funding in ${minutes} minutes`,
      action: Math.abs(symbolRate.fundingRate) > HIGH_POSITIVE
        ? 'Consider position timing around funding'
        : 'Normal funding - no special timing needed'
    });
  }

  return recommendations;
}

/**
 * Get open interest data
 */
async function fetchOpenInterest(symbol) {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/openInterest`, {
      params: { symbol },
      timeout: 5000
    });

    if (response.data) {
      return {
        symbol,
        openInterest: parseFloat(response.data.openInterest),
        timestamp: response.data.time
      };
    }
  } catch (err) {
    console.error(`[FUNDING] Failed to fetch OI for ${symbol}:`, err.message);
  }

  return { symbol, error: 'Failed to fetch' };
}

/**
 * Get long/short ratio
 */
async function fetchLongShortRatio(symbol, period = '5m') {
  try {
    const [topTrader, global] = await Promise.all([
      axios.get(`${BINANCE_API}/futures/data/topLongShortAccountRatio`, {
        params: { symbol, period, limit: 10 },
        timeout: 5000
      }),
      axios.get(`${BINANCE_API}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol, period, limit: 10 },
        timeout: 5000
      })
    ]);

    const topRatio = topTrader.data?.[0];
    const globalRatio = global.data?.[0];

    return {
      symbol,
      period,
      topTraders: topRatio ? {
        longAccount: parseFloat(topRatio.longAccount),
        shortAccount: parseFloat(topRatio.shortAccount),
        longShortRatio: parseFloat(topRatio.longShortRatio),
        timestamp: topRatio.timestamp
      } : null,
      global: globalRatio ? {
        longAccount: parseFloat(globalRatio.longAccount),
        shortAccount: parseFloat(globalRatio.shortAccount),
        longShortRatio: parseFloat(globalRatio.longShortRatio),
        timestamp: globalRatio.timestamp
      } : null,
      signal: getLongShortSignal(topRatio, globalRatio)
    };
  } catch (err) {
    console.error(`[FUNDING] Failed to fetch L/S ratio for ${symbol}:`, err.message);
    return { symbol, error: 'Failed to fetch' };
  }
}

/**
 * Get signal from long/short ratio
 */
function getLongShortSignal(topRatio, globalRatio) {
  if (!topRatio && !globalRatio) return { bias: 'neutral', reason: 'Data unavailable' };

  const ratio = parseFloat(topRatio?.longShortRatio || globalRatio?.longShortRatio || 1);

  if (ratio > 2) {
    return {
      bias: 'bearish',
      strength: 'strong',
      reason: 'Extreme long positioning - potential squeeze',
      contrarian: 'Consider fading longs'
    };
  }

  if (ratio > 1.5) {
    return {
      bias: 'slightly_bearish',
      strength: 'moderate',
      reason: 'Crowded long trade',
      contrarian: 'Caution on new longs'
    };
  }

  if (ratio < 0.5) {
    return {
      bias: 'bullish',
      strength: 'strong',
      reason: 'Extreme short positioning - potential squeeze',
      contrarian: 'Consider fading shorts'
    };
  }

  if (ratio < 0.7) {
    return {
      bias: 'slightly_bullish',
      strength: 'moderate',
      reason: 'Crowded short trade',
      contrarian: 'Caution on new shorts'
    };
  }

  return {
    bias: 'neutral',
    strength: 'weak',
    reason: 'Balanced positioning'
  };
}

/**
 * Get comprehensive leverage analysis
 */
async function getLeverageAnalysis(symbol) {
  const [funding, oi, lsRatio] = await Promise.all([
    getSymbolFunding(symbol),
    fetchOpenInterest(symbol),
    fetchLongShortRatio(symbol)
  ]);

  // Combine signals
  const signals = [];

  if (funding.current?.signal?.strength === 'strong') {
    signals.push(funding.current.signal);
  }

  if (lsRatio.signal?.strength === 'strong' || lsRatio.signal?.strength === 'moderate') {
    signals.push(lsRatio.signal);
  }

  // Determine combined bias
  let combinedBias = 'neutral';
  const bullishSignals = signals.filter(s => s.bias?.includes('bullish')).length;
  const bearishSignals = signals.filter(s => s.bias?.includes('bearish')).length;

  if (bullishSignals > bearishSignals) combinedBias = 'bullish';
  else if (bearishSignals > bullishSignals) combinedBias = 'bearish';

  return {
    symbol,
    timestamp: Date.now(),
    funding: funding.available ? funding.current : null,
    openInterest: oi.openInterest || null,
    longShortRatio: lsRatio.global || lsRatio.topTraders,
    combinedAnalysis: {
      bias: combinedBias,
      signals,
      marketCondition: funding.marketContext?.sentiment || 'normal'
    },
    recommendations: [
      ...funding.recommendations || [],
      ...(lsRatio.signal?.contrarian ? [{
        type: 'POSITIONING',
        priority: lsRatio.signal.strength === 'strong' ? 'high' : 'medium',
        message: lsRatio.signal.reason,
        action: lsRatio.signal.contrarian
      }] : [])
    ]
  };
}

/**
 * Load cached data
 */
function loadFundingCache() {
  try {
    if (fs.existsSync(FUNDING_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(FUNDING_CACHE_FILE, 'utf-8'));
      fundingState = { ...fundingState, ...data };
    }
  } catch (err) {
    // Ignore
  }
}

/**
 * Save cache
 */
function saveFundingCache() {
  try {
    const dir = path.dirname(FUNDING_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(FUNDING_CACHE_FILE, JSON.stringify(fundingState, null, 2));
  } catch (err) {
    // Ignore
  }
}

// Initialize
loadFundingCache();

module.exports = {
  fetchFundingRates,
  fetchFundingHistory,
  getSymbolFunding,
  fetchOpenInterest,
  fetchLongShortRatio,
  getLeverageAnalysis
};
