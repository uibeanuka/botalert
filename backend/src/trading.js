const axios = require('axios');
const crypto = require('crypto');
const { recordPattern, getStats: getPatternStats } = require('./patternMemory');

const API_BASE = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

// Trading configuration
const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';
const RISK_PER_TRADE = Number(process.env.RISK_PER_TRADE || 5) / 100; // 5% default
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 65) / 100; // 65% default
const MAX_OPEN_POSITIONS = Number(process.env.MAX_OPEN_POSITIONS || 5);
const MAX_DAILY_TRADES = Number(process.env.MAX_DAILY_TRADES || 20);
const LEVERAGE = Number(process.env.LEVERAGE || 10);

// Mutable runtime settings (can be changed via chat)
const runtimeSettings = {
  riskPerTrade: RISK_PER_TRADE,
  minConfidence: MIN_CONFIDENCE,
  maxOpenPositions: MAX_OPEN_POSITIONS,
  maxDailyTrades: MAX_DAILY_TRADES,
  leverage: LEVERAGE,
};

function updateSettings(updates) {
  if (updates.riskPerTrade !== undefined) {
    runtimeSettings.riskPerTrade = Math.max(0.01, Math.min(0.20, updates.riskPerTrade));
  }
  if (updates.minConfidence !== undefined) {
    runtimeSettings.minConfidence = Math.max(0.50, Math.min(0.95, updates.minConfidence));
  }
  if (updates.maxOpenPositions !== undefined) {
    runtimeSettings.maxOpenPositions = Math.max(1, Math.min(20, Math.floor(updates.maxOpenPositions)));
  }
  if (updates.maxDailyTrades !== undefined) {
    runtimeSettings.maxDailyTrades = Math.max(1, Math.min(100, Math.floor(updates.maxDailyTrades)));
  }
  if (updates.leverage !== undefined) {
    runtimeSettings.leverage = Math.max(1, Math.min(125, Math.floor(updates.leverage)));
  }
  return { ...runtimeSettings };
}

// State tracking
const openPositions = new Map(); // symbol -> position info
const dailyTrades = { count: 0, date: new Date().toDateString() };
const tradeHistory = [];

function sign(queryString) {
  return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

function buildClient() {
  return axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
      'X-MBX-APIKEY': API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

async function getAccountBalance() {
  if (!API_KEY || !API_SECRET) return null;

  const client = buildClient();
  const timestamp = Date.now();
  const params = `timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    const res = await client.get(`/fapi/v2/balance?${params}&signature=${signature}`);
    const usdtBalance = res.data.find(b => b.asset === 'USDT');
    return usdtBalance ? Number(usdtBalance.availableBalance) : 0;
  } catch (err) {
    console.error('Failed to get balance:', err.message);
    return null;
  }
}

async function getOpenPositions() {
  if (!API_KEY || !API_SECRET) return [];

  const client = buildClient();
  const timestamp = Date.now();
  const params = `timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    const res = await client.get(`/fapi/v2/positionRisk?${params}&signature=${signature}`);
    return res.data.filter(p => Number(p.positionAmt) !== 0);
  } catch (err) {
    console.error('Failed to get positions:', err.message);
    return [];
  }
}

async function setLeverage(symbol, leverage) {
  if (!API_KEY || !API_SECRET) return false;

  const client = buildClient();
  const timestamp = Date.now();
  const params = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    await client.post(`/fapi/v1/leverage?${params}&signature=${signature}`);
    return true;
  } catch (err) {
    // Leverage might already be set, ignore error
    return true;
  }
}

async function placeMarketOrder(symbol, side, quantity) {
  if (!API_KEY || !API_SECRET) {
    console.log(`[DRY RUN] Would place ${side} order for ${quantity} ${symbol}`);
    return { orderId: 'dry-run', status: 'DRY_RUN' };
  }

  const client = buildClient();
  const timestamp = Date.now();
  const params = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    const res = await client.post(`/fapi/v1/order?${params}&signature=${signature}`);
    console.log(`Placed ${side} order for ${quantity} ${symbol}:`, res.data.orderId);
    return res.data;
  } catch (err) {
    console.error(`Failed to place ${side} order:`, err.response?.data || err.message);
    throw err;
  }
}

async function placeStopLossOrder(symbol, side, quantity, stopPrice) {
  if (!API_KEY || !API_SECRET) {
    console.log(`[DRY RUN] Would place SL at ${stopPrice} for ${symbol}`);
    return { orderId: 'dry-run-sl', status: 'DRY_RUN' };
  }

  const client = buildClient();
  const timestamp = Date.now();
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
  const params = `symbol=${symbol}&side=${closeSide}&type=STOP_MARKET&quantity=${quantity}&stopPrice=${stopPrice}&closePosition=true&timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    const res = await client.post(`/fapi/v1/order?${params}&signature=${signature}`);
    console.log(`Placed SL order at ${stopPrice} for ${symbol}:`, res.data.orderId);
    return res.data;
  } catch (err) {
    console.error(`Failed to place SL order:`, err.response?.data || err.message);
    throw err;
  }
}

async function placeTakeProfitOrder(symbol, side, quantity, takeProfitPrice) {
  if (!API_KEY || !API_SECRET) {
    console.log(`[DRY RUN] Would place TP at ${takeProfitPrice} for ${symbol}`);
    return { orderId: 'dry-run-tp', status: 'DRY_RUN' };
  }

  const client = buildClient();
  const timestamp = Date.now();
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
  const params = `symbol=${symbol}&side=${closeSide}&type=TAKE_PROFIT_MARKET&quantity=${quantity}&stopPrice=${takeProfitPrice}&closePosition=true&timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    const res = await client.post(`/fapi/v1/order?${params}&signature=${signature}`);
    console.log(`Placed TP order at ${takeProfitPrice} for ${symbol}:`, res.data.orderId);
    return res.data;
  } catch (err) {
    console.error(`Failed to place TP order:`, err.response?.data || err.message);
    throw err;
  }
}

async function cancelAllOrders(symbol) {
  if (!API_KEY || !API_SECRET) return;

  const client = buildClient();
  const timestamp = Date.now();
  const params = `symbol=${symbol}&timestamp=${timestamp}`;
  const signature = sign(params);

  try {
    await client.delete(`/fapi/v1/allOpenOrders?${params}&signature=${signature}`);
    console.log(`Cancelled all orders for ${symbol}`);
  } catch (err) {
    console.error(`Failed to cancel orders:`, err.response?.data || err.message);
  }
}

async function getSymbolInfo(symbol) {
  try {
    const client = axios.create({ baseURL: API_BASE, timeout: 10000 });
    const res = await client.get('/fapi/v1/exchangeInfo');
    const symbolInfo = res.data.symbols.find(s => s.symbol === symbol);
    if (!symbolInfo) return null;

    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');

    return {
      minQty: Number(lotSizeFilter?.minQty || 0.001),
      stepSize: Number(lotSizeFilter?.stepSize || 0.001),
      tickSize: Number(priceFilter?.tickSize || 0.01),
      pricePrecision: symbolInfo.pricePrecision,
      quantityPrecision: symbolInfo.quantityPrecision
    };
  } catch (err) {
    console.error('Failed to get symbol info:', err.message);
    return null;
  }
}

function roundToStep(value, step, precision) {
  const rounded = Math.floor(value / step) * step;
  return Number(rounded.toFixed(precision));
}

function roundPrice(price, tickSize, precision) {
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(precision));
}

async function executeTrade(signal) {
  // Safety checks
  if (!TRADING_ENABLED) {
    console.log('[TRADING DISABLED] Would execute trade for', signal.symbol);
    return { executed: false, reason: 'Trading disabled' };
  }

  if (!API_KEY || !API_SECRET) {
    console.log('[NO API KEYS] Cannot execute trade for', signal.symbol);
    return { executed: false, reason: 'No API keys configured' };
  }

  // Check confidence threshold - sniper signals get a lower threshold (15% less)
  const confidence = signal.ai?.confidence || 0;
  const isSniper = signal.ai?.trade?.isSniper || signal.signal?.includes('SNIPER') || signal.ai?.sniperAnalysis?.isSniper;
  const sniperDiscount = 0.15; // 15% lower confidence required for sniper entries
  const effectiveThreshold = isSniper
    ? Math.max(0.50, runtimeSettings.minConfidence - sniperDiscount)
    : runtimeSettings.minConfidence;

  if (confidence < effectiveThreshold) {
    return { executed: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% below ${(effectiveThreshold * 100).toFixed(0)}% threshold${isSniper ? ' (sniper)' : ''}` };
  }

  // Check if we have a valid trade setup
  const trade = signal.ai?.trade;
  if (!trade || !trade.entry || !trade.stopLoss || !trade.takeProfit?.[0]) {
    return { executed: false, reason: 'No valid trade setup' };
  }

  // Check candle strength - avoid entering on weak/doji candles
  const indicators = signal.indicators;
  if (indicators?.atr && indicators?.currentPrice) {
    const atrPercent = (indicators.atr / indicators.currentPrice) * 100;

    // In very low volatility (< 0.15% ATR), skip trade - market is dead
    // Note: 1m/5m/15m candles typically have 0.1-0.5% ATR; 0.8% was blocking most short-TF trades
    if (atrPercent < 0.15) {
      return { executed: false, reason: `Volatility too low (ATR ${atrPercent.toFixed(2)}%) - skipping` };
    }

    // Check if doji pattern detected (weak candle)
    if (indicators.patterns?.includes('DOJI')) {
      return { executed: false, reason: 'Doji candle detected - waiting for confirmation' };
    }
  }

  // Check daily trade limit
  const today = new Date().toDateString();
  if (dailyTrades.date !== today) {
    dailyTrades.date = today;
    dailyTrades.count = 0;
  }
  if (dailyTrades.count >= runtimeSettings.maxDailyTrades) {
    return { executed: false, reason: `Daily trade limit (${runtimeSettings.maxDailyTrades}) reached` };
  }

  // Check open positions limit
  const currentPositions = await getOpenPositions();
  if (currentPositions.length >= runtimeSettings.maxOpenPositions) {
    return { executed: false, reason: `Max open positions (${runtimeSettings.maxOpenPositions}) reached` };
  }

  // Check if already in position for this symbol
  if (currentPositions.some(p => p.symbol === signal.symbol)) {
    return { executed: false, reason: 'Already in position for this symbol' };
  }

  // Get account balance
  const balance = await getAccountBalance();
  if (balance === null) {
    return { executed: false, reason: 'Could not fetch balance - check API keys and IP whitelist' };
  }
  if (balance < 10) {
    return { executed: false, reason: `Insufficient balance: $${balance.toFixed(2)}` };
  }

  // Get symbol trading info
  const symbolInfo = await getSymbolInfo(signal.symbol);
  if (!symbolInfo) {
    return { executed: false, reason: 'Could not get symbol info' };
  }

  // Calculate position size based on risk
  const riskAmount = balance * runtimeSettings.riskPerTrade;
  const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);
  let quantity = riskAmount / riskPerUnit;

  // Apply leverage
  quantity = quantity / runtimeSettings.leverage;

  // Round to step size
  quantity = roundToStep(quantity, symbolInfo.stepSize, symbolInfo.quantityPrecision);

  if (quantity < symbolInfo.minQty) {
    return { executed: false, reason: `Position size ${quantity} below minimum ${symbolInfo.minQty}` };
  }

  // Round prices
  const stopLoss = roundPrice(trade.stopLoss, symbolInfo.tickSize, symbolInfo.pricePrecision);
  const takeProfit = roundPrice(trade.takeProfit[0], symbolInfo.tickSize, symbolInfo.pricePrecision);

  const side = trade.type === 'LONG' ? 'BUY' : 'SELL';

  try {
    // Set leverage first
    await setLeverage(signal.symbol, runtimeSettings.leverage);

    // Place market entry order
    const entryOrder = await placeMarketOrder(signal.symbol, side, quantity);

    // Place stop loss order with retry logic
    let slOrder = null;
    let slAttempts = 0;
    while (!slOrder && slAttempts < 3) {
      try {
        slOrder = await placeStopLossOrder(signal.symbol, side, quantity, stopLoss);
      } catch (slErr) {
        slAttempts++;
        console.warn(`SL placement attempt ${slAttempts} failed:`, slErr.message);
        if (slAttempts < 3) {
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
      }
    }

    // Place take profit order with retry logic
    let tpOrder = null;
    let tpAttempts = 0;
    while (!tpOrder && tpAttempts < 3) {
      try {
        tpOrder = await placeTakeProfitOrder(signal.symbol, side, quantity, takeProfit);
      } catch (tpErr) {
        tpAttempts++;
        console.warn(`TP placement attempt ${tpAttempts} failed:`, tpErr.message);
        if (tpAttempts < 3) {
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
      }
    }

    // CRITICAL: If SL failed after all retries, close position immediately for safety
    if (!slOrder) {
      console.error(`CRITICAL: SL placement failed for ${signal.symbol} after 3 attempts. Closing position for safety.`);
      try {
        const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
        await placeMarketOrder(signal.symbol, closeSide, quantity);
        console.log(`Position closed for ${signal.symbol} due to failed SL placement`);
      } catch (closeErr) {
        console.error(`EMERGENCY: Could not close position after SL failure:`, closeErr.message);
      }
      return { executed: false, reason: 'SL placement failed - position closed for safety' };
    }

    // If TP failed, log warning but continue (SL is protecting the position)
    if (!tpOrder) {
      console.warn(`WARNING: TP placement failed for ${signal.symbol}. Position protected by SL only.`);
    }

    // Track position
    openPositions.set(signal.symbol, {
      symbol: signal.symbol,
      side: trade.type,
      quantity,
      entryPrice: trade.entry,
      stopLoss,
      takeProfit,
      entryOrderId: entryOrder.orderId,
      slOrderId: slOrder?.orderId || null,
      tpOrderId: tpOrder?.orderId || null,
      hasTP: !!tpOrder,
      hasSL: !!slOrder,
      openTime: Date.now(),
      signal
    });

    // Update daily trades count
    dailyTrades.count++;

    // Add to history
    tradeHistory.push({
      symbol: signal.symbol,
      side: trade.type,
      quantity,
      entryPrice: trade.entry,
      stopLoss,
      takeProfit,
      confidence: signal.ai.confidence,
      reasons: signal.ai.reasons,
      timestamp: Date.now(),
      status: 'OPENED',
      isSniper,
      hasSL: !!slOrder,
      hasTP: !!tpOrder
    });

    console.log(`${isSniper ? 'SNIPER ' : ''}TRADE EXECUTED: ${trade.type} ${signal.symbol} qty=${quantity} entry=${trade.entry} sl=${stopLoss} tp=${takeProfit} (SL: ${!!slOrder}, TP: ${!!tpOrder}, conf: ${(confidence * 100).toFixed(0)}%, threshold: ${(effectiveThreshold * 100).toFixed(0)}%)`);

    return {
      executed: true,
      order: {
        symbol: signal.symbol,
        side: trade.type,
        quantity,
        entryOrderId: entryOrder.orderId,
        stopLoss,
        takeProfit,
        hasSL: !!slOrder,
        hasTP: !!tpOrder
      }
    };
  } catch (err) {
    console.error(`Trade execution failed for ${signal.symbol}:`, err.message);
    return { executed: false, reason: err.message };
  }
}

async function closePosition(symbol, reason = 'manual', currentPrice = null) {
  const position = openPositions.get(symbol);
  if (!position) {
    return { closed: false, reason: 'No position found' };
  }

  try {
    // Cancel existing SL/TP orders
    await cancelAllOrders(symbol);

    // Close position with market order
    const closeSide = position.side === 'LONG' ? 'SELL' : 'BUY';
    await placeMarketOrder(symbol, closeSide, position.quantity);

    // Determine trade result for pattern learning
    let result = 'breakeven';
    if (currentPrice && position.entryPrice) {
      const pnl = position.side === 'LONG'
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;

      if (pnl > 0.005) result = 'win'; // > 0.5% profit
      else if (pnl < -0.005) result = 'loss'; // > 0.5% loss
    } else if (reason.includes('profit') || reason.includes('TP')) {
      result = 'win';
    } else if (reason.includes('SL') || reason.includes('stop')) {
      result = 'loss';
    }

    // Record pattern for learning
    if (position.signal) {
      try {
        recordPattern(position.signal, result);
        console.log(`Pattern recorded for ${symbol}: ${result}`);
      } catch (e) {
        // Pattern memory might not be loaded
      }
    }

    // Remove from tracking
    openPositions.delete(symbol);

    console.log(`Position closed for ${symbol}: ${reason} (${result})`);
    return { closed: true, symbol, reason, result };
  } catch (err) {
    console.error(`Failed to close position for ${symbol}:`, err.message);
    return { closed: false, reason: err.message };
  }
}

// Smart exit monitoring - checks if open positions should be closed early
async function monitorPosition(symbol, currentSignal) {
  const position = openPositions.get(symbol);
  if (!position) return null;

  const ai = currentSignal?.ai;
  if (!ai) return null;

  const positionSide = position.side; // 'LONG' or 'SHORT'
  const signalDirection = ai.direction; // 'long', 'short', or 'neutral'
  const confidence = ai.confidence || 0;
  const scores = ai.scores || {};

  let shouldClose = false;
  let closeReason = '';

  // 1. Signal reversal - most important
  if (positionSide === 'LONG' && signalDirection === 'short' && confidence >= 0.6) {
    shouldClose = true;
    closeReason = `Signal reversed to SHORT (${(confidence * 100).toFixed(0)}% confidence)`;
  } else if (positionSide === 'SHORT' && signalDirection === 'long' && confidence >= 0.6) {
    shouldClose = true;
    closeReason = `Signal reversed to LONG (${(confidence * 100).toFixed(0)}% confidence)`;
  }

  // 2. Strong opposing momentum
  if (!shouldClose) {
    const bullScore = scores.bull || 0;
    const bearScore = scores.bear || 0;

    if (positionSide === 'LONG' && bearScore > bullScore + 25) {
      shouldClose = true;
      closeReason = `Strong bearish momentum (bear: ${bearScore}, bull: ${bullScore})`;
    } else if (positionSide === 'SHORT' && bullScore > bearScore + 25) {
      shouldClose = true;
      closeReason = `Strong bullish momentum (bull: ${bullScore}, bear: ${bearScore})`;
    }
  }

  // 3. Check key indicator reversals
  if (!shouldClose && currentSignal?.indicators) {
    const { rsi, macd, breakout } = currentSignal.indicators;

    // RSI extreme reversal
    if (positionSide === 'LONG' && rsi > 75) {
      shouldClose = true;
      closeReason = `RSI extremely overbought (${rsi.toFixed(1)}) - taking profit`;
    } else if (positionSide === 'SHORT' && rsi < 25) {
      shouldClose = true;
      closeReason = `RSI extremely oversold (${rsi.toFixed(1)}) - taking profit`;
    }

    // Breakout against position
    if (positionSide === 'LONG' && breakout?.direction === 'down') {
      shouldClose = true;
      closeReason = 'Breakdown detected - closing LONG';
    } else if (positionSide === 'SHORT' && breakout?.direction === 'up') {
      shouldClose = true;
      closeReason = 'Breakout detected - closing SHORT';
    }

    // MACD histogram flip
    if (macd?.histogram !== undefined) {
      const entrySignal = position.signal?.ai;
      const entryHistogram = entrySignal?.indicators?.macd?.histogram || 0;

      // Significant MACD flip against position
      if (positionSide === 'LONG' && entryHistogram > 0 && macd.histogram < -0.5) {
        shouldClose = true;
        closeReason = 'MACD histogram flipped bearish';
      } else if (positionSide === 'SHORT' && entryHistogram < 0 && macd.histogram > 0.5) {
        shouldClose = true;
        closeReason = 'MACD histogram flipped bullish';
      }
    }
  }

  // === SNIPER SIGNALS CHECK - Early exit on predictive reversals ===
  if (!shouldClose && currentSignal?.indicators?.sniperSignals) {
    const sniper = currentSignal.indicators.sniperSignals;

    // Divergence against position (early reversal warning)
    if (sniper.divergence?.type === 'bearish' && positionSide === 'LONG' && sniper.divergence.strength > 50) {
      shouldClose = true;
      closeReason = `SNIPER EXIT: Bearish divergence detected (strength: ${sniper.divergence.strength.toFixed(0)})`;
    } else if (sniper.divergence?.type === 'bullish' && positionSide === 'SHORT' && sniper.divergence.strength > 50) {
      shouldClose = true;
      closeReason = `SNIPER EXIT: Bullish divergence detected (strength: ${sniper.divergence.strength.toFixed(0)})`;
    }

    // Volume accumulation against position (smart money moving opposite)
    if (!shouldClose && sniper.volumeAccumulation?.detected) {
      const accumDir = sniper.volumeAccumulation.direction;
      if (accumDir === 'bearish' && positionSide === 'LONG' && sniper.volumeAccumulation.strength > 60) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Bearish volume accumulation (strength: ${sniper.volumeAccumulation.strength.toFixed(0)})`;
      } else if (accumDir === 'bullish' && positionSide === 'SHORT' && sniper.volumeAccumulation.strength > 60) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Bullish volume accumulation (strength: ${sniper.volumeAccumulation.strength.toFixed(0)})`;
      }
    }

    // Early breakout against position (approaching key level)
    if (!shouldClose && sniper.earlyBreakout) {
      if (sniper.earlyBreakout.type === 'approaching_support' && positionSide === 'LONG' && sniper.earlyBreakout.strength > 70) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Price approaching breakdown (strength: ${sniper.earlyBreakout.strength.toFixed(0)})`;
      } else if (sniper.earlyBreakout.type === 'approaching_resistance' && positionSide === 'SHORT' && sniper.earlyBreakout.strength > 70) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Price approaching breakout (strength: ${sniper.earlyBreakout.strength.toFixed(0)})`;
      }
    }

    // Momentum building against position
    if (!shouldClose && sniper.momentumBuilding?.detected) {
      const momDir = sniper.momentumBuilding.direction;
      if (momDir === 'bearish' && positionSide === 'LONG' && sniper.momentumBuilding.strength > 60) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Bearish momentum building (strength: ${sniper.momentumBuilding.strength.toFixed(0)})`;
      } else if (momDir === 'bullish' && positionSide === 'SHORT' && sniper.momentumBuilding.strength > 60) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Bullish momentum building (strength: ${sniper.momentumBuilding.strength.toFixed(0)})`;
      }
    }

    // Sniper score reversal - overall predictive signal against position
    if (!shouldClose && sniper.score?.isSniper) {
      if (sniper.score.direction === 'bearish' && positionSide === 'LONG' && sniper.score.score > 70) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Strong bearish sniper signal (score: ${sniper.score.score.toFixed(0)})`;
      } else if (sniper.score.direction === 'bullish' && positionSide === 'SHORT' && sniper.score.score > 70) {
        shouldClose = true;
        closeReason = `SNIPER EXIT: Strong bullish sniper signal (score: ${sniper.score.score.toFixed(0)})`;
      }
    }
  }

  // === AI SNIPER ANALYSIS CHECK ===
  if (!shouldClose && ai.sniperAnalysis?.isSniper) {
    const sniperDir = ai.sniperAnalysis.direction;
    if (sniperDir === 'bearish' && positionSide === 'LONG') {
      shouldClose = true;
      closeReason = `SNIPER EXIT: AI detected bearish sniper setup`;
    } else if (sniperDir === 'bullish' && positionSide === 'SHORT') {
      shouldClose = true;
      closeReason = `SNIPER EXIT: AI detected bullish sniper setup`;
    }
  }

  // 4. Position age check - close stale trades after 4 hours with no significant movement
  const positionAge = Date.now() - position.openTime;
  const fourHours = 4 * 60 * 60 * 1000;
  if (!shouldClose && positionAge > fourHours && signalDirection === 'neutral') {
    shouldClose = true;
    closeReason = 'Position stale (4h+) with neutral signal';
  }

  if (shouldClose) {
    console.log(`SMART EXIT: Closing ${symbol} - ${closeReason}`);
    const currentPrice = currentSignal?.indicators?.currentPrice;
    const result = await closePosition(symbol, closeReason, currentPrice);

    // Update trade history
    const historyEntry = tradeHistory.find(t => t.symbol === symbol && t.status === 'OPENED');
    if (historyEntry) {
      historyEntry.status = 'SMART_EXIT';
      historyEntry.closeReason = closeReason;
      historyEntry.closeTime = Date.now();
    }

    return { closed: true, symbol, reason: closeReason };
  }

  return { closed: false, symbol, reason: 'Position OK' };
}

// Monitor all open positions with current signals
async function monitorAllPositions(latestSignals) {
  if (!TRADING_ENABLED || openPositions.size === 0) return [];

  const results = [];

  for (const [symbol, position] of openPositions) {
    // Find the matching signal for this symbol (prefer the interval used to open)
    const interval = position.signal?.interval || '5m';
    const signalKey = `${symbol}-${interval}`;
    const signal = latestSignals.get(signalKey);

    if (signal) {
      const result = await monitorPosition(symbol, signal);
      if (result) results.push(result);
    }
  }

  return results;
}

function getStatus() {
  let patternStats = null;
  try {
    patternStats = getPatternStats();
  } catch (e) {
    // Pattern memory not available
  }

  return {
    enabled: TRADING_ENABLED,
    hasApiKeys: !!(API_KEY && API_SECRET),
    settings: {
      riskPerTrade: runtimeSettings.riskPerTrade * 100,
      minConfidence: runtimeSettings.minConfidence * 100,
      maxOpenPositions: runtimeSettings.maxOpenPositions,
      maxDailyTrades: runtimeSettings.maxDailyTrades,
      leverage: runtimeSettings.leverage
    },
    openPositions: Array.from(openPositions.values()),
    dailyTrades: dailyTrades.count,
    tradeHistory: tradeHistory.slice(-50),
    // Pattern learning stats
    patternLearning: patternStats
  };
}

module.exports = {
  executeTrade,
  closePosition,
  monitorPosition,
  monitorAllPositions,
  getAccountBalance,
  getOpenPositions,
  getStatus,
  updateSettings,
  TRADING_ENABLED,
  MIN_CONFIDENCE
};
