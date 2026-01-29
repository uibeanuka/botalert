/**
 * Advanced Chart Pattern Recognition Module
 * Detects professional trading patterns: Head & Shoulders, Triangles, Flags, Wedges, Cup & Handle
 * Uses algorithmic detection with confirmation signals
 */

/**
 * Main function to detect all chart patterns
 * @param {Array} candles - OHLCV candle data
 * @returns {Object} Detected patterns with confidence and trade signals
 */
function detectChartPatterns(candles) {
  if (!candles || candles.length < 50) {
    return { patterns: [], summary: null };
  }

  const patterns = [];

  // Detect all pattern types
  const headAndShoulders = detectHeadAndShoulders(candles);
  const inverseHnS = detectInverseHeadAndShoulders(candles);
  const ascTriangle = detectAscendingTriangle(candles);
  const descTriangle = detectDescendingTriangle(candles);
  const symTriangle = detectSymmetricalTriangle(candles);
  const bullFlag = detectBullFlag(candles);
  const bearFlag = detectBearFlag(candles);
  const risingWedge = detectRisingWedge(candles);
  const fallingWedge = detectFallingWedge(candles);
  const cupAndHandle = detectCupAndHandle(candles);
  const doubleTop = detectDoubleTopPattern(candles);
  const doubleBottom = detectDoubleBottomPattern(candles);
  const tripleTop = detectTripleTop(candles);
  const tripleBottom = detectTripleBottom(candles);
  const channelPattern = detectChannel(candles);
  const rectanglePattern = detectRectangle(candles);

  // Collect all detected patterns
  if (headAndShoulders.detected) patterns.push(headAndShoulders);
  if (inverseHnS.detected) patterns.push(inverseHnS);
  if (ascTriangle.detected) patterns.push(ascTriangle);
  if (descTriangle.detected) patterns.push(descTriangle);
  if (symTriangle.detected) patterns.push(symTriangle);
  if (bullFlag.detected) patterns.push(bullFlag);
  if (bearFlag.detected) patterns.push(bearFlag);
  if (risingWedge.detected) patterns.push(risingWedge);
  if (fallingWedge.detected) patterns.push(fallingWedge);
  if (cupAndHandle.detected) patterns.push(cupAndHandle);
  if (doubleTop.detected) patterns.push(doubleTop);
  if (doubleBottom.detected) patterns.push(doubleBottom);
  if (tripleTop.detected) patterns.push(tripleTop);
  if (tripleBottom.detected) patterns.push(tripleBottom);
  if (channelPattern.detected) patterns.push(channelPattern);
  if (rectanglePattern.detected) patterns.push(rectanglePattern);

  // Sort by confidence
  patterns.sort((a, b) => b.confidence - a.confidence);

  // Generate summary
  const summary = generatePatternSummary(patterns, candles);

  return { patterns, summary };
}

/**
 * Head and Shoulders Pattern Detection
 * Bearish reversal pattern with left shoulder, head, right shoulder
 */
function detectHeadAndShoulders(candles) {
  const result = {
    detected: false,
    type: 'HEAD_AND_SHOULDERS',
    direction: 'bearish',
    confidence: 0,
    neckline: null,
    target: null,
    stopLoss: null
  };

  if (candles.length < 30) return result;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  // Find potential peaks (local maxima)
  const peaks = findSignificantPeaks(highs, 5);

  if (peaks.length < 3) return result;

  // Look for H&S pattern in last 3 significant peaks
  for (let i = 0; i < peaks.length - 2; i++) {
    const leftShoulder = peaks[i];
    const head = peaks[i + 1];
    const rightShoulder = peaks[i + 2];

    // Head must be highest
    if (head.value <= leftShoulder.value || head.value <= rightShoulder.value) continue;

    // Shoulders should be roughly equal (within 3%)
    const shoulderDiff = Math.abs(leftShoulder.value - rightShoulder.value) / leftShoulder.value;
    if (shoulderDiff > 0.03) continue;

    // Find neckline (lows between shoulders and head)
    const leftTrough = Math.min(...lows.slice(leftShoulder.index, head.index));
    const rightTrough = Math.min(...lows.slice(head.index, rightShoulder.index + 1));
    const neckline = (leftTrough + rightTrough) / 2;

    // Current price should be near or below neckline
    const currentPrice = closes.at(-1);
    const distanceToNeckline = (currentPrice - neckline) / neckline;

    if (distanceToNeckline > 0.02) continue; // Price not near neckline

    // Pattern height for target calculation
    const patternHeight = head.value - neckline;
    const target = neckline - patternHeight;
    const stopLoss = head.value * 1.01; // Just above head

    // Calculate confidence
    let confidence = 60;

    // Symmetry bonus
    if (shoulderDiff < 0.015) confidence += 10;

    // Volume confirmation (decreasing on right shoulder)
    const leftShoulderVol = candles[leftShoulder.index]?.volume || 0;
    const rightShoulderVol = candles[rightShoulder.index]?.volume || 0;
    if (rightShoulderVol < leftShoulderVol * 0.8) confidence += 10;

    // Neckline break confirmation
    if (currentPrice < neckline) confidence += 15;

    result.detected = true;
    result.confidence = Math.min(confidence, 95);
    result.neckline = round(neckline);
    result.target = round(target);
    result.stopLoss = round(stopLoss);
    result.leftShoulder = round(leftShoulder.value);
    result.head = round(head.value);
    result.rightShoulder = round(rightShoulder.value);
    result.patternHeight = round(patternHeight);
    result.entry = round(neckline * 0.998); // Entry just below neckline
    result.riskReward = round(patternHeight / (stopLoss - neckline), 2);

    return result;
  }

  return result;
}

/**
 * Inverse Head and Shoulders Pattern Detection
 * Bullish reversal pattern
 */
function detectInverseHeadAndShoulders(candles) {
  const result = {
    detected: false,
    type: 'INVERSE_HEAD_AND_SHOULDERS',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 30) return result;

  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const closes = candles.map(c => c.close);

  // Find potential troughs (local minima)
  const troughs = findSignificantTroughs(lows, 5);

  if (troughs.length < 3) return result;

  for (let i = 0; i < troughs.length - 2; i++) {
    const leftShoulder = troughs[i];
    const head = troughs[i + 1];
    const rightShoulder = troughs[i + 2];

    // Head must be lowest
    if (head.value >= leftShoulder.value || head.value >= rightShoulder.value) continue;

    // Shoulders should be roughly equal
    const shoulderDiff = Math.abs(leftShoulder.value - rightShoulder.value) / leftShoulder.value;
    if (shoulderDiff > 0.03) continue;

    // Find neckline
    const leftPeak = Math.max(...highs.slice(leftShoulder.index, head.index));
    const rightPeak = Math.max(...highs.slice(head.index, rightShoulder.index + 1));
    const neckline = (leftPeak + rightPeak) / 2;

    const currentPrice = closes.at(-1);
    const distanceToNeckline = (neckline - currentPrice) / neckline;

    if (distanceToNeckline > 0.02) continue;

    const patternHeight = neckline - head.value;
    const target = neckline + patternHeight;
    const stopLoss = head.value * 0.99;

    let confidence = 60;
    if (shoulderDiff < 0.015) confidence += 10;
    if (currentPrice > neckline) confidence += 15;

    result.detected = true;
    result.confidence = Math.min(confidence, 95);
    result.neckline = round(neckline);
    result.target = round(target);
    result.stopLoss = round(stopLoss);
    result.entry = round(neckline * 1.002);
    result.patternHeight = round(patternHeight);
    result.riskReward = round(patternHeight / (neckline - stopLoss), 2);

    return result;
  }

  return result;
}

/**
 * Ascending Triangle Detection
 * Bullish continuation pattern with flat resistance and rising support
 */
function detectAscendingTriangle(candles) {
  const result = {
    detected: false,
    type: 'ASCENDING_TRIANGLE',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const closes = recent.map(c => c.close);

  // Find resistance level (flat top)
  const peaks = findSignificantPeaks(highs, 3);
  if (peaks.length < 2) return result;

  // Check if peaks are at similar levels (flat resistance)
  const peakValues = peaks.map(p => p.value);
  const avgResistance = peakValues.reduce((a, b) => a + b) / peakValues.length;
  const resistanceVariance = peakValues.every(p => Math.abs(p - avgResistance) / avgResistance < 0.015);

  if (!resistanceVariance) return result;

  // Check for rising support (ascending lows)
  const troughs = findSignificantTroughs(lows, 3);
  if (troughs.length < 2) return result;

  let risingSupport = true;
  for (let i = 1; i < troughs.length; i++) {
    if (troughs[i].value <= troughs[i - 1].value) {
      risingSupport = false;
      break;
    }
  }

  if (!risingSupport) return result;

  // Calculate triangle metrics
  const resistance = avgResistance;
  const currentLow = troughs.at(-1).value;
  const triangleHeight = resistance - currentLow;
  const currentPrice = closes.at(-1);

  // Price should be in upper half of triangle for bullish bias
  const pricePosition = (currentPrice - currentLow) / triangleHeight;

  let confidence = 55;
  if (pricePosition > 0.6) confidence += 10;
  if (peaks.length >= 3) confidence += 10;
  if (troughs.length >= 3) confidence += 10;

  // Volume typically decreases in triangle
  const volumeTrend = calculateVolumeTrend(recent);
  if (volumeTrend < 0) confidence += 10;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.resistance = round(resistance);
  result.support = round(currentLow);
  result.target = round(resistance + triangleHeight);
  result.stopLoss = round(currentLow * 0.99);
  result.entry = round(resistance * 1.002);
  result.triangleHeight = round(triangleHeight);
  result.riskReward = round(triangleHeight / (resistance - currentLow * 0.99), 2);

  return result;
}

/**
 * Descending Triangle Detection
 * Bearish continuation pattern with flat support and descending resistance
 */
function detectDescendingTriangle(candles) {
  const result = {
    detected: false,
    type: 'DESCENDING_TRIANGLE',
    direction: 'bearish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);
  const closes = recent.map(c => c.close);

  // Find support level (flat bottom)
  const troughs = findSignificantTroughs(lows, 3);
  if (troughs.length < 2) return result;

  const troughValues = troughs.map(t => t.value);
  const avgSupport = troughValues.reduce((a, b) => a + b) / troughValues.length;
  const supportVariance = troughValues.every(t => Math.abs(t - avgSupport) / avgSupport < 0.015);

  if (!supportVariance) return result;

  // Check for descending highs
  const peaks = findSignificantPeaks(highs, 3);
  if (peaks.length < 2) return result;

  let descendingResistance = true;
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i].value >= peaks[i - 1].value) {
      descendingResistance = false;
      break;
    }
  }

  if (!descendingResistance) return result;

  const support = avgSupport;
  const currentHigh = peaks.at(-1).value;
  const triangleHeight = currentHigh - support;
  const currentPrice = closes.at(-1);

  const pricePosition = (currentPrice - support) / triangleHeight;

  let confidence = 55;
  if (pricePosition < 0.4) confidence += 10;
  if (peaks.length >= 3) confidence += 10;
  if (troughs.length >= 3) confidence += 10;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.resistance = round(currentHigh);
  result.support = round(support);
  result.target = round(support - triangleHeight);
  result.stopLoss = round(currentHigh * 1.01);
  result.entry = round(support * 0.998);
  result.triangleHeight = round(triangleHeight);

  return result;
}

/**
 * Symmetrical Triangle Detection
 * Continuation pattern with converging trendlines
 */
function detectSymmetricalTriangle(candles) {
  const result = {
    detected: false,
    type: 'SYMMETRICAL_TRIANGLE',
    direction: 'neutral',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  const peaks = findSignificantPeaks(highs, 3);
  const troughs = findSignificantTroughs(lows, 3);

  if (peaks.length < 2 || troughs.length < 2) return result;

  // Check for descending highs
  let descendingHighs = true;
  for (let i = 1; i < peaks.length; i++) {
    if (peaks[i].value >= peaks[i - 1].value) descendingHighs = false;
  }

  // Check for ascending lows
  let ascendingLows = true;
  for (let i = 1; i < troughs.length; i++) {
    if (troughs[i].value <= troughs[i - 1].value) ascendingLows = false;
  }

  if (!descendingHighs || !ascendingLows) return result;

  // Calculate convergence point
  const currentHigh = peaks.at(-1).value;
  const currentLow = troughs.at(-1).value;
  const triangleHeight = currentHigh - currentLow;

  let confidence = 60;
  if (peaks.length >= 3 && troughs.length >= 3) confidence += 15;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.upperTrendline = round(currentHigh);
  result.lowerTrendline = round(currentLow);
  result.triangleHeight = round(triangleHeight);
  result.breakoutTarget = {
    bullish: round(currentHigh + triangleHeight),
    bearish: round(currentLow - triangleHeight)
  };

  return result;
}

/**
 * Bull Flag Detection
 * Bullish continuation after strong up move
 */
function detectBullFlag(candles) {
  const result = {
    detected: false,
    type: 'BULL_FLAG',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 15) return result;

  const recent = candles.slice(-25);
  const closes = recent.map(c => c.close);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  // Find the flagpole (strong up move)
  let flagpoleStart = -1;
  let flagpoleEnd = -1;
  let maxMove = 0;

  for (let i = 0; i < recent.length - 5; i++) {
    for (let j = i + 3; j < Math.min(i + 10, recent.length - 5); j++) {
      const move = (closes[j] - closes[i]) / closes[i];
      if (move > maxMove && move > 0.03) { // At least 3% move
        maxMove = move;
        flagpoleStart = i;
        flagpoleEnd = j;
      }
    }
  }

  if (flagpoleStart === -1) return result;

  // Check for flag (consolidation with slight downward drift)
  const flagCandles = recent.slice(flagpoleEnd);
  if (flagCandles.length < 3) return result;

  const flagHighs = flagCandles.map(c => c.high);
  const flagLows = flagCandles.map(c => c.low);

  // Flag should have descending highs and lows (parallel channel down)
  const highSlope = linearRegression(flagHighs).slope;
  const lowSlope = linearRegression(flagLows).slope;

  // Both slopes should be negative (slight pullback)
  if (highSlope > 0 || lowSlope > 0) return result;

  // Slopes should be similar (parallel)
  if (Math.abs(highSlope - lowSlope) > 0.01) return result;

  // Flag retracement should be less than 50% of flagpole
  const flagpoleHeight = closes[flagpoleEnd] - closes[flagpoleStart];
  const flagRetracement = closes[flagpoleEnd] - closes.at(-1);
  const retracementRatio = flagRetracement / flagpoleHeight;

  if (retracementRatio > 0.5 || retracementRatio < 0) return result;

  let confidence = 60;
  if (retracementRatio < 0.38) confidence += 10; // Shallow retracement
  if (maxMove > 0.05) confidence += 10; // Strong flagpole

  // Volume should decrease during flag
  const volumeTrend = calculateVolumeTrend(flagCandles);
  if (volumeTrend < 0) confidence += 10;

  const target = closes.at(-1) + flagpoleHeight;
  const stopLoss = Math.min(...flagLows) * 0.99;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.flagpoleHeight = round(flagpoleHeight);
  result.target = round(target);
  result.stopLoss = round(stopLoss);
  result.entry = round(Math.max(...flagHighs) * 1.002);
  result.retracementRatio = round(retracementRatio, 2);

  return result;
}

/**
 * Bear Flag Detection
 * Bearish continuation after strong down move
 */
function detectBearFlag(candles) {
  const result = {
    detected: false,
    type: 'BEAR_FLAG',
    direction: 'bearish',
    confidence: 0
  };

  if (candles.length < 15) return result;

  const recent = candles.slice(-25);
  const closes = recent.map(c => c.close);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  // Find the flagpole (strong down move)
  let flagpoleStart = -1;
  let flagpoleEnd = -1;
  let maxMove = 0;

  for (let i = 0; i < recent.length - 5; i++) {
    for (let j = i + 3; j < Math.min(i + 10, recent.length - 5); j++) {
      const move = (closes[i] - closes[j]) / closes[i];
      if (move > maxMove && move > 0.03) {
        maxMove = move;
        flagpoleStart = i;
        flagpoleEnd = j;
      }
    }
  }

  if (flagpoleStart === -1) return result;

  const flagCandles = recent.slice(flagpoleEnd);
  if (flagCandles.length < 3) return result;

  const flagHighs = flagCandles.map(c => c.high);
  const flagLows = flagCandles.map(c => c.low);

  const highSlope = linearRegression(flagHighs).slope;
  const lowSlope = linearRegression(flagLows).slope;

  // Both slopes should be positive (slight bounce)
  if (highSlope < 0 || lowSlope < 0) return result;
  if (Math.abs(highSlope - lowSlope) > 0.01) return result;

  const flagpoleHeight = closes[flagpoleStart] - closes[flagpoleEnd];
  const flagRetracement = closes.at(-1) - closes[flagpoleEnd];
  const retracementRatio = flagRetracement / flagpoleHeight;

  if (retracementRatio > 0.5 || retracementRatio < 0) return result;

  let confidence = 60;
  if (retracementRatio < 0.38) confidence += 10;
  if (maxMove > 0.05) confidence += 10;

  const target = closes.at(-1) - flagpoleHeight;
  const stopLoss = Math.max(...flagHighs) * 1.01;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.flagpoleHeight = round(flagpoleHeight);
  result.target = round(target);
  result.stopLoss = round(stopLoss);
  result.entry = round(Math.min(...flagLows) * 0.998);

  return result;
}

/**
 * Rising Wedge Detection
 * Bearish reversal pattern
 */
function detectRisingWedge(candles) {
  const result = {
    detected: false,
    type: 'RISING_WEDGE',
    direction: 'bearish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  const highReg = linearRegression(highs);
  const lowReg = linearRegression(lows);

  // Both trendlines should be rising
  if (highReg.slope <= 0 || lowReg.slope <= 0) return result;

  // Lines should be converging (lower slope should be steeper percentage-wise)
  const avgHigh = highs.reduce((a, b) => a + b) / highs.length;
  const avgLow = lows.reduce((a, b) => a + b) / lows.length;

  const highSlopeNorm = highReg.slope / avgHigh;
  const lowSlopeNorm = lowReg.slope / avgLow;

  if (lowSlopeNorm <= highSlopeNorm) return result; // Not converging

  let confidence = 55;

  // Check for touches on both trendlines
  const highTouches = countTrendlineTouches(highs, highReg);
  const lowTouches = countTrendlineTouches(lows, lowReg);

  if (highTouches >= 3) confidence += 10;
  if (lowTouches >= 3) confidence += 10;

  const wedgeHeight = highs.at(-1) - lows.at(-1);
  const target = lows.at(-1) - wedgeHeight;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.target = round(target);
  result.stopLoss = round(highs.at(-1) * 1.01);
  result.wedgeHeight = round(wedgeHeight);

  return result;
}

/**
 * Falling Wedge Detection
 * Bullish reversal pattern
 */
function detectFallingWedge(candles) {
  const result = {
    detected: false,
    type: 'FALLING_WEDGE',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  const highReg = linearRegression(highs);
  const lowReg = linearRegression(lows);

  // Both trendlines should be falling
  if (highReg.slope >= 0 || lowReg.slope >= 0) return result;

  // Lines should be converging
  const avgHigh = highs.reduce((a, b) => a + b) / highs.length;
  const avgLow = lows.reduce((a, b) => a + b) / lows.length;

  const highSlopeNorm = Math.abs(highReg.slope / avgHigh);
  const lowSlopeNorm = Math.abs(lowReg.slope / avgLow);

  if (highSlopeNorm <= lowSlopeNorm) return result;

  let confidence = 55;

  const highTouches = countTrendlineTouches(highs, highReg);
  const lowTouches = countTrendlineTouches(lows, lowReg);

  if (highTouches >= 3) confidence += 10;
  if (lowTouches >= 3) confidence += 10;

  const wedgeHeight = highs.at(-1) - lows.at(-1);
  const target = highs.at(-1) + wedgeHeight;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.target = round(target);
  result.stopLoss = round(lows.at(-1) * 0.99);
  result.wedgeHeight = round(wedgeHeight);

  return result;
}

/**
 * Cup and Handle Detection
 * Bullish continuation pattern
 */
function detectCupAndHandle(candles) {
  const result = {
    detected: false,
    type: 'CUP_AND_HANDLE',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 40) return result;

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  // Find cup formation (U-shape)
  const len = closes.length;
  const cupStart = Math.floor(len * 0.3);
  const cupEnd = Math.floor(len * 0.85);

  // Left rim (high point at start)
  const leftRim = Math.max(...highs.slice(0, cupStart));
  const leftRimIdx = highs.indexOf(leftRim);

  // Right rim (high point near end)
  const rightRim = Math.max(...highs.slice(cupEnd));
  const rightRimIdx = cupEnd + highs.slice(cupEnd).indexOf(rightRim);

  // Rims should be at similar levels
  const rimDiff = Math.abs(leftRim - rightRim) / leftRim;
  if (rimDiff > 0.03) return result;

  // Cup bottom (low point between rims)
  const cupBottom = Math.min(...lows.slice(leftRimIdx, rightRimIdx));
  const cupBottomIdx = leftRimIdx + lows.slice(leftRimIdx, rightRimIdx).indexOf(cupBottom);

  // Cup depth should be 12-33% of rim height
  const cupDepth = (leftRim - cupBottom) / leftRim;
  if (cupDepth < 0.12 || cupDepth > 0.33) return result;

  // Check for handle (small consolidation after right rim)
  const handleCandles = candles.slice(rightRimIdx);
  if (handleCandles.length < 3) return result;

  const handleLows = handleCandles.map(c => c.low);
  const handleRetracement = (rightRim - Math.min(...handleLows)) / (rightRim - cupBottom);

  // Handle should retrace 30-50% of cup
  if (handleRetracement < 0.1 || handleRetracement > 0.5) return result;

  let confidence = 60;
  if (rimDiff < 0.02) confidence += 10;
  if (handleRetracement > 0.2 && handleRetracement < 0.4) confidence += 10;

  const cupHeight = leftRim - cupBottom;
  const target = rightRim + cupHeight;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.leftRim = round(leftRim);
  result.rightRim = round(rightRim);
  result.cupBottom = round(cupBottom);
  result.cupDepth = round(cupDepth * 100, 1);
  result.target = round(target);
  result.stopLoss = round(Math.min(...handleLows) * 0.99);
  result.entry = round(rightRim * 1.002);

  return result;
}

/**
 * Double Top Pattern Detection
 */
function detectDoubleTopPattern(candles) {
  const result = {
    detected: false,
    type: 'DOUBLE_TOP',
    direction: 'bearish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const peaks = findSignificantPeaks(highs, 5);
  if (peaks.length < 2) return result;

  // Check last two peaks
  const peak1 = peaks.at(-2);
  const peak2 = peaks.at(-1);

  // Peaks should be at similar levels
  const peakDiff = Math.abs(peak1.value - peak2.value) / peak1.value;
  if (peakDiff > 0.02) return result;

  // Find neckline (low between peaks)
  const neckline = Math.min(...lows.slice(peak1.index, peak2.index + 1));

  const patternHeight = peak1.value - neckline;
  const currentPrice = closes.at(-1);

  // Price should be near or below neckline
  if ((currentPrice - neckline) / neckline > 0.01) return result;

  let confidence = 60;
  if (peakDiff < 0.01) confidence += 10;
  if (currentPrice < neckline) confidence += 15;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.peak1 = round(peak1.value);
  result.peak2 = round(peak2.value);
  result.neckline = round(neckline);
  result.target = round(neckline - patternHeight);
  result.stopLoss = round(Math.max(peak1.value, peak2.value) * 1.01);
  result.entry = round(neckline * 0.998);

  return result;
}

/**
 * Double Bottom Pattern Detection
 */
function detectDoubleBottomPattern(candles) {
  const result = {
    detected: false,
    type: 'DOUBLE_BOTTOM',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const closes = candles.map(c => c.close);

  const troughs = findSignificantTroughs(lows, 5);
  if (troughs.length < 2) return result;

  const trough1 = troughs.at(-2);
  const trough2 = troughs.at(-1);

  const troughDiff = Math.abs(trough1.value - trough2.value) / trough1.value;
  if (troughDiff > 0.02) return result;

  const neckline = Math.max(...highs.slice(trough1.index, trough2.index + 1));

  const patternHeight = neckline - trough1.value;
  const currentPrice = closes.at(-1);

  if ((neckline - currentPrice) / neckline > 0.01) return result;

  let confidence = 60;
  if (troughDiff < 0.01) confidence += 10;
  if (currentPrice > neckline) confidence += 15;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.trough1 = round(trough1.value);
  result.trough2 = round(trough2.value);
  result.neckline = round(neckline);
  result.target = round(neckline + patternHeight);
  result.stopLoss = round(Math.min(trough1.value, trough2.value) * 0.99);
  result.entry = round(neckline * 1.002);

  return result;
}

/**
 * Triple Top Pattern Detection
 */
function detectTripleTop(candles) {
  const result = {
    detected: false,
    type: 'TRIPLE_TOP',
    direction: 'bearish',
    confidence: 0
  };

  if (candles.length < 30) return result;

  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);

  const peaks = findSignificantPeaks(highs, 5);
  if (peaks.length < 3) return result;

  const recentPeaks = peaks.slice(-3);
  const avgPeak = recentPeaks.reduce((a, b) => a + b.value, 0) / 3;

  // All three peaks should be within 2%
  const allSimilar = recentPeaks.every(p => Math.abs(p.value - avgPeak) / avgPeak < 0.02);
  if (!allSimilar) return result;

  const neckline = Math.min(...lows.slice(recentPeaks[0].index, recentPeaks[2].index + 1));
  const patternHeight = avgPeak - neckline;
  const currentPrice = closes.at(-1);

  let confidence = 65;
  if (currentPrice < neckline) confidence += 15;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.peaks = recentPeaks.map(p => round(p.value));
  result.neckline = round(neckline);
  result.target = round(neckline - patternHeight);
  result.stopLoss = round(avgPeak * 1.01);
  result.entry = round(neckline * 0.998);

  return result;
}

/**
 * Triple Bottom Pattern Detection
 */
function detectTripleBottom(candles) {
  const result = {
    detected: false,
    type: 'TRIPLE_BOTTOM',
    direction: 'bullish',
    confidence: 0
  };

  if (candles.length < 30) return result;

  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const closes = candles.map(c => c.close);

  const troughs = findSignificantTroughs(lows, 5);
  if (troughs.length < 3) return result;

  const recentTroughs = troughs.slice(-3);
  const avgTrough = recentTroughs.reduce((a, b) => a + b.value, 0) / 3;

  const allSimilar = recentTroughs.every(t => Math.abs(t.value - avgTrough) / avgTrough < 0.02);
  if (!allSimilar) return result;

  const neckline = Math.max(...highs.slice(recentTroughs[0].index, recentTroughs[2].index + 1));
  const patternHeight = neckline - avgTrough;
  const currentPrice = closes.at(-1);

  let confidence = 65;
  if (currentPrice > neckline) confidence += 15;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.troughs = recentTroughs.map(t => round(t.value));
  result.neckline = round(neckline);
  result.target = round(neckline + patternHeight);
  result.stopLoss = round(avgTrough * 0.99);
  result.entry = round(neckline * 1.002);

  return result;
}

/**
 * Channel Pattern Detection (Ascending/Descending/Horizontal)
 */
function detectChannel(candles) {
  const result = {
    detected: false,
    type: 'CHANNEL',
    direction: 'neutral',
    confidence: 0
  };

  if (candles.length < 20) return result;

  const recent = candles.slice(-30);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  const highReg = linearRegression(highs);
  const lowReg = linearRegression(lows);

  // Slopes should be similar (parallel)
  const slopeDiff = Math.abs(highReg.slope - lowReg.slope);
  const avgPrice = (highs.reduce((a, b) => a + b) / highs.length + lows.reduce((a, b) => a + b) / lows.length) / 2;

  if (slopeDiff / avgPrice > 0.001) return result; // Not parallel enough

  // Determine channel type
  let channelType = 'horizontal';
  if (highReg.slope > 0.0001) channelType = 'ascending';
  if (highReg.slope < -0.0001) channelType = 'descending';

  // Count touches
  const highTouches = countTrendlineTouches(highs, highReg);
  const lowTouches = countTrendlineTouches(lows, lowReg);

  if (highTouches < 2 || lowTouches < 2) return result;

  const channelHeight = highs.at(-1) - lows.at(-1);
  const currentPrice = recent.at(-1).close;
  const pricePosition = (currentPrice - lows.at(-1)) / channelHeight;

  let confidence = 55;
  if (highTouches >= 3) confidence += 10;
  if (lowTouches >= 3) confidence += 10;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.channelType = channelType;
  result.upperBound = round(highs.at(-1));
  result.lowerBound = round(lows.at(-1));
  result.channelHeight = round(channelHeight);
  result.pricePosition = round(pricePosition, 2);

  // Trade based on position in channel
  if (pricePosition < 0.2) {
    result.direction = 'bullish';
    result.signal = 'BUY_AT_SUPPORT';
    result.target = round(highs.at(-1));
    result.stopLoss = round(lows.at(-1) * 0.99);
  } else if (pricePosition > 0.8) {
    result.direction = 'bearish';
    result.signal = 'SELL_AT_RESISTANCE';
    result.target = round(lows.at(-1));
    result.stopLoss = round(highs.at(-1) * 1.01);
  }

  return result;
}

/**
 * Rectangle Pattern Detection
 */
function detectRectangle(candles) {
  const result = {
    detected: false,
    type: 'RECTANGLE',
    direction: 'neutral',
    confidence: 0
  };

  if (candles.length < 15) return result;

  const recent = candles.slice(-25);
  const highs = recent.map(c => c.high);
  const lows = recent.map(c => c.low);

  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  // Check if price is consolidating in a range
  const highVariance = calculateVariance(highs);
  const lowVariance = calculateVariance(lows);

  const avgPrice = (resistance + support) / 2;
  const highVarPercent = Math.sqrt(highVariance) / avgPrice;
  const lowVarPercent = Math.sqrt(lowVariance) / avgPrice;

  // Low variance indicates ranging market
  if (highVarPercent > 0.03 || lowVarPercent > 0.03) return result;

  // Count touches of support and resistance
  const resistanceTouches = highs.filter(h => Math.abs(h - resistance) / resistance < 0.01).length;
  const supportTouches = lows.filter(l => Math.abs(l - support) / support < 0.01).length;

  if (resistanceTouches < 2 || supportTouches < 2) return result;

  const rangeHeight = resistance - support;

  let confidence = 55;
  if (resistanceTouches >= 3) confidence += 10;
  if (supportTouches >= 3) confidence += 10;

  result.detected = true;
  result.confidence = Math.min(confidence, 95);
  result.resistance = round(resistance);
  result.support = round(support);
  result.rangeHeight = round(rangeHeight);
  result.breakoutTargets = {
    bullish: round(resistance + rangeHeight),
    bearish: round(support - rangeHeight)
  };

  return result;
}

// ============ HELPER FUNCTIONS ============

function findSignificantPeaks(values, minDistance) {
  const peaks = [];
  for (let i = minDistance; i < values.length - minDistance; i++) {
    let isPeak = true;
    for (let j = 1; j <= minDistance; j++) {
      if (values[i] <= values[i - j] || values[i] <= values[i + j]) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) {
      peaks.push({ index: i, value: values[i] });
    }
  }
  return peaks;
}

function findSignificantTroughs(values, minDistance) {
  const troughs = [];
  for (let i = minDistance; i < values.length - minDistance; i++) {
    let isTrough = true;
    for (let j = 1; j <= minDistance; j++) {
      if (values[i] >= values[i - j] || values[i] >= values[i + j]) {
        isTrough = false;
        break;
      }
    }
    if (isTrough) {
      troughs.push({ index: i, value: values[i] });
    }
  }
  return troughs;
}

function linearRegression(values) {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

function countTrendlineTouches(values, regression, tolerance = 0.01) {
  let touches = 0;
  for (let i = 0; i < values.length; i++) {
    const expectedValue = regression.intercept + regression.slope * i;
    if (Math.abs(values[i] - expectedValue) / expectedValue < tolerance) {
      touches++;
    }
  }
  return touches;
}

function calculateVolumeTrend(candles) {
  const volumes = candles.map(c => c.volume);
  const reg = linearRegression(volumes);
  return reg.slope;
}

function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b) / values.length;
}

function round(value, decimals = 4) {
  if (value === undefined || value === null || isNaN(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function generatePatternSummary(patterns, candles) {
  if (patterns.length === 0) {
    return {
      hasPatterns: false,
      dominantDirection: 'neutral',
      patternCount: 0,
      bestPattern: null,
      recommendation: null
    };
  }

  const bullishPatterns = patterns.filter(p => p.direction === 'bullish');
  const bearishPatterns = patterns.filter(p => p.direction === 'bearish');

  const bullishScore = bullishPatterns.reduce((sum, p) => sum + p.confidence, 0);
  const bearishScore = bearishPatterns.reduce((sum, p) => sum + p.confidence, 0);

  const dominantDirection = bullishScore > bearishScore ? 'bullish' :
                           bearishScore > bullishScore ? 'bearish' : 'neutral';

  const bestPattern = patterns[0]; // Already sorted by confidence

  return {
    hasPatterns: true,
    dominantDirection,
    patternCount: patterns.length,
    bullishPatterns: bullishPatterns.length,
    bearishPatterns: bearishPatterns.length,
    bullishScore: round(bullishScore, 0),
    bearishScore: round(bearishScore, 0),
    bestPattern: {
      type: bestPattern.type,
      direction: bestPattern.direction,
      confidence: bestPattern.confidence,
      target: bestPattern.target,
      stopLoss: bestPattern.stopLoss,
      entry: bestPattern.entry
    },
    recommendation: generateRecommendation(bestPattern, dominantDirection)
  };
}

function generateRecommendation(pattern, direction) {
  if (!pattern || pattern.confidence < 60) {
    return { action: 'WAIT', reason: 'No high-confidence pattern' };
  }

  if (direction === 'bullish' && pattern.direction === 'bullish') {
    return {
      action: 'LONG',
      reason: `${pattern.type} pattern detected`,
      entry: pattern.entry,
      target: pattern.target,
      stopLoss: pattern.stopLoss,
      confidence: pattern.confidence
    };
  }

  if (direction === 'bearish' && pattern.direction === 'bearish') {
    return {
      action: 'SHORT',
      reason: `${pattern.type} pattern detected`,
      entry: pattern.entry,
      target: pattern.target,
      stopLoss: pattern.stopLoss,
      confidence: pattern.confidence
    };
  }

  return { action: 'WAIT', reason: 'Mixed signals' };
}

module.exports = {
  detectChartPatterns,
  detectHeadAndShoulders,
  detectInverseHeadAndShoulders,
  detectAscendingTriangle,
  detectDescendingTriangle,
  detectSymmetricalTriangle,
  detectBullFlag,
  detectBearFlag,
  detectRisingWedge,
  detectFallingWedge,
  detectCupAndHandle,
  detectDoubleTopPattern,
  detectDoubleBottomPattern,
  detectTripleTop,
  detectTripleBottom,
  detectChannel,
  detectRectangle
};
