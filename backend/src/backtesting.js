/**
 * Comprehensive Backtesting Framework
 * Test trading strategies on historical data with detailed performance metrics
 */

const fs = require('fs');
const path = require('path');

const BACKTEST_RESULTS_DIR = path.join(__dirname, '../data/backtests');

/**
 * Run a complete backtest on historical data
 * @param {Array} historicalCandles - Array of OHLCV candles
 * @param {Object} strategy - Strategy configuration
 * @param {Object} options - Backtest options
 * @returns {Object} Comprehensive backtest results
 */
async function runBacktest(historicalCandles, strategy, options = {}) {
  const {
    initialCapital = 10000,
    positionSize = 0.1, // 10% of capital per trade
    maxOpenPositions = 3,
    commission = 0.001, // 0.1% per trade
    slippage = 0.0005, // 0.05% slippage
    leverage = 1,
    stopLossPercent = 2,
    takeProfitPercent = 4,
    startIndex = 100, // Need history for indicators
    endIndex = null
  } = options;

  if (!historicalCandles || historicalCandles.length < startIndex + 50) {
    return { error: 'Insufficient historical data' };
  }

  const endIdx = endIndex || historicalCandles.length;
  const trades = [];
  const equity = [initialCapital];
  let capital = initialCapital;
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  const openPositions = [];

  // Trade statistics
  const stats = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakEvenTrades: 0,
    longTrades: 0,
    shortTrades: 0,
    winningLongs: 0,
    winningShorts: 0,
    totalProfit: 0,
    totalLoss: 0,
    largestWin: 0,
    largestLoss: 0,
    consecutiveWins: 0,
    consecutiveLosses: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    totalCommissions: 0,
    avgHoldingPeriod: 0
  };

  const dailyReturns = [];
  let lastDayClose = initialCapital;

  // Process each candle
  for (let i = startIndex; i < endIdx; i++) {
    const currentCandle = historicalCandles[i];
    const lookbackCandles = historicalCandles.slice(Math.max(0, i - 200), i + 1);

    // Check for stop loss / take profit on open positions
    for (let j = openPositions.length - 1; j >= 0; j--) {
      const position = openPositions[j];
      const closeResult = checkPositionClose(position, currentCandle);

      if (closeResult.closed) {
        // Calculate P&L
        const pnl = calculatePnL(position, closeResult.closePrice, commission, leverage);
        capital += pnl.netPnL;

        // Record trade
        const trade = {
          ...position,
          closeTime: currentCandle.openTime,
          closePrice: closeResult.closePrice,
          closeReason: closeResult.reason,
          pnl: pnl.grossPnL,
          netPnL: pnl.netPnL,
          commission: pnl.commission,
          returnPercent: (pnl.netPnL / position.capital) * 100,
          holdingPeriod: i - position.entryIndex
        };
        trades.push(trade);

        // Update stats
        updateTradeStats(stats, trade);

        // Remove from open positions
        openPositions.splice(j, 1);
      }
    }

    // Generate signal from strategy
    const signal = await generateSignal(strategy, lookbackCandles);

    // Execute new trades if signal and capacity available
    if (signal && signal.action !== 'HOLD' && openPositions.length < maxOpenPositions) {
      const tradeCapital = capital * positionSize;

      if (tradeCapital >= 10) { // Minimum trade size
        const entryPrice = currentCandle.close * (1 + (signal.action.includes('LONG') ? slippage : -slippage));

        const position = {
          id: trades.length + openPositions.length + 1,
          direction: signal.action.includes('LONG') ? 'long' : 'short',
          entryTime: currentCandle.openTime,
          entryPrice,
          entryIndex: i,
          capital: tradeCapital,
          quantity: (tradeCapital * leverage) / entryPrice,
          stopLoss: signal.action.includes('LONG')
            ? entryPrice * (1 - stopLossPercent / 100)
            : entryPrice * (1 + stopLossPercent / 100),
          takeProfit: signal.action.includes('LONG')
            ? entryPrice * (1 + takeProfitPercent / 100)
            : entryPrice * (1 - takeProfitPercent / 100),
          signal: signal.signal,
          confidence: signal.confidence
        };

        openPositions.push(position);
        stats.totalCommissions += tradeCapital * commission;

        if (position.direction === 'long') stats.longTrades++;
        else stats.shortTrades++;
      }
    }

    // Track equity
    let openPnL = 0;
    for (const position of openPositions) {
      const unrealizedPnL = calculateUnrealizedPnL(position, currentCandle.close, leverage);
      openPnL += unrealizedPnL;
    }

    const currentEquity = capital + openPnL;
    equity.push(currentEquity);

    // Track drawdown
    if (currentEquity > peakCapital) {
      peakCapital = currentEquity;
    }
    currentDrawdown = (peakCapital - currentEquity) / peakCapital * 100;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }

    // Track daily returns (assuming each candle is a period)
    if (i % 24 === 0) { // Approximate daily
      const dailyReturn = (currentEquity - lastDayClose) / lastDayClose;
      dailyReturns.push(dailyReturn);
      lastDayClose = currentEquity;
    }
  }

  // Close any remaining open positions at end
  for (const position of openPositions) {
    const lastCandle = historicalCandles[endIdx - 1];
    const pnl = calculatePnL(position, lastCandle.close, commission, leverage);
    capital += pnl.netPnL;

    trades.push({
      ...position,
      closeTime: lastCandle.openTime,
      closePrice: lastCandle.close,
      closeReason: 'END_OF_BACKTEST',
      pnl: pnl.grossPnL,
      netPnL: pnl.netPnL,
      returnPercent: (pnl.netPnL / position.capital) * 100
    });

    updateTradeStats(stats, trades.at(-1));
  }

  // Calculate final metrics
  const finalEquity = capital;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;
  const avgTradeReturn = stats.totalTrades > 0
    ? trades.reduce((sum, t) => sum + t.returnPercent, 0) / stats.totalTrades
    : 0;

  // Calculate advanced metrics
  const metrics = calculateAdvancedMetrics(trades, equity, dailyReturns, initialCapital);

  const result = {
    summary: {
      initialCapital,
      finalEquity: round(finalEquity, 2),
      totalReturn: round(totalReturn, 2),
      maxDrawdown: round(maxDrawdown, 2),
      totalTrades: stats.totalTrades,
      winRate: stats.totalTrades > 0
        ? round((stats.winningTrades / stats.totalTrades) * 100, 2)
        : 0,
      profitFactor: stats.totalLoss > 0
        ? round(stats.totalProfit / Math.abs(stats.totalLoss), 2)
        : stats.totalProfit > 0 ? Infinity : 0,
      avgTradeReturn: round(avgTradeReturn, 2),
      sharpeRatio: metrics.sharpeRatio,
      sortinoRatio: metrics.sortinoRatio,
      calmarRatio: metrics.calmarRatio
    },
    stats: {
      ...stats,
      winRate: stats.totalTrades > 0
        ? round((stats.winningTrades / stats.totalTrades) * 100, 2)
        : 0,
      avgWin: stats.winningTrades > 0
        ? round(stats.totalProfit / stats.winningTrades, 2)
        : 0,
      avgLoss: stats.losingTrades > 0
        ? round(stats.totalLoss / stats.losingTrades, 2)
        : 0,
      expectancy: calculateExpectancy(stats),
      longWinRate: stats.longTrades > 0
        ? round((stats.winningLongs / stats.longTrades) * 100, 2)
        : 0,
      shortWinRate: stats.shortTrades > 0
        ? round((stats.winningShorts / stats.shortTrades) * 100, 2)
        : 0
    },
    metrics,
    trades: trades.slice(-100), // Last 100 trades for review
    equity: equity.filter((_, i) => i % 10 === 0), // Sampled equity curve
    settings: {
      positionSize,
      maxOpenPositions,
      commission,
      slippage,
      leverage,
      stopLossPercent,
      takeProfitPercent,
      candlesProcessed: endIdx - startIndex
    },
    timestamp: Date.now()
  };

  // Save results
  saveBacktestResults(result, strategy.name);

  return result;
}

/**
 * Generate signal from strategy
 */
async function generateSignal(strategy, candles) {
  // Import dynamically to avoid circular dependencies
  try {
    const { calculateIndicators } = require('./indicators');
    const { predictNextMove } = require('./ai');

    const indicators = calculateIndicators(candles);
    if (!indicators) return null;

    const prediction = predictNextMove(indicators);

    return {
      action: prediction.signal,
      confidence: prediction.confidence,
      signal: prediction.signal,
      direction: prediction.direction
    };
  } catch (err) {
    return null;
  }
}

/**
 * Check if position should be closed
 */
function checkPositionClose(position, candle) {
  const { direction, stopLoss, takeProfit } = position;

  if (direction === 'long') {
    // Check stop loss
    if (candle.low <= stopLoss) {
      return { closed: true, closePrice: stopLoss, reason: 'STOP_LOSS' };
    }
    // Check take profit
    if (candle.high >= takeProfit) {
      return { closed: true, closePrice: takeProfit, reason: 'TAKE_PROFIT' };
    }
  } else {
    // Short position
    if (candle.high >= stopLoss) {
      return { closed: true, closePrice: stopLoss, reason: 'STOP_LOSS' };
    }
    if (candle.low <= takeProfit) {
      return { closed: true, closePrice: takeProfit, reason: 'TAKE_PROFIT' };
    }
  }

  return { closed: false };
}

/**
 * Calculate P&L for a closed position
 */
function calculatePnL(position, closePrice, commission, leverage) {
  const { direction, entryPrice, capital } = position;
  const quantity = (capital * leverage) / entryPrice;

  let grossPnL;
  if (direction === 'long') {
    grossPnL = (closePrice - entryPrice) * quantity;
  } else {
    grossPnL = (entryPrice - closePrice) * quantity;
  }

  const commissionCost = capital * commission * 2; // Entry and exit
  const netPnL = grossPnL - commissionCost;

  return {
    grossPnL: round(grossPnL, 2),
    netPnL: round(netPnL, 2),
    commission: round(commissionCost, 2)
  };
}

/**
 * Calculate unrealized P&L for open position
 */
function calculateUnrealizedPnL(position, currentPrice, leverage) {
  const { direction, entryPrice, capital } = position;
  const quantity = (capital * leverage) / entryPrice;

  if (direction === 'long') {
    return (currentPrice - entryPrice) * quantity;
  } else {
    return (entryPrice - currentPrice) * quantity;
  }
}

/**
 * Update trade statistics
 */
function updateTradeStats(stats, trade) {
  stats.totalTrades++;
  stats.avgHoldingPeriod = (stats.avgHoldingPeriod * (stats.totalTrades - 1) + (trade.holdingPeriod || 0)) / stats.totalTrades;

  if (trade.netPnL > 0) {
    stats.winningTrades++;
    stats.totalProfit += trade.netPnL;
    stats.consecutiveWins++;
    stats.consecutiveLosses = 0;

    if (trade.netPnL > stats.largestWin) stats.largestWin = trade.netPnL;
    if (stats.consecutiveWins > stats.maxConsecutiveWins) {
      stats.maxConsecutiveWins = stats.consecutiveWins;
    }

    if (trade.direction === 'long') stats.winningLongs++;
    else stats.winningShorts++;

  } else if (trade.netPnL < 0) {
    stats.losingTrades++;
    stats.totalLoss += trade.netPnL;
    stats.consecutiveLosses++;
    stats.consecutiveWins = 0;

    if (trade.netPnL < stats.largestLoss) stats.largestLoss = trade.netPnL;
    if (stats.consecutiveLosses > stats.maxConsecutiveLosses) {
      stats.maxConsecutiveLosses = stats.consecutiveLosses;
    }
  } else {
    stats.breakEvenTrades++;
  }
}

/**
 * Calculate expectancy
 */
function calculateExpectancy(stats) {
  if (stats.totalTrades === 0) return 0;

  const winRate = stats.winningTrades / stats.totalTrades;
  const avgWin = stats.winningTrades > 0 ? stats.totalProfit / stats.winningTrades : 0;
  const avgLoss = stats.losingTrades > 0 ? Math.abs(stats.totalLoss) / stats.losingTrades : 0;

  return round((winRate * avgWin) - ((1 - winRate) * avgLoss), 2);
}

/**
 * Calculate advanced metrics
 */
function calculateAdvancedMetrics(trades, equity, dailyReturns, initialCapital) {
  // Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
  const avgReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    : 0;
  const stdDev = calculateStdDev(dailyReturns);
  const sharpeRatio = stdDev > 0 ? round((avgReturn / stdDev) * Math.sqrt(365), 2) : 0;

  // Sortino Ratio (downside deviation only)
  const negativeReturns = dailyReturns.filter(r => r < 0);
  const downsideStdDev = calculateStdDev(negativeReturns);
  const sortinoRatio = downsideStdDev > 0 ? round((avgReturn / downsideStdDev) * Math.sqrt(365), 2) : 0;

  // Max Drawdown
  let maxDrawdown = 0;
  let peak = equity[0];
  let drawdownStart = 0;
  let drawdownEnd = 0;
  let longestDrawdown = 0;
  let currentDrawdownLength = 0;

  for (let i = 1; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      currentDrawdownLength = 0;
    } else {
      currentDrawdownLength++;
      const drawdown = (peak - equity[i]) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        drawdownEnd = i;
      }
      if (currentDrawdownLength > longestDrawdown) {
        longestDrawdown = currentDrawdownLength;
      }
    }
  }

  // Calmar Ratio (annual return / max drawdown)
  const totalReturn = (equity.at(-1) - initialCapital) / initialCapital;
  const calmarRatio = maxDrawdown > 0 ? round(totalReturn / maxDrawdown, 2) : 0;

  // Win/Loss streaks analysis
  let currentStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  for (const trade of trades) {
    if (trade.netPnL > 0) {
      if (currentStreak >= 0) currentStreak++;
      else currentStreak = 1;
      if (currentStreak > maxWinStreak) maxWinStreak = currentStreak;
    } else if (trade.netPnL < 0) {
      if (currentStreak <= 0) currentStreak--;
      else currentStreak = -1;
      if (Math.abs(currentStreak) > maxLossStreak) maxLossStreak = Math.abs(currentStreak);
    }
  }

  // Recovery factor
  const totalProfit = equity.at(-1) - initialCapital;
  const maxDrawdownAbs = maxDrawdown * initialCapital;
  const recoveryFactor = maxDrawdownAbs > 0 ? round(totalProfit / maxDrawdownAbs, 2) : 0;

  // Risk of Ruin (simplified)
  const winRate = trades.filter(t => t.netPnL > 0).length / trades.length || 0;
  const avgWin = trades.filter(t => t.netPnL > 0).reduce((s, t) => s + t.netPnL, 0) /
                 trades.filter(t => t.netPnL > 0).length || 0;
  const avgLoss = Math.abs(trades.filter(t => t.netPnL < 0).reduce((s, t) => s + t.netPnL, 0)) /
                  trades.filter(t => t.netPnL < 0).length || 1;
  const riskOfRuin = avgLoss > 0 ? Math.pow((1 - winRate) / winRate, avgWin / avgLoss) : 0;

  return {
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown: round(maxDrawdown * 100, 2),
    maxDrawdownDuration: longestDrawdown,
    recoveryFactor,
    riskOfRuin: round(Math.min(riskOfRuin * 100, 100), 2),
    maxWinStreak,
    maxLossStreak,
    volatility: round(stdDev * Math.sqrt(365) * 100, 2),
    averageDailyReturn: round(avgReturn * 100, 4)
  };
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Save backtest results to file
 */
function saveBacktestResults(results, strategyName) {
  try {
    if (!fs.existsSync(BACKTEST_RESULTS_DIR)) {
      fs.mkdirSync(BACKTEST_RESULTS_DIR, { recursive: true });
    }

    const filename = `backtest_${strategyName || 'default'}_${Date.now()}.json`;
    const filepath = path.join(BACKTEST_RESULTS_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
    console.log(`[BACKTEST] Results saved to ${filename}`);
  } catch (err) {
    console.warn('[BACKTEST] Could not save results:', err.message);
  }
}

/**
 * Load historical backtest results
 */
function loadBacktestHistory() {
  const results = [];

  try {
    if (!fs.existsSync(BACKTEST_RESULTS_DIR)) return results;

    const files = fs.readdirSync(BACKTEST_RESULTS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .slice(-20); // Last 20 backtests

    for (const file of files) {
      const data = fs.readFileSync(path.join(BACKTEST_RESULTS_DIR, file), 'utf-8');
      const result = JSON.parse(data);
      results.push({
        filename: file,
        summary: result.summary,
        timestamp: result.timestamp
      });
    }
  } catch (err) {
    console.warn('[BACKTEST] Could not load history:', err.message);
  }

  return results;
}

/**
 * Run Walk-Forward Optimization
 * Tests strategy on rolling out-of-sample periods
 */
async function runWalkForward(historicalCandles, strategy, options = {}) {
  const {
    trainPeriod = 500, // Candles for training
    testPeriod = 100,  // Candles for testing
    step = 50          // Step forward between tests
  } = options;

  const results = [];
  const totalCandles = historicalCandles.length;

  for (let start = 0; start + trainPeriod + testPeriod <= totalCandles; start += step) {
    const trainStart = start;
    const trainEnd = start + trainPeriod;
    const testStart = trainEnd;
    const testEnd = testStart + testPeriod;

    // Run backtest on test period
    const testCandles = historicalCandles.slice(trainStart, testEnd);

    const result = await runBacktest(testCandles, strategy, {
      ...options,
      startIndex: trainPeriod
    });

    if (result && !result.error) {
      results.push({
        period: { trainStart, trainEnd, testStart, testEnd },
        summary: result.summary
      });
    }
  }

  // Aggregate results
  const aggregated = aggregateWalkForwardResults(results);

  return {
    periods: results.length,
    results,
    aggregated
  };
}

/**
 * Aggregate walk-forward results
 */
function aggregateWalkForwardResults(results) {
  if (results.length === 0) return null;

  const returns = results.map(r => r.summary.totalReturn);
  const winRates = results.map(r => r.summary.winRate);
  const drawdowns = results.map(r => r.summary.maxDrawdown);

  return {
    avgReturn: round(returns.reduce((a, b) => a + b, 0) / returns.length, 2),
    minReturn: round(Math.min(...returns), 2),
    maxReturn: round(Math.max(...returns), 2),
    avgWinRate: round(winRates.reduce((a, b) => a + b, 0) / winRates.length, 2),
    avgDrawdown: round(drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length, 2),
    maxDrawdown: round(Math.max(...drawdowns), 2),
    consistency: round((returns.filter(r => r > 0).length / returns.length) * 100, 2)
  };
}

/**
 * Monte Carlo Simulation
 * Simulate possible outcomes by shuffling trade order
 */
function runMonteCarloSimulation(trades, initialCapital = 10000, simulations = 1000) {
  const results = [];

  for (let sim = 0; sim < simulations; sim++) {
    // Shuffle trades randomly
    const shuffledTrades = [...trades].sort(() => Math.random() - 0.5);

    let capital = initialCapital;
    let peak = initialCapital;
    let maxDrawdown = 0;

    for (const trade of shuffledTrades) {
      capital += trade.netPnL;

      if (capital > peak) peak = capital;
      const drawdown = (peak - capital) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    results.push({
      finalCapital: capital,
      totalReturn: ((capital - initialCapital) / initialCapital) * 100,
      maxDrawdown: maxDrawdown * 100
    });
  }

  // Calculate percentiles
  const sortedReturns = results.map(r => r.totalReturn).sort((a, b) => a - b);
  const sortedDrawdowns = results.map(r => r.maxDrawdown).sort((a, b) => a - b);

  return {
    simulations,
    returns: {
      median: round(sortedReturns[Math.floor(simulations * 0.5)], 2),
      p5: round(sortedReturns[Math.floor(simulations * 0.05)], 2),
      p25: round(sortedReturns[Math.floor(simulations * 0.25)], 2),
      p75: round(sortedReturns[Math.floor(simulations * 0.75)], 2),
      p95: round(sortedReturns[Math.floor(simulations * 0.95)], 2),
      worst: round(sortedReturns[0], 2),
      best: round(sortedReturns.at(-1), 2)
    },
    drawdowns: {
      median: round(sortedDrawdowns[Math.floor(simulations * 0.5)], 2),
      p5: round(sortedDrawdowns[Math.floor(simulations * 0.05)], 2),
      p95: round(sortedDrawdowns[Math.floor(simulations * 0.95)], 2),
      worst: round(sortedDrawdowns.at(-1), 2)
    },
    probabilityOfProfit: round((results.filter(r => r.totalReturn > 0).length / simulations) * 100, 2),
    probabilityOfDrawdownOver20: round((results.filter(r => r.maxDrawdown > 20).length / simulations) * 100, 2)
  };
}

function round(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  runBacktest,
  loadBacktestHistory,
  runWalkForward,
  runMonteCarloSimulation
};
