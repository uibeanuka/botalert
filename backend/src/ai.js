function predictNextMove(indicators) {
  if (!indicators) {
    return { direction: 'neutral', confidence: 0.5, explanation: 'No indicators available', signal: 'HOLD' };
  }

  const {
    currentPrice,
    rsi,
    macd,
    bollinger,
    kdj,
    atr,
    ema,
    trend,
    volumeSpike,
    volumeRatio,
    support,
    resistance,
    breakout,
    patterns,
    momentumScore,
    tradeLevels
  } = indicators;

  let bullScore = 0;
  let bearScore = 0;
  const reasons = [];

  // 1. Trend Analysis (weight: 25 points max)
  if (trend) {
    if (trend.direction === 'STRONG_UP') {
      bullScore += 25;
      reasons.push('Strong uptrend');
    } else if (trend.direction === 'UP') {
      bullScore += 15;
      reasons.push('Uptrend');
    } else if (trend.direction === 'STRONG_DOWN') {
      bearScore += 25;
      reasons.push('Strong downtrend');
    } else if (trend.direction === 'DOWN') {
      bearScore += 15;
      reasons.push('Downtrend');
    }
  }

  // 2. RSI Analysis (weight: 20 points max)
  if (typeof rsi === 'number') {
    if (rsi < 25) {
      bullScore += 20;
      reasons.push(`RSI extremely oversold (${rsi.toFixed(1)})`);
    } else if (rsi < 30) {
      bullScore += 15;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi < 40) {
      bullScore += 5;
    } else if (rsi > 75) {
      bearScore += 20;
      reasons.push(`RSI extremely overbought (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      bearScore += 15;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    } else if (rsi > 60) {
      bearScore += 5;
    }
  }

  // 3. MACD Analysis (weight: 15 points max)
  if (macd?.histogram !== undefined) {
    const histAbs = Math.abs(macd.histogram);
    if (macd.histogram > 0 && macd.MACD > macd.signal) {
      bullScore += Math.min(15, histAbs * 3);
      if (histAbs > 1) reasons.push('MACD bullish momentum');
    } else if (macd.histogram < 0 && macd.MACD < macd.signal) {
      bearScore += Math.min(15, histAbs * 3);
      if (histAbs > 1) reasons.push('MACD bearish momentum');
    }
  }

  // 4. Bollinger Bands Analysis (weight: 15 points max)
  if (bollinger?.pb !== undefined) {
    if (bollinger.pb < 0) {
      bullScore += 15;
      reasons.push('Price below lower Bollinger');
    } else if (bollinger.pb < 0.2) {
      bullScore += 10;
      reasons.push('Near lower Bollinger band');
    } else if (bollinger.pb > 1) {
      bearScore += 15;
      reasons.push('Price above upper Bollinger');
    } else if (bollinger.pb > 0.8) {
      bearScore += 10;
      reasons.push('Near upper Bollinger band');
    }
  }

  // 5. KDJ Analysis (weight: 10 points max)
  if (kdj?.j !== undefined) {
    if (kdj.j < 0) {
      bullScore += 10;
      reasons.push('KDJ J extremely oversold');
    } else if (kdj.j < 20) {
      bullScore += 7;
      reasons.push('KDJ J oversold');
    } else if (kdj.j > 100) {
      bearScore += 10;
      reasons.push('KDJ J extremely overbought');
    } else if (kdj.j > 80) {
      bearScore += 7;
      reasons.push('KDJ J overbought');
    }
  }

  // 6. Breakout Detection (weight: 15 points max)
  if (breakout?.direction) {
    if (breakout.direction === 'up') {
      bullScore += 15;
      reasons.push('Breakout above resistance');
    } else if (breakout.direction === 'down') {
      bearScore += 15;
      reasons.push('Breakdown below support');
    }
  }

  // 7. Volume Confirmation (weight: 10 points max)
  if (volumeSpike) {
    const dominantDirection = bullScore > bearScore ? 'bull' : 'bear';
    if (dominantDirection === 'bull') {
      bullScore += 10;
    } else {
      bearScore += 10;
    }
    reasons.push(`Volume spike (${volumeRatio?.toFixed(1)}x avg)`);
  }

  // 8. Support/Resistance Proximity (weight: 10 points max)
  if (currentPrice && support && resistance) {
    const range = resistance - support;
    if (range > 0) {
      const pricePosition = (currentPrice - support) / range;
      if (pricePosition < 0.15) {
        bullScore += 10;
        reasons.push('Near support level');
      } else if (pricePosition > 0.85) {
        bearScore += 10;
        reasons.push('Near resistance level');
      }
    }
  }

  // 9. Candlestick Patterns (weight: 10 points max)
  if (patterns && patterns.length > 0) {
    for (const pattern of patterns) {
      if (['BULLISH_ENGULFING', 'HAMMER', 'MORNING_STAR'].includes(pattern)) {
        bullScore += 10;
        reasons.push(formatPatternName(pattern));
        break;
      }
      if (['BEARISH_ENGULFING', 'SHOOTING_STAR', 'EVENING_STAR'].includes(pattern)) {
        bearScore += 10;
        reasons.push(formatPatternName(pattern));
        break;
      }
      if (pattern === 'DOJI') {
        reasons.push('Doji - indecision');
      }
    }
  }

  // Calculate final scores and direction
  const totalScore = bullScore + bearScore;
  const maxPossibleScore = 130; // Sum of all max weights

  let direction = 'neutral';
  let signal = 'HOLD';
  let confidence = 0.5;

  if (totalScore > 0) {
    const scoreDiff = Math.abs(bullScore - bearScore);
    const dominantScore = Math.max(bullScore, bearScore);

    // Base confidence from dominant score percentage
    confidence = 0.4 + (dominantScore / maxPossibleScore) * 0.4;

    // Bonus for clear directional bias
    if (scoreDiff > 20) {
      confidence += 0.1;
    }

    // Determine direction and signal
    if (bullScore > bearScore) {
      direction = 'long';
      if (bullScore >= 40 && scoreDiff >= 15) {
        signal = 'LONG';
        if (bullScore >= 60 && scoreDiff >= 25) {
          signal = 'STRONG_LONG';
          confidence += 0.05;
        }
      }
    } else if (bearScore > bullScore) {
      direction = 'short';
      if (bearScore >= 40 && scoreDiff >= 15) {
        signal = 'SHORT';
        if (bearScore >= 60 && scoreDiff >= 25) {
          signal = 'STRONG_SHORT';
          confidence += 0.05;
        }
      }
    }
  }

  // Cap confidence
  confidence = Math.min(0.95, Math.max(0.1, confidence));

  // Build trade recommendation
  const trade = buildTradeRecommendation(direction, tradeLevels, confidence, signal);

  return {
    direction,
    signal,
    confidence: Number(confidence.toFixed(2)),
    reasons: reasons.slice(0, 5), // Top 5 reasons
    scores: {
      bull: bullScore,
      bear: bearScore,
      momentum: momentumScore || 0
    },
    trade
  };
}

function buildTradeRecommendation(direction, tradeLevels, confidence, signal) {
  if (!tradeLevels || signal === 'HOLD') {
    return null;
  }

  const levels = direction === 'long' ? tradeLevels.long : tradeLevels.short;

  if (!levels) {
    return null;
  }

  // Only recommend trades with decent R:R
  if (levels.rr < 1.2) {
    return null;
  }

  // Determine recommended position size based on confidence
  let positionSize = 'small';
  if (confidence >= 0.75 && levels.rr >= 2) {
    positionSize = 'normal';
  }
  if (confidence >= 0.85 && levels.rr >= 2.5) {
    positionSize = 'aggressive';
  }

  return {
    type: direction.toUpperCase(),
    entry: levels.entry,
    stopLoss: levels.stopLoss,
    takeProfit: [levels.tp1, levels.tp2, levels.tp3],
    riskPercent: levels.riskPct,
    rewardRatio: levels.rr,
    positionSize,
    atr: tradeLevels.atr,
    atrPercent: tradeLevels.atrPct
  };
}

function formatPatternName(pattern) {
  const names = {
    'BULLISH_ENGULFING': 'Bullish engulfing',
    'BEARISH_ENGULFING': 'Bearish engulfing',
    'HAMMER': 'Hammer pattern',
    'SHOOTING_STAR': 'Shooting star',
    'MORNING_STAR': 'Morning star',
    'EVENING_STAR': 'Evening star',
    'DOJI': 'Doji'
  };
  return names[pattern] || pattern;
}

// Filter signals by quality - only return high-probability setups
function filterHighProbability(prediction) {
  if (!prediction) return false;

  // Minimum requirements for a tradeable signal
  const minConfidence = 0.6;
  const minReasons = 2;
  const validSignals = ['LONG', 'SHORT', 'STRONG_LONG', 'STRONG_SHORT'];

  return (
    prediction.confidence >= minConfidence &&
    prediction.reasons.length >= minReasons &&
    validSignals.includes(prediction.signal) &&
    prediction.trade !== null
  );
}

module.exports = {
  predictNextMove,
  filterHighProbability,
  buildTradeRecommendation
};
