/**
 * Chat Handler - Rule-based command parser for AI chat interface
 * Processes user messages and routes to appropriate handlers
 */

const intents = [
  {
    name: 'open_trade',
    priority: 1,
    patterns: [
      /\b(open|enter|buy|long)\b.*\b([A-Z]{2,10}USDT)\b/i,
      /\b(sell|short)\b.*\b([A-Z]{2,10}USDT)\b/i,
    ],
    handler: handleOpenTrade
  },
  {
    name: 'close_trade',
    priority: 2,
    patterns: [
      /\bclose\s+all\b/i,
      /\b(close|exit)\b.*\b([A-Z]{2,10}USDT)\b/i,
    ],
    handler: handleCloseTrade
  },
  {
    name: 'market_analysis',
    priority: 3,
    patterns: [
      /\b(analyze|analysis|scan|check)\b.*\b([A-Z]{2,10}USDT)\b/i,
      /\b(what|how)\b.*\b([A-Z]{2,10}USDT)\b/i,
      /\b([A-Z]{2,10}USDT)\b.*\b(signal|analysis|outlook|look|doing|trend)\b/i,
    ],
    handler: handleMarketAnalysis
  },
  {
    name: 'set_risk',
    priority: 4,
    patterns: [
      /\b(set|change|update)\b.*\brisk\b.*?(\d+\.?\d*)\s*%?/i,
    ],
    handler: handleSetRisk
  },
  {
    name: 'set_leverage',
    priority: 5,
    patterns: [
      /\b(set|change|update)\b.*\bleverage\b.*?(\d+)/i,
      /\bleverage\b.*?(\d+)x?/i,
    ],
    handler: handleSetLeverage
  },
  {
    name: 'set_confidence',
    priority: 6,
    patterns: [
      /\b(set|change|update)\b.*\bconfidence\b.*?(\d+\.?\d*)\s*%?/i,
      /\bmin\s*confidence\b.*?(\d+)/i,
    ],
    handler: handleSetConfidence
  },
  {
    name: 'set_max_positions',
    priority: 7,
    patterns: [
      /\b(set|change|update)\b.*\bmax\s*positions?\b.*?(\d+)/i,
    ],
    handler: handleSetMaxPositions
  },
  {
    name: 'position_status',
    priority: 8,
    patterns: [
      /\b(positions?|open\s*trades?|status)\b/i,
      /\bwhat.*(open|position)/i,
    ],
    handler: handlePositionStatus
  },
  {
    name: 'trade_history',
    priority: 9,
    patterns: [
      /\b(history|past\s*trades?|recent\s*trades?|trade\s*log)\b/i,
    ],
    handler: handleTradeHistory
  },
  {
    name: 'pattern_stats',
    priority: 10,
    patterns: [
      /\b(pattern|learn)\b.*\b(stats?|statistics?|memory|performance)\b/i,
      /\bshow\b.*\bpatterns?\b/i,
      /\bbest\s*patterns?\b/i,
    ],
    handler: handlePatternStats
  },
  {
    name: 'trading_settings',
    priority: 12,
    patterns: [
      /\b(settings|config|configuration|params|parameters)\b/i,
      /\bshow\b.*\bsettings\b/i,
    ],
    handler: handleShowSettings
  },
  {
    name: 'top_signals',
    priority: 13,
    patterns: [
      /\b(top|best|strongest|highest)\b.*\bsignal/i,
      /\bsignal.*\b(top|best|strongest)\b/i,
    ],
    handler: handleTopSignals
  },
  {
    name: 'top_movers',
    priority: 11,
    patterns: [
      /\b(top|biggest?|hot)\b.*\b(mover|gainer|pump|pumping|rising|green)\b/i,
      /\bwhat.*(pump|moving|moon|rising|green)\b/i,
      /\b(pump|moon|rising|gainer|mover)\b/i,
    ],
    handler: handleTopMovers
  },
  {
    name: 'help',
    priority: 99,
    patterns: [
      /\b(help|commands?|what can you|menu)\b/i,
    ],
    handler: handleHelp
  }
];

// Normalize symbol: append USDT if missing
function normalizeSymbol(raw, trackedSymbols) {
  let sym = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!sym.endsWith('USDT')) sym += 'USDT';
  // Check if tracked
  if (trackedSymbols && !trackedSymbols.includes(sym)) {
    // Try to find partial match
    const match = trackedSymbols.find(s => s.startsWith(sym.replace('USDT', '')));
    if (match) return match;
  }
  return sym;
}

// Extract symbol from regex match groups
function extractSymbol(match, ctx) {
  // Look through all capture groups for something that looks like a symbol
  for (let i = 1; i < match.length; i++) {
    const g = match[i];
    if (g && /^[A-Z]{2,10}USDT$/i.test(g)) {
      return normalizeSymbol(g, ctx.trackedSymbols);
    }
  }
  // Try to find symbol in the full match string
  const symbolMatch = match[0].match(/\b([A-Z]{2,10}USDT)\b/i);
  if (symbolMatch) return normalizeSymbol(symbolMatch[1], ctx.trackedSymbols);
  return null;
}

// Find signal for a symbol across all intervals
function findSignal(symbol, ctx) {
  for (const [key, signal] of ctx.latestSignals) {
    if (signal.symbol === symbol) return signal;
  }
  return null;
}

async function handleOpenTrade(match, ctx) {
  const symbol = extractSymbol(match, ctx);
  if (!symbol) {
    return { type: 'error', message: 'Could not identify symbol. Try: "open long BTCUSDT"' };
  }

  const signal = findSignal(symbol, ctx);
  if (!signal) {
    return { type: 'error', message: `No signal data available for ${symbol}. It may not be tracked.` };
  }

  // Determine direction from message
  const msg = match[0].toLowerCase();
  let wantedDirection = null;
  if (/\b(long|buy)\b/.test(msg)) wantedDirection = 'long';
  if (/\b(short|sell)\b/.test(msg)) wantedDirection = 'short';

  if (!signal.ai?.trade) {
    return { type: 'error', message: `No trade setup available for ${symbol}. AI confidence: ${((signal.ai?.confidence || 0) * 100).toFixed(0)}%` };
  }

  // Override direction if user specified
  if (wantedDirection && signal.ai.trade.type !== wantedDirection.toUpperCase()) {
    return {
      type: 'text',
      message: `AI signal for ${symbol} is ${signal.ai.trade.type}, but you requested ${wantedDirection.toUpperCase()}. Cannot override AI direction for safety. Wait for matching signal or type "analyze ${symbol}" to check.`
    };
  }

  try {
    const result = await ctx.executeTrade(signal);
    if (result.executed) {
      return {
        type: 'trade',
        message: `Trade opened: ${result.order.side} ${symbol}\nEntry: ${signal.ai.trade.entry}\nSL: ${result.order.stopLoss} | TP: ${result.order.takeProfit}\nQty: ${result.order.quantity}`,
        data: result.order
      };
    } else {
      return { type: 'error', message: `Could not open trade: ${result.reason}` };
    }
  } catch (err) {
    return { type: 'error', message: `Trade error: ${err.message}` };
  }
}

async function handleCloseTrade(match, ctx) {
  const msg = match[0].toLowerCase();

  if (/close\s+all/i.test(msg)) {
    const status = ctx.getTradingStatus();
    const positions = status.openPositions || [];
    if (positions.length === 0) {
      return { type: 'text', message: 'No open positions to close.' };
    }

    const results = [];
    for (const pos of positions) {
      const r = await ctx.closePosition(pos.symbol, 'chat command');
      results.push(`${pos.symbol}: ${r.closed ? 'closed' : r.reason}`);
    }
    return {
      type: 'text',
      message: `Closed ${results.length} position(s):\n${results.join('\n')}`
    };
  }

  const symbol = extractSymbol(match, ctx);
  if (!symbol) {
    return { type: 'error', message: 'Specify symbol to close. Try: "close BTCUSDT" or "close all"' };
  }

  try {
    const result = await ctx.closePosition(symbol, 'chat command');
    if (result.closed) {
      return { type: 'trade', message: `Position closed for ${symbol} (${result.result})`, data: result };
    } else {
      return { type: 'error', message: `Could not close ${symbol}: ${result.reason}` };
    }
  } catch (err) {
    return { type: 'error', message: `Close error: ${err.message}` };
  }
}

function handleMarketAnalysis(match, ctx) {
  const symbol = extractSymbol(match, ctx);
  if (!symbol) {
    return { type: 'error', message: 'Specify a symbol. Try: "analyze BTCUSDT"' };
  }

  const signal = findSignal(symbol, ctx);
  if (!signal) {
    return { type: 'error', message: `No data for ${symbol}. It may not be tracked.\nTracked: ${ctx.trackedSymbols.slice(0, 10).join(', ')}${ctx.trackedSymbols.length > 10 ? '...' : ''}` };
  }

  const ind = signal.indicators || {};
  const ai = signal.ai || {};
  const trade = ai.trade;

  let msg = `${symbol} Analysis (${signal.interval})\n`;
  msg += `Signal: ${signal.signal || 'NEUTRAL'}\n`;
  msg += `Confidence: ${((ai.confidence || 0) * 100).toFixed(0)}%\n`;
  msg += `Direction: ${ai.direction || 'neutral'}\n\n`;

  msg += `RSI: ${ind.rsi?.toFixed(1) || 'N/A'}\n`;
  msg += `MACD: ${ind.macd?.histogram?.toFixed(4) || 'N/A'}\n`;
  msg += `Trend: ${ind.trend?.direction || 'N/A'}\n`;
  msg += `BB %B: ${ind.bollinger?.pb?.toFixed(2) || 'N/A'}\n`;
  msg += `Volume Spike: ${ind.volumeSpike ? 'Yes' : 'No'}\n`;

  if (ind.sniperSignals) {
    const sniper = ind.sniperSignals;
    const active = [];
    if (sniper.divergence?.type) active.push(`Divergence: ${sniper.divergence.type}`);
    if (sniper.volumeAccumulation?.detected) active.push(`Vol Accum: ${sniper.volumeAccumulation.direction}`);
    if (sniper.squeeze?.inSqueeze) active.push('Squeeze');
    if (sniper.momentumBuilding?.detected) active.push(`Momentum: ${sniper.momentumBuilding.direction}`);
    if (active.length > 0) msg += `\nSniper: ${active.join(', ')}`;
  }

  if (trade) {
    msg += `\n\nTrade Setup (${trade.type}):`;
    msg += `\nEntry: $${trade.entry}`;
    msg += `\nSL: $${trade.stopLoss}`;
    msg += `\nTP1: $${trade.takeProfit?.[0] || 'N/A'}`;
  }

  const data = {
    price: ind.currentPrice,
    rsi: ind.rsi?.toFixed(1),
    trend: ind.trend?.direction,
    confidence: ((ai.confidence || 0) * 100).toFixed(0),
    signal: signal.signal,
    macd: ind.macd?.histogram?.toFixed(4)
  };

  return { type: 'analysis', message: msg, data };
}

function handleSetRisk(match, ctx) {
  // Extract number from last capture group
  const value = parseFloat(match[match.length - 1] || match[2]);
  if (isNaN(value) || value < 1 || value > 20) {
    return { type: 'error', message: 'Risk must be between 1% and 20%. Try: "set risk 3%"' };
  }

  const updated = ctx.updateSettings({ riskPerTrade: value / 100 });
  return {
    type: 'settings',
    message: `Risk per trade updated to ${(updated.riskPerTrade * 100).toFixed(1)}%`,
    data: updated
  };
}

function handleSetLeverage(match, ctx) {
  const value = parseInt(match[match.length - 1] || match[2]);
  if (isNaN(value) || value < 1 || value > 125) {
    return { type: 'error', message: 'Leverage must be between 1x and 125x. Try: "set leverage 20"' };
  }

  const updated = ctx.updateSettings({ leverage: value });
  return {
    type: 'settings',
    message: `Leverage updated to ${updated.leverage}x`,
    data: updated
  };
}

function handleSetConfidence(match, ctx) {
  const value = parseFloat(match[match.length - 1] || match[2]);
  if (isNaN(value) || value < 50 || value > 95) {
    return { type: 'error', message: 'Confidence must be between 50% and 95%. Try: "set confidence 70%"' };
  }

  const updated = ctx.updateSettings({ minConfidence: value / 100 });
  return {
    type: 'settings',
    message: `Min confidence updated to ${(updated.minConfidence * 100).toFixed(0)}%`,
    data: updated
  };
}

function handleSetMaxPositions(match, ctx) {
  const value = parseInt(match[match.length - 1] || match[2]);
  if (isNaN(value) || value < 1 || value > 20) {
    return { type: 'error', message: 'Max positions must be between 1 and 20. Try: "set max positions 3"' };
  }

  const updated = ctx.updateSettings({ maxOpenPositions: value });
  return {
    type: 'settings',
    message: `Max open positions updated to ${updated.maxOpenPositions}`,
    data: updated
  };
}

function handlePositionStatus(match, ctx) {
  const status = ctx.getTradingStatus();
  const positions = status.openPositions || [];

  if (positions.length === 0) {
    return {
      type: 'positions',
      message: `No open positions.\nTrading: ${status.enabled ? 'Enabled' : 'Disabled'}\nDaily trades: ${status.dailyTrades}`,
      data: { positions: [], enabled: status.enabled, dailyTrades: status.dailyTrades }
    };
  }

  let msg = `Open Positions (${positions.length}):\n\n`;
  for (const pos of positions) {
    const age = Math.round((Date.now() - pos.openTime) / 60000);
    msg += `${pos.side} ${pos.symbol}\n`;
    msg += `  Entry: $${pos.entryPrice} | SL: $${pos.stopLoss} | TP: $${pos.takeProfit}\n`;
    msg += `  Qty: ${pos.quantity} | Age: ${age}m\n\n`;
  }

  return {
    type: 'positions',
    message: msg.trim(),
    data: { positions, enabled: status.enabled, dailyTrades: status.dailyTrades }
  };
}

function handleTradeHistory(match, ctx) {
  const status = ctx.getTradingStatus();
  const history = status.tradeHistory || [];

  if (history.length === 0) {
    return { type: 'text', message: 'No trade history yet.' };
  }

  const recent = history.slice(-10).reverse();
  let msg = `Recent Trades (${recent.length} of ${history.length}):\n\n`;
  for (const t of recent) {
    const time = new Date(t.timestamp).toLocaleString();
    msg += `${t.side} ${t.symbol} - ${t.status}\n`;
    msg += `  Entry: $${t.entryPrice} | Conf: ${((t.confidence || 0) * 100).toFixed(0)}%\n`;
    if (t.closeReason) msg += `  Exit: ${t.closeReason}\n`;
    msg += `  ${time}\n\n`;
  }

  return { type: 'history', message: msg.trim(), data: { history: recent, total: history.length } };
}

function handlePatternStats(match, ctx) {
  const stats = ctx.getPatternStats();

  if (!stats) {
    return { type: 'text', message: 'Pattern memory not available.' };
  }

  let msg = `Pattern Learning Stats:\n\n`;
  msg += `Memorized: ${stats.memorizedPatterns} patterns\n`;
  msg += `Total recorded: ${stats.totalPatterns}\n`;
  msg += `Wins: ${stats.successfulPatterns}\n`;
  msg += `Win Rate: ${stats.winRate}%\n`;

  if (stats.bestPatterns?.length > 0) {
    msg += `\nTop Patterns:\n`;
    for (const p of stats.bestPatterns) {
      msg += `  ${p.hash.substring(0, 30)}... (${p.winRate}% win, ${p.count} trades)\n`;
    }
  }

  return { type: 'patterns', message: msg.trim(), data: stats };
}

function handleShowSettings(match, ctx) {
  const status = ctx.getTradingStatus();
  const s = status.settings;

  let msg = `Trading Settings:\n\n`;
  msg += `Trading: ${status.enabled ? 'Enabled' : 'Disabled'}\n`;
  msg += `API Keys: ${status.hasApiKeys ? 'Configured' : 'Missing'}\n`;
  msg += `Risk/Trade: ${s.riskPerTrade.toFixed(1)}%\n`;
  msg += `Min Confidence: ${s.minConfidence.toFixed(0)}%\n`;
  msg += `Max Positions: ${s.maxOpenPositions}\n`;
  msg += `Max Daily Trades: ${s.maxDailyTrades}\n`;
  msg += `Leverage: ${s.leverage}x\n`;
  msg += `\nDaily trades used: ${status.dailyTrades}`;
  msg += `\nOpen positions: ${(status.openPositions || []).length}`;

  return {
    type: 'settings',
    message: msg,
    data: { ...s, enabled: status.enabled, hasApiKeys: status.hasApiKeys }
  };
}

function handleTopSignals(match, ctx) {
  const signals = Array.from(ctx.latestSignals.values())
    .filter(s => s.ai?.confidence >= 0.6 && s.signal !== 'NEUTRAL')
    .sort((a, b) => (b.ai?.confidence || 0) - (a.ai?.confidence || 0))
    .slice(0, 5);

  if (signals.length === 0) {
    return { type: 'text', message: 'No strong signals at the moment.' };
  }

  let msg = `Top Signals:\n\n`;
  for (const s of signals) {
    msg += `${s.signal} ${s.symbol} (${s.interval})\n`;
    msg += `  Confidence: ${((s.ai?.confidence || 0) * 100).toFixed(0)}%`;
    if (s.ai?.trade) msg += ` | Entry: $${s.ai.trade.entry}`;
    msg += `\n`;
    if (s.ai?.reasons?.[0]) msg += `  ${s.ai.reasons[0]}\n`;
    msg += `\n`;
  }

  return { type: 'text', message: msg.trim() };
}

async function handleTopMovers(match, ctx) {
  if (!ctx.getTopGainers) {
    return { type: 'error', message: 'Top movers scanner not available.' };
  }

  try {
    const gainers = await ctx.getTopGainers(3, 15);
    if (!gainers || gainers.length === 0) {
      return { type: 'text', message: 'No significant movers right now (>3% with >$1M volume).' };
    }

    let msg = `Top Movers (24h):\n\n`;
    for (const g of gainers.slice(0, 10)) {
      const dir = g.priceChangePercent > 0 ? '+' : '';
      msg += `${g.symbol.replace('USDT', '/USDT')} ${dir}${g.priceChangePercent.toFixed(1)}%`;
      msg += ` — $${g.lastPrice}`;
      msg += ` (Vol: $${(g.volume / 1e6).toFixed(1)}M)\n`;

      // Check if we have a signal for this mover
      const signal = findSignal(g.symbol, ctx);
      if (signal && signal.signal !== 'NEUTRAL') {
        msg += `  Signal: ${signal.signal} (${((signal.ai?.confidence || 0) * 100).toFixed(0)}%)\n`;
      }
    }

    return { type: 'text', message: msg.trim() };
  } catch (err) {
    return { type: 'error', message: `Failed to fetch top movers: ${err.message}` };
  }
}

function handleHelp() {
  const msg = `FuturesAI Chat Commands:

Market:
  "analyze BTCUSDT" - Full market analysis
  "top signals" - View strongest signals
  "top movers" - View biggest pumps today

Trading:
  "open long BTCUSDT" - Open a trade
  "short ETHUSDT" - Open short trade
  "close BTCUSDT" - Close a position
  "close all" - Close all positions
  "positions" - View open positions
  "history" - View trade history

Settings:
  "settings" - View current config
  "set risk 3%" - Change risk (1-20%)
  "set leverage 20" - Change leverage (1-125x)
  "set confidence 70%" - Min confidence (50-95%)
  "set max positions 3" - Max positions (1-20)

Learning:
  "pattern stats" - Pattern memory stats`;

  return { type: 'text', message: msg };
}

async function handleChatMessage(userMessage, context) {
  const normalized = userMessage.trim();
  if (!normalized) {
    return { type: 'text', message: 'Type "help" to see available commands.' };
  }

  const sorted = [...intents].sort((a, b) => a.priority - b.priority);

  for (const intent of sorted) {
    for (const pattern of intent.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        try {
          return await intent.handler(match, context);
        } catch (err) {
          console.error(`Chat handler error (${intent.name}):`, err.message);
          return { type: 'error', message: `Error: ${err.message}` };
        }
      }
    }
  }

  return {
    type: 'text',
    message: `I didn't understand that. Type "help" to see available commands.`
  };
}

module.exports = { handleChatMessage };
