function predictNextMove(indicators) {
  if (!indicators) {
    return { direction: 'neutral', confidence: 0.5, explanation: 'No indicators available' };
  }

  const { rsi, macd, kdj, volumeSpike, breakout, momentumScore } = indicators;
  let confidence = 0.5;
  let direction = 'neutral';
  const reasons = [];

  if (breakout?.direction) {
    direction = breakout.direction === 'up' ? 'long' : 'short';
    confidence += 0.15;
    reasons.push(`Breakout ${breakout.direction}`);
  }

  if (macd?.histogram !== undefined) {
    if (macd.histogram > 0) {
      direction = 'long';
      confidence += 0.1;
      reasons.push('MACD momentum up');
    } else if (macd.histogram < 0) {
      direction = 'short';
      confidence += 0.1;
      reasons.push('MACD momentum down');
    }
  }

  if (typeof rsi === 'number') {
    if (rsi < 30) {
      direction = 'long';
      confidence += 0.1;
      reasons.push('RSI oversold');
    } else if (rsi > 70) {
      direction = 'short';
      confidence += 0.1;
      reasons.push('RSI overbought');
    }
  }

  if (kdj?.j !== undefined) {
    if (kdj.j < 20) {
      direction = 'long';
      confidence += 0.05;
      reasons.push('KDJ J oversold');
    } else if (kdj.j > 80) {
      direction = 'short';
      confidence += 0.05;
      reasons.push('KDJ J overbought');
    }
  }

  if (volumeSpike) {
    confidence += 0.05;
    reasons.push('Volume spike');
  }

  confidence = Math.min(0.99, Math.max(0.01, confidence + (momentumScore || 0) / 400));

  return {
    direction,
    confidence: Number(confidence.toFixed(2)),
    reasons
  };
}

module.exports = { predictNextMove };
