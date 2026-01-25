/**
 * Pattern Memory System
 * Learns from successful trades and recognizes similar patterns
 */

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../data/pattern_memory.json');
const MAX_PATTERNS = 1000; // Keep last 1000 patterns

// In-memory pattern storage
let patternMemory = {
  patterns: [],
  stats: {
    totalPatterns: 0,
    successfulPatterns: 0,
    winRate: 0,
    bestPatterns: []
  }
};

// Load patterns from disk on startup
function loadPatterns() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
      patternMemory = JSON.parse(data);
      console.log(`Loaded ${patternMemory.patterns.length} patterns from memory`);
    }
  } catch (err) {
    console.warn('Could not load pattern memory:', err.message);
  }
}

// Save patterns to disk
function savePatterns() {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(patternMemory, null, 2));
  } catch (err) {
    console.warn('Could not save pattern memory:', err.message);
  }
}

// Extract pattern fingerprint from indicators
function extractPatternFingerprint(indicators) {
  if (!indicators) return null;

  const { rsi, macd, bollinger, kdj, trend, sniperSignals, patterns } = indicators;

  // Create a normalized fingerprint
  return {
    // RSI zone: oversold (0-30), neutral (30-70), overbought (70-100)
    rsiZone: rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral',
    rsiValue: Math.round(rsi / 5) * 5, // Round to nearest 5

    // MACD state
    macdTrend: macd?.histogram > 0 ? 'bullish' : 'bearish',
    macdStrength: Math.abs(macd?.histogram || 0) > 0.5 ? 'strong' : 'weak',

    // Bollinger position
    bbPosition: bollinger?.pb < 0.2 ? 'lower' : bollinger?.pb > 0.8 ? 'upper' : 'middle',

    // KDJ state
    kdjState: kdj?.j < 20 ? 'oversold' : kdj?.j > 80 ? 'overbought' : 'neutral',

    // Trend
    trendDirection: trend?.direction || 'neutral',

    // Sniper signals
    hasDivergence: sniperSignals?.divergence?.type || null,
    hasVolumeAccumulation: sniperSignals?.volumeAccumulation?.detected || false,
    hasEarlyBreakout: sniperSignals?.earlyBreakout?.type || null,
    hasMomentumBuilding: sniperSignals?.momentumBuilding?.detected || false,
    inSqueeze: sniperSignals?.squeeze?.inSqueeze || false,
    sniperScore: Math.round((sniperSignals?.score?.score || 0) / 10) * 10,

    // Candlestick patterns
    candlePatterns: patterns || []
  };
}

// Generate pattern hash for quick lookup
function hashPattern(fingerprint) {
  if (!fingerprint) return null;

  const key = [
    fingerprint.rsiZone,
    fingerprint.macdTrend,
    fingerprint.bbPosition,
    fingerprint.trendDirection,
    fingerprint.hasDivergence || 'none',
    fingerprint.hasEarlyBreakout || 'none',
    fingerprint.inSqueeze ? 'squeeze' : 'normal'
  ].join('-');

  return key;
}

// Record a trade pattern
function recordPattern(signal, result) {
  const fingerprint = extractPatternFingerprint(signal.indicators);
  if (!fingerprint) return;

  const hash = hashPattern(fingerprint);
  const pattern = {
    hash,
    fingerprint,
    symbol: signal.symbol,
    interval: signal.interval,
    direction: signal.ai?.direction,
    confidence: signal.ai?.confidence,
    entryPrice: signal.ai?.trade?.entry,
    result: result, // 'win', 'loss', 'breakeven'
    profit: result === 'win' ? 1 : result === 'loss' ? -1 : 0,
    timestamp: Date.now()
  };

  patternMemory.patterns.push(pattern);
  patternMemory.stats.totalPatterns++;

  if (result === 'win') {
    patternMemory.stats.successfulPatterns++;
  }

  patternMemory.stats.winRate =
    patternMemory.stats.totalPatterns > 0
      ? (patternMemory.stats.successfulPatterns / patternMemory.stats.totalPatterns * 100).toFixed(1)
      : 0;

  // Trim old patterns
  if (patternMemory.patterns.length > MAX_PATTERNS) {
    patternMemory.patterns = patternMemory.patterns.slice(-MAX_PATTERNS);
  }

  // Update best patterns
  updateBestPatterns();

  // Save periodically (every 10 patterns)
  if (patternMemory.patterns.length % 10 === 0) {
    savePatterns();
  }

  return pattern;
}

// Update best performing patterns
function updateBestPatterns() {
  const patternStats = {};

  for (const pattern of patternMemory.patterns) {
    if (!patternStats[pattern.hash]) {
      patternStats[pattern.hash] = {
        hash: pattern.hash,
        count: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        fingerprint: pattern.fingerprint
      };
    }

    patternStats[pattern.hash].count++;
    if (pattern.result === 'win') patternStats[pattern.hash].wins++;
    if (pattern.result === 'loss') patternStats[pattern.hash].losses++;
    patternStats[pattern.hash].winRate =
      (patternStats[pattern.hash].wins / patternStats[pattern.hash].count * 100).toFixed(1);
  }

  // Sort by win rate (min 5 occurrences) and take top 10
  patternMemory.stats.bestPatterns = Object.values(patternStats)
    .filter(p => p.count >= 5)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10);
}

// Find similar patterns in memory
function findSimilarPatterns(indicators) {
  const fingerprint = extractPatternFingerprint(indicators);
  if (!fingerprint) return { found: false, confidence: 0 };

  const hash = hashPattern(fingerprint);

  // Count matches and outcomes
  const matches = patternMemory.patterns.filter(p => p.hash === hash);
  if (matches.length < 3) {
    return { found: false, confidence: 0, matches: matches.length };
  }

  const wins = matches.filter(m => m.result === 'win').length;
  const winRate = wins / matches.length;

  // Check if this is a best pattern
  const isBestPattern = patternMemory.stats.bestPatterns.some(p => p.hash === hash);

  return {
    found: true,
    matches: matches.length,
    wins,
    winRate: (winRate * 100).toFixed(1),
    confidenceBoost: calculateConfidenceBoost(winRate, matches.length),
    isBestPattern,
    historicalDirection: getHistoricalDirection(matches)
  };
}

// Calculate confidence boost based on historical performance
function calculateConfidenceBoost(winRate, sampleSize) {
  // More samples and higher win rate = more boost
  // Max boost: 15%
  let boost = 0;

  if (sampleSize >= 5 && winRate > 0.6) {
    boost = (winRate - 0.5) * 20; // 0-10% boost from win rate

    // Sample size bonus
    if (sampleSize >= 10) boost += 2;
    if (sampleSize >= 20) boost += 3;
  }

  return Math.min(boost, 15);
}

// Get dominant direction from historical patterns
function getHistoricalDirection(matches) {
  const longMatches = matches.filter(m => m.direction === 'long' && m.result === 'win').length;
  const shortMatches = matches.filter(m => m.direction === 'short' && m.result === 'win').length;

  if (longMatches > shortMatches * 1.5) return 'long';
  if (shortMatches > longMatches * 1.5) return 'short';
  return null;
}

// Get pattern memory stats
function getStats() {
  return {
    totalPatterns: patternMemory.stats.totalPatterns,
    successfulPatterns: patternMemory.stats.successfulPatterns,
    winRate: patternMemory.stats.winRate,
    bestPatterns: patternMemory.stats.bestPatterns.slice(0, 5),
    memorizedPatterns: patternMemory.patterns.length
  };
}

// Initialize - load patterns on module load
loadPatterns();

module.exports = {
  extractPatternFingerprint,
  hashPattern,
  recordPattern,
  findSimilarPatterns,
  getStats,
  savePatterns,
  loadPatterns
};
