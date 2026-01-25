const axios = require('axios');
const crypto = require('crypto');

const API_BASE = process.env.BINANCE_API_URL || 'https://fapi.binance.com';
const API_KEY = process.env.BINANCE_API_KEY || '';
const API_SECRET = process.env.BINANCE_API_SECRET || '';

// Trading configuration
const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';
const RISK_PER_TRADE = Number(process.env.RISK_PER_TRADE || 5) / 100; // 5% default
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 70) / 100; // 70% default
const MAX_OPEN_POSITIONS = Number(process.env.MAX_OPEN_POSITIONS || 5);
const MAX_DAILY_TRADES = Number(process.env.MAX_DAILY_TRADES || 20);
const LEVERAGE = Number(process.env.LEVERAGE || 10);

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

  // Check confidence threshold
  const confidence = signal.ai?.confidence || 0;
  if (confidence < MIN_CONFIDENCE) {
    return { executed: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% below ${MIN_CONFIDENCE * 100}% threshold` };
  }

  // Check if we have a valid trade setup
  const trade = signal.ai?.trade;
  if (!trade || !trade.entry || !trade.stopLoss || !trade.takeProfit?.[0]) {
    return { executed: false, reason: 'No valid trade setup' };
  }

  // Check daily trade limit
  const today = new Date().toDateString();
  if (dailyTrades.date !== today) {
    dailyTrades.date = today;
    dailyTrades.count = 0;
  }
  if (dailyTrades.count >= MAX_DAILY_TRADES) {
    return { executed: false, reason: `Daily trade limit (${MAX_DAILY_TRADES}) reached` };
  }

  // Check open positions limit
  const currentPositions = await getOpenPositions();
  if (currentPositions.length >= MAX_OPEN_POSITIONS) {
    return { executed: false, reason: `Max open positions (${MAX_OPEN_POSITIONS}) reached` };
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
  const riskAmount = balance * RISK_PER_TRADE;
  const riskPerUnit = Math.abs(trade.entry - trade.stopLoss);
  let quantity = riskAmount / riskPerUnit;

  // Apply leverage
  quantity = quantity / LEVERAGE;

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
    await setLeverage(signal.symbol, LEVERAGE);

    // Place market entry order
    const entryOrder = await placeMarketOrder(signal.symbol, side, quantity);

    // Place stop loss order
    const slOrder = await placeStopLossOrder(signal.symbol, side, quantity, stopLoss);

    // Place take profit order (TP1)
    const tpOrder = await placeTakeProfitOrder(signal.symbol, side, quantity, takeProfit);

    // Track position
    openPositions.set(signal.symbol, {
      symbol: signal.symbol,
      side: trade.type,
      quantity,
      entryPrice: trade.entry,
      stopLoss,
      takeProfit,
      entryOrderId: entryOrder.orderId,
      slOrderId: slOrder.orderId,
      tpOrderId: tpOrder.orderId,
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
      status: 'OPENED'
    });

    console.log(`TRADE EXECUTED: ${trade.type} ${signal.symbol} qty=${quantity} entry=${trade.entry} sl=${stopLoss} tp=${takeProfit}`);

    return {
      executed: true,
      order: {
        symbol: signal.symbol,
        side: trade.type,
        quantity,
        entryOrderId: entryOrder.orderId,
        stopLoss,
        takeProfit
      }
    };
  } catch (err) {
    console.error(`Trade execution failed for ${signal.symbol}:`, err.message);
    return { executed: false, reason: err.message };
  }
}

async function closePosition(symbol, reason = 'manual') {
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

    // Remove from tracking
    openPositions.delete(symbol);

    console.log(`Position closed for ${symbol}: ${reason}`);
    return { closed: true, symbol, reason };
  } catch (err) {
    console.error(`Failed to close position for ${symbol}:`, err.message);
    return { closed: false, reason: err.message };
  }
}

function getStatus() {
  return {
    enabled: TRADING_ENABLED,
    hasApiKeys: !!(API_KEY && API_SECRET),
    settings: {
      riskPerTrade: RISK_PER_TRADE * 100,
      minConfidence: MIN_CONFIDENCE * 100,
      maxOpenPositions: MAX_OPEN_POSITIONS,
      maxDailyTrades: MAX_DAILY_TRADES,
      leverage: LEVERAGE
    },
    openPositions: Array.from(openPositions.values()),
    dailyTrades: dailyTrades.count,
    tradeHistory: tradeHistory.slice(-50)
  };
}

module.exports = {
  executeTrade,
  closePosition,
  getAccountBalance,
  getOpenPositions,
  getStatus,
  TRADING_ENABLED,
  MIN_CONFIDENCE
};
