const {
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ATR,
  EMA,
  SMA
} = require('technicalindicators');

const LAGOS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Lagos',
  weekday: 'short',
  hour: '2-digit',
  hour12: false
});
const MIDWEEK_WINDOW_HOURS = 12;

function calculateIndicators(candles) {
  if (!candles || candles.length < 20) {
    return null;
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const currentPrice = closes.at(-1);

  // RSI
  const rsiSeries = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiSeries.at(-1);

  // MACD
  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macd = macdSeries.at(-1) || { MACD: 0, signal: 0, histogram: 0 };

  // Bollinger Bands
  const bbSeries = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  });
  const bollinger = bbSeries.at(-1) || { upper: null, lower: null, middle: null };
  if (bollinger.upper && bollinger.lower) {
    bollinger.pb = (currentPrice - bollinger.lower) / (bollinger.upper - bollinger.lower);
  }

  // Stochastic / KDJ
  const stochSeries = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 9,
    signalPeriod: 3
  });
  const stoch = stochSeries.at(-1) || { k: 50, d: 50 };
  const kdj = { k: stoch.k, d: stoch.d, j: 3 * stoch.k - 2 * stoch.d };

  // ATR for volatility-based SL/TP
  const atrSeries = ATR.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  });
  const atr = atrSeries.at(-1) || 0;

  // EMAs for trend
  const ema20 = EMA.calculate({ values: closes, period: 20 }).at(-1);
  const ema50 = EMA.calculate({ values: closes, period: 50 }).at(-1);
  const ema200 = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }).at(-1) : null;

  // Trend direction
  const trend = determineTrend(currentPrice, ema20, ema50, ema200);

  // Volume analysis
  const avgVolume = volumes.slice(-20).reduce((acc, v) => acc + v, 0) / 20;
  const currentVolume = volumes.at(-1);
  const volumeRatio = currentVolume / avgVolume;
  const volumeSpike = volumeRatio > 2;

  // Support & Resistance
  const { support, resistance } = findSupportResistance(candles);

  // Breakout detection
  const breakout = detectBreakout(candles);

  // Candlestick patterns
  const patterns = detectPatterns(candles);

  // === PREDICTIVE/SNIPER FEATURES ===

  // 1. Divergence Detection (early reversal signals)
  const divergence = detectDivergence(closes, rsiSeries, macdSeries);

  // 2. Volume Accumulation Detection (smart money moving before price)
  const volumeAccumulation = detectVolumeAccumulation(candles, volumes, avgVolume);

  // 3. Early Breakout Detection (price building pressure near key levels)
  const earlyBreakout = detectEarlyBreakout(candles, support, resistance, atr, volumeRatio);

  // 4. Momentum Building Detection
  const momentumBuilding = detectMomentumBuilding(closes, rsiSeries, macdSeries, volumes);

  // 5. Squeeze Detection (low volatility before big move)
  const squeeze = detectSqueeze(bollinger, atr, closes);

  // 6. Midweek reversal detection (Wed Lagos time, 12h V/U/W patterns)
  const midweekReversal = detectMidweekReversal(candles, trend, atr, currentPrice);

  // 7. Volume Surge Detection (rapid volume acceleration — meme coin pump detector)
  const volumeSurge = detectVolumeSurge(candles, volumes, avgVolume);

  // Combine into sniper signals
  const sniperSignals = {
    divergence,
    volumeAccumulation,
    earlyBreakout,
    momentumBuilding,
    squeeze,
    volumeSurge,
    // Overall sniper score (0-100)
    score: calculateSniperScore(divergence, volumeAccumulation, earlyBreakout, momentumBuilding, squeeze, volumeSurge)
  };

  // Momentum score
  const momentumScore = buildScore({ rsi, macd, kdj, volumeSpike, breakout, trend, sniperSignals });

  // Calculate trade levels
  const tradeLevels = calculateTradeLevels({
    currentPrice,
    atr,
    support,
    resistance,
    bollinger,
    trend
  });

  return {
    currentPrice,
    rsi,
    macd,
    bollinger,
    kdj,
    atr,
    ema: { ema20, ema50, ema200 },
    trend,
    volumeSpike,
    volumeRatio,
    support,
    resistance,
    breakout,
    patterns,
    momentumScore,
    tradeLevels,
    // New predictive features
    sniperSignals,
    midweekReversal,
    // Volume surge data for meme coin detection
    volumeSurge: volumeSurge
  };
}

// === PREDICTIVE/SNIPER DETECTION FUNCTIONS ===

// Detect RSI and MACD divergence (price vs indicator disagreement = early reversal)
function detectDivergence(closes, rsiSeries, macdSeries) {
  if (closes.length < 20 || rsiSeries.length < 10) {
    return { type: null, strength: 0 };
  }

  const lookback = 10;
  const recentCloses = closes.slice(-lookback);
  const recentRSI = rsiSeries.slice(-lookback);
  const recentMACD = macdSeries.slice(-lookback);

  let divergenceType = null;
  let strength = 0;
  const reasons = [];

  // Find price highs/lows
  const priceHigh1 = Math.max(...recentCloses.slice(0, 5));
  const priceHigh2 = Math.max(...recentCloses.slice(5));
  const priceLow1 = Math.min(...recentCloses.slice(0, 5));
  const priceLow2 = Math.min(...recentCloses.slice(5));

  // Find RSI highs/lows
  const rsiHigh1 = Math.max(...recentRSI.slice(0, 5));
  const rsiHigh2 = Math.max(...recentRSI.slice(5));
  const rsiLow1 = Math.min(...recentRSI.slice(0, 5));
  const rsiLow2 = Math.min(...recentRSI.slice(5));

  // Bearish Divergence: Price makes higher high, RSI makes lower high
  if (priceHigh2 > priceHigh1 && rsiHigh2 < rsiHigh1) {
    divergenceType = 'bearish';
    strength += 40;
    reasons.push('RSI bearish divergence');
  }

  // Bullish Divergence: Price makes lower low, RSI makes higher low
  if (priceLow2 < priceLow1 && rsiLow2 > rsiLow1) {
    divergenceType = 'bullish';
    strength += 40;
    reasons.push('RSI bullish divergence');
  }

  // Check MACD divergence too
  if (recentMACD.length >= 10) {
    const macdVals = recentMACD.map(m => m?.MACD || 0);
    const macdHigh1 = Math.max(...macdVals.slice(0, 5));
    const macdHigh2 = Math.max(...macdVals.slice(5));
    const macdLow1 = Math.min(...macdVals.slice(0, 5));
    const macdLow2 = Math.min(...macdVals.slice(5));

    if (priceHigh2 > priceHigh1 && macdHigh2 < macdHigh1) {
      if (divergenceType === 'bearish') strength += 20; // Confirms RSI
      else { divergenceType = 'bearish'; strength += 30; }
      reasons.push('MACD bearish divergence');
    }

    if (priceLow2 < priceLow1 && macdLow2 > macdLow1) {
      if (divergenceType === 'bullish') strength += 20; // Confirms RSI
      else { divergenceType = 'bullish'; strength += 30; }
      reasons.push('MACD bullish divergence');
    }
  }

  return { type: divergenceType, strength: Math.min(strength, 100), reasons };
}

// Detect volume accumulation before price moves (smart money entering)
function detectVolumeAccumulation(candles, volumes, avgVolume) {
  if (candles.length < 10) {
    return { detected: false, direction: null, strength: 0 };
  }

  const recent = candles.slice(-10);
  const recentVolumes = volumes.slice(-10);

  // Check if volume is increasing while price is relatively flat
  const priceChange = Math.abs(recent.at(-1).close - recent[0].close) / recent[0].close;
  const volumeIncrease = recentVolumes.slice(-3).reduce((a, b) => a + b, 0) / 3 / avgVolume;

  let detected = false;
  let direction = null;
  let strength = 0;

  // Volume increasing (1.5x+ avg) but price barely moving (<1%) = accumulation
  if (volumeIncrease > 1.5 && priceChange < 0.01) {
    detected = true;
    strength = Math.min((volumeIncrease - 1) * 50, 80);

    // Determine direction by analyzing buy/sell pressure
    const buyVolume = recent.filter(c => c.close > c.open).reduce((acc, c) => acc + c.volume, 0);
    const sellVolume = recent.filter(c => c.close < c.open).reduce((acc, c) => acc + c.volume, 0);

    if (buyVolume > sellVolume * 1.3) {
      direction = 'bullish';
      strength += 10;
    } else if (sellVolume > buyVolume * 1.3) {
      direction = 'bearish';
      strength += 10;
    }
  }

  // Volume spike with price direction = confirmation of move starting
  if (volumeIncrease > 2 && priceChange > 0.005) {
    const lastCandle = recent.at(-1);
    if (lastCandle.close > lastCandle.open) {
      detected = true;
      direction = 'bullish';
      strength = Math.min(volumeIncrease * 30, 90);
    } else {
      detected = true;
      direction = 'bearish';
      strength = Math.min(volumeIncrease * 30, 90);
    }
  }

  return { detected, direction, strength: Math.min(strength, 100) };
}

// Detect early breakout signals (price approaching key levels with momentum)
function detectEarlyBreakout(candles, support, resistance, atr, volumeRatio) {
  if (candles.length < 5 || !support || !resistance) {
    return { type: null, level: null, distance: null, strength: 0 };
  }

  const currentPrice = candles.at(-1).close;
  const range = resistance - support;
  if (range <= 0) return { type: null, level: null, distance: null, strength: 0 };

  const distanceToResistance = (resistance - currentPrice) / currentPrice;
  const distanceToSupport = (currentPrice - support) / currentPrice;
  const atrPercent = atr / currentPrice;

  let type = null;
  let level = null;
  let strength = 0;

  // Price within 1 ATR of resistance with volume building = potential upside breakout
  if (distanceToResistance < atrPercent && distanceToResistance > 0) {
    type = 'approaching_resistance';
    level = resistance;
    strength = 40;

    // Higher volume = more likely to break
    if (volumeRatio > 1.5) strength += 25;
    if (volumeRatio > 2) strength += 15;

    // Closing near highs = bullish pressure
    const lastCandle = candles.at(-1);
    const closePosition = (lastCandle.close - lastCandle.low) / (lastCandle.high - lastCandle.low);
    if (closePosition > 0.7) strength += 15;
  }

  // Price within 1 ATR of support with volume = potential downside breakdown
  if (distanceToSupport < atrPercent && distanceToSupport > 0) {
    type = 'approaching_support';
    level = support;
    strength = 40;

    if (volumeRatio > 1.5) strength += 25;
    if (volumeRatio > 2) strength += 15;

    // Closing near lows = bearish pressure
    const lastCandle = candles.at(-1);
    const closePosition = (lastCandle.close - lastCandle.low) / (lastCandle.high - lastCandle.low);
    if (closePosition < 0.3) strength += 15;
  }

  return {
    type,
    level,
    distance: type === 'approaching_resistance' ? distanceToResistance : distanceToSupport,
    strength: Math.min(strength, 100)
  };
}

// Detect momentum building (RSI/MACD starting to move before price catches up)
function detectMomentumBuilding(closes, rsiSeries, macdSeries, volumes) {
  if (rsiSeries.length < 5 || macdSeries.length < 5) {
    return { detected: false, direction: null, strength: 0 };
  }

  const recentRSI = rsiSeries.slice(-5);
  const recentMACD = macdSeries.slice(-5);
  const recentCloses = closes.slice(-5);

  let detected = false;
  let direction = null;
  let strength = 0;

  // RSI rising but price flat = bullish momentum building
  const rsiChange = recentRSI.at(-1) - recentRSI[0];
  const priceChange = (recentCloses.at(-1) - recentCloses[0]) / recentCloses[0];

  if (rsiChange > 10 && Math.abs(priceChange) < 0.005) {
    detected = true;
    direction = 'bullish';
    strength = Math.min(rsiChange * 3, 60);
  }

  if (rsiChange < -10 && Math.abs(priceChange) < 0.005) {
    detected = true;
    direction = 'bearish';
    strength = Math.min(Math.abs(rsiChange) * 3, 60);
  }

  // MACD histogram increasing = momentum building
  const histograms = recentMACD.map(m => m?.histogram || 0);
  const histChange = histograms.at(-1) - histograms[0];

  if (histChange > 0 && histograms.at(-1) > 0) {
    if (direction === 'bullish') strength += 20;
    else if (!detected) { detected = true; direction = 'bullish'; strength = 40; }
  }

  if (histChange < 0 && histograms.at(-1) < 0) {
    if (direction === 'bearish') strength += 20;
    else if (!detected) { detected = true; direction = 'bearish'; strength = 40; }
  }

  // Volume increasing with momentum = stronger signal
  const recentVolumes = volumes.slice(-5);
  const volumeGrowing = recentVolumes.at(-1) > recentVolumes[0] * 1.2;
  if (volumeGrowing && detected) strength += 15;

  return { detected, direction, strength: Math.min(strength, 100) };
}

// Detect squeeze (low volatility compression before explosive move)
function detectSqueeze(bollinger, atr, closes) {
  if (!bollinger.upper || !bollinger.lower || closes.length < 20) {
    return { inSqueeze: false, strength: 0, duration: 0 };
  }

  const bbWidth = (bollinger.upper - bollinger.lower) / bollinger.middle;
  const currentPrice = closes.at(-1);
  const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const atrPercent = atr / avgPrice;

  // Squeeze = Bollinger Bands narrowing (low volatility)
  // Typically BB width < 4% and ATR < 2% indicates squeeze
  const inSqueeze = bbWidth < 0.04 && atrPercent < 0.02;

  let strength = 0;
  if (inSqueeze) {
    // Tighter squeeze = stronger signal
    strength = Math.max(0, (0.04 - bbWidth) * 1000);
    strength = Math.min(strength, 80);
  }

  return { inSqueeze, strength, bbWidth: round(bbWidth * 100, 2) };
}

function detectMidweekReversal(candles, trend, atr, currentPrice) {
  if (!candles || candles.length < 6) {
    return { windowActive: false, detected: false, shape: null, strength: 0, windowHours: MIDWEEK_WINDOW_HOURS };
  }

  const lastCandle = candles.at(-1);
  const lastTime = lastCandle?.closeTime || lastCandle?.openTime;
  if (!lastTime) {
    return { windowActive: false, detected: false, shape: null, strength: 0, windowHours: MIDWEEK_WINDOW_HOURS };
  }

  const windowActive = isMidweekWindowLagos(lastTime);
  if (!windowActive) {
    return { windowActive: false, detected: false, shape: null, strength: 0, windowHours: MIDWEEK_WINDOW_HOURS };
  }

  const windowMs = MIDWEEK_WINDOW_HOURS * 60 * 60 * 1000;
  const windowCandles = candles.filter((c) => {
    const ts = c.closeTime || c.openTime || 0;
    return ts >= lastTime - windowMs;
  });

  if (windowCandles.length < 6) {
    return { windowActive, detected: false, shape: null, strength: 0, windowHours: MIDWEEK_WINDOW_HOURS };
  }

  const closes = windowCandles.map(c => c.close);
  const trendDir = trend?.direction;
  const inUptrend = trendDir === 'UP' || trendDir === 'STRONG_UP';
  const inDowntrend = trendDir === 'DOWN' || trendDir === 'STRONG_DOWN';

  if (!inUptrend && !inDowntrend) {
    return { windowActive, detected: false, shape: null, strength: 0, windowHours: MIDWEEK_WINDOW_HOURS };
  }

  const atrPercent = atr && currentPrice ? (atr / currentPrice) : 0.005;
  const drawThreshold = Math.max(atrPercent * 1.2, 0.006);
  const recoveryTolerance = Math.max(atrPercent * 1.1, 0.004);

  let detection = null;
  if (inUptrend) {
    detection = detectReversalUp(closes, drawThreshold, recoveryTolerance);
  } else {
    detection = detectReversalDown(closes, drawThreshold, recoveryTolerance);
  }

  if (!detection) {
    return {
      windowActive,
      detected: false,
      shape: null,
      strength: 0,
      direction: inUptrend ? 'up' : 'down',
      windowHours: MIDWEEK_WINDOW_HOURS
    };
  }

  return {
    windowActive,
    detected: true,
    direction: inUptrend ? 'up' : 'down',
    windowHours: MIDWEEK_WINDOW_HOURS,
    ...detection
  };
}

function detectReversalUp(closes, drawThreshold, recoveryTolerance) {
  const doubleBottom = detectDoubleBottom(closes, drawThreshold, recoveryTolerance);
  if (doubleBottom) return doubleBottom;
  return detectSingleReversalUp(closes, drawThreshold, recoveryTolerance);
}

function detectReversalDown(closes, drawThreshold, recoveryTolerance) {
  const doubleTop = detectDoubleTop(closes, drawThreshold, recoveryTolerance);
  if (doubleTop) return doubleTop;
  return detectSingleReversalDown(closes, drawThreshold, recoveryTolerance);
}

function detectSingleReversalUp(closes, drawThreshold, recoveryTolerance) {
  const len = closes.length;
  const firstEnd = Math.max(2, Math.floor(len / 3));
  const peak = findMaxInRange(closes, 0, firstEnd);
  if (peak.index < 0 || peak.index >= len - 2) return null;

  const trough = findMinInRange(closes, peak.index + 1, len);
  if (trough.index < 0) return null;

  const drawdown = (peak.value - trough.value) / peak.value;
  if (!isFinite(drawdown) || drawdown < drawThreshold) return null;

  const recovery = findMaxInRange(closes, trough.index + 1, len);
  if (recovery.index < 0 || recovery.value < peak.value * (1 - recoveryTolerance)) return null;

  const bottomRange = (peak.value - trough.value) * 0.25;
  const bottomCount = closes.filter(c => c <= trough.value + bottomRange).length;
  const shape = bottomCount >= len * 0.3 ? 'U' : 'V';

  return {
    shape,
    strength: Math.min(100, Math.round((drawdown / drawThreshold) * 50 + 30)),
    drawdown: round(drawdown, 4)
  };
}

function detectSingleReversalDown(closes, drawThreshold, recoveryTolerance) {
  const len = closes.length;
  const firstEnd = Math.max(2, Math.floor(len / 3));
  const base = findMinInRange(closes, 0, firstEnd);
  if (base.index < 0 || base.index >= len - 2) return null;

  const pullback = findMaxInRange(closes, base.index + 1, len);
  if (pullback.index < 0) return null;

  const drawup = (pullback.value - base.value) / base.value;
  if (!isFinite(drawup) || drawup < drawThreshold) return null;

  const resume = findMinInRange(closes, pullback.index + 1, len);
  if (resume.index < 0 || resume.value > base.value * (1 + recoveryTolerance)) return null;

  const topRange = (pullback.value - base.value) * 0.25;
  const topCount = closes.filter(c => c >= pullback.value - topRange).length;
  const shape = topCount >= len * 0.3 ? 'U' : 'V';

  return {
    shape,
    strength: Math.min(100, Math.round((drawup / drawThreshold) * 50 + 30)),
    drawup: round(drawup, 4)
  };
}

function detectDoubleBottom(closes, drawThreshold, recoveryTolerance) {
  const len = closes.length;
  const firstEnd = Math.max(2, Math.floor(len / 3));
  const reference = Math.max(...closes.slice(0, firstEnd));
  if (!isFinite(reference) || reference <= 0) return null;

  const minima = findLocalMinima(closes);
  if (minima.length < 2) return null;

  for (let i = 0; i < minima.length - 1; i++) {
    for (let j = i + 1; j < minima.length; j++) {
      const m1 = minima[i];
      const m2 = minima[j];
      if (m2.index - m1.index < 2) continue;

      const lowest = Math.min(m1.value, m2.value);
      const drawdown = (reference - lowest) / reference;
      if (!isFinite(drawdown) || drawdown < drawThreshold) continue;

      const peakBetween = Math.max(...closes.slice(m1.index, m2.index + 1));
      const bounce = (peakBetween - Math.max(m1.value, m2.value)) / reference;
      if (!isFinite(bounce) || bounce < drawThreshold * 0.5) continue;

      const recovery = Math.max(...closes.slice(m2.index));
      if (recovery < reference * (1 - recoveryTolerance)) continue;

      return {
        shape: 'W',
        strength: Math.min(100, Math.round((drawdown / drawThreshold) * 40 + (bounce / drawThreshold) * 20 + 20)),
        drawdown: round(drawdown, 4)
      };
    }
  }

  return null;
}

function detectDoubleTop(closes, drawThreshold, recoveryTolerance) {
  const len = closes.length;
  const firstEnd = Math.max(2, Math.floor(len / 3));
  const reference = Math.min(...closes.slice(0, firstEnd));
  if (!isFinite(reference) || reference <= 0) return null;

  const maxima = findLocalMaxima(closes);
  if (maxima.length < 2) return null;

  for (let i = 0; i < maxima.length - 1; i++) {
    for (let j = i + 1; j < maxima.length; j++) {
      const p1 = maxima[i];
      const p2 = maxima[j];
      if (p2.index - p1.index < 2) continue;

      const highest = Math.max(p1.value, p2.value);
      const drawup = (highest - reference) / reference;
      if (!isFinite(drawup) || drawup < drawThreshold) continue;

      const dipBetween = Math.min(...closes.slice(p1.index, p2.index + 1));
      const pullback = (highest - dipBetween) / reference;
      if (!isFinite(pullback) || pullback < drawThreshold * 0.5) continue;

      const resume = Math.min(...closes.slice(p2.index));
      if (resume > reference * (1 + recoveryTolerance)) continue;

      return {
        shape: 'W',
        strength: Math.min(100, Math.round((drawup / drawThreshold) * 40 + (pullback / drawThreshold) * 20 + 20)),
        drawup: round(drawup, 4)
      };
    }
  }

  return null;
}

function findLocalMinima(closes) {
  const minima = [];
  for (let i = 1; i < closes.length - 1; i++) {
    if (closes[i] <= closes[i - 1] && closes[i] <= closes[i + 1]) {
      minima.push({ index: i, value: closes[i] });
    }
  }
  return minima;
}

function findLocalMaxima(closes) {
  const maxima = [];
  for (let i = 1; i < closes.length - 1; i++) {
    if (closes[i] >= closes[i - 1] && closes[i] >= closes[i + 1]) {
      maxima.push({ index: i, value: closes[i] });
    }
  }
  return maxima;
}

function findMaxInRange(values, start, end) {
  let max = -Infinity;
  let idx = -1;
  for (let i = start; i < end; i++) {
    if (values[i] > max) {
      max = values[i];
      idx = i;
    }
  }
  return { value: max, index: idx };
}

function findMinInRange(values, start, end) {
  let min = Infinity;
  let idx = -1;
  for (let i = start; i < end; i++) {
    if (values[i] < min) {
      min = values[i];
      idx = i;
    }
  }
  return { value: min, index: idx };
}

function isMidweekWindowLagos(timestamp) {
  const { weekdayIndex, hour } = getLagosWeekdayHour(timestamp);
  if (weekdayIndex === 3) return true; // Wednesday only
  return false;
}

function getLagosWeekdayHour(timestamp) {
  const parts = LAGOS_FORMATTER.formatToParts(new Date(timestamp));
  let weekday = null;
  let hour = null;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = Number(part.value);
  }
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekdayIndex: map[weekday] ?? -1, hour: Number.isFinite(hour) ? hour : 0 };
}

// Detect rapid volume surge (volume accelerating across candles — meme/alpha pump detector)
// Unlike volumeSpike (single candle 2x avg), this detects ACCELERATION: each candle's volume growing
function detectVolumeSurge(candles, volumes, avgVolume) {
  if (!candles || candles.length < 6) {
    return { detected: false, intensity: 0, acceleration: 0, direction: null, consecutiveGreen: 0 };
  }

  const recent = candles.slice(-6);
  const recentVols = volumes.slice(-6);

  // 1. Check volume acceleration: are last 3 candles each bigger than the previous?
  let accelerating = 0;
  for (let i = recentVols.length - 3; i < recentVols.length; i++) {
    if (recentVols[i] > recentVols[i - 1] * 1.2) accelerating++;
  }

  // 2. Current volume vs average (intensity)
  const lastThreeAvg = (recentVols.at(-1) + recentVols.at(-2) + recentVols.at(-3)) / 3;
  const intensity = avgVolume > 0 ? lastThreeAvg / avgVolume : 0;

  // 3. Price direction during surge
  let consecutiveGreen = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].close > recent[i].open) consecutiveGreen++;
    else break;
  }

  let consecutiveRed = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].close < recent[i].open) consecutiveRed++;
    else break;
  }

  // 4. Price change during the surge window
  const surgeStart = recent[0].open;
  const surgeEnd = recent.at(-1).close;
  const surgePct = surgeStart > 0 ? ((surgeEnd - surgeStart) / surgeStart) * 100 : 0;

  // Detect surge: volume 3x+ avg AND accelerating AND directional
  const isVolumeSurge = intensity >= 3 && accelerating >= 2;
  // Also detect emerging surge: volume 2x+ AND some acceleration
  const isEmergingSurge = intensity >= 2 && accelerating >= 1 && (consecutiveGreen >= 3 || consecutiveRed >= 3);

  const detected = isVolumeSurge || isEmergingSurge;

  let direction = null;
  if (detected) {
    if (consecutiveGreen >= 2 && surgePct > 0) direction = 'bullish';
    else if (consecutiveRed >= 2 && surgePct < 0) direction = 'bearish';
  }

  // Strength score (0-100)
  let strength = 0;
  if (detected) {
    strength += Math.min(intensity * 10, 40);           // Volume intensity (max 40)
    strength += accelerating * 15;                       // Acceleration (max 45)
    strength += Math.min(Math.abs(surgePct) * 2, 15);   // Price move size (max 15)
  }

  return {
    detected,
    intensity: round(intensity, 2),
    acceleration: accelerating,
    direction,
    consecutiveGreen,
    consecutiveRed,
    surgePct: round(surgePct, 2),
    strength: Math.min(Math.round(strength), 100),
    isExplosive: isVolumeSurge && Math.abs(surgePct) > 3 // 3%+ move with 3x volume = explosive
  };
}

// Calculate overall sniper score
function calculateSniperScore(divergence, volumeAccumulation, earlyBreakout, momentumBuilding, squeeze, volumeSurge) {
  let score = 0;
  let direction = null;
  const signals = [];

  if (divergence.type) {
    score += divergence.strength * 0.3;
    direction = divergence.type;
    signals.push(`Divergence: ${divergence.type}`);
  }

  if (volumeAccumulation.detected) {
    score += volumeAccumulation.strength * 0.25;
    if (!direction) direction = volumeAccumulation.direction;
    signals.push(`Volume accumulation: ${volumeAccumulation.direction}`);
  }

  if (earlyBreakout.type) {
    score += earlyBreakout.strength * 0.2;
    const breakoutDir = earlyBreakout.type === 'approaching_resistance' ? 'bullish' : 'bearish';
    if (!direction) direction = breakoutDir;
    signals.push(`Early breakout: ${earlyBreakout.type}`);
  }

  if (momentumBuilding.detected) {
    score += momentumBuilding.strength * 0.15;
    if (!direction) direction = momentumBuilding.direction;
    signals.push(`Momentum building: ${momentumBuilding.direction}`);
  }

  if (squeeze.inSqueeze) {
    score += squeeze.strength * 0.1;
    signals.push('Squeeze detected');
  }

  // Volume surge (meme/alpha detection) — high weight, this is the primary meme signal
  if (volumeSurge && volumeSurge.detected) {
    score += volumeSurge.strength * 0.3;
    if (!direction) direction = volumeSurge.direction;
    signals.push(`Volume surge: ${volumeSurge.intensity.toFixed(1)}x avg${volumeSurge.isExplosive ? ' (EXPLOSIVE)' : ''}`);
  }

  return {
    score: Math.min(Math.round(score), 100),
    direction,
    signals,
    isSniper: score >= 50, // Strong predictive signal
    isVolumeSurge: !!(volumeSurge && volumeSurge.detected)
  };
}

function determineTrend(price, ema20, ema50, ema200) {
  let score = 0;
  let direction = 'NEUTRAL';

  if (ema20 && price > ema20) score += 1;
  if (ema20 && price < ema20) score -= 1;

  if (ema50 && price > ema50) score += 1;
  if (ema50 && price < ema50) score -= 1;

  if (ema20 && ema50 && ema20 > ema50) score += 1;
  if (ema20 && ema50 && ema20 < ema50) score -= 1;

  if (ema200) {
    if (price > ema200) score += 2;
    if (price < ema200) score -= 2;
  }

  if (score >= 3) direction = 'STRONG_UP';
  else if (score >= 1) direction = 'UP';
  else if (score <= -3) direction = 'STRONG_DOWN';
  else if (score <= -1) direction = 'DOWN';

  return { direction, score };
}

function findSupportResistance(candles, lookback = 50) {
  const slice = candles.slice(-Math.min(lookback, candles.length));
  const highs = slice.map(c => c.high);
  const lows = slice.map(c => c.low);

  // Find swing highs and lows
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < slice.length - 2; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] &&
        highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
      swingHighs.push(highs[i]);
    }
    if (lows[i] < lows[i-1] && lows[i] < lows[i-2] &&
        lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
      swingLows.push(lows[i]);
    }
  }

  // Get nearest support and resistance
  const currentPrice = slice.at(-1).close;

  const resistance = swingHighs.length > 0
    ? swingHighs.filter(h => h > currentPrice).sort((a, b) => a - b)[0] || Math.max(...highs)
    : Math.max(...highs);

  const support = swingLows.length > 0
    ? swingLows.filter(l => l < currentPrice).sort((a, b) => b - a)[0] || Math.min(...lows)
    : Math.min(...lows);

  return { support, resistance };
}

function calculateTradeLevels({ currentPrice, atr, support, resistance, bollinger, trend }) {
  if (!currentPrice || !atr) {
    return null;
  }

  // Adjust multipliers based on volatility - tighter targets in low volatility
  const atrPercent = (atr / currentPrice) * 100;
  const isLowVolatility = atrPercent < 1.5; // Less than 1.5% ATR = low volatility

  const atrMultiplierSL = isLowVolatility ? 1.2 : 1.5;  // Tighter SL in low vol
  const atrMultiplierTP1 = isLowVolatility ? 1.5 : 2;   // TP1 closer in low vol
  const atrMultiplierTP2 = isLowVolatility ? 2.5 : 3;   // TP2 adjusted for vol
  const atrMultiplierTP3 = isLowVolatility ? 3.5 : 4.5; // TP3 adjusted for vol

  // Long trade levels
  const longEntry = currentPrice;
  const longSL = Math.max(currentPrice - (atr * atrMultiplierSL), support * 0.998);
  const longTP1 = currentPrice + (atr * atrMultiplierTP1);
  const longTP2 = Math.min(currentPrice + (atr * atrMultiplierTP2), resistance * 0.998);
  const longTP3 = currentPrice + (atr * atrMultiplierTP3);
  const longRiskPct = ((longEntry - longSL) / longEntry) * 100;
  const longReward1Pct = ((longTP1 - longEntry) / longEntry) * 100;
  const longRR1 = longReward1Pct / longRiskPct;

  // Short trade levels
  const shortEntry = currentPrice;
  const shortSL = Math.min(currentPrice + (atr * atrMultiplierSL), resistance * 1.002);
  const shortTP1 = currentPrice - (atr * atrMultiplierTP1);
  const shortTP2 = Math.max(currentPrice - (atr * atrMultiplierTP2), support * 1.002);
  const shortTP3 = currentPrice - (atr * atrMultiplierTP3);
  const shortRiskPct = ((shortSL - shortEntry) / shortEntry) * 100;
  const shortReward1Pct = ((shortEntry - shortTP1) / shortEntry) * 100;
  const shortRR1 = shortReward1Pct / shortRiskPct;

  return {
    long: {
      entry: round(longEntry),
      stopLoss: round(longSL),
      tp1: round(longTP1),
      tp2: round(longTP2),
      tp3: round(longTP3),
      riskPct: round(longRiskPct, 2),
      rr: round(longRR1, 2)
    },
    short: {
      entry: round(shortEntry),
      stopLoss: round(shortSL),
      tp1: round(shortTP1),
      tp2: round(shortTP2),
      tp3: round(shortTP3),
      riskPct: round(shortRiskPct, 2),
      rr: round(shortRR1, 2)
    },
    atr: round(atr),
    atrPct: round((atr / currentPrice) * 100, 2)
  };
}

function round(value, decimals = 4) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function detectBreakout(candles, lookback = 20) {
  if (candles.length < lookback + 1) return { direction: null };
  const recent = candles.slice(-lookback - 1);
  const closes = recent.map((c) => c.close);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const lastClose = closes.at(-1);

  const resistance = Math.max(...highs.slice(0, -1));
  const support = Math.min(...lows.slice(0, -1));

  if (lastClose > resistance) return { direction: 'up', resistance, support };
  if (lastClose < support) return { direction: 'down', resistance, support };
  return { direction: null, resistance, support };
}

function detectPatterns(candles) {
  if (candles.length < 3) return [];
  const prev2 = candles.at(-3);
  const prev = candles.at(-2);
  const last = candles.at(-1);
  const patterns = [];

  const isBullish = (c) => c.close > c.open;
  const isBearish = (c) => c.close < c.open;
  const bodySize = (c) => Math.abs(c.close - c.open);
  const wickUpper = (c) => c.high - Math.max(c.close, c.open);
  const wickLower = (c) => Math.min(c.close, c.open) - c.low;
  const range = (c) => c.high - c.low;

  // Engulfing patterns
  if (isBearish(prev) && isBullish(last) && last.open < prev.close && last.close > prev.open) {
    patterns.push('BULLISH_ENGULFING');
  }
  if (isBullish(prev) && isBearish(last) && last.open > prev.close && last.close < prev.open) {
    patterns.push('BEARISH_ENGULFING');
  }

  // Hammer & Shooting Star
  const lastBody = bodySize(last);
  const lastRange = range(last);
  if (lastBody > 0 && lastRange > 0) {
    const bodyRatio = lastBody / lastRange;
    if (wickLower(last) > 2 * lastBody && wickUpper(last) < lastBody && bodyRatio < 0.3) {
      patterns.push('HAMMER');
    }
    if (wickUpper(last) > 2 * lastBody && wickLower(last) < lastBody && bodyRatio < 0.3) {
      patterns.push('SHOOTING_STAR');
    }
  }

  // Morning/Evening Star (3-candle patterns)
  if (prev2 && prev && last) {
    const smallBody = bodySize(prev) < (bodySize(prev2) * 0.3);
    if (isBearish(prev2) && smallBody && isBullish(last) && last.close > prev2.close * 0.5) {
      patterns.push('MORNING_STAR');
    }
    if (isBullish(prev2) && smallBody && isBearish(last) && last.close < prev2.close * 0.5) {
      patterns.push('EVENING_STAR');
    }
  }

  // Doji
  if (lastBody > 0 && lastRange > 0 && (lastBody / lastRange) < 0.1) {
    patterns.push('DOJI');
  }

  return patterns;
}

function buildScore({ rsi, macd, kdj, volumeSpike, breakout, trend, sniperSignals }) {
  let score = 0;

  // RSI contribution (max 20)
  if (rsi !== undefined && rsi !== null) {
    if (rsi < 30) score += 20;
    else if (rsi > 70) score += 20;
    else if (rsi < 40 || rsi > 60) score += 10;
  }

  // MACD contribution (max 20)
  if (macd && macd.histogram) {
    const histAbs = Math.abs(macd.histogram);
    if (histAbs > 0) score += Math.min(20, histAbs * 2);
  }

  // KDJ contribution (max 15)
  if (kdj) {
    if (kdj.j < 20 || kdj.j > 80) score += 15;
    else if (kdj.j < 30 || kdj.j > 70) score += 8;
  }

  // Volume spike (max 15)
  if (volumeSpike) score += 15;

  // Breakout (max 15)
  if (breakout && breakout.direction) score += 15;

  // Trend alignment (max 15)
  if (trend) {
    if (trend.direction === 'STRONG_UP' || trend.direction === 'STRONG_DOWN') score += 15;
    else if (trend.direction === 'UP' || trend.direction === 'DOWN') score += 8;
  }

  // SNIPER SIGNALS BONUS (max 25)
  if (sniperSignals && sniperSignals.score) {
    score += Math.min(sniperSignals.score * 0.25, 25);
  }

  return Math.min(score, 100);
}

module.exports = {
  calculateIndicators,
  detectBreakout,
  detectPatterns,
  buildScore,
  findSupportResistance,
  calculateTradeLevels,
  // Sniper/Predictive functions
  detectDivergence,
  detectVolumeAccumulation,
  detectEarlyBreakout,
  detectMomentumBuilding,
  detectSqueeze,
  detectVolumeSurge,
  calculateSniperScore
};
