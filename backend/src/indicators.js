const {
  RSI,
  MACD,
  BollingerBands,
  Stochastic
} = require('technicalindicators');

function calculateIndicators(candles) {
  if (!candles || candles.length === 0) {
    return null;
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const rsiSeries = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiSeries.at(-1);

  const macdSeries = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const macd = macdSeries.at(-1) || { MACD: 0, signal: 0, histogram: 0 };

  const bbSeries = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2
  });
  const bollinger = bbSeries.at(-1) || { upper: null, lower: null, middle: null };

  const stochSeries = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 9,
    signalPeriod: 3
  });
  const stoch = stochSeries.at(-1) || { k: 50, d: 50 };
  const kdj = { k: stoch.k, d: stoch.d, j: 3 * stoch.k - 2 * stoch.d };

  const avgVolume = volumes.reduce((acc, v) => acc + v, 0) / volumes.length;
  const volumeSpike = volumes.at(-1) > avgVolume * 2;

  const breakout = detectBreakout(candles);
  const patterns = detectPatterns(candles);

  const momentumScore = buildScore({ rsi, macd, kdj, volumeSpike, breakout });

  return {
    rsi,
    macd,
    bollinger,
    kdj,
    volumeSpike,
    breakout,
    patterns,
    momentumScore
  };
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
  if (candles.length < 2) return [];
  const prev = candles.at(-2);
  const last = candles.at(-1);
  const patterns = [];

  const isBullish = (c) => c.close > c.open;
  const isBearish = (c) => c.close < c.open;
  const bodySize = (c) => Math.abs(c.close - c.open);
  const wickUpper = (c) => c.high - Math.max(c.close, c.open);
  const wickLower = (c) => Math.min(c.close, c.open) - c.low;

  if (isBearish(prev) && isBullish(last) && last.open < prev.close && last.close > prev.open) {
    patterns.push('BULLISH_ENGULFING');
  }
  if (isBullish(prev) && isBearish(last) && last.open > prev.close && last.close < prev.open) {
    patterns.push('BEARISH_ENGULFING');
  }

  const lastBody = bodySize(last);
  if (lastBody > 0) {
    if (wickLower(last) > 2 * lastBody && wickUpper(last) < lastBody) {
      patterns.push('HAMMER');
    }
    if (wickUpper(last) > 2 * lastBody && wickLower(last) < lastBody) {
      patterns.push('SHOOTING_STAR');
    }
  }

  return patterns;
}

function buildScore({ rsi, macd, kdj, volumeSpike, breakout }) {
  let score = 0;

  if (rsi !== undefined && rsi !== null) {
    if (rsi < 30) score += 20;
    else if (rsi > 70) score += 20;
  }

  if (macd) {
    if (macd.histogram > 0) score += 15;
    else if (macd.histogram < 0) score += 15;
  }

  if (kdj) {
    if (kdj.j < 20) score += 10;
    else if (kdj.j > 80) score += 10;
  }

  if (volumeSpike) score += 15;
  if (breakout.direction) score += 20;

  return Math.min(score, 100);
}

module.exports = {
  calculateIndicators,
  detectBreakout,
  detectPatterns,
  buildScore
};
