/**
 * Advanced Risk Management System
 * Kelly Criterion, Position Sizing, Drawdown Protection, Portfolio Risk
 */

const fs = require('fs');
const path = require('path');

const RISK_STATE_FILE = path.join(__dirname, '../data/risk_state.json');

// Risk state
let riskState = {
  dailyPnL: 0,
  weeklyPnL: 0,
  monthlyPnL: 0,
  currentDrawdown: 0,
  peakEquity: 10000,
  consecutiveLosses: 0,
  consecutiveWins: 0,
  todayTrades: 0,
  lastTradeTime: null,
  dailyLossLimit: false,
  weeklyLossLimit: false,
  riskMultiplier: 1.0,
  tradeHistory: []
};

// Risk configuration
const DEFAULT_CONFIG = {
  maxRiskPerTrade: 2, // 2% max risk per trade
  maxDailyLoss: 5, // 5% max daily loss
  maxWeeklyLoss: 10, // 10% max weekly loss
  maxDrawdown: 15, // 15% max drawdown - pause trading
  maxOpenPositions: 5,
  maxDailyTrades: 20,
  minTimeBetweenTrades: 60000, // 1 minute minimum
  maxConsecutiveLosses: 5, // Reduce size after 5 losses
  maxCorrelatedPositions: 3, // Max positions in correlated assets
  volatilityAdjustment: true,
  kellyFraction: 0.25, // Use 25% of Kelly sizing (conservative)
  dynamicSizing: true
};

let config = { ...DEFAULT_CONFIG };

// Load risk state on startup
function loadRiskState() {
  try {
    if (fs.existsSync(RISK_STATE_FILE)) {
      const data = fs.readFileSync(RISK_STATE_FILE, 'utf-8');
      const loaded = JSON.parse(data);

      // Reset daily stats if new day
      const lastUpdate = new Date(loaded.lastUpdate || 0);
      const today = new Date();

      if (lastUpdate.toDateString() !== today.toDateString()) {
        loaded.dailyPnL = 0;
        loaded.todayTrades = 0;
        loaded.dailyLossLimit = false;
      }

      // Reset weekly stats if new week
      if (getWeekNumber(lastUpdate) !== getWeekNumber(today)) {
        loaded.weeklyPnL = 0;
        loaded.weeklyLossLimit = false;
      }

      riskState = { ...riskState, ...loaded };
      console.log('[RISK] Loaded risk state');
    }
  } catch (err) {
    console.warn('[RISK] Could not load risk state:', err.message);
  }
}

// Save risk state
function saveRiskState() {
  try {
    const dir = path.dirname(RISK_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    riskState.lastUpdate = Date.now();
    fs.writeFileSync(RISK_STATE_FILE, JSON.stringify(riskState, null, 2));
  } catch (err) {
    console.warn('[RISK] Could not save risk state:', err.message);
  }
}

/**
 * Calculate Kelly Criterion optimal position size
 * @param {number} winRate - Historical win rate (0-1)
 * @param {number} avgWin - Average winning trade return
 * @param {number} avgLoss - Average losing trade return (absolute)
 * @returns {number} Optimal position size as fraction of capital
 */
function calculateKellySize(winRate, avgWin, avgLoss) {
  if (avgLoss === 0) return 0;

  // Kelly formula: f* = (p * b - q) / b
  // where p = win probability, q = loss probability, b = win/loss ratio
  const p = winRate;
  const q = 1 - winRate;
  const b = avgWin / avgLoss;

  const kellyFraction = (p * b - q) / b;

  // Apply conservative fraction (quarter Kelly)
  const conservativeKelly = kellyFraction * config.kellyFraction;

  // Cap at max risk per trade
  return Math.max(0, Math.min(conservativeKelly, config.maxRiskPerTrade / 100));
}

/**
 * Calculate optimal position size based on multiple factors
 * @param {Object} params - Position sizing parameters
 * @returns {Object} Position sizing recommendation
 */
function calculatePositionSize(params) {
  const {
    accountBalance,
    entryPrice,
    stopLossPrice,
    confidence = 0.6,
    signal = {},
    historicalStats = {},
    currentVolatility = null
  } = params;

  // Check if trading is allowed
  const tradingAllowed = checkTradingAllowed();
  if (!tradingAllowed.allowed) {
    return {
      allowed: false,
      reason: tradingAllowed.reason,
      positionSize: 0,
      quantity: 0
    };
  }

  // Base risk calculation
  const direction = signal.direction || 'long';
  let riskPercent = config.maxRiskPerTrade;

  // 1. Kelly Criterion adjustment
  if (historicalStats.winRate && historicalStats.avgWin && historicalStats.avgLoss) {
    const kellySize = calculateKellySize(
      historicalStats.winRate,
      historicalStats.avgWin,
      historicalStats.avgLoss
    );
    riskPercent = Math.min(riskPercent, kellySize * 100);
  }

  // 2. Confidence-based adjustment
  // Higher confidence = closer to full position
  const confidenceMultiplier = 0.5 + (confidence * 0.5); // Range: 0.5 - 1.0
  riskPercent *= confidenceMultiplier;

  // 3. Volatility adjustment
  if (config.volatilityAdjustment && currentVolatility) {
    // Reduce size in high volatility
    const avgVolatility = 2; // Baseline 2% ATR
    const volatilityRatio = avgVolatility / Math.max(currentVolatility, 0.5);
    riskPercent *= Math.min(volatilityRatio, 1.5); // Cap boost at 1.5x
  }

  // 4. Drawdown-based adjustment
  if (riskState.currentDrawdown > 5) {
    const drawdownMultiplier = 1 - (riskState.currentDrawdown / config.maxDrawdown);
    riskPercent *= Math.max(drawdownMultiplier, 0.25);
  }

  // 5. Consecutive losses adjustment
  if (riskState.consecutiveLosses >= 3) {
    const lossMultiplier = 1 - (riskState.consecutiveLosses * 0.1);
    riskPercent *= Math.max(lossMultiplier, 0.3);
  }

  // 6. Consecutive wins bonus (limited)
  if (riskState.consecutiveWins >= 3 && riskState.consecutiveLosses === 0) {
    const winBonus = Math.min(riskState.consecutiveWins * 0.05, 0.2);
    riskPercent *= (1 + winBonus);
  }

  // 7. Apply global risk multiplier
  riskPercent *= riskState.riskMultiplier;

  // Calculate position size
  const riskAmount = accountBalance * (riskPercent / 100);
  const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
  const riskPerUnit = stopLossDistance / entryPrice;

  const positionValue = riskAmount / riskPerUnit;
  const quantity = positionValue / entryPrice;

  // Final checks
  const maxPositionValue = accountBalance * 0.25; // Never more than 25% of account
  const finalPositionValue = Math.min(positionValue, maxPositionValue);
  const finalQuantity = finalPositionValue / entryPrice;

  return {
    allowed: true,
    riskPercent: round(riskPercent, 2),
    riskAmount: round(riskAmount, 2),
    positionValue: round(finalPositionValue, 2),
    quantity: round(finalQuantity, 6),
    leverage: calculateSafeLeverage(finalPositionValue, accountBalance, stopLossDistance / entryPrice),
    adjustments: {
      confidence: round(confidenceMultiplier, 2),
      volatility: currentVolatility ? round(avgVolatility / Math.max(currentVolatility, 0.5), 2) : 1,
      drawdown: round(1 - (riskState.currentDrawdown / config.maxDrawdown), 2),
      consecutiveLosses: riskState.consecutiveLosses,
      consecutiveWins: riskState.consecutiveWins
    }
  };
}

/**
 * Calculate safe leverage based on position and stop loss
 */
function calculateSafeLeverage(positionValue, accountBalance, stopLossPercent) {
  // Max loss should be within risk tolerance
  const maxAcceptableLoss = accountBalance * (config.maxRiskPerTrade / 100);
  const potentialLoss = positionValue * stopLossPercent;

  if (potentialLoss <= 0) return 1;

  const safeLeverage = maxAcceptableLoss / potentialLoss;

  // Cap leverage
  return Math.min(Math.max(1, Math.floor(safeLeverage)), 20);
}

/**
 * Check if trading is currently allowed based on risk limits
 */
function checkTradingAllowed() {
  // Daily loss limit
  if (Math.abs(riskState.dailyPnL) >= config.maxDailyLoss) {
    riskState.dailyLossLimit = true;
    return { allowed: false, reason: 'Daily loss limit reached' };
  }

  // Weekly loss limit
  if (Math.abs(riskState.weeklyPnL) >= config.maxWeeklyLoss) {
    riskState.weeklyLossLimit = true;
    return { allowed: false, reason: 'Weekly loss limit reached' };
  }

  // Max drawdown
  if (riskState.currentDrawdown >= config.maxDrawdown) {
    return { allowed: false, reason: `Max drawdown (${config.maxDrawdown}%) reached - trading paused` };
  }

  // Daily trade limit
  if (riskState.todayTrades >= config.maxDailyTrades) {
    return { allowed: false, reason: 'Daily trade limit reached' };
  }

  // Minimum time between trades
  if (riskState.lastTradeTime) {
    const timeSinceLastTrade = Date.now() - riskState.lastTradeTime;
    if (timeSinceLastTrade < config.minTimeBetweenTrades) {
      return { allowed: false, reason: 'Minimum time between trades not met' };
    }
  }

  // Consecutive loss cooldown
  if (riskState.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { allowed: false, reason: `${config.maxConsecutiveLosses} consecutive losses - cooldown period` };
  }

  return { allowed: true };
}

/**
 * Record a completed trade and update risk state
 */
function recordTrade(trade) {
  const { pnl, pnlPercent, result, symbol, direction } = trade;

  // Update P&L tracking
  riskState.dailyPnL += pnlPercent;
  riskState.weeklyPnL += pnlPercent;
  riskState.monthlyPnL += pnlPercent;

  // Update streak tracking
  if (result === 'win' || pnl > 0) {
    riskState.consecutiveWins++;
    riskState.consecutiveLosses = 0;
  } else if (result === 'loss' || pnl < 0) {
    riskState.consecutiveLosses++;
    riskState.consecutiveWins = 0;
  }

  // Update trade count and time
  riskState.todayTrades++;
  riskState.lastTradeTime = Date.now();

  // Update equity and drawdown tracking
  const currentEquity = trade.accountBalance || riskState.peakEquity;
  if (currentEquity > riskState.peakEquity) {
    riskState.peakEquity = currentEquity;
  }
  riskState.currentDrawdown = ((riskState.peakEquity - currentEquity) / riskState.peakEquity) * 100;

  // Add to trade history
  riskState.tradeHistory.push({
    timestamp: Date.now(),
    symbol,
    direction,
    pnl,
    pnlPercent,
    result
  });

  // Keep only last 100 trades
  if (riskState.tradeHistory.length > 100) {
    riskState.tradeHistory = riskState.tradeHistory.slice(-100);
  }

  // Save state
  saveRiskState();

  return getRiskStatus();
}

/**
 * Get current risk status and recommendations
 */
function getRiskStatus() {
  const tradingAllowed = checkTradingAllowed();

  // Calculate historical stats from trade history
  const recentTrades = riskState.tradeHistory.slice(-50);
  const wins = recentTrades.filter(t => t.pnl > 0);
  const losses = recentTrades.filter(t => t.pnl < 0);

  const winRate = recentTrades.length > 0 ? wins.length / recentTrades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0)) / losses.length : 0;

  // Calculate Kelly criterion for reference
  const kellyOptimal = calculateKellySize(winRate, avgWin, avgLoss) * 100;

  // Determine risk level
  let riskLevel = 'NORMAL';
  if (riskState.currentDrawdown > config.maxDrawdown * 0.7) riskLevel = 'HIGH';
  if (riskState.currentDrawdown > config.maxDrawdown * 0.9) riskLevel = 'CRITICAL';
  if (riskState.consecutiveLosses >= 3) riskLevel = 'ELEVATED';
  if (!tradingAllowed.allowed) riskLevel = 'STOPPED';

  return {
    tradingAllowed: tradingAllowed.allowed,
    reason: tradingAllowed.reason,
    riskLevel,
    currentState: {
      dailyPnL: round(riskState.dailyPnL, 2),
      weeklyPnL: round(riskState.weeklyPnL, 2),
      monthlyPnL: round(riskState.monthlyPnL, 2),
      currentDrawdown: round(riskState.currentDrawdown, 2),
      consecutiveLosses: riskState.consecutiveLosses,
      consecutiveWins: riskState.consecutiveWins,
      todayTrades: riskState.todayTrades,
      riskMultiplier: riskState.riskMultiplier
    },
    limits: {
      dailyLossLimit: config.maxDailyLoss,
      weeklyLossLimit: config.maxWeeklyLoss,
      maxDrawdown: config.maxDrawdown,
      maxDailyTrades: config.maxDailyTrades,
      remainingDailyLoss: round(config.maxDailyLoss - Math.abs(riskState.dailyPnL), 2),
      remainingTrades: config.maxDailyTrades - riskState.todayTrades
    },
    stats: {
      winRate: round(winRate * 100, 1),
      avgWin: round(avgWin, 2),
      avgLoss: round(avgLoss, 2),
      kellyOptimal: round(kellyOptimal, 2),
      recentTrades: recentTrades.length
    },
    recommendations: generateRiskRecommendations(riskLevel, riskState)
  };
}

/**
 * Generate risk-based recommendations
 */
function generateRiskRecommendations(riskLevel, state) {
  const recommendations = [];

  if (state.consecutiveLosses >= 2) {
    recommendations.push({
      type: 'WARNING',
      message: `${state.consecutiveLosses} consecutive losses - consider reducing position size`
    });
  }

  if (state.currentDrawdown > 5) {
    recommendations.push({
      type: 'CAUTION',
      message: `In ${state.currentDrawdown.toFixed(1)}% drawdown - position sizes reduced`
    });
  }

  if (state.dailyPnL < -3) {
    recommendations.push({
      type: 'WARNING',
      message: 'Down more than 3% today - consider stopping for the day'
    });
  }

  if (riskLevel === 'CRITICAL') {
    recommendations.push({
      type: 'ALERT',
      message: 'Critical risk level - manual review recommended before trading'
    });
  }

  if (state.consecutiveWins >= 5) {
    recommendations.push({
      type: 'INFO',
      message: 'Strong winning streak - avoid overconfidence, maintain discipline'
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      type: 'OK',
      message: 'Risk levels normal - trading parameters optimal'
    });
  }

  return recommendations;
}

/**
 * Calculate Value at Risk (VaR)
 * @param {number} portfolioValue - Total portfolio value
 * @param {number} confidenceLevel - e.g., 0.95 for 95% VaR
 * @param {Array} returns - Historical returns array
 * @returns {Object} VaR metrics
 */
function calculateVaR(portfolioValue, confidenceLevel = 0.95, returns = []) {
  if (returns.length < 20) {
    return { var: 0, cvar: 0, insufficient: true };
  }

  // Sort returns ascending
  const sortedReturns = [...returns].sort((a, b) => a - b);

  // VaR is the percentile loss
  const varIndex = Math.floor((1 - confidenceLevel) * returns.length);
  const var95 = -sortedReturns[varIndex];

  // CVaR (Conditional VaR) - average of losses beyond VaR
  const tailReturns = sortedReturns.slice(0, varIndex);
  const cvar = tailReturns.length > 0
    ? -tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
    : var95;

  return {
    var: round(var95 * portfolioValue, 2),
    varPercent: round(var95 * 100, 2),
    cvar: round(cvar * portfolioValue, 2),
    cvarPercent: round(cvar * 100, 2),
    confidenceLevel: confidenceLevel * 100
  };
}

/**
 * Check correlation between positions
 */
function checkCorrelation(positions, newSymbol) {
  // Group symbols by asset class/correlation group
  const correlationGroups = {
    btc: ['BTCUSDT', 'BTCUSDC'],
    eth: ['ETHUSDT', 'ETHUSDC'],
    majors: ['BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT'],
    memes: ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FARTCOINUSDT', 'BONKUSDT'],
    defi: ['UNIUSDT', 'AAVEUSDT', 'LINKUSDT']
  };

  // Find which group the new symbol belongs to
  let newSymbolGroup = null;
  for (const [group, symbols] of Object.entries(correlationGroups)) {
    if (symbols.includes(newSymbol)) {
      newSymbolGroup = group;
      break;
    }
  }

  if (!newSymbolGroup) return { allowed: true, correlation: 'low' };

  // Count existing positions in same group
  const sameGroupPositions = positions.filter(p => {
    return correlationGroups[newSymbolGroup]?.includes(p.symbol);
  });

  if (sameGroupPositions.length >= config.maxCorrelatedPositions) {
    return {
      allowed: false,
      correlation: 'high',
      reason: `Already have ${sameGroupPositions.length} correlated positions in ${newSymbolGroup} group`
    };
  }

  return {
    allowed: true,
    correlation: sameGroupPositions.length > 0 ? 'medium' : 'low',
    existingInGroup: sameGroupPositions.length
  };
}

/**
 * Update risk configuration
 */
function updateConfig(newConfig) {
  config = { ...config, ...newConfig };
  console.log('[RISK] Configuration updated');
  return config;
}

/**
 * Reset daily/weekly limits (for manual override)
 */
function resetLimits(type = 'daily') {
  if (type === 'daily' || type === 'all') {
    riskState.dailyPnL = 0;
    riskState.todayTrades = 0;
    riskState.dailyLossLimit = false;
  }

  if (type === 'weekly' || type === 'all') {
    riskState.weeklyPnL = 0;
    riskState.weeklyLossLimit = false;
  }

  if (type === 'all') {
    riskState.consecutiveLosses = 0;
    riskState.consecutiveWins = 0;
    riskState.riskMultiplier = 1.0;
  }

  saveRiskState();
  return getRiskStatus();
}

/**
 * Set risk multiplier for scaling all positions
 */
function setRiskMultiplier(multiplier) {
  riskState.riskMultiplier = Math.max(0.1, Math.min(2.0, multiplier));
  saveRiskState();
  return riskState.riskMultiplier;
}

// Helper functions
function round(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Initialize on load
loadRiskState();

module.exports = {
  calculateKellySize,
  calculatePositionSize,
  checkTradingAllowed,
  recordTrade,
  getRiskStatus,
  calculateVaR,
  checkCorrelation,
  updateConfig,
  resetLimits,
  setRiskMultiplier
};
