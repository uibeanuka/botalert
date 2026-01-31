const axios = require('axios');
const crypto = require('crypto');
const { recordPattern, getStats: getPatternStats } = require('./patternMemory');
const { learnFromTrade, learnFromLiquidation, learnFromSevereLoss, isDangerousCondition, analyzeTradeFailure, checkFailurePatternRisk, extractEntryConditions, updateEntryConditionPerformance, checkEntryQuality } = require('./aiLearning');
const { recordTrade: recordRiskTrade, checkTradingAllowed, calculatePositionSize: riskCalcPositionSize } = require('./riskManager');
const { addTrainingSample } = require('./mlSignalGenerator');
const { analyzeCompletedTrade, getRecommendedStyle } = require('./tradeAnalyzer');
const { getSymbolSentiment, fetchFearGreedIndex } = require('./sentimentEngine');
const { getEventTradingAdjustment, checkUpcomingEvents } = require('./economicCalendar');

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

// Sentiment integration
const SENTIMENT_ENABLED = process.env.SENTIMENT_TRADING_ENABLED !== 'false'; // Default enabled
const SENTIMENT_WEIGHT = Number(process.env.SENTIMENT_WEIGHT || 20) / 100; // 20% weight in decision
const BLOCK_EXTREME_SENTIMENT = process.env.BLOCK_EXTREME_SENTIMENT === 'true'; // Block trades in extreme fear/greed

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

// Cached sentiment to avoid excessive API calls
let cachedSentiment = { data: null, expiry: 0 };

/**
 * Evaluate sentiment impact on trade decision
 * @param {string} symbol - Trading symbol
 * @param {string} direction - 'long' or 'short'
 * @returns {Promise<{allowed: boolean, adjustment: number, reason: string, sentiment: object}>}
 */
async function evaluateSentiment(symbol, direction) {
  if (!SENTIMENT_ENABLED) {
    return { allowed: true, adjustment: 0, reason: 'Sentiment checks disabled', sentiment: null };
  }

  try {
    // Check cache first (valid for 2 minutes)
    let sentiment;
    if (cachedSentiment.data && Date.now() < cachedSentiment.expiry) {
      sentiment = cachedSentiment.data;
    } else {
      sentiment = await getSymbolSentiment(symbol);
      cachedSentiment = { data: sentiment, expiry: Date.now() + 120000 };
    }

    const fearGreed = sentiment.fearGreed;
    const combined = sentiment.combined;
    const news = sentiment.news;

    // === BLOCK CONDITIONS ===

    // 1. Extreme fear/greed blocking (if enabled)
    if (BLOCK_EXTREME_SENTIMENT) {
      if (fearGreed.value <= 10) {
        return {
          allowed: false,
          adjustment: 0,
          reason: `🔴 EXTREME FEAR (${fearGreed.value}) - market panic, no new trades`,
          sentiment
        };
      }
      if (fearGreed.value >= 90) {
        return {
          allowed: false,
          adjustment: 0,
          reason: `🔴 EXTREME GREED (${fearGreed.value}) - market euphoria, crash imminent`,
          sentiment
        };
      }
    }

    // 2. Strong news against trade direction
    if (news.count >= 3) {
      const newsScore = news.score || 0;
      if (direction === 'long' && newsScore < -0.5) {
        return {
          allowed: false,
          adjustment: 0,
          reason: `📰 Strong bearish news flow (${(newsScore * 100).toFixed(0)}%) conflicts with long`,
          sentiment
        };
      }
      if (direction === 'short' && newsScore > 0.5) {
        return {
          allowed: false,
          adjustment: 0,
          reason: `📰 Strong bullish news flow (${(newsScore * 100).toFixed(0)}%) conflicts with short`,
          sentiment
        };
      }
    }

    // === CONFIDENCE ADJUSTMENTS ===
    let adjustment = 0;
    const reasons = [];

    // Fear & Greed alignment
    if (direction === 'long') {
      if (fearGreed.value <= 25) {
        adjustment += 0.08; // Extreme fear = contrarian buy opportunity
        reasons.push(`Extreme fear (${fearGreed.value}) favors long`);
      } else if (fearGreed.value >= 70) {
        adjustment -= 0.05; // Greed = caution on longs
        reasons.push(`High greed (${fearGreed.value}) cautions long`);
      }
    } else {
      if (fearGreed.value >= 75) {
        adjustment += 0.08; // Extreme greed = contrarian short opportunity
        reasons.push(`Extreme greed (${fearGreed.value}) favors short`);
      } else if (fearGreed.value <= 30) {
        adjustment -= 0.05; // Fear = caution on shorts
        reasons.push(`Fear (${fearGreed.value}) cautions short`);
      }
    }

    // News sentiment alignment
    const newsScore = news.score || 0;
    if (direction === 'long' && newsScore > 0.3) {
      adjustment += 0.05;
      reasons.push('News supports bullish bias');
    } else if (direction === 'short' && newsScore < -0.3) {
      adjustment += 0.05;
      reasons.push('News supports bearish bias');
    }

    // Combined sentiment score alignment
    const combinedScore = combined.score || 0;
    if ((direction === 'long' && combinedScore > 0.2) || (direction === 'short' && combinedScore < -0.2)) {
      adjustment += 0.03;
      reasons.push('Overall sentiment aligned');
    } else if ((direction === 'long' && combinedScore < -0.3) || (direction === 'short' && combinedScore > 0.3)) {
      adjustment -= 0.05;
      reasons.push('Overall sentiment conflicts');
    }

    // Apply weight
    adjustment = adjustment * SENTIMENT_WEIGHT;

    return {
      allowed: true,
      adjustment: Math.round(adjustment * 100) / 100,
      reason: reasons.length > 0 ? reasons.join('; ') : 'Neutral sentiment',
      sentiment
    };

  } catch (err) {
    console.warn('[SENTIMENT] Evaluation failed:', err.message);
    return { allowed: true, adjustment: 0, reason: 'Sentiment check failed', sentiment: null };
  }
}

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

  // Check confidence threshold - sniper/surge signals get lower thresholds
  const confidence = signal.ai?.confidence || 0;
  const isSniper = signal.ai?.trade?.isSniper || signal.signal?.includes('SNIPER') || signal.ai?.sniperAnalysis?.isSniper;
  const isVolumeSurge = signal.ai?.sniperAnalysis?.isVolumeSurge || signal.ai?.sniperAnalysis?.volumeSurge?.detected || signal.indicators?.volumeSurge?.detected;
  const isExplosiveSurge = signal.ai?.sniperAnalysis?.volumeSurge?.isExplosive || signal.indicators?.volumeSurge?.isExplosive;

  let effectiveThreshold = runtimeSettings.minConfidence;
  let thresholdLabel = '';

  if (isExplosiveSurge) {
    // Explosive volume surge = meme/alpha pump, lowest threshold (45%)
    effectiveThreshold = Math.max(0.45, runtimeSettings.minConfidence - 0.20);
    thresholdLabel = ' (explosive surge)';
  } else if (isVolumeSurge) {
    // Volume surge = emerging move, lower threshold (50%)
    effectiveThreshold = Math.max(0.50, runtimeSettings.minConfidence - 0.15);
    thresholdLabel = ' (volume surge)';
  } else if (isSniper) {
    // Sniper signal = predictive entry (50%)
    effectiveThreshold = Math.max(0.50, runtimeSettings.minConfidence - 0.15);
    thresholdLabel = ' (sniper)';
  }

  if (confidence < effectiveThreshold) {
    return { executed: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% below ${(effectiveThreshold * 100).toFixed(0)}% threshold${thresholdLabel}` };
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

  // === FAILURE PATTERN LEARNING CHECK ===
  // Check if this entry matches known failure patterns from past trades
  const direction = trade?.type === 'LONG' ? 'long' : 'short';
  const failureRisk = checkFailurePatternRisk(signal.symbol, direction, indicators);

  if (failureRisk.recommendation === 'AVOID') {
    const reasons = failureRisk.risks.map(r => r.reason).join(', ');
    console.log(`⚠️ [LEARN] BLOCKED ${signal.symbol}: Matches ${failureRisk.risks.length} failure patterns - ${reasons}`);
    return {
      executed: false,
      reason: `Blocked by learning: ${reasons}`,
      failurePatterns: failureRisk.risks.map(r => r.pattern)
    };
  }

  if (failureRisk.recommendation === 'CAUTION' && failureRisk.highRisk) {
    // High risk pattern - require higher confidence (additional 10%)
    const cautionThreshold = effectiveThreshold + 0.10;
    if (confidence < cautionThreshold) {
      const reasons = failureRisk.risks.map(r => r.reason).join(', ');
      console.log(`⚠️ [LEARN] CAUTION ${signal.symbol}: ${reasons} - needs ${(cautionThreshold * 100).toFixed(0)}% confidence`);
      return {
        executed: false,
        reason: `High-risk pattern (${reasons}) requires ${(cautionThreshold * 100).toFixed(0)}% confidence, got ${(confidence * 100).toFixed(0)}%`,
        failurePatterns: failureRisk.risks.map(r => r.pattern)
      };
    }
  }

  // === ENTRY QUALITY CHECK - Learn from what works ===
  // Extract current entry conditions and check quality based on historical performance
  const entryConditions = extractEntryConditions(indicators);
  const entryQuality = checkEntryQuality(indicators, direction);

  // Block trades with AVOID quality (matches multiple losing patterns)
  if (entryQuality.quality === 'AVOID') {
    console.log(`⛔ [LEARN] BLOCKED ${signal.symbol}: Entry quality AVOID - ${entryQuality.reason}`);
    return {
      executed: false,
      reason: `Entry blocked by learning: ${entryQuality.reason}`,
      entryQuality: entryQuality.quality,
      conditions: entryConditions
    };
  }

  // POOR quality entries need extra confidence (+15%)
  if (entryQuality.quality === 'POOR') {
    const poorThreshold = effectiveThreshold + 0.15;
    if (confidence < poorThreshold) {
      console.log(`⚠️ [LEARN] POOR ${signal.symbol}: ${entryQuality.reason} - needs ${(poorThreshold * 100).toFixed(0)}% confidence`);
      return {
        executed: false,
        reason: `Poor entry (${entryQuality.reason}) requires ${(poorThreshold * 100).toFixed(0)}% confidence`,
        entryQuality: entryQuality.quality,
        conditions: entryConditions
      };
    }
  }

  // EXCELLENT quality entries get a confidence boost (lower threshold by 5%)
  if (entryQuality.quality === 'EXCELLENT') {
    effectiveThreshold = Math.max(0.45, effectiveThreshold - 0.05);
    console.log(`✨ [LEARN] EXCELLENT ${signal.symbol}: ${entryQuality.reason} - threshold lowered to ${(effectiveThreshold * 100).toFixed(0)}%`);
  }

  // === SENTIMENT CHECK ===
  // Evaluate market sentiment and news before entering
  const sentimentResult = await evaluateSentiment(signal.symbol, direction);

  if (!sentimentResult.allowed) {
    console.log(`🛑 [SENTIMENT] BLOCKED ${signal.symbol} ${direction.toUpperCase()}: ${sentimentResult.reason}`);
    return {
      executed: false,
      reason: sentimentResult.reason,
      sentiment: {
        fearGreed: sentimentResult.sentiment?.fearGreed?.value,
        news: sentimentResult.sentiment?.news?.sentiment,
        combined: sentimentResult.sentiment?.combined?.classification
      }
    };
  }

  // Apply sentiment adjustment to confidence
  if (sentimentResult.adjustment !== 0) {
    const adjustedConfidence = confidence + sentimentResult.adjustment;
    if (sentimentResult.adjustment > 0) {
      console.log(`📈 [SENTIMENT] ${signal.symbol}: Confidence boosted ${(sentimentResult.adjustment * 100).toFixed(0)}% → ${(adjustedConfidence * 100).toFixed(0)}% (${sentimentResult.reason})`);
    } else {
      console.log(`📉 [SENTIMENT] ${signal.symbol}: Confidence reduced ${(sentimentResult.adjustment * 100).toFixed(0)}% → ${(adjustedConfidence * 100).toFixed(0)}% (${sentimentResult.reason})`);
      // If sentiment significantly reduces confidence below threshold, block
      if (adjustedConfidence < effectiveThreshold) {
        return {
          executed: false,
          reason: `Sentiment reduced confidence to ${(adjustedConfidence * 100).toFixed(0)}%, below ${(effectiveThreshold * 100).toFixed(0)}% threshold`,
          sentiment: {
            fearGreed: sentimentResult.sentiment?.fearGreed?.value,
            adjustment: sentimentResult.adjustment,
            reason: sentimentResult.reason
          }
        };
      }
    }
  }

  // === ECONOMIC CALENDAR CHECK ===
  // Reduce exposure during high-impact macro events (FOMC, CPI, NFP)
  const calendarAdjustment = getEventTradingAdjustment();
  if (calendarAdjustment.warnings.length > 0) {
    console.log(`📅 [CALENDAR] ${signal.symbol}: ${calendarAdjustment.warnings.join(', ')}`);
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
  let riskAmount = balance * runtimeSettings.riskPerTrade;

  // Apply calendar adjustment (reduce size during high-impact events)
  if (calendarAdjustment.positionSizeMultiplier < 1) {
    const originalRisk = riskAmount;
    riskAmount = riskAmount * calendarAdjustment.positionSizeMultiplier;
    console.log(`📅 [CALENDAR] ${signal.symbol}: Position size reduced ${((1 - calendarAdjustment.positionSizeMultiplier) * 100).toFixed(0)}% ($${originalRisk.toFixed(2)} → $${riskAmount.toFixed(2)})`);
  }

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

    // Estimate liquidation price (simplified - actual depends on margin mode)
    // For isolated margin: liq = entry * (1 - 1/leverage) for LONG, entry * (1 + 1/leverage) for SHORT
    const leverage = runtimeSettings.leverage || 10;
    const liqDistance = 1 / leverage;
    const liquidationPrice = trade.type === 'LONG'
      ? trade.entry * (1 - liqDistance * 0.9) // 90% of theoretical (buffer for fees)
      : trade.entry * (1 + liqDistance * 0.9);

    // Track position
    openPositions.set(signal.symbol, {
      symbol: signal.symbol,
      side: trade.type,
      quantity,
      entryPrice: trade.entry,
      stopLoss,
      takeProfit,
      liquidationPrice,
      entryOrderId: entryOrder.orderId,
      slOrderId: slOrder?.orderId || null,
      tpOrderId: tpOrder?.orderId || null,
      hasTP: !!tpOrder,
      hasSL: !!slOrder,
      openTime: Date.now(),
      peakProfit: 0,
      signal,
      // Entry condition learning
      entryConditions,
      entryQuality: entryQuality.quality,
      expectedWinRate: entryQuality.expectedWinRate
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
      isVolumeSurge: !!isVolumeSurge,
      isExplosiveSurge: !!isExplosiveSurge,
      hasSL: !!slOrder,
      hasTP: !!tpOrder
    });

    const tradeTag = isExplosiveSurge ? 'SURGE EXPLOSIVE ' : isVolumeSurge ? 'SURGE ' : isSniper ? 'SNIPER ' : '';
    console.log(`${tradeTag}TRADE EXECUTED: ${trade.type} ${signal.symbol} qty=${quantity} entry=${trade.entry} sl=${stopLoss} tp=${takeProfit} (SL: ${!!slOrder}, TP: ${!!tpOrder}, conf: ${(confidence * 100).toFixed(0)}%, threshold: ${(effectiveThreshold * 100).toFixed(0)}%)`);

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
        hasTP: !!tpOrder,
        isVolumeSurge,
        isExplosiveSurge
      }
    };
  } catch (err) {
    console.error(`Trade execution failed for ${signal.symbol}:`, err.message);
    return { executed: false, reason: err.message };
  }
}

async function closePosition(symbol, reason = 'manual', currentPrice = null, exitIndicators = null) {
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

    // Calculate PnL for learning
    let pnlPercent = 0;
    if (currentPrice && position.entryPrice) {
      pnlPercent = position.side === 'LONG'
        ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }

    // Record trade for AI learning
    try {
      learnFromTrade({
        indicators: position.signal?.indicators,
        signal: position.signal?.signal,
        direction: position.side?.toLowerCase(),
        pnlPercent,
        result,
        symbol,
        timestamp: Date.now()
      });

      // CRITICAL: Learn from severe losses
      if (pnlPercent <= -5) {
        learnFromSevereLoss({
          symbol,
          pnlPercent,
          indicators: position.signal?.indicators,
          direction: position.side?.toLowerCase()
        });
      }

      // CRITICAL: Learn from liquidation-level losses
      if (pnlPercent <= -15 || reason.includes('LIQUIDATION') || reason.includes('EMERGENCY')) {
        learnFromLiquidation({
          symbol,
          indicators: position.signal?.indicators,
          entryPrice: position.entryPrice,
          liquidationPrice: position.liquidationPrice,
          direction: position.side?.toLowerCase(),
          fundingRate: position.signal?.indicators?.fundingRate || null,
          volumeAtEntry: position.signal?.indicators?.volume || null,
          timestamp: Date.now()
        });
      }

      // CRITICAL: Analyze failure patterns for ALL losses > 2%
      // This learns what specific mistakes were made (fakeout, resistance reject, etc.)
      if (result === 'loss' && pnlPercent <= -2) {
        const failures = analyzeTradeFailure({
          symbol,
          direction: position.side?.toLowerCase(),
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          pnlPercent,
          entryIndicators: position.signal?.indicators,
          exitIndicators: exitIndicators, // Current indicators passed from monitorPosition
          holdTime: Date.now() - position.openTime
        });

        if (failures.length > 0) {
          console.log(`📊 [LEARN] ${symbol} failure patterns detected: ${failures.map(f => f.type).join(', ')}`);
        }
      }

      // === LEARN FROM ENTRY CONDITIONS ===
      // Update entry condition performance for ALL trades (wins AND losses)
      // This helps the bot learn which entry conditions lead to success
      if (position.entryConditions && position.entryConditions.length > 0) {
        updateEntryConditionPerformance(position.entryConditions, result, pnlPercent);
        const winLoss = result === 'win' || pnlPercent > 0 ? '✅ WIN' : '❌ LOSS';
        console.log(`📈 [LEARN] ${symbol} ${winLoss}: Updated ${position.entryConditions.length} entry conditions (${position.entryConditions.slice(0, 3).join(', ')}...)`);
      }

      // === DEEP TRADE ANALYSIS - Understand WHY ===
      // Analyze root cause of win/loss, exit timing, optimal style
      try {
        const deepAnalysis = analyzeCompletedTrade({
          symbol,
          direction: position.side?.toLowerCase(),
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          pnlPercent,
          result,
          holdTime: Date.now() - position.openTime,
          entryIndicators: position.signal?.indicators,
          exitIndicators,
          peakPnlPercent: position.peakProfit || 0,
          troughPnlPercent: position.troughLoss || 0,
          entryConditions: position.entryConditions,
          signal: position.signal?.signal,
          closeReason: reason
        });

        if (deepAnalysis.rootCauses.length > 0) {
          const emoji = result === 'win' || pnlPercent > 0 ? '🎯' : '💡';
          console.log(`${emoji} [ANALYSIS] ${symbol}: ${deepAnalysis.rootCauses.map(c => c.reason).join(', ')} | Style: ${deepAnalysis.style} | Exit: ${deepAnalysis.exitQuality}`);
          if (deepAnalysis.lessonsLearned.length > 0) {
            console.log(`   📚 Lesson: ${deepAnalysis.lessonsLearned[0].message}`);
          }
        }
      } catch (e) {
        console.warn('[TRADING] Deep analysis error:', e.message);
      }
    } catch (e) {
      // AI learning might not be loaded
      console.warn('[TRADING] Learning error:', e.message);
    }

    // Record for risk management
    try {
      recordRiskTrade({
        pnl: pnlPercent * (position.quantity * position.entryPrice) / 100,
        pnlPercent,
        result,
        symbol,
        direction: position.side?.toLowerCase()
      });
    } catch (e) {
      // Risk manager might not be loaded
    }

    // Add to ML training data
    try {
      if (position.signal?.indicators) {
        addTrainingSample(
          position.signal.indicators,
          position.side?.toLowerCase(),
          result === 'win' ? 1 : result === 'loss' ? -1 : 0
        );
      }
    } catch (e) {
      // ML module might not be loaded
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

// Emergency stop loss settings
const EMERGENCY_STOP_LOSS_PCT = Number(process.env.EMERGENCY_STOP_LOSS_PCT || 8); // -8% hard stop
const TRAILING_STOP_PCT = Number(process.env.TRAILING_STOP_PCT || 3); // 3% trailing from peak
const LIQUIDATION_WARNING_PCT = 50; // Warn if within 50% of liquidation

// Smart exit monitoring - checks if open positions should be closed early
async function monitorPosition(symbol, currentSignal) {
  const position = openPositions.get(symbol);
  if (!position) return null;

  const currentPrice = currentSignal?.indicators?.currentPrice;
  const positionSide = position.side; // 'LONG' or 'SHORT'

  let shouldClose = false;
  let closeReason = '';

  // === EMERGENCY CHECKS FIRST (before any signal analysis) ===

  // 1. EMERGENCY HARD STOP - Never let loss exceed this %
  if (currentPrice && position.entryPrice) {
    const pnlPct = positionSide === 'LONG'
      ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

    // Track peak profit for trailing stop
    if (!position.peakProfit) position.peakProfit = 0;
    if (pnlPct > position.peakProfit) {
      position.peakProfit = pnlPct;
    }

    // EMERGENCY STOP - Hard loss limit
    if (pnlPct <= -EMERGENCY_STOP_LOSS_PCT) {
      console.log(`🚨 EMERGENCY STOP: ${symbol} at ${pnlPct.toFixed(2)}% loss (limit: -${EMERGENCY_STOP_LOSS_PCT}%)`);
      shouldClose = true;
      closeReason = `EMERGENCY STOP: ${pnlPct.toFixed(1)}% loss exceeded -${EMERGENCY_STOP_LOSS_PCT}% limit`;
    }

    // TRAILING STOP - Lock in profits
    if (!shouldClose && position.peakProfit >= 2) { // Only activate after 2% profit
      const drawdownFromPeak = position.peakProfit - pnlPct;
      if (drawdownFromPeak >= TRAILING_STOP_PCT) {
        console.log(`📉 TRAILING STOP: ${symbol} dropped ${drawdownFromPeak.toFixed(1)}% from peak (${position.peakProfit.toFixed(1)}% -> ${pnlPct.toFixed(1)}%)`);
        shouldClose = true;
        closeReason = `TRAILING STOP: Dropped ${drawdownFromPeak.toFixed(1)}% from ${position.peakProfit.toFixed(1)}% peak`;
      }
    }

    // LIQUIDATION PROXIMITY WARNING
    if (!shouldClose && position.liquidationPrice) {
      const distanceToLiq = positionSide === 'LONG'
        ? ((currentPrice - position.liquidationPrice) / currentPrice) * 100
        : ((position.liquidationPrice - currentPrice) / currentPrice) * 100;

      if (distanceToLiq <= LIQUIDATION_WARNING_PCT / 2) {
        console.log(`⚠️ LIQUIDATION DANGER: ${symbol} only ${distanceToLiq.toFixed(1)}% from liquidation!`);
        shouldClose = true;
        closeReason = `LIQUIDATION DANGER: Only ${distanceToLiq.toFixed(1)}% from liquidation price`;
      }
    }
  }

  // 2. VOLUME SPIKE EXIT - Large incoming volume against position
  if (!shouldClose && currentSignal?.indicators?.sniperSignals?.volumeSurge) {
    const surge = currentSignal.indicators.sniperSignals.volumeSurge;
    if (surge.detected && surge.isExplosive) {
      // Check if surge direction is against position
      const priceDirection = currentSignal.indicators.priceChange > 0 ? 'up' : 'down';
      if ((positionSide === 'LONG' && priceDirection === 'down' && surge.strength > 70) ||
          (positionSide === 'SHORT' && priceDirection === 'up' && surge.strength > 70)) {
        console.log(`💥 VOLUME SPIKE EXIT: ${symbol} explosive volume against position`);
        shouldClose = true;
        closeReason = `VOLUME SPIKE: Explosive ${surge.strength}% volume surge against position`;
      }
    }
  }

  if (shouldClose) {
    console.log(`EMERGENCY EXIT: Closing ${symbol} - ${closeReason}`);
    const result = await closePosition(symbol, closeReason, currentPrice, currentSignal?.indicators);
    return { closed: true, symbol, reason: closeReason, emergency: true };
  }

  // === NORMAL SIGNAL-BASED CHECKS ===
  const ai = currentSignal?.ai;
  if (!ai) return null;

  const signalDirection = ai.direction; // 'long', 'short', or 'neutral'
  const confidence = ai.confidence || 0;
  const scores = ai.scores || {};

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
    const result = await closePosition(symbol, closeReason, currentPrice, currentSignal?.indicators);

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
  evaluateSentiment,
  TRADING_ENABLED,
  MIN_CONFIDENCE,
  SENTIMENT_ENABLED
};
