/**
 * Coin Scanner Middleware
 *
 * Scans ALL futures coins to find sniper opportunities.
 * Uses a queue system to avoid rate limits and process efficiently.
 */

const { getFuturesSymbols, getCandles } = require('./binance');
const { calculateIndicators } = require('./indicators');
const { predictNextMove } = require('./ai');

// Scanner config
const SCAN_BATCH_SIZE = 10; // Process 10 coins at a time
const BATCH_DELAY_MS = 1000; // 1 second between batches
const FULL_SCAN_INTERVAL_MS = 15 * 60 * 1000; // Full scan every 15 min
const QUICK_SCAN_INTERVAL_MS = 3 * 60 * 1000; // Quick scan top opportunities every 3 min

// Scanner state
let allFuturesSymbols = [];
let lastFullScan = 0;
let scanResults = new Map(); // symbol -> scan result
let topOpportunities = []; // Best sniper opportunities
let scanQueue = [];
let isScanning = false;

/**
 * Initialize scanner with all futures symbols
 */
async function initScanner() {
  try {
    const symbols = await getFuturesSymbols();
    allFuturesSymbols = symbols
      .filter(s => s.endsWith('USDT'))
      .filter(s => !s.includes('_')); // Exclude delivery contracts

    console.log(`[SCANNER] Initialized with ${allFuturesSymbols.length} futures symbols`);
    return allFuturesSymbols;
  } catch (err) {
    console.error('[SCANNER] Failed to init:', err.message);
    return [];
  }
}

/**
 * Scan a single coin and return opportunity score
 */
async function scanCoin(symbol, interval = '15m') {
  try {
    const candles = await getCandles(symbol, interval);
    if (!candles || candles.length < 50) {
      return null;
    }

    const indicators = calculateIndicators(candles);
    if (!indicators) return null;

    const ai = predictNextMove(indicators, null, symbol);
    const sniper = indicators.sniperSignals;

    // Calculate opportunity score
    let score = 0;
    let reasons = [];

    // Sniper signals (most important)
    if (sniper?.score?.isSniper) {
      score += sniper.score.score;
      reasons.push(`Sniper ${sniper.score.direction} (${sniper.score.score})`);
    }

    // Divergence
    if (sniper?.divergence?.detected) {
      score += sniper.divergence.strength * 0.5;
      reasons.push(`${sniper.divergence.type} divergence`);
    }

    // Volume accumulation
    if (sniper?.volumeAccumulation?.detected) {
      score += sniper.volumeAccumulation.strength * 0.4;
      reasons.push(`Vol accum ${sniper.volumeAccumulation.direction}`);
    }

    // Volume surge
    if (sniper?.volumeSurge?.detected) {
      score += sniper.volumeSurge.strength * 0.6;
      if (sniper.volumeSurge.isExplosive) score += 20;
      reasons.push(`Volume surge ${sniper.volumeSurge.isExplosive ? 'EXPLOSIVE' : ''}`);
    }

    // Squeeze breakout potential
    if (sniper?.squeeze?.inSqueeze) {
      score += 15;
      reasons.push('In squeeze (breakout pending)');
    }

    // Early breakout
    if (sniper?.earlyBreakout?.detected) {
      score += 25;
      reasons.push(`Early ${sniper.earlyBreakout.direction} breakout`);
    }

    // Momentum building
    if (sniper?.momentumBuilding?.detected) {
      score += sniper.momentumBuilding.strength * 0.3;
      reasons.push(`Momentum ${sniper.momentumBuilding.direction}`);
    }

    // AI confidence boost
    if (ai.confidence >= 0.65) {
      score += (ai.confidence - 0.5) * 50;
    }

    // Strong signal boost
    if (ai.signal?.includes('STRONG')) {
      score += 15;
    }
    if (ai.signal?.includes('SNIPER')) {
      score += 20;
    }

    return {
      symbol,
      score: Math.round(score),
      direction: ai.direction,
      signal: ai.signal,
      confidence: ai.confidence,
      price: indicators.currentPrice,
      priceChange24h: indicators.priceChange24h || 0,
      volume: indicators.volume,
      reasons,
      sniperActive: sniper?.score?.isSniper || false,
      sniperDirection: sniper?.score?.direction,
      sniperScore: sniper?.score?.score || 0,
      timestamp: Date.now()
    };
  } catch (err) {
    // Silent fail for individual coins
    return null;
  }
}

/**
 * Process scan queue in batches
 */
async function processQueue() {
  if (isScanning || scanQueue.length === 0) return;

  isScanning = true;
  const startTime = Date.now();
  let processed = 0;
  let found = 0;

  while (scanQueue.length > 0) {
    const batch = scanQueue.splice(0, SCAN_BATCH_SIZE);

    const results = await Promise.all(
      batch.map(symbol => scanCoin(symbol))
    );

    for (const result of results) {
      if (result) {
        scanResults.set(result.symbol, result);
        processed++;
        if (result.score >= 40) found++;
      }
    }

    // Rate limit protection
    if (scanQueue.length > 0) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Update top opportunities
  updateTopOpportunities();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCANNER] Processed ${processed} coins in ${elapsed}s, found ${found} opportunities (score≥40)`);

  isScanning = false;
}

/**
 * Update sorted list of top opportunities
 */
function updateTopOpportunities() {
  const all = Array.from(scanResults.values());

  // Filter and sort by score
  topOpportunities = all
    .filter(r => r.score >= 30 && r.timestamp > Date.now() - 30 * 60 * 1000) // Score≥30, fresh data
    .sort((a, b) => b.score - a.score)
    .slice(0, 50); // Top 50

  if (topOpportunities.length > 0) {
    const top5 = topOpportunities.slice(0, 5);
    console.log(`[SCANNER] Top opportunities: ${top5.map(t => `${t.symbol}(${t.score})`).join(', ')}`);
  }
}

/**
 * Run full scan of all futures coins
 */
async function runFullScan() {
  if (allFuturesSymbols.length === 0) {
    await initScanner();
  }

  console.log(`[SCANNER] Starting full scan of ${allFuturesSymbols.length} coins...`);
  scanQueue = [...allFuturesSymbols];
  lastFullScan = Date.now();

  await processQueue();
}

/**
 * Quick scan of top movers and previous opportunities
 */
async function runQuickScan() {
  // Re-scan previous top opportunities + any new symbols with high activity
  const toScan = new Set();

  // Previous opportunities
  for (const opp of topOpportunities.slice(0, 20)) {
    toScan.add(opp.symbol);
  }

  // Add symbols that had sniper signals
  for (const [symbol, result] of scanResults) {
    if (result.sniperActive) {
      toScan.add(symbol);
    }
  }

  if (toScan.size === 0) return;

  console.log(`[SCANNER] Quick scan of ${toScan.size} coins...`);
  scanQueue = Array.from(toScan);
  await processQueue();
}

/**
 * Get current top opportunities
 */
function getTopOpportunities(limit = 20) {
  return topOpportunities.slice(0, limit);
}

/**
 * Get opportunities filtered by direction
 */
function getOpportunitiesByDirection(direction, limit = 10) {
  return topOpportunities
    .filter(o => o.direction === direction)
    .slice(0, limit);
}

/**
 * Get sniper-ready opportunities (high score + sniper active)
 */
function getSniperOpportunities(limit = 10) {
  return topOpportunities
    .filter(o => o.sniperActive && o.score >= 50)
    .slice(0, limit);
}

/**
 * Get scan result for specific symbol
 */
function getScanResult(symbol) {
  return scanResults.get(symbol);
}

/**
 * Get scanner status
 */
function getScannerStatus() {
  return {
    totalSymbols: allFuturesSymbols.length,
    scannedSymbols: scanResults.size,
    topOpportunities: topOpportunities.length,
    isScanning,
    queueLength: scanQueue.length,
    lastFullScan: lastFullScan ? new Date(lastFullScan).toISOString() : null,
    sniperReady: topOpportunities.filter(o => o.sniperActive && o.score >= 50).length
  };
}

/**
 * Start the scanner with automatic intervals
 */
function startScanner() {
  console.log('[SCANNER] Starting coin scanner...');

  // Initial full scan after 5 seconds
  setTimeout(() => {
    runFullScan().catch(err => console.error('[SCANNER] Full scan error:', err.message));
  }, 5000);

  // Full scan every 15 minutes
  setInterval(() => {
    runFullScan().catch(err => console.error('[SCANNER] Full scan error:', err.message));
  }, FULL_SCAN_INTERVAL_MS);

  // Quick scan every 3 minutes
  setInterval(() => {
    runQuickScan().catch(err => console.error('[SCANNER] Quick scan error:', err.message));
  }, QUICK_SCAN_INTERVAL_MS);

  return {
    getTopOpportunities,
    getOpportunitiesByDirection,
    getSniperOpportunities,
    getScanResult,
    getScannerStatus,
    runFullScan,
    runQuickScan
  };
}

module.exports = {
  startScanner,
  getTopOpportunities,
  getOpportunitiesByDirection,
  getSniperOpportunities,
  getScanResult,
  getScannerStatus,
  runFullScan,
  runQuickScan,
  scanCoin
};
