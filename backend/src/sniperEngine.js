/**
 * Professional Sniper Entry System
 * Advanced entry techniques: Liquidity Grabs, Fair Value Gaps, Order Blocks, ICT Concepts
 * Designed for precision entries with high probability setups
 */

/**
 * Main Sniper Analysis Function
 * Analyzes price action for professional entry opportunities
 * @param {Array} candles - OHLCV candle data
 * @param {Object} indicators - Technical indicators
 * @returns {Object} Sniper analysis with entry signals
 */
function analyzeSniperSetup(candles, indicators) {
  if (!candles || candles.length < 50) {
    return { hasSetup: false, entries: [] };
  }

  const entries = [];

  // Detect all sniper setups
  const liquidityGrab = detectLiquidityGrab(candles);
  const fairValueGap = detectFairValueGap(candles);
  const orderBlock = detectOrderBlock(candles);
  const breaker = detectBreakerBlock(candles);
  const mitigation = detectMitigationBlock(candles);
  const inducement = detectInducement(candles);
  const optimalEntry = detectOptimalTradeEntry(candles, indicators);
  const killzone = detectKillzone();
  const smartMoney = detectSmartMoneyDivergence(candles, indicators);

  // Collect valid entries
  if (liquidityGrab.detected) entries.push(liquidityGrab);
  if (fairValueGap.detected) entries.push(fairValueGap);
  if (orderBlock.detected) entries.push(orderBlock);
  if (breaker.detected) entries.push(breaker);
  if (mitigation.detected) entries.push(mitigation);
  if (inducement.detected) entries.push(inducement);
  if (optimalEntry.detected) entries.push(optimalEntry);
  if (smartMoney.detected) entries.push(smartMoney);

  // Sort by confidence
  entries.sort((a, b) => b.confidence - a.confidence);

  // Calculate combined sniper score
  const sniperScore = calculateCombinedSniperScore(entries, killzone);

  return {
    hasSetup: entries.length > 0,
    entries,
    bestEntry: entries[0] || null,
    sniperScore,
    killzone,
    entryCount: entries.length,
    recommendation: generateSniperRecommendation(entries, killzone, indicators)
  };
}

/**
 * Liquidity Grab Detection (Stop Hunt / Sweep)
 * Detects when price sweeps above/below a key level then reverses
 */
function detectLiquidityGrab(candles) {
  const result = {
    detected: false,
    type: 'LIQUIDITY_GRAB',
    direction: null,
    confidence: 0,
    entryZone: null,
    stopLoss: null,
    target: null
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-20);
  const lastCandle = recent.at(-1);
  const prevCandles = recent.slice(0, -1);

  // Find swing highs and lows
  const swingHighs = findSwingPoints(prevCandles, 'high');
  const swingLows = findSwingPoints(prevCandles, 'low');

  // Bullish Liquidity Grab: Price sweeps below swing low then closes above it
  for (const swingLow of swingLows) {
    // Wick below swing low
    if (lastCandle.low < swingLow.value && lastCandle.close > swingLow.value) {
      // Strong bullish close
      if (lastCandle.close > lastCandle.open) {
        const wickLength = swingLow.value - lastCandle.low;
        const bodyLength = Math.abs(lastCandle.close - lastCandle.open);

        // Long lower wick indicates rejection
        if (wickLength > bodyLength * 0.5) {
          result.detected = true;
          result.direction = 'bullish';
          result.sweepLevel = round(swingLow.value);
          result.entryZone = round(lastCandle.close);
          result.stopLoss = round(lastCandle.low * 0.998);
          result.target = round(lastCandle.close + (lastCandle.close - lastCandle.low) * 2);
          result.confidence = 70 + Math.min(wickLength / bodyLength * 10, 20);
          result.reason = 'Bullish liquidity grab below swing low';
          return result;
        }
      }
    }
  }

  // Bearish Liquidity Grab: Price sweeps above swing high then closes below it
  for (const swingHigh of swingHighs) {
    if (lastCandle.high > swingHigh.value && lastCandle.close < swingHigh.value) {
      if (lastCandle.close < lastCandle.open) {
        const wickLength = lastCandle.high - swingHigh.value;
        const bodyLength = Math.abs(lastCandle.close - lastCandle.open);

        if (wickLength > bodyLength * 0.5) {
          result.detected = true;
          result.direction = 'bearish';
          result.sweepLevel = round(swingHigh.value);
          result.entryZone = round(lastCandle.close);
          result.stopLoss = round(lastCandle.high * 1.002);
          result.target = round(lastCandle.close - (lastCandle.high - lastCandle.close) * 2);
          result.confidence = 70 + Math.min(wickLength / bodyLength * 10, 20);
          result.reason = 'Bearish liquidity grab above swing high';
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Fair Value Gap (FVG) Detection
 * Imbalance in price where buyers/sellers are dominant
 */
function detectFairValueGap(candles) {
  const result = {
    detected: false,
    type: 'FAIR_VALUE_GAP',
    direction: null,
    confidence: 0,
    gapZone: null,
    entryZone: null
  };

  if (candles.length < 5) return result;

  const recent = candles.slice(-15);

  // Look for FVGs in recent candles
  for (let i = recent.length - 1; i >= 2; i--) {
    const candle1 = recent[i - 2];
    const candle2 = recent[i - 1];
    const candle3 = recent[i];

    // Bullish FVG: Gap between candle 1 high and candle 3 low
    if (candle3.low > candle1.high) {
      const gapSize = candle3.low - candle1.high;
      const gapPercent = gapSize / candle2.close * 100;

      // Significant gap (at least 0.1%)
      if (gapPercent > 0.1) {
        const currentPrice = recent.at(-1).close;

        // Price approaching or in the gap
        if (currentPrice <= candle3.low && currentPrice >= candle1.high * 0.998) {
          result.detected = true;
          result.direction = 'bullish';
          result.gapTop = round(candle3.low);
          result.gapBottom = round(candle1.high);
          result.gapPercent = round(gapPercent, 2);
          result.entryZone = round((candle3.low + candle1.high) / 2); // Middle of gap
          result.stopLoss = round(candle1.high * 0.995);
          result.target = round(currentPrice + gapSize * 3);
          result.confidence = 60 + Math.min(gapPercent * 10, 30);
          result.reason = `Bullish FVG (${gapPercent.toFixed(2)}% gap)`;
          return result;
        }
      }
    }

    // Bearish FVG: Gap between candle 1 low and candle 3 high
    if (candle3.high < candle1.low) {
      const gapSize = candle1.low - candle3.high;
      const gapPercent = gapSize / candle2.close * 100;

      if (gapPercent > 0.1) {
        const currentPrice = recent.at(-1).close;

        if (currentPrice >= candle3.high && currentPrice <= candle1.low * 1.002) {
          result.detected = true;
          result.direction = 'bearish';
          result.gapTop = round(candle1.low);
          result.gapBottom = round(candle3.high);
          result.gapPercent = round(gapPercent, 2);
          result.entryZone = round((candle1.low + candle3.high) / 2);
          result.stopLoss = round(candle1.low * 1.005);
          result.target = round(currentPrice - gapSize * 3);
          result.confidence = 60 + Math.min(gapPercent * 10, 30);
          result.reason = `Bearish FVG (${gapPercent.toFixed(2)}% gap)`;
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Order Block Detection
 * Last opposing candle before a strong move
 */
function detectOrderBlock(candles) {
  const result = {
    detected: false,
    type: 'ORDER_BLOCK',
    direction: null,
    confidence: 0,
    blockZone: null
  };

  if (candles.length < 15) return result;

  const recent = candles.slice(-30);

  // Find strong impulsive moves
  for (let i = recent.length - 1; i >= 5; i--) {
    const candle = recent[i];
    const prevCandles = recent.slice(Math.max(0, i - 5), i);

    // Calculate move strength
    const movePercent = Math.abs(candle.close - candle.open) / candle.open * 100;

    if (movePercent < 0.5) continue; // Need significant move

    // Bullish Order Block: Strong bullish candle preceded by bearish candle
    if (candle.close > candle.open) {
      const lastBearish = [...prevCandles].reverse().find(c => c.close < c.open);

      if (lastBearish) {
        const currentPrice = recent.at(-1).close;
        const blockTop = lastBearish.open;
        const blockBottom = lastBearish.close;

        // Price returning to order block
        if (currentPrice >= blockBottom * 0.998 && currentPrice <= blockTop * 1.002) {
          result.detected = true;
          result.direction = 'bullish';
          result.blockTop = round(blockTop);
          result.blockBottom = round(blockBottom);
          result.entryZone = round((blockTop + blockBottom) / 2);
          result.stopLoss = round(blockBottom * 0.995);
          result.target = round(currentPrice + movePercent / 100 * currentPrice);
          result.confidence = 65 + Math.min(movePercent * 5, 25);
          result.reason = 'Price at bullish order block';
          return result;
        }
      }
    }

    // Bearish Order Block
    if (candle.close < candle.open) {
      const lastBullish = [...prevCandles].reverse().find(c => c.close > c.open);

      if (lastBullish) {
        const currentPrice = recent.at(-1).close;
        const blockTop = lastBullish.close;
        const blockBottom = lastBullish.open;

        if (currentPrice <= blockTop * 1.002 && currentPrice >= blockBottom * 0.998) {
          result.detected = true;
          result.direction = 'bearish';
          result.blockTop = round(blockTop);
          result.blockBottom = round(blockBottom);
          result.entryZone = round((blockTop + blockBottom) / 2);
          result.stopLoss = round(blockTop * 1.005);
          result.target = round(currentPrice - movePercent / 100 * currentPrice);
          result.confidence = 65 + Math.min(movePercent * 5, 25);
          result.reason = 'Price at bearish order block';
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Breaker Block Detection
 * Failed order block that becomes support/resistance
 */
function detectBreakerBlock(candles) {
  const result = {
    detected: false,
    type: 'BREAKER_BLOCK',
    direction: null,
    confidence: 0
  };

  if (candles.length < 30) return result;

  const recent = candles.slice(-40);

  // Find order blocks that were broken
  for (let i = 10; i < recent.length - 5; i++) {
    const candle = recent[i];
    const bodySize = Math.abs(candle.close - candle.open);

    if (bodySize / candle.close < 0.003) continue; // Skip small candles

    // Bullish breaker: Previous bearish order block broken and retested
    if (candle.close < candle.open) { // Bearish candle (potential order block)
      const blockHigh = candle.open;
      const blockLow = candle.close;

      // Check if price broke above this block
      const breakCandles = recent.slice(i + 1);
      const broke = breakCandles.some(c => c.close > blockHigh);

      if (broke) {
        const currentPrice = recent.at(-1).close;

        // Price retesting the broken block from above (now support)
        if (currentPrice >= blockLow * 0.998 && currentPrice <= blockHigh * 1.005) {
          result.detected = true;
          result.direction = 'bullish';
          result.blockHigh = round(blockHigh);
          result.blockLow = round(blockLow);
          result.entryZone = round(blockHigh);
          result.stopLoss = round(blockLow * 0.995);
          result.confidence = 70;
          result.reason = 'Bullish breaker block retest';
          return result;
        }
      }
    }

    // Bearish breaker
    if (candle.close > candle.open) { // Bullish candle
      const blockHigh = candle.close;
      const blockLow = candle.open;

      const breakCandles = recent.slice(i + 1);
      const broke = breakCandles.some(c => c.close < blockLow);

      if (broke) {
        const currentPrice = recent.at(-1).close;

        if (currentPrice <= blockHigh * 1.002 && currentPrice >= blockLow * 0.995) {
          result.detected = true;
          result.direction = 'bearish';
          result.blockHigh = round(blockHigh);
          result.blockLow = round(blockLow);
          result.entryZone = round(blockLow);
          result.stopLoss = round(blockHigh * 1.005);
          result.confidence = 70;
          result.reason = 'Bearish breaker block retest';
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Mitigation Block Detection
 * Unmitigated order block (first return to zone)
 */
function detectMitigationBlock(candles) {
  const result = {
    detected: false,
    type: 'MITIGATION_BLOCK',
    direction: null,
    confidence: 0
  };

  if (candles.length < 25) return result;

  const recent = candles.slice(-40);

  // Find unmitigated order blocks
  for (let i = 5; i < recent.length - 10; i++) {
    const candle = recent[i];
    const bodyPercent = Math.abs(candle.close - candle.open) / candle.close * 100;

    if (bodyPercent < 0.3) continue;

    // Bullish mitigation: Strong bullish candle, price returning for first time
    if (candle.close > candle.open && bodyPercent > 0.5) {
      const mitZone = candle.open; // Bottom of bullish candle

      // Check if price has returned to this zone
      const afterCandles = recent.slice(i + 1);
      const touchedBefore = afterCandles.slice(0, -3).some(c => c.low <= mitZone * 1.002);

      if (!touchedBefore) {
        const currentPrice = recent.at(-1).close;

        if (currentPrice >= candle.open * 0.998 && currentPrice <= candle.close * 1.002) {
          result.detected = true;
          result.direction = 'bullish';
          result.mitigationZone = round(mitZone);
          result.entryZone = round(mitZone);
          result.stopLoss = round(mitZone * 0.99);
          result.confidence = 75;
          result.reason = 'First return to bullish mitigation zone';
          return result;
        }
      }
    }

    // Bearish mitigation
    if (candle.close < candle.open && bodyPercent > 0.5) {
      const mitZone = candle.open;

      const afterCandles = recent.slice(i + 1);
      const touchedBefore = afterCandles.slice(0, -3).some(c => c.high >= mitZone * 0.998);

      if (!touchedBefore) {
        const currentPrice = recent.at(-1).close;

        if (currentPrice <= candle.open * 1.002 && currentPrice >= candle.close * 0.998) {
          result.detected = true;
          result.direction = 'bearish';
          result.mitigationZone = round(mitZone);
          result.entryZone = round(mitZone);
          result.stopLoss = round(mitZone * 1.01);
          result.confidence = 75;
          result.reason = 'First return to bearish mitigation zone';
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Inducement Detection
 * Fake breakout to trap traders before real move
 */
function detectInducement(candles) {
  const result = {
    detected: false,
    type: 'INDUCEMENT',
    direction: null,
    confidence: 0
  };

  if (candles.length < 15) return result;

  const recent = candles.slice(-20);
  const lastCandle = recent.at(-1);
  const prevCandle = recent.at(-2);

  // Find recent range highs and lows
  const recentHigh = Math.max(...recent.slice(0, -2).map(c => c.high));
  const recentLow = Math.min(...recent.slice(0, -2).map(c => c.low));

  // Bullish Inducement: Previous candle broke below range, current candle reverses
  if (prevCandle.low < recentLow && prevCandle.close < recentLow) {
    if (lastCandle.close > prevCandle.high && lastCandle.close > lastCandle.open) {
      result.detected = true;
      result.direction = 'bullish';
      result.inducementLevel = round(recentLow);
      result.entryZone = round(lastCandle.close);
      result.stopLoss = round(prevCandle.low * 0.998);
      result.target = round(recentHigh);
      result.confidence = 72;
      result.reason = 'Bullish inducement - fake breakdown trapped shorts';
      return result;
    }
  }

  // Bearish Inducement
  if (prevCandle.high > recentHigh && prevCandle.close > recentHigh) {
    if (lastCandle.close < prevCandle.low && lastCandle.close < lastCandle.open) {
      result.detected = true;
      result.direction = 'bearish';
      result.inducementLevel = round(recentHigh);
      result.entryZone = round(lastCandle.close);
      result.stopLoss = round(prevCandle.high * 1.002);
      result.target = round(recentLow);
      result.confidence = 72;
      result.reason = 'Bearish inducement - fake breakout trapped longs';
      return result;
    }
  }

  return result;
}

/**
 * Optimal Trade Entry (OTE) Detection
 * Entry at 61.8-78.6% Fibonacci retracement
 */
function detectOptimalTradeEntry(candles, indicators) {
  const result = {
    detected: false,
    type: 'OPTIMAL_TRADE_ENTRY',
    direction: null,
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const currentPrice = recent.at(-1).close;

  // Find recent swing high and low
  const swingHigh = Math.max(...recent.map(c => c.high));
  const swingLow = Math.min(...recent.map(c => c.low));
  const range = swingHigh - swingLow;

  if (range / currentPrice < 0.02) return result; // Need significant range

  // Calculate Fibonacci levels
  const fib618 = swingHigh - range * 0.618;
  const fib786 = swingHigh - range * 0.786;
  const fib50 = swingHigh - range * 0.5;

  // For bullish OTE (looking for uptrend continuation)
  const inUptrend = indicators?.trend?.direction?.includes('UP');
  if (inUptrend && currentPrice >= fib786 && currentPrice <= fib618) {
    result.detected = true;
    result.direction = 'bullish';
    result.fibLevel = round((swingHigh - currentPrice) / range * 100, 1);
    result.entryZone = round(currentPrice);
    result.stopLoss = round(swingLow * 0.995);
    result.target = round(swingHigh * 1.005);
    result.confidence = 75;
    result.reason = `Bullish OTE at ${result.fibLevel}% retracement`;
    result.fibLevels = {
      '0%': round(swingHigh),
      '50%': round(fib50),
      '61.8%': round(fib618),
      '78.6%': round(fib786),
      '100%': round(swingLow)
    };
    return result;
  }

  // For bearish OTE
  const bearFib618 = swingLow + range * 0.618;
  const bearFib786 = swingLow + range * 0.786;

  const inDowntrend = indicators?.trend?.direction?.includes('DOWN');
  if (inDowntrend && currentPrice >= bearFib618 && currentPrice <= bearFib786) {
    result.detected = true;
    result.direction = 'bearish';
    result.fibLevel = round((currentPrice - swingLow) / range * 100, 1);
    result.entryZone = round(currentPrice);
    result.stopLoss = round(swingHigh * 1.005);
    result.target = round(swingLow * 0.995);
    result.confidence = 75;
    result.reason = `Bearish OTE at ${result.fibLevel}% retracement`;
    return result;
  }

  return result;
}

/**
 * Kill Zone Detection
 * Optimal trading times (London, NY Open/Close)
 */
function detectKillzone() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const killzones = {
    asianSession: utcHour >= 0 && utcHour < 8,
    londonOpen: utcHour >= 7 && utcHour < 10,
    nyOpen: utcHour >= 12 && utcHour < 15,
    londonClose: utcHour >= 15 && utcHour < 17,
    nyClose: utcHour >= 20 && utcHour < 22
  };

  const activeKillzone = Object.entries(killzones).find(([, active]) => active)?.[0] || null;
  const isOptimalTime = killzones.londonOpen || killzones.nyOpen;

  return {
    currentUTCHour: utcHour,
    activeKillzone,
    isOptimalTime,
    killzones,
    recommendation: isOptimalTime
      ? 'High volatility expected - good for entries'
      : 'Lower volatility period - consider waiting'
  };
}

/**
 * Smart Money Divergence Detection
 * Volume/price divergence indicating institutional activity
 */
function detectSmartMoneyDivergence(candles, indicators) {
  const result = {
    detected: false,
    type: 'SMART_MONEY_DIVERGENCE',
    direction: null,
    confidence: 0
  };

  if (candles.length < 10 || !indicators) return result;

  const recent = candles.slice(-10);
  const closes = recent.map(c => c.close);
  const volumes = recent.map(c => c.volume);

  // Calculate price and volume changes
  const priceChange = (closes.at(-1) - closes[0]) / closes[0] * 100;
  const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;
  const recentVolume = (volumes.at(-1) + volumes.at(-2) + volumes.at(-3)) / 3;
  const volumeRatio = recentVolume / avgVolume;

  // Bullish SMD: Price down/flat but volume accumulating
  if (priceChange < 0.5 && priceChange > -2 && volumeRatio > 1.5) {
    // Check for bullish candles on high volume
    const bullishVolume = recent.filter(c => c.close > c.open)
      .reduce((sum, c) => sum + c.volume, 0);
    const bearishVolume = recent.filter(c => c.close < c.open)
      .reduce((sum, c) => sum + c.volume, 0);

    if (bullishVolume > bearishVolume * 1.3) {
      result.detected = true;
      result.direction = 'bullish';
      result.volumeRatio = round(volumeRatio, 2);
      result.priceChange = round(priceChange, 2);
      result.confidence = 68 + Math.min(volumeRatio * 5, 20);
      result.reason = 'Smart money accumulation detected';
      result.entryZone = round(recent.at(-1).close);
      result.stopLoss = round(Math.min(...recent.map(c => c.low)) * 0.995);
      return result;
    }
  }

  // Bearish SMD: Price up/flat but distribution
  if (priceChange > -0.5 && priceChange < 2 && volumeRatio > 1.5) {
    const bullishVolume = recent.filter(c => c.close > c.open)
      .reduce((sum, c) => sum + c.volume, 0);
    const bearishVolume = recent.filter(c => c.close < c.open)
      .reduce((sum, c) => sum + c.volume, 0);

    if (bearishVolume > bullishVolume * 1.3) {
      result.detected = true;
      result.direction = 'bearish';
      result.volumeRatio = round(volumeRatio, 2);
      result.priceChange = round(priceChange, 2);
      result.confidence = 68 + Math.min(volumeRatio * 5, 20);
      result.reason = 'Smart money distribution detected';
      result.entryZone = round(recent.at(-1).close);
      result.stopLoss = round(Math.max(...recent.map(c => c.high)) * 1.005);
      return result;
    }
  }

  return result;
}

// ============ HELPER FUNCTIONS ============

function findSwingPoints(candles, type) {
  const points = [];
  const values = candles.map(c => c[type]);

  for (let i = 2; i < values.length - 2; i++) {
    if (type === 'high') {
      if (values[i] > values[i-1] && values[i] > values[i-2] &&
          values[i] > values[i+1] && values[i] > values[i+2]) {
        points.push({ index: i, value: values[i] });
      }
    } else {
      if (values[i] < values[i-1] && values[i] < values[i-2] &&
          values[i] < values[i+1] && values[i] < values[i+2]) {
        points.push({ index: i, value: values[i] });
      }
    }
  }

  return points;
}

function calculateCombinedSniperScore(entries, killzone) {
  if (entries.length === 0) return 0;

  let score = 0;

  // Base score from entries
  for (const entry of entries) {
    score += entry.confidence * 0.3;
  }

  // Confluence bonus
  if (entries.length >= 2) score += 10;
  if (entries.length >= 3) score += 15;

  // Kill zone bonus
  if (killzone.isOptimalTime) score += 10;

  // Direction alignment bonus
  const directions = entries.map(e => e.direction);
  const allBullish = directions.every(d => d === 'bullish');
  const allBearish = directions.every(d => d === 'bearish');
  if (allBullish || allBearish) score += 15;

  return Math.min(Math.round(score), 100);
}

function generateSniperRecommendation(entries, killzone, indicators) {
  if (entries.length === 0) {
    return {
      action: 'WAIT',
      reason: 'No sniper setups detected',
      confidence: 0
    };
  }

  const bestEntry = entries[0];
  const confluenceCount = entries.filter(e => e.direction === bestEntry.direction).length;

  // Check trend alignment
  const trendDirection = indicators?.trend?.direction;
  const trendAligned = (bestEntry.direction === 'bullish' && trendDirection?.includes('UP')) ||
                       (bestEntry.direction === 'bearish' && trendDirection?.includes('DOWN'));

  let confidence = bestEntry.confidence;
  if (confluenceCount >= 2) confidence += 5;
  if (confluenceCount >= 3) confidence += 10;
  if (trendAligned) confidence += 5;
  if (killzone.isOptimalTime) confidence += 5;

  return {
    action: bestEntry.direction === 'bullish' ? 'SNIPER_LONG' : 'SNIPER_SHORT',
    direction: bestEntry.direction,
    entryType: bestEntry.type,
    entryZone: bestEntry.entryZone,
    stopLoss: bestEntry.stopLoss,
    target: bestEntry.target,
    confidence: Math.min(confidence, 95),
    confluenceCount,
    trendAligned,
    killzoneActive: killzone.isOptimalTime,
    reasons: entries.map(e => e.reason).slice(0, 3)
  };
}

function round(value, decimals = 4) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  analyzeSniperSetup,
  detectLiquidityGrab,
  detectFairValueGap,
  detectOrderBlock,
  detectBreakerBlock,
  detectMitigationBlock,
  detectInducement,
  detectOptimalTradeEntry,
  detectKillzone,
  detectSmartMoneyDivergence
};
