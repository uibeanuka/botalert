/**
 * Simulation Engine - Paper Trading for Learning
 *
 * Runs simulated trades alongside real trading to:
 * - Test strategies without risk
 * - Learn from more data points
 * - Understand market behavior
 * - Improve sniper entry timing
 */

const fs = require('fs');
const path = require('path');
const { extractEntryConditions, updateEntryConditionPerformance, analyzeTradeFailure, learnFromTrade, checkEntryQuality } = require('./aiLearning');

const SIMULATION_DATA_FILE = path.join(__dirname, '../data/simulation_state.json');

// Simulation configuration
const SIM_ENABLED = process.env.SIMULATION_ENABLED !== 'false'; // On by default
const SIM_MAX_POSITIONS = Number(process.env.SIM_MAX_POSITIONS || 20);
const SIM_INITIAL_BALANCE = Number(process.env.SIM_INITIAL_BALANCE || 10000);
const SIM_RISK_PER_TRADE = Number(process.env.SIM_RISK_PER_TRADE || 3) / 100;
const SIM_LEVERAGE = Number(process.env.SIM_LEVERAGE || 10);
const SIM_MIN_CONFIDENCE = Number(process.env.SIM_MIN_CONFIDENCE || 55) / 100;

// Simulation state
let simState = {
  balance: SIM_INITIAL_BALANCE,
  initialBalance: SIM_INITIAL_BALANCE,
  positions: new Map(), // symbol -> position
  closedTrades: [], // History of closed trades
  stats: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    peakBalance: SIM_INITIAL_BALANCE,
    bestTrade: null,
    worstTrade: null,
    byDirection: {
      long: { trades: 0, wins: 0, pnl: 0 },
      short: { trades: 0, wins: 0, pnl: 0 }
    },
    byEntryQuality: {
      EXCELLENT: { trades: 0, wins: 0, pnl: 0 },
      GOOD: { trades: 0, wins: 0, pnl: 0 },
      FAIR: { trades: 0, wins: 0, pnl: 0 },
      POOR: { trades: 0, wins: 0, pnl: 0 }
    },
    byTimeOfDay: {}, // hour -> { trades, wins, pnl }
    recentTrades: [] // Last 20 trades for dashboard
  },
  learningEnabled: true,
  startTime: Date.now()
};

// Load simulation state
function loadSimState() {
  try {
    if (fs.existsSync(SIMULATION_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(SIMULATION_DATA_FILE, 'utf-8'));
      simState = {
        ...simState,
        ...data,
        positions: new Map(Object.entries(data.positions || {}))
      };
      console.log(`[SIM] Loaded state: $${simState.balance.toFixed(2)} balance, ${simState.stats.totalTrades} trades`);
    }
  } catch (err) {
    console.warn('[SIM] Could not load state:', err.message);
  }
}

// Save simulation state
function saveSimState() {
  try {
    const dir = path.dirname(SIMULATION_DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const toSave = {
      ...simState,
      positions: Object.fromEntries(simState.positions)
    };
    fs.writeFileSync(SIMULATION_DATA_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.warn('[SIM] Could not save state:', err.message);
  }
}

/**
 * Check if we should open a simulated position
 */
function shouldSimulateTrade(signal) {
  if (!SIM_ENABLED) return { simulate: false, reason: 'Simulation disabled' };

  const confidence = signal.ai?.confidence || 0;
  const trade = signal.ai?.trade;

  // Need valid trade setup
  if (!trade || !trade.entry || !trade.stopLoss || !trade.takeProfit?.[0]) {
    return { simulate: false, reason: 'No valid trade setup' };
  }

  // Check confidence (lower threshold for simulation - we want to learn from all signals)
  if (confidence < SIM_MIN_CONFIDENCE) {
    return { simulate: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% below ${(SIM_MIN_CONFIDENCE * 100).toFixed(0)}%` };
  }

  // Check position limit
  if (simState.positions.size >= SIM_MAX_POSITIONS) {
    return { simulate: false, reason: 'Max simulated positions reached' };
  }

  // Already have position for this symbol
  if (simState.positions.has(signal.symbol)) {
    return { simulate: false, reason: 'Already have simulated position' };
  }

  return { simulate: true, reason: 'OK' };
}

/**
 * Open a simulated position
 */
function openSimPosition(signal) {
  const check = shouldSimulateTrade(signal);
  if (!check.simulate) {
    return { opened: false, reason: check.reason };
  }

  const trade = signal.ai.trade;
  const indicators = signal.indicators;
  const direction = trade.type === 'LONG' ? 'long' : 'short';

  // Extract entry conditions for learning
  const entryConditions = extractEntryConditions(indicators);
  const entryQuality = checkEntryQuality(indicators, direction);

  // Calculate position size
  const riskAmount = simState.balance * SIM_RISK_PER_TRADE;
  const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);
  let positionValue = (riskAmount / riskPerUnit) * trade.entry;
  positionValue = Math.min(positionValue, simState.balance * 0.3); // Max 30% per trade

  const position = {
    symbol: signal.symbol,
    side: trade.type,
    entryPrice: trade.entry,
    currentPrice: trade.entry,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit[0],
    positionValue,
    leverage: SIM_LEVERAGE,
    openTime: Date.now(),
    peakProfit: 0,
    peakPnlPercent: 0,
    signal: signal.signal,
    confidence: signal.ai.confidence,
    entryConditions,
    entryQuality: entryQuality.quality,
    expectedWinRate: entryQuality.expectedWinRate,
    indicators: {
      rsi: indicators.rsi,
      macd: indicators.macd?.histogram,
      trend: indicators.trend?.direction,
      sniperActive: indicators.sniperSignals?.score?.isSniper
    }
  };

  simState.positions.set(signal.symbol, position);

  const qualityEmoji = {
    EXCELLENT: '✨',
    GOOD: '👍',
    FAIR: '🤔',
    POOR: '⚠️'
  }[entryQuality.quality] || '📊';

  console.log(`[SIM] ${qualityEmoji} OPENED ${trade.type} ${signal.symbol} @ ${trade.entry.toFixed(4)} | SL: ${trade.stopLoss.toFixed(4)} TP: ${trade.takeProfit[0].toFixed(4)} | Quality: ${entryQuality.quality} (${(entryQuality.expectedWinRate * 100).toFixed(0)}% expected)`);

  return { opened: true, position };
}

/**
 * Monitor all simulated positions
 */
function monitorSimPositions(latestSignals) {
  if (!SIM_ENABLED || simState.positions.size === 0) return;

  const closedPositions = [];

  for (const [symbol, position] of simState.positions) {
    // Find current signal for this symbol
    let currentSignal = null;
    for (const [key, signal] of latestSignals) {
      if (key.startsWith(symbol + '-')) {
        currentSignal = signal;
        break;
      }
    }

    if (!currentSignal?.indicators?.currentPrice) continue;

    const currentPrice = currentSignal.indicators.currentPrice;
    position.currentPrice = currentPrice;

    // Calculate P&L
    const pnlPercent = position.side === 'LONG'
      ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * SIM_LEVERAGE
      : ((position.entryPrice - currentPrice) / position.entryPrice) * 100 * SIM_LEVERAGE;

    // Track peak profit for trailing analysis
    if (pnlPercent > position.peakPnlPercent) {
      position.peakPnlPercent = pnlPercent;
    }

    // Check exit conditions
    let shouldClose = false;
    let closeReason = '';

    // Stop Loss hit
    if ((position.side === 'LONG' && currentPrice <= position.stopLoss) ||
        (position.side === 'SHORT' && currentPrice >= position.stopLoss)) {
      shouldClose = true;
      closeReason = 'Stop Loss hit';
    }

    // Take Profit hit
    if ((position.side === 'LONG' && currentPrice >= position.takeProfit) ||
        (position.side === 'SHORT' && currentPrice <= position.takeProfit)) {
      shouldClose = true;
      closeReason = 'Take Profit hit';
    }

    // Signal reversal
    const signalDir = currentSignal.ai?.direction;
    if (signalDir && currentSignal.ai?.confidence >= 0.6) {
      if ((position.side === 'LONG' && signalDir === 'short') ||
          (position.side === 'SHORT' && signalDir === 'long')) {
        shouldClose = true;
        closeReason = `Signal reversed to ${signalDir.toUpperCase()}`;
      }
    }

    // Trailing stop (if we had 5%+ profit and now losing 3% from peak)
    if (position.peakPnlPercent >= 5 && pnlPercent < position.peakPnlPercent - 3) {
      shouldClose = true;
      closeReason = `Trailing stop (peak: ${position.peakPnlPercent.toFixed(1)}%, now: ${pnlPercent.toFixed(1)}%)`;
    }

    // Emergency stop at -10%
    if (pnlPercent <= -10) {
      shouldClose = true;
      closeReason = `Emergency stop at ${pnlPercent.toFixed(1)}%`;
    }

    // Position stale (8 hours with no significant move)
    const holdTime = Date.now() - position.openTime;
    if (holdTime > 8 * 60 * 60 * 1000 && Math.abs(pnlPercent) < 1) {
      shouldClose = true;
      closeReason = 'Position stale (8h+)';
    }

    if (shouldClose) {
      const result = closeSimPosition(symbol, closeReason, currentPrice, currentSignal.indicators);
      closedPositions.push(result);
    }
  }

  // Save state periodically
  if (closedPositions.length > 0 || Math.random() < 0.1) {
    saveSimState();
  }

  return closedPositions;
}

/**
 * Close a simulated position and learn from it
 */
function closeSimPosition(symbol, reason, exitPrice, exitIndicators = null) {
  const position = simState.positions.get(symbol);
  if (!position) return null;

  // Calculate final P&L
  const pnlPercent = position.side === 'LONG'
    ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100 * SIM_LEVERAGE
    : ((position.entryPrice - exitPrice) / position.entryPrice) * 100 * SIM_LEVERAGE;

  const pnlValue = (pnlPercent / 100) * position.positionValue;

  // Update balance
  simState.balance += pnlValue;

  // Track drawdown
  if (simState.balance > simState.stats.peakBalance) {
    simState.stats.peakBalance = simState.balance;
  }
  const currentDrawdown = ((simState.stats.peakBalance - simState.balance) / simState.stats.peakBalance) * 100;
  if (currentDrawdown > simState.stats.maxDrawdown) {
    simState.stats.maxDrawdown = currentDrawdown;
  }

  // Determine result
  let result;
  if (pnlPercent > 0.5) result = 'win';
  else if (pnlPercent < -0.5) result = 'loss';
  else result = 'breakeven';

  const holdTime = Date.now() - position.openTime;
  const direction = position.side === 'LONG' ? 'long' : 'short';

  // Create trade record
  const closedTrade = {
    symbol,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
    pnlValue: Math.round(pnlValue * 100) / 100,
    result,
    reason,
    openTime: position.openTime,
    closeTime: Date.now(),
    holdTime,
    entryConditions: position.entryConditions,
    entryQuality: position.entryQuality,
    confidence: position.confidence,
    peakPnlPercent: position.peakPnlPercent
  };

  // Add to closed trades history
  simState.closedTrades.push(closedTrade);
  if (simState.closedTrades.length > 500) {
    simState.closedTrades = simState.closedTrades.slice(-500);
  }

  // Update stats
  simState.stats.totalTrades++;
  simState.stats.totalPnl += pnlValue;
  simState.stats.totalPnlPercent += pnlPercent;

  if (result === 'win') {
    simState.stats.wins++;
    simState.stats.avgWin = (simState.stats.avgWin * (simState.stats.wins - 1) + pnlPercent) / simState.stats.wins;
    if (!simState.stats.bestTrade || pnlPercent > simState.stats.bestTrade.pnlPercent) {
      simState.stats.bestTrade = { symbol, pnlPercent, side: position.side };
    }
  } else if (result === 'loss') {
    simState.stats.losses++;
    simState.stats.avgLoss = (simState.stats.avgLoss * (simState.stats.losses - 1) + pnlPercent) / simState.stats.losses;
    if (!simState.stats.worstTrade || pnlPercent < simState.stats.worstTrade.pnlPercent) {
      simState.stats.worstTrade = { symbol, pnlPercent, side: position.side };
    }
  } else {
    simState.stats.breakeven++;
  }

  // Calculate win rate and profit factor
  simState.stats.winRate = simState.stats.wins / simState.stats.totalTrades;
  if (simState.stats.losses > 0 && simState.stats.avgLoss !== 0) {
    const totalWins = simState.stats.wins * Math.abs(simState.stats.avgWin);
    const totalLosses = simState.stats.losses * Math.abs(simState.stats.avgLoss);
    simState.stats.profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;
  }

  // Update by direction
  const dirStats = simState.stats.byDirection[direction];
  dirStats.trades++;
  if (result === 'win') dirStats.wins++;
  dirStats.pnl += pnlPercent;

  // Update by entry quality
  const qualityStats = simState.stats.byEntryQuality[position.entryQuality];
  if (qualityStats) {
    qualityStats.trades++;
    if (result === 'win') qualityStats.wins++;
    qualityStats.pnl += pnlPercent;
  }

  // Update by time of day
  const hour = new Date(position.openTime).getUTCHours();
  if (!simState.stats.byTimeOfDay[hour]) {
    simState.stats.byTimeOfDay[hour] = { trades: 0, wins: 0, pnl: 0 };
  }
  simState.stats.byTimeOfDay[hour].trades++;
  if (result === 'win') simState.stats.byTimeOfDay[hour].wins++;
  simState.stats.byTimeOfDay[hour].pnl += pnlPercent;

  // Recent trades for dashboard
  simState.stats.recentTrades.unshift(closedTrade);
  if (simState.stats.recentTrades.length > 20) {
    simState.stats.recentTrades = simState.stats.recentTrades.slice(0, 20);
  }

  // === LEARN FROM SIMULATION ===
  if (simState.learningEnabled) {
    // Update entry condition performance
    if (position.entryConditions?.length > 0) {
      updateEntryConditionPerformance(position.entryConditions, result, pnlPercent);
    }

    // Learn from trade
    learnFromTrade({
      indicators: exitIndicators || position.indicators,
      signal: position.signal,
      direction,
      pnlPercent,
      result,
      symbol,
      timestamp: Date.now(),
      isSimulation: true
    });

    // Analyze failure patterns for losses
    if (result === 'loss' && pnlPercent <= -2) {
      analyzeTradeFailure({
        symbol,
        direction,
        entryPrice: position.entryPrice,
        exitPrice,
        pnlPercent,
        entryIndicators: position.indicators,
        exitIndicators,
        holdTime
      });
    }
  }

  // Remove from positions
  simState.positions.delete(symbol);

  // Log result
  const emoji = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
  console.log(`[SIM] ${emoji} CLOSED ${position.side} ${symbol} | PnL: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% ($${pnlValue >= 0 ? '+' : ''}${pnlValue.toFixed(2)}) | ${reason} | Balance: $${simState.balance.toFixed(2)}`);

  return closedTrade;
}

/**
 * Process all signals for potential simulated trades
 */
function processSignalsForSimulation(latestSignals) {
  if (!SIM_ENABLED) return;

  let opened = 0;

  for (const [key, signal] of latestSignals) {
    if (!signal.ai?.trade) continue;

    const result = openSimPosition(signal);
    if (result.opened) opened++;
  }

  return opened;
}

/**
 * Get simulation status for dashboard
 */
function getSimulationStatus() {
  const runtime = Date.now() - simState.startTime;
  const runtimeHours = runtime / (1000 * 60 * 60);

  // Calculate entry quality performance
  const qualityPerformance = {};
  for (const [quality, stats] of Object.entries(simState.stats.byEntryQuality)) {
    if (stats.trades > 0) {
      qualityPerformance[quality] = {
        trades: stats.trades,
        winRate: Math.round((stats.wins / stats.trades) * 100),
        avgPnl: Math.round((stats.pnl / stats.trades) * 100) / 100
      };
    }
  }

  // Calculate hourly performance
  const hourlyPerformance = Object.entries(simState.stats.byTimeOfDay)
    .map(([hour, stats]) => ({
      hour: parseInt(hour),
      trades: stats.trades,
      winRate: stats.trades > 0 ? Math.round((stats.wins / stats.trades) * 100) : 0,
      avgPnl: stats.trades > 0 ? Math.round((stats.pnl / stats.trades) * 100) / 100 : 0
    }))
    .sort((a, b) => b.winRate - a.winRate);

  return {
    enabled: SIM_ENABLED,
    balance: Math.round(simState.balance * 100) / 100,
    initialBalance: simState.initialBalance,
    totalReturn: Math.round(((simState.balance - simState.initialBalance) / simState.initialBalance) * 10000) / 100,
    openPositions: Array.from(simState.positions.values()).map(p => ({
      symbol: p.symbol,
      side: p.side,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      pnl: p.side === 'LONG'
        ? Math.round(((p.currentPrice - p.entryPrice) / p.entryPrice) * 100 * SIM_LEVERAGE * 100) / 100
        : Math.round(((p.entryPrice - p.currentPrice) / p.entryPrice) * 100 * SIM_LEVERAGE * 100) / 100,
      entryQuality: p.entryQuality,
      holdTime: Date.now() - p.openTime
    })),
    stats: {
      totalTrades: simState.stats.totalTrades,
      wins: simState.stats.wins,
      losses: simState.stats.losses,
      breakeven: simState.stats.breakeven,
      winRate: Math.round(simState.stats.winRate * 100),
      avgWin: Math.round(simState.stats.avgWin * 100) / 100,
      avgLoss: Math.round(simState.stats.avgLoss * 100) / 100,
      profitFactor: Math.round(simState.stats.profitFactor * 100) / 100,
      maxDrawdown: Math.round(simState.stats.maxDrawdown * 100) / 100,
      totalPnl: Math.round(simState.stats.totalPnl * 100) / 100,
      bestTrade: simState.stats.bestTrade,
      worstTrade: simState.stats.worstTrade,
      tradesPerDay: simState.stats.totalTrades / Math.max(runtimeHours / 24, 1)
    },
    byDirection: {
      long: {
        trades: simState.stats.byDirection.long.trades,
        winRate: simState.stats.byDirection.long.trades > 0
          ? Math.round((simState.stats.byDirection.long.wins / simState.stats.byDirection.long.trades) * 100)
          : 0,
        avgPnl: simState.stats.byDirection.long.trades > 0
          ? Math.round((simState.stats.byDirection.long.pnl / simState.stats.byDirection.long.trades) * 100) / 100
          : 0
      },
      short: {
        trades: simState.stats.byDirection.short.trades,
        winRate: simState.stats.byDirection.short.trades > 0
          ? Math.round((simState.stats.byDirection.short.wins / simState.stats.byDirection.short.trades) * 100)
          : 0,
        avgPnl: simState.stats.byDirection.short.trades > 0
          ? Math.round((simState.stats.byDirection.short.pnl / simState.stats.byDirection.short.trades) * 100) / 100
          : 0
      }
    },
    byEntryQuality: qualityPerformance,
    bestHours: hourlyPerformance.slice(0, 5),
    worstHours: hourlyPerformance.slice(-3).reverse(),
    recentTrades: simState.stats.recentTrades,
    learningEnabled: simState.learningEnabled,
    runtimeHours: Math.round(runtimeHours * 10) / 10
  };
}

/**
 * Reset simulation state
 */
function resetSimulation() {
  simState = {
    balance: SIM_INITIAL_BALANCE,
    initialBalance: SIM_INITIAL_BALANCE,
    positions: new Map(),
    closedTrades: [],
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      peakBalance: SIM_INITIAL_BALANCE,
      bestTrade: null,
      worstTrade: null,
      byDirection: {
        long: { trades: 0, wins: 0, pnl: 0 },
        short: { trades: 0, wins: 0, pnl: 0 }
      },
      byEntryQuality: {
        EXCELLENT: { trades: 0, wins: 0, pnl: 0 },
        GOOD: { trades: 0, wins: 0, pnl: 0 },
        FAIR: { trades: 0, wins: 0, pnl: 0 },
        POOR: { trades: 0, wins: 0, pnl: 0 }
      },
      byTimeOfDay: {},
      recentTrades: []
    },
    learningEnabled: true,
    startTime: Date.now()
  };
  saveSimState();
  console.log('[SIM] Simulation reset');
  return getSimulationStatus();
}

/**
 * Start simulation engine
 */
function startSimulationEngine({ latestSignals }) {
  if (!SIM_ENABLED) {
    console.log('[SIM] Simulation disabled');
    return null;
  }

  loadSimState();

  console.log(`[SIM] Started with $${simState.balance.toFixed(2)} balance`);
  console.log(`[SIM] Config: max positions=${SIM_MAX_POSITIONS}, risk=${SIM_RISK_PER_TRADE * 100}%, leverage=${SIM_LEVERAGE}x, min confidence=${SIM_MIN_CONFIDENCE * 100}%`);

  return {
    processSignals: (signals) => processSignalsForSimulation(signals),
    monitorPositions: (signals) => monitorSimPositions(signals),
    getStatus: getSimulationStatus,
    reset: resetSimulation,
    setLearning: (enabled) => {
      simState.learningEnabled = enabled;
      console.log(`[SIM] Learning ${enabled ? 'enabled' : 'disabled'}`);
    }
  };
}

// Initialize on load
loadSimState();

module.exports = {
  startSimulationEngine,
  openSimPosition,
  closeSimPosition,
  monitorSimPositions,
  processSignalsForSimulation,
  getSimulationStatus,
  resetSimulation,
  SIM_ENABLED
};
