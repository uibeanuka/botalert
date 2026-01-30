/**
 * Historical Data Learning Module
 *
 * Fetches and analyzes years of historical candle data to:
 * 1. Learn recurring patterns across market cycles
 * 2. Identify historical support/resistance levels
 * 3. Understand seasonal and cyclical behaviors
 * 4. Train pattern recognition on thousands of historical examples
 *
 * Data sources: Binance (2017+), with synthetic pre-2017 patterns
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BINANCE_API = 'https://api.binance.com';
const CACHE_DIR = path.join(__dirname, '../data/historical');
const MAX_CANDLES_PER_REQUEST = 1000;

// Historical market events for context
const MARKET_EVENTS = [
  { date: '2017-12-17', type: 'cycle_top', btcPrice: 19783, description: '2017 Bull Run Peak' },
  { date: '2018-12-15', type: 'cycle_bottom', btcPrice: 3215, description: '2018 Bear Market Bottom' },
  { date: '2019-06-26', type: 'local_top', btcPrice: 13880, description: '2019 Mini Bull Peak' },
  { date: '2020-03-13', type: 'crash', btcPrice: 3850, description: 'COVID Crash' },
  { date: '2020-05-11', type: 'halving', btcPrice: 8600, description: '3rd Bitcoin Halving' },
  { date: '2021-04-14', type: 'local_top', btcPrice: 64800, description: '2021 First Peak' },
  { date: '2021-07-20', type: 'local_bottom', btcPrice: 29300, description: '2021 Summer Dip' },
  { date: '2021-11-10', type: 'cycle_top', btcPrice: 69000, description: '2021 All-Time High' },
  { date: '2022-06-18', type: 'crash', btcPrice: 17600, description: 'Luna/3AC Crash' },
  { date: '2022-11-09', type: 'cycle_bottom', btcPrice: 15500, description: 'FTX Crash Bottom' },
  { date: '2024-01-10', type: 'etf', btcPrice: 46000, description: 'Spot ETF Approval' },
  { date: '2024-03-14', type: 'local_top', btcPrice: 73800, description: 'Pre-Halving High' },
  { date: '2024-04-20', type: 'halving', btcPrice: 64000, description: '4th Bitcoin Halving' },
];

// Ensure cache directory exists
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Fetch historical candles from Binance
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Candle interval (e.g., '1d', '4h', '1h')
 * @param {number} startTime - Start timestamp in ms
 * @param {number} endTime - End timestamp in ms
 */
async function fetchHistoricalCandles(symbol, interval, startTime, endTime) {
  const candles = [];
  let currentStart = startTime;

  while (currentStart < endTime) {
    try {
      const response = await axios.get(`${BINANCE_API}/api/v3/klines`, {
        params: {
          symbol,
          interval,
          startTime: currentStart,
          endTime,
          limit: MAX_CANDLES_PER_REQUEST
        },
        timeout: 30000
      });

      if (!response.data || response.data.length === 0) break;

      for (const c of response.data) {
        candles.push({
          openTime: c[0],
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[5]),
          closeTime: c[6],
          quoteVolume: parseFloat(c[7]),
          trades: c[8]
        });
      }

      // Move to next batch
      const lastCandle = response.data[response.data.length - 1];
      currentStart = lastCandle[6] + 1; // closeTime + 1ms

      // Rate limiting
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.error(`[HISTORICAL] Error fetching ${symbol} ${interval}:`, err.message);
      break;
    }
  }

  return candles;
}

/**
 * Get cached historical data or fetch if not available
 */
async function getHistoricalData(symbol, interval, yearsBack = 5) {
  ensureCacheDir();

  const cacheFile = path.join(CACHE_DIR, `${symbol}_${interval}_${yearsBack}y.json`);

  // Check cache (valid for 24 hours)
  if (fs.existsSync(cacheFile)) {
    const stats = fs.statSync(cacheFile);
    const cacheAge = Date.now() - stats.mtimeMs;
    if (cacheAge < 24 * 60 * 60 * 1000) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      console.log(`[HISTORICAL] Loaded ${cached.candles.length} candles from cache`);
      return cached;
    }
  }

  // Fetch fresh data
  const endTime = Date.now();
  const startTime = endTime - (yearsBack * 365.25 * 24 * 60 * 60 * 1000);

  console.log(`[HISTORICAL] Fetching ${yearsBack} years of ${symbol} ${interval} data...`);
  const candles = await fetchHistoricalCandles(symbol, interval, startTime, endTime);

  const data = {
    symbol,
    interval,
    yearsBack,
    fetchedAt: new Date().toISOString(),
    candleCount: candles.length,
    startDate: candles[0] ? new Date(candles[0].openTime).toISOString() : null,
    endDate: candles[candles.length - 1] ? new Date(candles[candles.length - 1].closeTime).toISOString() : null,
    candles
  };

  // Cache the data
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  console.log(`[HISTORICAL] Cached ${candles.length} candles for ${symbol} ${interval}`);

  return data;
}

/**
 * Analyze historical patterns and learn from them
 */
function analyzeHistoricalPatterns(candles) {
  if (!candles || candles.length < 100) {
    return { error: 'Insufficient data' };
  }

  const patterns = {
    // Price levels that acted as support/resistance multiple times
    keyLevels: findKeyLevels(candles),

    // Patterns that preceded big moves
    bigMovePatterns: findBigMovePatterns(candles),

    // Seasonal patterns (monthly/weekly)
    seasonalPatterns: analyzeSeasonality(candles),

    // Volume patterns before moves
    volumePatterns: analyzeVolumePatterns(candles),

    // Recovery patterns after crashes
    recoveryPatterns: findRecoveryPatterns(candles),

    // Statistics
    stats: calculateStats(candles)
  };

  return patterns;
}

/**
 * Find price levels that acted as support/resistance multiple times
 */
function findKeyLevels(candles) {
  const levels = [];
  const tolerance = 0.02; // 2% tolerance for level matching

  // Find local highs and lows
  for (let i = 10; i < candles.length - 10; i++) {
    const current = candles[i];

    // Check if local high (5 candles each side)
    const isLocalHigh = candles.slice(i - 5, i).every(c => c.high < current.high) &&
                        candles.slice(i + 1, i + 6).every(c => c.high < current.high);

    // Check if local low
    const isLocalLow = candles.slice(i - 5, i).every(c => c.low > current.low) &&
                       candles.slice(i + 1, i + 6).every(c => c.low > current.low);

    if (isLocalHigh) {
      levels.push({ price: current.high, type: 'resistance', time: current.openTime });
    }
    if (isLocalLow) {
      levels.push({ price: current.low, type: 'support', time: current.openTime });
    }
  }

  // Cluster nearby levels
  const clusters = [];
  for (const level of levels) {
    const existing = clusters.find(c =>
      Math.abs(c.price - level.price) / c.price < tolerance
    );

    if (existing) {
      existing.touches++;
      existing.times.push(level.time);
    } else {
      clusters.push({
        price: level.price,
        type: level.type,
        touches: 1,
        times: [level.time]
      });
    }
  }

  // Return levels touched 3+ times (significant)
  return clusters
    .filter(c => c.touches >= 3)
    .sort((a, b) => b.touches - a.touches)
    .slice(0, 20); // Top 20 levels
}

/**
 * Find patterns that preceded big price moves (>10%)
 */
function findBigMovePatterns(candles) {
  const patterns = [];
  const bigMoveThreshold = 0.10; // 10% move

  for (let i = 20; i < candles.length - 5; i++) {
    // Check for big move in next 5 candles
    const currentPrice = candles[i].close;
    let maxMove = 0;
    let moveDirection = null;

    for (let j = i + 1; j <= i + 5 && j < candles.length; j++) {
      const move = (candles[j].close - currentPrice) / currentPrice;
      if (Math.abs(move) > Math.abs(maxMove)) {
        maxMove = move;
        moveDirection = move > 0 ? 'bullish' : 'bearish';
      }
    }

    if (Math.abs(maxMove) >= bigMoveThreshold) {
      // Analyze pattern before the move
      const priorCandles = candles.slice(i - 20, i + 1);

      patterns.push({
        time: candles[i].openTime,
        date: new Date(candles[i].openTime).toISOString().split('T')[0],
        direction: moveDirection,
        movePercent: Math.round(maxMove * 100),
        priorPattern: extractPatternSignature(priorCandles)
      });
    }
  }

  return patterns;
}

/**
 * Extract a pattern signature from candles for matching
 */
function extractPatternSignature(candles) {
  if (candles.length < 5) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  // Normalize to percentages from first candle
  const normalizedCloses = closes.map(c => (c - closes[0]) / closes[0]);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const normalizedVolumes = volumes.map(v => v / avgVolume);

  // Calculate trend
  const trend = normalizedCloses[normalizedCloses.length - 1] > 0 ? 'up' : 'down';

  // Calculate volatility
  let sumSquares = 0;
  for (let i = 1; i < normalizedCloses.length; i++) {
    const change = normalizedCloses[i] - normalizedCloses[i - 1];
    sumSquares += change * change;
  }
  const volatility = Math.sqrt(sumSquares / normalizedCloses.length);

  // Volume trend
  const recentVolAvg = normalizedVolumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeTrend = recentVolAvg > 1.5 ? 'high' : recentVolAvg < 0.5 ? 'low' : 'normal';

  return {
    trend,
    volatility: volatility > 0.05 ? 'high' : volatility < 0.02 ? 'low' : 'medium',
    volumeTrend,
    priceChange: Math.round(normalizedCloses[normalizedCloses.length - 1] * 100)
  };
}

/**
 * Analyze monthly/weekly seasonality
 */
function analyzeSeasonality(candles) {
  const monthlyReturns = {};
  const dayOfWeekReturns = {};

  for (let i = 1; i < candles.length; i++) {
    const date = new Date(candles[i].openTime);
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();
    const dailyReturn = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;

    // Monthly
    if (!monthlyReturns[month]) monthlyReturns[month] = [];
    monthlyReturns[month].push(dailyReturn);

    // Day of week
    if (!dayOfWeekReturns[dayOfWeek]) dayOfWeekReturns[dayOfWeek] = [];
    dayOfWeekReturns[dayOfWeek].push(dailyReturn);
  }

  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthlySummary = {};
  for (const [month, returns] of Object.entries(monthlyReturns)) {
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const positiveRate = returns.filter(r => r > 0).length / returns.length;
    monthlySummary[monthNames[month]] = {
      avgReturn: Math.round(avgReturn * 10000) / 100, // As percentage
      positiveRate: Math.round(positiveRate * 100),
      samples: returns.length
    };
  }

  const weeklySummary = {};
  for (const [day, returns] of Object.entries(dayOfWeekReturns)) {
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    weeklySummary[dayNames[day]] = {
      avgReturn: Math.round(avgReturn * 10000) / 100,
      samples: returns.length
    };
  }

  return { monthly: monthlySummary, weekly: weeklySummary };
}

/**
 * Analyze volume patterns before significant moves
 */
function analyzeVolumePatterns(candles) {
  const volumeBeforePump = [];
  const volumeBeforeDump = [];

  for (let i = 10; i < candles.length - 1; i++) {
    const nextMove = (candles[i + 1].close - candles[i].close) / candles[i].close;
    const priorVolumes = candles.slice(i - 5, i).map(c => c.volume);
    const avgVolume = candles.slice(i - 20, i).reduce((a, c) => a + c.volume, 0) / 20;
    const recentVolumeRatio = priorVolumes.reduce((a, b) => a + b, 0) / 5 / avgVolume;

    if (nextMove > 0.03) { // 3% pump
      volumeBeforePump.push(recentVolumeRatio);
    } else if (nextMove < -0.03) { // 3% dump
      volumeBeforeDump.push(recentVolumeRatio);
    }
  }

  return {
    beforePump: {
      avgVolumeRatio: volumeBeforePump.length > 0 ?
        Math.round(volumeBeforePump.reduce((a, b) => a + b, 0) / volumeBeforePump.length * 100) / 100 : 0,
      samples: volumeBeforePump.length
    },
    beforeDump: {
      avgVolumeRatio: volumeBeforeDump.length > 0 ?
        Math.round(volumeBeforeDump.reduce((a, b) => a + b, 0) / volumeBeforeDump.length * 100) / 100 : 0,
      samples: volumeBeforeDump.length
    }
  };
}

/**
 * Find patterns in recovery after major crashes
 */
function findRecoveryPatterns(candles) {
  const crashes = [];
  const recoveries = [];

  for (let i = 20; i < candles.length - 20; i++) {
    // Find 20%+ drops
    const priorHigh = Math.max(...candles.slice(i - 20, i).map(c => c.high));
    const currentLow = candles[i].low;
    const drop = (priorHigh - currentLow) / priorHigh;

    if (drop >= 0.20) {
      // Check recovery
      const futureCandles = candles.slice(i, i + 20);
      const recoveryHigh = Math.max(...futureCandles.map(c => c.high));
      const recoveryPercent = (recoveryHigh - currentLow) / currentLow;

      crashes.push({
        date: new Date(candles[i].openTime).toISOString().split('T')[0],
        dropPercent: Math.round(drop * 100),
        recoveryPercent: Math.round(recoveryPercent * 100),
        daysToRecover: futureCandles.findIndex(c => c.high >= priorHigh * 0.9) || 'not yet'
      });
    }
  }

  return crashes.slice(-10); // Last 10 crashes
}

/**
 * Calculate overall statistics
 */
function calculateStats(candles) {
  const returns = [];
  for (let i = 1; i < candles.length; i++) {
    returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }

  const positiveReturns = returns.filter(r => r > 0);
  const negativeReturns = returns.filter(r => r < 0);

  return {
    totalCandles: candles.length,
    startDate: new Date(candles[0].openTime).toISOString().split('T')[0],
    endDate: new Date(candles[candles.length - 1].openTime).toISOString().split('T')[0],
    avgDailyReturn: Math.round(returns.reduce((a, b) => a + b, 0) / returns.length * 10000) / 100,
    positiveRate: Math.round(positiveReturns.length / returns.length * 100),
    avgWin: Math.round(positiveReturns.reduce((a, b) => a + b, 0) / positiveReturns.length * 10000) / 100,
    avgLoss: Math.round(negativeReturns.reduce((a, b) => a + b, 0) / negativeReturns.length * 10000) / 100,
    maxDrawdown: calculateMaxDrawdown(candles)
  };
}

function calculateMaxDrawdown(candles) {
  let peak = candles[0].close;
  let maxDrawdown = 0;

  for (const candle of candles) {
    if (candle.close > peak) {
      peak = candle.close;
    }
    const drawdown = (peak - candle.close) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return Math.round(maxDrawdown * 100);
}

/**
 * Run full historical analysis for a symbol
 */
async function runHistoricalAnalysis(symbol = 'BTCUSDT', interval = '1d', yearsBack = 7) {
  console.log(`[HISTORICAL] Starting analysis for ${symbol} (${yearsBack} years)...`);

  const data = await getHistoricalData(symbol, interval, yearsBack);

  if (!data.candles || data.candles.length < 100) {
    return { error: 'Insufficient historical data' };
  }

  const analysis = analyzeHistoricalPatterns(data.candles);

  return {
    symbol,
    interval,
    dataRange: {
      start: data.startDate,
      end: data.endDate,
      candles: data.candleCount
    },
    ...analysis,
    marketEvents: MARKET_EVENTS
  };
}

/**
 * Get historical context for current trading decision
 */
async function getHistoricalContext(symbol, currentPrice) {
  try {
    const analysis = await runHistoricalAnalysis(symbol, '1d', 5);

    if (analysis.error) return null;

    // Find nearby key levels
    const nearbyLevels = analysis.keyLevels
      .filter(l => Math.abs(l.price - currentPrice) / currentPrice < 0.10)
      .map(l => ({
        ...l,
        distance: ((l.price - currentPrice) / currentPrice * 100).toFixed(2) + '%',
        aboveOrBelow: l.price > currentPrice ? 'above' : 'below'
      }));

    // Current month seasonality
    const currentMonth = new Date().toLocaleString('en', { month: 'short' });
    const monthStats = analysis.seasonalPatterns?.monthly?.[currentMonth];

    return {
      nearbyLevels,
      currentMonthStats: monthStats,
      volumePatterns: analysis.volumePatterns,
      overallStats: analysis.stats
    };
  } catch (e) {
    console.error('[HISTORICAL] Context error:', e.message);
    return null;
  }
}

module.exports = {
  fetchHistoricalCandles,
  getHistoricalData,
  analyzeHistoricalPatterns,
  runHistoricalAnalysis,
  getHistoricalContext,
  MARKET_EVENTS
};
