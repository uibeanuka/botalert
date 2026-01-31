/**
 * MongoDB Storage for Bot Learning & Analytics
 *
 * Stores: trade history, learning state, simulation results,
 * entry condition performance, failure patterns, market insights
 */

const { MongoClient } = require('mongodb');

// Use public URL for external access, internal for Railway-to-Railway
const MONGO_URL = process.env.MONGO_URL || process.env.MONGO_PUBLIC_URL || null;
const DB_NAME = 'botalert';

let client = null;
let db = null;
let isConnected = false;

// Collections
const COLLECTIONS = {
  LEARNING_STATE: 'learning_state',
  TRADE_HISTORY: 'trade_history',
  SIMULATION_TRADES: 'simulation_trades',
  SIMULATION_STATE: 'simulation_state',
  ENTRY_CONDITIONS: 'entry_conditions',
  FAILURE_PATTERNS: 'failure_patterns',
  MARKET_SNAPSHOTS: 'market_snapshots',
  DAILY_STATS: 'daily_stats'
};

/**
 * Connect to MongoDB
 */
async function connect() {
  if (isConnected && client) return db;

  if (!MONGO_URL) {
    console.log('[MONGO] No MONGO_URL configured - using file storage fallback');
    return null;
  }

  try {
    client = new MongoClient(MONGO_URL, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    await client.connect();
    db = client.db(DB_NAME);
    isConnected = true;

    // Create indexes for efficient queries
    await createIndexes();

    console.log('[MONGO] Connected to MongoDB successfully');
    return db;
  } catch (err) {
    console.error('[MONGO] Connection failed:', err.message);
    isConnected = false;
    return null;
  }
}

/**
 * Create indexes for efficient queries
 */
async function createIndexes() {
  if (!db) return;

  try {
    // Trade history indexes
    await db.collection(COLLECTIONS.TRADE_HISTORY).createIndex({ symbol: 1, timestamp: -1 });
    await db.collection(COLLECTIONS.TRADE_HISTORY).createIndex({ result: 1, timestamp: -1 });
    await db.collection(COLLECTIONS.TRADE_HISTORY).createIndex({ timestamp: -1 });

    // Simulation trades
    await db.collection(COLLECTIONS.SIMULATION_TRADES).createIndex({ symbol: 1, openTime: -1 });
    await db.collection(COLLECTIONS.SIMULATION_TRADES).createIndex({ status: 1 });

    // Entry conditions
    await db.collection(COLLECTIONS.ENTRY_CONDITIONS).createIndex({ condition: 1 });
    await db.collection(COLLECTIONS.ENTRY_CONDITIONS).createIndex({ winRate: -1 });

    // Failure patterns
    await db.collection(COLLECTIONS.FAILURE_PATTERNS).createIndex({ pattern: 1, symbol: 1 });
    await db.collection(COLLECTIONS.FAILURE_PATTERNS).createIndex({ count: -1 });

    // Market snapshots (for historical analysis)
    await db.collection(COLLECTIONS.MARKET_SNAPSHOTS).createIndex({ timestamp: -1 });
    await db.collection(COLLECTIONS.MARKET_SNAPSHOTS).createIndex({ symbol: 1, timestamp: -1 });

    // Daily stats
    await db.collection(COLLECTIONS.DAILY_STATS).createIndex({ date: -1 });
  } catch (err) {
    console.warn('[MONGO] Index creation warning:', err.message);
  }
}

/**
 * Check if MongoDB is available
 */
function isAvailable() {
  return isConnected && db !== null;
}

// ============================================================
// LEARNING STATE OPERATIONS
// ============================================================

/**
 * Save entire learning state
 */
async function saveLearningState(state) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.LEARNING_STATE).updateOne(
      { _id: 'main' },
      {
        $set: {
          ...state,
          updatedAt: new Date(),
          version: state.version || 2
        }
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error('[MONGO] Save learning state error:', err.message);
    return false;
  }
}

/**
 * Load learning state
 */
async function loadLearningState() {
  if (!isAvailable()) return null;

  try {
    const state = await db.collection(COLLECTIONS.LEARNING_STATE).findOne({ _id: 'main' });
    return state;
  } catch (err) {
    console.error('[MONGO] Load learning state error:', err.message);
    return null;
  }
}

// ============================================================
// TRADE HISTORY OPERATIONS
// ============================================================

/**
 * Record a completed trade
 */
async function recordTrade(trade) {
  if (!isAvailable()) return false;

  try {
    const doc = {
      ...trade,
      timestamp: trade.timestamp || Date.now(),
      createdAt: new Date()
    };

    await db.collection(COLLECTIONS.TRADE_HISTORY).insertOne(doc);
    return true;
  } catch (err) {
    console.error('[MONGO] Record trade error:', err.message);
    return false;
  }
}

/**
 * Get trade history with filters
 */
async function getTradeHistory(options = {}) {
  if (!isAvailable()) return [];

  try {
    const { symbol, result, limit = 100, skip = 0, startDate, endDate } = options;
    const query = {};

    if (symbol) query.symbol = symbol;
    if (result) query.result = result;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    return await db.collection(COLLECTIONS.TRADE_HISTORY)
      .find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('[MONGO] Get trade history error:', err.message);
    return [];
  }
}

/**
 * Get trade statistics
 */
async function getTradeStats() {
  if (!isAvailable()) return null;

  try {
    const pipeline = [
      {
        $group: {
          _id: null,
          totalTrades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $eq: ['$result', 'loss'] }, 1, 0] } },
          totalPnl: { $sum: { $ifNull: ['$pnlPercent', 0] } },
          avgPnl: { $avg: { $ifNull: ['$pnlPercent', 0] } },
          maxWin: { $max: { $cond: [{ $gt: ['$pnlPercent', 0] }, '$pnlPercent', 0] } },
          maxLoss: { $min: { $cond: [{ $lt: ['$pnlPercent', 0] }, '$pnlPercent', 0] } }
        }
      }
    ];

    const result = await db.collection(COLLECTIONS.TRADE_HISTORY).aggregate(pipeline).toArray();
    if (result.length === 0) return null;

    const stats = result[0];
    stats.winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades * 100).toFixed(1) : 0;
    return stats;
  } catch (err) {
    console.error('[MONGO] Get trade stats error:', err.message);
    return null;
  }
}

/**
 * Get performance by symbol
 */
async function getPerformanceBySymbol() {
  if (!isAvailable()) return [];

  try {
    const pipeline = [
      {
        $group: {
          _id: '$symbol',
          trades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $eq: ['$result', 'win'] }, 1, 0] } },
          totalPnl: { $sum: { $ifNull: ['$pnlPercent', 0] } },
          avgPnl: { $avg: { $ifNull: ['$pnlPercent', 0] } }
        }
      },
      {
        $addFields: {
          winRate: { $multiply: [{ $divide: ['$wins', '$trades'] }, 100] }
        }
      },
      { $sort: { trades: -1 } },
      { $limit: 50 }
    ];

    return await db.collection(COLLECTIONS.TRADE_HISTORY).aggregate(pipeline).toArray();
  } catch (err) {
    console.error('[MONGO] Get performance by symbol error:', err.message);
    return [];
  }
}

// ============================================================
// SIMULATION OPERATIONS
// ============================================================

/**
 * Save simulation state
 */
async function saveSimulationState(state) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.SIMULATION_STATE).updateOne(
      { _id: 'main' },
      {
        $set: {
          ...state,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error('[MONGO] Save simulation state error:', err.message);
    return false;
  }
}

/**
 * Load simulation state
 */
async function loadSimulationState() {
  if (!isAvailable()) return null;

  try {
    return await db.collection(COLLECTIONS.SIMULATION_STATE).findOne({ _id: 'main' });
  } catch (err) {
    console.error('[MONGO] Load simulation state error:', err.message);
    return null;
  }
}

/**
 * Record a simulation trade
 */
async function recordSimulationTrade(trade) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.SIMULATION_TRADES).insertOne({
      ...trade,
      createdAt: new Date()
    });
    return true;
  } catch (err) {
    console.error('[MONGO] Record simulation trade error:', err.message);
    return false;
  }
}

/**
 * Get simulation trades
 */
async function getSimulationTrades(options = {}) {
  if (!isAvailable()) return [];

  try {
    const { status, limit = 100 } = options;
    const query = {};
    if (status) query.status = status;

    return await db.collection(COLLECTIONS.SIMULATION_TRADES)
      .find(query)
      .sort({ openTime: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('[MONGO] Get simulation trades error:', err.message);
    return [];
  }
}

/**
 * Get simulation statistics
 */
async function getSimulationStats() {
  if (!isAvailable()) return null;

  try {
    const closedTrades = await db.collection(COLLECTIONS.SIMULATION_TRADES)
      .find({ status: 'CLOSED' })
      .toArray();

    if (closedTrades.length === 0) return { totalTrades: 0 };

    let wins = 0, losses = 0, totalPnl = 0;
    let maxWin = 0, maxLoss = 0;
    const byDirection = { long: { trades: 0, pnl: 0 }, short: { trades: 0, pnl: 0 } };
    const byHour = {};
    const byEntryQuality = {};

    for (const t of closedTrades) {
      const pnl = t.pnlPercent || 0;
      totalPnl += pnl;

      if (pnl > 0) {
        wins++;
        if (pnl > maxWin) maxWin = pnl;
      } else {
        losses++;
        if (pnl < maxLoss) maxLoss = pnl;
      }

      // By direction
      const dir = t.direction || 'unknown';
      if (byDirection[dir]) {
        byDirection[dir].trades++;
        byDirection[dir].pnl += pnl;
      }

      // By hour
      const hour = new Date(t.openTime).getHours();
      if (!byHour[hour]) byHour[hour] = { trades: 0, wins: 0, pnl: 0 };
      byHour[hour].trades++;
      if (pnl > 0) byHour[hour].wins++;
      byHour[hour].pnl += pnl;

      // By entry quality
      const quality = t.entryQuality || 'UNKNOWN';
      if (!byEntryQuality[quality]) byEntryQuality[quality] = { trades: 0, wins: 0, pnl: 0 };
      byEntryQuality[quality].trades++;
      if (pnl > 0) byEntryQuality[quality].wins++;
      byEntryQuality[quality].pnl += pnl;
    }

    return {
      totalTrades: closedTrades.length,
      wins,
      losses,
      winRate: ((wins / closedTrades.length) * 100).toFixed(1),
      totalPnl: totalPnl.toFixed(2),
      avgPnl: (totalPnl / closedTrades.length).toFixed(2),
      maxWin: maxWin.toFixed(2),
      maxLoss: maxLoss.toFixed(2),
      byDirection,
      byHour,
      byEntryQuality
    };
  } catch (err) {
    console.error('[MONGO] Get simulation stats error:', err.message);
    return null;
  }
}

// ============================================================
// ENTRY CONDITION TRACKING
// ============================================================

/**
 * Update entry condition performance
 */
async function updateEntryCondition(condition, isWin, pnlPercent) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.ENTRY_CONDITIONS).updateOne(
      { condition },
      {
        $inc: {
          trades: 1,
          wins: isWin ? 1 : 0,
          totalPnl: pnlPercent
        },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );

    // Also recalculate win rate
    const doc = await db.collection(COLLECTIONS.ENTRY_CONDITIONS).findOne({ condition });
    if (doc && doc.trades > 0) {
      await db.collection(COLLECTIONS.ENTRY_CONDITIONS).updateOne(
        { condition },
        {
          $set: {
            winRate: (doc.wins / doc.trades * 100),
            avgPnl: doc.totalPnl / doc.trades
          }
        }
      );
    }
    return true;
  } catch (err) {
    console.error('[MONGO] Update entry condition error:', err.message);
    return false;
  }
}

/**
 * Get best/worst entry conditions
 */
async function getEntryConditionRankings() {
  if (!isAvailable()) return { best: [], worst: [] };

  try {
    const best = await db.collection(COLLECTIONS.ENTRY_CONDITIONS)
      .find({ trades: { $gte: 5 } })
      .sort({ winRate: -1 })
      .limit(10)
      .toArray();

    const worst = await db.collection(COLLECTIONS.ENTRY_CONDITIONS)
      .find({ trades: { $gte: 5 } })
      .sort({ winRate: 1 })
      .limit(10)
      .toArray();

    return { best, worst };
  } catch (err) {
    console.error('[MONGO] Get entry condition rankings error:', err.message);
    return { best: [], worst: [] };
  }
}

// ============================================================
// FAILURE PATTERN TRACKING
// ============================================================

/**
 * Record a failure pattern
 */
async function recordFailurePattern(pattern, symbol, details) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.FAILURE_PATTERNS).updateOne(
      { pattern, symbol },
      {
        $inc: { count: 1 },
        $set: {
          lastOccurred: new Date(),
          details
        },
        $push: {
          occurrences: {
            $each: [{ timestamp: new Date(), ...details }],
            $slice: -20  // Keep last 20 occurrences
          }
        }
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error('[MONGO] Record failure pattern error:', err.message);
    return false;
  }
}

/**
 * Get most common failure patterns
 */
async function getTopFailurePatterns(limit = 10) {
  if (!isAvailable()) return [];

  try {
    return await db.collection(COLLECTIONS.FAILURE_PATTERNS)
      .find()
      .sort({ count: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('[MONGO] Get failure patterns error:', err.message);
    return [];
  }
}

// ============================================================
// MARKET SNAPSHOTS (for historical analysis)
// ============================================================

/**
 * Store market snapshot
 */
async function storeMarketSnapshot(snapshot) {
  if (!isAvailable()) return false;

  try {
    await db.collection(COLLECTIONS.MARKET_SNAPSHOTS).insertOne({
      ...snapshot,
      timestamp: new Date()
    });
    return true;
  } catch (err) {
    console.error('[MONGO] Store market snapshot error:', err.message);
    return false;
  }
}

// ============================================================
// DAILY STATS
// ============================================================

/**
 * Update daily stats
 */
async function updateDailyStats(stats) {
  if (!isAvailable()) return false;

  try {
    const today = new Date().toISOString().split('T')[0];
    await db.collection(COLLECTIONS.DAILY_STATS).updateOne(
      { date: today },
      {
        $set: {
          ...stats,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.error('[MONGO] Update daily stats error:', err.message);
    return false;
  }
}

/**
 * Get daily stats history
 */
async function getDailyStatsHistory(days = 30) {
  if (!isAvailable()) return [];

  try {
    return await db.collection(COLLECTIONS.DAILY_STATS)
      .find()
      .sort({ date: -1 })
      .limit(days)
      .toArray();
  } catch (err) {
    console.error('[MONGO] Get daily stats error:', err.message);
    return [];
  }
}

// ============================================================
// COMPREHENSIVE INSIGHTS
// ============================================================

/**
 * Get all learning insights for dashboard
 */
async function getAllInsights() {
  if (!isAvailable()) {
    return {
      connected: false,
      message: 'MongoDB not connected - using file storage'
    };
  }

  try {
    const [
      tradeStats,
      symbolPerformance,
      entryRankings,
      failurePatterns,
      simulationStats,
      dailyStats
    ] = await Promise.all([
      getTradeStats(),
      getPerformanceBySymbol(),
      getEntryConditionRankings(),
      getTopFailurePatterns(10),
      getSimulationStats(),
      getDailyStatsHistory(7)
    ]);

    return {
      connected: true,
      realTrades: tradeStats,
      symbolPerformance: symbolPerformance.slice(0, 20),
      entryConditions: entryRankings,
      failurePatterns,
      simulation: simulationStats,
      last7Days: dailyStats
    };
  } catch (err) {
    console.error('[MONGO] Get all insights error:', err.message);
    return { connected: true, error: err.message };
  }
}

/**
 * Close connection
 */
async function close() {
  if (client) {
    await client.close();
    isConnected = false;
    db = null;
    console.log('[MONGO] Connection closed');
  }
}

module.exports = {
  connect,
  isAvailable,
  close,

  // Learning state
  saveLearningState,
  loadLearningState,

  // Trade history
  recordTrade,
  getTradeHistory,
  getTradeStats,
  getPerformanceBySymbol,

  // Simulation
  saveSimulationState,
  loadSimulationState,
  recordSimulationTrade,
  getSimulationTrades,
  getSimulationStats,

  // Entry conditions
  updateEntryCondition,
  getEntryConditionRankings,

  // Failure patterns
  recordFailurePattern,
  getTopFailurePatterns,

  // Market data
  storeMarketSnapshot,

  // Daily stats
  updateDailyStats,
  getDailyStatsHistory,

  // Dashboard
  getAllInsights,

  // Constants
  COLLECTIONS
};
