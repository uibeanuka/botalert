const {
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ATR,
  EMA,
  SMA
} = require('technicalindicators');

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

  // Momentum score
  const momentumScore = buildScore({ rsi, macd, kdj, volumeSpike, breakout, trend });

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
    tradeLevels
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

  const atrMultiplierSL = 1.5;  // Stop loss at 1.5x ATR
  const atrMultiplierTP1 = 2;   // TP1 at 2x ATR (1:1.33 R:R)
  const atrMultiplierTP2 = 3;   // TP2 at 3x ATR (1:2 R:R)
  const atrMultiplierTP3 = 4.5; // TP3 at 4.5x ATR (1:3 R:R)

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

function buildScore({ rsi, macd, kdj, volumeSpike, breakout, trend }) {
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

  return Math.min(score, 100);
}

module.exports = {
  calculateIndicators,
  detectBreakout,
  detectPatterns,
  buildScore,
  findSupportResistance,
  calculateTradeLevels
};
