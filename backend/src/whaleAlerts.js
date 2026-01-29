/**
 * Whale Alerts & Large Transaction Monitoring
 * Tracks large crypto movements that may signal market direction
 *
 * Data Sources:
 * - Whale Alert API
 * - Binance large trade detection
 * - Exchange flow analysis
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Environment configuration (Railway auto-picks these)
const WHALE_ALERT_API_KEY = process.env.WHALE_ALERT_API_KEY || '';
const WHALE_MIN_VALUE_USD = Number(process.env.WHALE_MIN_VALUE_USD || 1000000); // $1M default

const WHALE_CACHE_FILE = path.join(__dirname, '../data/whale_alerts.json');

// Whale tracking state
let whaleState = {
  recentAlerts: [],
  exchangeFlows: {
    inflow: 0,
    outflow: 0,
    netFlow: 0
  },
  symbolAlerts: {},
  lastUpdate: 0
};

// Known exchange wallets (simplified - real implementations would have full lists)
const EXCHANGE_WALLETS = {
  binance: ['binance', 'binance-cold'],
  coinbase: ['coinbase', 'coinbase-custody'],
  kraken: ['kraken'],
  ftx: ['ftx'], // historical
  okex: ['okex', 'okx'],
  huobi: ['huobi'],
  bitfinex: ['bitfinex'],
  kucoin: ['kucoin'],
  bybit: ['bybit'],
  gateio: ['gate.io']
};

/**
 * Fetch whale alerts from Whale Alert API
 */
async function fetchWhaleAlerts(minValue = WHALE_MIN_VALUE_USD) {
  if (!WHALE_ALERT_API_KEY) {
    // Return synthetic data based on Binance large trades
    return await detectLargeTradesFromBinance();
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    const response = await axios.get('https://api.whale-alert.io/v1/transactions', {
      params: {
        api_key: WHALE_ALERT_API_KEY,
        min_value: minValue,
        start: oneHourAgo,
        cursor: null
      },
      timeout: 10000
    });

    if (response.data?.transactions) {
      const alerts = response.data.transactions.map(tx => parseWhaleTransaction(tx));

      // Update state
      whaleState.recentAlerts = alerts.slice(0, 50);
      whaleState.lastUpdate = Date.now();

      // Calculate exchange flows
      calculateExchangeFlows(alerts);

      // Group by symbol
      groupAlertsBySymbol(alerts);

      saveWhaleCache();

      return {
        alerts: alerts.slice(0, 20),
        count: alerts.length,
        exchangeFlows: whaleState.exchangeFlows,
        summary: generateWhaleSummary(alerts)
      };
    }
  } catch (err) {
    console.warn('[WHALE] API fetch failed:', err.message);
  }

  return await detectLargeTradesFromBinance();
}

/**
 * Parse whale transaction into standardized format
 */
function parseWhaleTransaction(tx) {
  const fromExchange = isExchangeWallet(tx.from?.owner_type || tx.from?.owner);
  const toExchange = isExchangeWallet(tx.to?.owner_type || tx.to?.owner);

  let flowType = 'unknown';
  if (fromExchange && !toExchange) flowType = 'exchange_outflow';
  else if (!fromExchange && toExchange) flowType = 'exchange_inflow';
  else if (fromExchange && toExchange) flowType = 'exchange_transfer';
  else flowType = 'wallet_transfer';

  return {
    id: tx.id || tx.hash,
    timestamp: tx.timestamp * 1000,
    symbol: tx.symbol?.toUpperCase() || 'UNKNOWN',
    amount: tx.amount,
    amountUsd: tx.amount_usd,
    from: {
      address: tx.from?.address,
      owner: tx.from?.owner || tx.from?.owner_type || 'unknown',
      isExchange: fromExchange
    },
    to: {
      address: tx.to?.address,
      owner: tx.to?.owner || tx.to?.owner_type || 'unknown',
      isExchange: toExchange
    },
    flowType,
    significance: calculateSignificance(tx.amount_usd, flowType),
    signal: getWhaleSignal(flowType, tx.amount_usd)
  };
}

/**
 * Check if wallet is an exchange
 */
function isExchangeWallet(owner) {
  if (!owner) return false;
  const ownerLower = owner.toLowerCase();

  for (const [exchange, patterns] of Object.entries(EXCHANGE_WALLETS)) {
    if (patterns.some(p => ownerLower.includes(p))) return true;
  }

  return ownerLower.includes('exchange');
}

/**
 * Calculate significance of transaction
 */
function calculateSignificance(amountUsd, flowType) {
  if (amountUsd >= 100000000) return 'massive'; // $100M+
  if (amountUsd >= 50000000) return 'huge'; // $50M+
  if (amountUsd >= 10000000) return 'large'; // $10M+
  if (amountUsd >= 5000000) return 'significant'; // $5M+
  if (amountUsd >= 1000000) return 'notable'; // $1M+
  return 'minor';
}

/**
 * Get trading signal from whale movement
 */
function getWhaleSignal(flowType, amountUsd) {
  const isMassive = amountUsd >= 50000000;
  const isLarge = amountUsd >= 10000000;

  switch (flowType) {
    case 'exchange_inflow':
      // Coins moving to exchange = potential selling pressure
      return {
        bias: 'bearish',
        strength: isMassive ? 'strong' : isLarge ? 'moderate' : 'weak',
        reason: 'Large deposit to exchange may indicate selling'
      };

    case 'exchange_outflow':
      // Coins leaving exchange = potential accumulation
      return {
        bias: 'bullish',
        strength: isMassive ? 'strong' : isLarge ? 'moderate' : 'weak',
        reason: 'Large withdrawal from exchange suggests accumulation'
      };

    case 'exchange_transfer':
      return {
        bias: 'neutral',
        strength: 'weak',
        reason: 'Inter-exchange transfer'
      };

    default:
      return {
        bias: 'neutral',
        strength: 'weak',
        reason: 'Wallet-to-wallet transfer'
      };
  }
}

/**
 * Calculate aggregate exchange flows
 */
function calculateExchangeFlows(alerts) {
  let inflow = 0;
  let outflow = 0;

  for (const alert of alerts) {
    if (alert.flowType === 'exchange_inflow') {
      inflow += alert.amountUsd;
    } else if (alert.flowType === 'exchange_outflow') {
      outflow += alert.amountUsd;
    }
  }

  whaleState.exchangeFlows = {
    inflow,
    outflow,
    netFlow: outflow - inflow, // Positive = bullish (more leaving exchanges)
    flowRatio: inflow > 0 ? outflow / inflow : outflow > 0 ? 999 : 1
  };
}

/**
 * Group alerts by symbol
 */
function groupAlertsBySymbol(alerts) {
  whaleState.symbolAlerts = {};

  for (const alert of alerts) {
    const symbol = alert.symbol;
    if (!whaleState.symbolAlerts[symbol]) {
      whaleState.symbolAlerts[symbol] = {
        alerts: [],
        totalVolume: 0,
        netFlow: 0
      };
    }

    whaleState.symbolAlerts[symbol].alerts.push(alert);
    whaleState.symbolAlerts[symbol].totalVolume += alert.amountUsd;

    if (alert.flowType === 'exchange_outflow') {
      whaleState.symbolAlerts[symbol].netFlow += alert.amountUsd;
    } else if (alert.flowType === 'exchange_inflow') {
      whaleState.symbolAlerts[symbol].netFlow -= alert.amountUsd;
    }
  }
}

/**
 * Generate whale activity summary
 */
function generateWhaleSummary(alerts) {
  const inflows = alerts.filter(a => a.flowType === 'exchange_inflow');
  const outflows = alerts.filter(a => a.flowType === 'exchange_outflow');

  const totalInflow = inflows.reduce((sum, a) => sum + a.amountUsd, 0);
  const totalOutflow = outflows.reduce((sum, a) => sum + a.amountUsd, 0);

  // Find most active symbols
  const symbolActivity = {};
  for (const alert of alerts) {
    symbolActivity[alert.symbol] = (symbolActivity[alert.symbol] || 0) + alert.amountUsd;
  }

  const topSymbols = Object.entries(symbolActivity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([symbol, volume]) => ({ symbol, volume }));

  // Determine market signal
  let marketSignal = 'neutral';
  const netFlow = totalOutflow - totalInflow;
  if (netFlow > 50000000) marketSignal = 'bullish';
  else if (netFlow > 20000000) marketSignal = 'slightly_bullish';
  else if (netFlow < -50000000) marketSignal = 'bearish';
  else if (netFlow < -20000000) marketSignal = 'slightly_bearish';

  return {
    period: '1h',
    totalTransactions: alerts.length,
    totalVolume: totalInflow + totalOutflow,
    inflows: {
      count: inflows.length,
      volume: totalInflow
    },
    outflows: {
      count: outflows.length,
      volume: totalOutflow
    },
    netFlow,
    marketSignal,
    topSymbols,
    massiveTransactions: alerts.filter(a => a.significance === 'massive' || a.significance === 'huge').length
  };
}

/**
 * Detect large trades from Binance when Whale Alert API not available
 */
async function detectLargeTradesFromBinance() {
  try {
    // Get recent large trades from Binance
    const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    const alerts = [];

    for (const symbol of symbols) {
      try {
        const response = await axios.get('https://fapi.binance.com/fapi/v1/trades', {
          params: { symbol, limit: 100 },
          timeout: 5000
        });

        if (response.data) {
          // Find large trades (> $500K)
          for (const trade of response.data) {
            const value = Number(trade.price) * Number(trade.qty);
            if (value >= 500000) {
              alerts.push({
                id: trade.id,
                timestamp: trade.time,
                symbol: symbol.replace('USDT', ''),
                amount: Number(trade.qty),
                amountUsd: value,
                flowType: trade.isBuyerMaker ? 'market_sell' : 'market_buy',
                significance: calculateSignificance(value, 'trade'),
                signal: {
                  bias: trade.isBuyerMaker ? 'bearish' : 'bullish',
                  strength: value >= 2000000 ? 'strong' : value >= 1000000 ? 'moderate' : 'weak',
                  reason: trade.isBuyerMaker ? 'Large market sell order' : 'Large market buy order'
                }
              });
            }
          }
        }
      } catch (err) {
        // Skip symbol on error
      }
    }

    // Sort by value
    alerts.sort((a, b) => b.amountUsd - a.amountUsd);

    whaleState.recentAlerts = alerts.slice(0, 50);
    whaleState.lastUpdate = Date.now();

    return {
      alerts: alerts.slice(0, 20),
      count: alerts.length,
      source: 'binance_trades',
      exchangeFlows: { inflow: 0, outflow: 0, netFlow: 0 },
      summary: {
        totalTransactions: alerts.length,
        totalVolume: alerts.reduce((sum, a) => sum + a.amountUsd, 0),
        marketSignal: 'neutral',
        note: 'Using Binance trade data (Whale Alert API key not configured)'
      }
    };
  } catch (err) {
    console.warn('[WHALE] Binance detection failed:', err.message);
    return {
      alerts: [],
      count: 0,
      exchangeFlows: { inflow: 0, outflow: 0, netFlow: 0 },
      summary: { marketSignal: 'unknown' }
    };
  }
}

/**
 * Get whale activity for specific symbol
 */
async function getSymbolWhaleActivity(symbol) {
  const alerts = await fetchWhaleAlerts();

  const symbolBase = symbol.replace(/USDT|BUSD|USD|USDC/i, '').toUpperCase();
  const symbolAlerts = whaleState.symbolAlerts[symbolBase] || { alerts: [], totalVolume: 0, netFlow: 0 };

  // Calculate signal
  let signal = 'neutral';
  if (symbolAlerts.netFlow > 10000000) signal = 'bullish';
  else if (symbolAlerts.netFlow > 5000000) signal = 'slightly_bullish';
  else if (symbolAlerts.netFlow < -10000000) signal = 'bearish';
  else if (symbolAlerts.netFlow < -5000000) signal = 'slightly_bearish';

  return {
    symbol,
    lastHour: {
      transactionCount: symbolAlerts.alerts.length,
      totalVolume: symbolAlerts.totalVolume,
      netFlow: symbolAlerts.netFlow,
      signal
    },
    recentAlerts: symbolAlerts.alerts.slice(0, 10),
    exchangeFlows: whaleState.exchangeFlows,
    recommendation: generateWhaleRecommendation(symbolAlerts, signal)
  };
}

/**
 * Generate whale-based recommendation
 */
function generateWhaleRecommendation(symbolAlerts, signal) {
  const recommendations = [];

  if (symbolAlerts.netFlow > 20000000) {
    recommendations.push({
      type: 'ACCUMULATION',
      priority: 'high',
      message: 'Large outflows from exchanges - whales accumulating',
      action: 'Consider long positions'
    });
  } else if (symbolAlerts.netFlow < -20000000) {
    recommendations.push({
      type: 'DISTRIBUTION',
      priority: 'high',
      message: 'Large inflows to exchanges - potential selling pressure',
      action: 'Consider reducing exposure'
    });
  }

  // Check for massive single transactions
  const massive = symbolAlerts.alerts.filter(a => a.significance === 'massive' || a.significance === 'huge');
  if (massive.length > 0) {
    recommendations.push({
      type: 'WHALE_ALERT',
      priority: 'high',
      message: `${massive.length} massive transaction(s) detected`,
      action: 'Monitor for volatility'
    });
  }

  return recommendations;
}

/**
 * Load cached whale data
 */
function loadWhaleCache() {
  try {
    if (fs.existsSync(WHALE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(WHALE_CACHE_FILE, 'utf-8'));
      whaleState = { ...whaleState, ...data };
    }
  } catch (err) {
    // Ignore
  }
}

/**
 * Save whale cache
 */
function saveWhaleCache() {
  try {
    const dir = path.dirname(WHALE_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(WHALE_CACHE_FILE, JSON.stringify(whaleState, null, 2));
  } catch (err) {
    // Ignore
  }
}

// Initialize
loadWhaleCache();

module.exports = {
  fetchWhaleAlerts,
  getSymbolWhaleActivity,
  generateWhaleSummary
};
