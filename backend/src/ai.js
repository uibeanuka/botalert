const { findSimilarPatterns } = require('./patternMemory');
const { getMarketCycleAnalysis, checkCycleAlignment } = require('./marketCycle');

function predictNextMove(indicators, multiTimeframeData = null) {
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
    tradeLevels,
    sniperSignals, // NEW: Predictive signals
    midweekReversal // NEW: Midweek reversal caution
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
  // IMPORTANT: Reduce RSI signal strength when against the trend (avoid catching falling knives)
  const trendDir = trend?.direction;
  const inDowntrend = trendDir === 'DOWN' || trendDir === 'STRONG_DOWN';
  const inUptrend = trendDir === 'UP' || trendDir === 'STRONG_UP';

  if (typeof rsi === 'number') {
    if (rsi < 25) {
      // In downtrend, oversold RSI is less reliable (falling knife)
      const rsiPoints = inDowntrend ? 8 : 20;
      bullScore += rsiPoints;
      reasons.push(`RSI extremely oversold (${rsi.toFixed(1)})${inDowntrend ? ' [trend caution]' : ''}`);
    } else if (rsi < 30) {
      const rsiPoints = inDowntrend ? 5 : 15;
      bullScore += rsiPoints;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})${inDowntrend ? ' [trend caution]' : ''}`);
    } else if (rsi < 40) {
      bullScore += inDowntrend ? 2 : 5;
    } else if (rsi > 75) {
      // In uptrend, overbought RSI is less reliable (momentum can continue)
      const rsiPoints = inUptrend ? 8 : 20;
      bearScore += rsiPoints;
      reasons.push(`RSI extremely overbought (${rsi.toFixed(1)})${inUptrend ? ' [trend caution]' : ''}`);
    } else if (rsi > 70) {
      const rsiPoints = inUptrend ? 5 : 15;
      bearScore += rsiPoints;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})${inUptrend ? ' [trend caution]' : ''}`);
    } else if (rsi > 60) {
      bearScore += inUptrend ? 2 : 5;
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

  // 9b. Midweek reversal caution (Wednesday NY time, V/U/W patterns)
  let midweekCaution = 0;
  if (midweekReversal?.windowActive && midweekReversal?.detected) {
    const shape = midweekReversal.shape || 'reversal';
    const dir = midweekReversal.direction === 'down' ? 'downtrend' : 'uptrend';
    reasons.push(`Caution: Midweek ${shape}-shape reversal (${dir})`);
    midweekCaution = 0.03; // slight confidence trim, no direction change
  }

  // === NEW: SNIPER/PREDICTIVE SIGNALS (weight: 30 points max) ===
  let sniperBonus = 0;
  if (sniperSignals) {
    // Divergence signals (early reversal detection)
    if (sniperSignals.divergence?.type === 'bullish') {
      bullScore += Math.min(15, sniperSignals.divergence.strength * 0.15);
      if (sniperSignals.divergence.strength > 40) {
        reasons.push('SNIPER: Bullish divergence detected');
      }
    } else if (sniperSignals.divergence?.type === 'bearish') {
      bearScore += Math.min(15, sniperSignals.divergence.strength * 0.15);
      if (sniperSignals.divergence.strength > 40) {
        reasons.push('SNIPER: Bearish divergence detected');
      }
    }

    // Volume accumulation (smart money moving)
    if (sniperSignals.volumeAccumulation?.detected) {
      const dir = sniperSignals.volumeAccumulation.direction;
      if (dir === 'bullish') {
        bullScore += Math.min(12, sniperSignals.volumeAccumulation.strength * 0.12);
        if (sniperSignals.volumeAccumulation.strength > 50) {
          reasons.push('SNIPER: Bullish volume accumulation');
        }
      } else if (dir === 'bearish') {
        bearScore += Math.min(12, sniperSignals.volumeAccumulation.strength * 0.12);
        if (sniperSignals.volumeAccumulation.strength > 50) {
          reasons.push('SNIPER: Bearish volume accumulation');
        }
      }
    }

    // Early breakout detection
    if (sniperSignals.earlyBreakout?.type === 'approaching_resistance') {
      bullScore += Math.min(10, sniperSignals.earlyBreakout.strength * 0.1);
      if (sniperSignals.earlyBreakout.strength > 60) {
        reasons.push('SNIPER: Building for breakout');
      }
    } else if (sniperSignals.earlyBreakout?.type === 'approaching_support') {
      bearScore += Math.min(10, sniperSignals.earlyBreakout.strength * 0.1);
      if (sniperSignals.earlyBreakout.strength > 60) {
        reasons.push('SNIPER: Building for breakdown');
      }
    }

    // Momentum building
    if (sniperSignals.momentumBuilding?.detected) {
      const dir = sniperSignals.momentumBuilding.direction;
      if (dir === 'bullish') {
        bullScore += Math.min(8, sniperSignals.momentumBuilding.strength * 0.08);
        reasons.push('SNIPER: Bullish momentum building');
      } else if (dir === 'bearish') {
        bearScore += Math.min(8, sniperSignals.momentumBuilding.strength * 0.08);
        reasons.push('SNIPER: Bearish momentum building');
      }
    }

    // Squeeze detection (volatility compression before big move)
    if (sniperSignals.squeeze?.inSqueeze) {
      sniperBonus += 5; // Adds to confidence, not direction
      reasons.push('SNIPER: Squeeze - expecting big move');
    }

    // Volume surge detection (meme/alpha pump catcher)
    if (sniperSignals.volumeSurge?.detected) {
      const surge = sniperSignals.volumeSurge;
      const surgePoints = Math.min(25, surge.strength * 0.25);
      if (surge.direction === 'bullish') {
        bullScore += surgePoints;
        reasons.push(`MEME SURGE: ${surge.intensity.toFixed(1)}x vol${surge.isExplosive ? ' EXPLOSIVE' : ''} (${surge.surgePct.toFixed(1)}%)`);
      } else if (surge.direction === 'bearish') {
        bearScore += surgePoints;
        reasons.push(`DUMP SURGE: ${surge.intensity.toFixed(1)}x vol${surge.isExplosive ? ' EXPLOSIVE' : ''} (${surge.surgePct.toFixed(1)}%)`);
      }
      // Extra confidence bonus for explosive volume
      if (surge.isExplosive) {
        sniperBonus += 10;
      } else {
        sniperBonus += 5;
      }
    }

    // Track overall sniper score
    if (sniperSignals.score?.isSniper) {
      sniperBonus += 5;
    }
  }

  // === PATTERN MEMORY BOOST ===
  let patternMemoryBoost = 0;
  let patternMatch = null;
  try {
    patternMatch = findSimilarPatterns(indicators);
    if (patternMatch.found && patternMatch.confidenceBoost > 0) {
      patternMemoryBoost = patternMatch.confidenceBoost;
      if (patternMatch.isBestPattern) {
        reasons.push(`LEARNED: High win-rate pattern (${patternMatch.winRate}%)`);
      }
      // Extra flag when this pattern previously led to big moves the bot missed
      if (patternMatch.isMissedPattern) {
        reasons.push(`LEARNED: Pattern seen in ${patternMatch.missedWins} missed pumps`);
        patternMemoryBoost += 5; // Extra urgency — don't miss it again
      }

      // Adjust scores if historical direction is known
      if (patternMatch.historicalDirection === 'long') {
        bullScore += patternMatch.isMissedPattern ? 10 : 5;
      } else if (patternMatch.historicalDirection === 'short') {
        bearScore += patternMatch.isMissedPattern ? 10 : 5;
      }
    }
  } catch (e) {
    // Pattern memory not loaded
  }

  // === MULTI-TIMEFRAME CONFLUENCE (if provided) ===
  let mtfBonus = 0;
  if (multiTimeframeData) {
    const { higherTimeframe, lowerTimeframe } = multiTimeframeData;

    // Check if higher timeframe agrees with current direction
    if (higherTimeframe?.direction === 'long' && bullScore > bearScore) {
      mtfBonus += 10;
      reasons.push('MTF: Higher timeframe confirms LONG');
    } else if (higherTimeframe?.direction === 'short' && bearScore > bullScore) {
      mtfBonus += 10;
      reasons.push('MTF: Higher timeframe confirms SHORT');
    }

    // Lower timeframe entry timing
    if (lowerTimeframe?.signal?.includes('LONG') && bullScore > bearScore) {
      mtfBonus += 5;
    } else if (lowerTimeframe?.signal?.includes('SHORT') && bearScore > bullScore) {
      mtfBonus += 5;
    }
  }

  // === MARKET CYCLE ANALYSIS (Halving cycle + Seasonality) ===
  let cycleBonus = 0;
  let marketCycle = null;
  try {
    marketCycle = getMarketCycleAnalysis();
    const { aiAdjustments, cyclePhase, seasonality } = marketCycle;

    // Apply cycle-based score adjustments
    // This biases the bot towards longs in bull phases, shorts in bear phases
    if (aiAdjustments.longScoreBonus !== 0) {
      bullScore += aiAdjustments.longScoreBonus;
      bearScore += aiAdjustments.shortScoreBonus;

      if (aiAdjustments.longScoreBonus > 5) {
        reasons.push(`CYCLE: ${cyclePhase.phase} + ${seasonality.monthName} favor LONGS (+${aiAdjustments.longScoreBonus})`);
      } else if (aiAdjustments.shortScoreBonus > 5) {
        reasons.push(`CYCLE: ${cyclePhase.phase} + ${seasonality.monthName} favor SHORTS (+${aiAdjustments.shortScoreBonus})`);
      }
    }

    cycleBonus = aiAdjustments.confidenceBonus * 100; // Convert to points
  } catch (e) {
    // Market cycle module not available
  }

  // Calculate final scores and direction
  const totalScore = bullScore + bearScore;
  const maxPossibleScore = 185; // Updated for sniper + volume surge signals

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

    // Sniper bonus
    confidence += sniperBonus / 100;

    // Pattern memory bonus
    confidence += patternMemoryBoost / 100;

    // Multi-timeframe bonus
    confidence += mtfBonus / 100;

    // Market cycle bonus (halving + seasonality alignment)
    confidence += cycleBonus / 100;

    // Midweek reversal caution (small penalty)
    confidence -= midweekCaution;

    // === HYSTERESIS FIX: Prevent flip-flopping on small score changes ===
    // Option 1: Require ≥10 point score difference to set a directional bias
    // Option 3: Neutral zone - if scores within 15 points, stay HOLD (no signal)
    const MIN_DIFF_FOR_DIRECTION = 10;  // Minimum to change direction
    const NEUTRAL_ZONE_THRESHOLD = 15;  // Minimum for actionable signal

    // === SNIPER CONFLICT CHECK ===
    // If sniper has a strong signal in opposite direction, it should block the trade
    const sniperDir = sniperSignals?.score?.direction;
    const sniperScore = sniperSignals?.score?.score || 0;
    const sniperIsStrong = sniperSignals?.score?.isSniper && sniperScore >= 40;

    // Determine direction only if score difference is significant enough
    if (scoreDiff >= MIN_DIFF_FOR_DIRECTION) {
      if (bullScore > bearScore) {
        direction = 'long';

        // SNIPER CONFLICT: If bearish sniper is active, block the LONG
        if (sniperIsStrong && sniperDir === 'bearish') {
          reasons.push(`SNIPER BLOCK: Bearish sniper (${sniperScore}) opposes LONG - waiting`);
          confidence -= 0.15; // Reduce confidence significantly
          // Keep signal as HOLD - don't enter against sniper
        } else {
          // Only generate signal if outside neutral zone
          if (scoreDiff >= NEUTRAL_ZONE_THRESHOLD && bullScore >= 40) {
            signal = 'LONG';
            if (bullScore >= 60 && scoreDiff >= 25) {
              signal = 'STRONG_LONG';
              confidence += 0.05;
            }
          }
          // SNIPER signal: upgrade when sniper AGREES with direction
          if (sniperSignals?.score?.isSniper && sniperDir === 'bullish') {
            signal = 'SNIPER_LONG';
            confidence += 0.03;
          }
        }
      } else if (bearScore > bullScore) {
        direction = 'short';

        // SNIPER CONFLICT: If bullish sniper is active, block the SHORT
        if (sniperIsStrong && sniperDir === 'bullish') {
          reasons.push(`SNIPER BLOCK: Bullish sniper (${sniperScore}) opposes SHORT - waiting`);
          confidence -= 0.15; // Reduce confidence significantly
          // Keep signal as HOLD - don't enter against sniper
        } else {
          // Only generate signal if outside neutral zone
          if (scoreDiff >= NEUTRAL_ZONE_THRESHOLD && bearScore >= 40) {
            signal = 'SHORT';
            if (bearScore >= 60 && scoreDiff >= 25) {
              signal = 'STRONG_SHORT';
              confidence += 0.05;
            }
          }
          // SNIPER signal: upgrade when sniper AGREES with direction
          if (sniperSignals?.score?.isSniper && sniperDir === 'bearish') {
            signal = 'SNIPER_SHORT';
            confidence += 0.03;
          }
        }
      }
    } else {
      // Scores too close - add reason for neutral stance
      reasons.push(`Mixed signals (bull: ${bullScore}, bear: ${bearScore}, diff: ${scoreDiff})`);
    }
    // scoreDiff < 10: direction stays 'neutral', signal stays 'HOLD'
    // This prevents flip-flopping when bull/bear scores are close

    // Volume surge can generate signals even when other indicators are neutral
    // Meme coins pump on volume before traditional indicators catch up
    if (sniperSignals?.volumeSurge?.detected && sniperSignals?.volumeSurge?.strength >= 50) {
      const surgeDir = sniperSignals.volumeSurge.direction;
      if (surgeDir === 'bullish' && (signal === 'HOLD' || signal === 'LONG')) {
        direction = 'long';
        signal = sniperSignals.volumeSurge.isExplosive ? 'STRONG_LONG' : 'SNIPER_LONG';
        confidence += sniperSignals.volumeSurge.isExplosive ? 0.08 : 0.04;
        if (!reasons.some(r => r.includes('MEME SURGE'))) {
          reasons.push('VOLUME SURGE: Early meme/alpha entry');
        }
      } else if (surgeDir === 'bearish' && (signal === 'HOLD' || signal === 'SHORT')) {
        direction = 'short';
        signal = sniperSignals.volumeSurge.isExplosive ? 'STRONG_SHORT' : 'SNIPER_SHORT';
        confidence += sniperSignals.volumeSurge.isExplosive ? 0.08 : 0.04;
        if (!reasons.some(r => r.includes('DUMP SURGE'))) {
          reasons.push('VOLUME SURGE: Early dump detection');
        }
      }
    }

    // Sniper can also generate signals when scores are close but sniper conviction is high
    // This handles the case where bullScore ~ bearScore (no clear winner) but sniper sees early setup
    if (signal === 'HOLD' && sniperSignals?.score?.isSniper && sniperSignals?.score?.score >= 65) {
      const sniperDir = sniperSignals.score.direction;
      if (sniperDir === 'bullish') {
        direction = 'long';
        signal = 'SNIPER_LONG';
        confidence += 0.05;
        reasons.push('SNIPER: Early entry on strong predictive signal');
      } else if (sniperDir === 'bearish') {
        direction = 'short';
        signal = 'SNIPER_SHORT';
        confidence += 0.05;
        reasons.push('SNIPER: Early entry on strong predictive signal');
      }
    }
  }

  // Cap confidence
  confidence = Math.min(0.95, Math.max(0.1, confidence));

  // Build trade recommendation
  const trade = buildTradeRecommendation(direction, tradeLevels, confidence, signal, sniperSignals);

  return {
    direction,
    signal,
    confidence: Number(confidence.toFixed(2)),
    reasons: reasons.slice(0, 7), // Top 7 reasons (more for sniper)
    scores: {
      bull: bullScore,
      bear: bearScore,
      momentum: momentumScore || 0,
      sniper: sniperSignals?.score?.score || 0
    },
    trade,
    // Include sniper analysis
    sniperAnalysis: sniperSignals ? {
      isSniper: sniperSignals.score?.isSniper || false,
      isVolumeSurge: sniperSignals.score?.isVolumeSurge || false,
      direction: sniperSignals.score?.direction,
      signals: sniperSignals.score?.signals || [],
      divergence: sniperSignals.divergence?.type,
      squeeze: sniperSignals.squeeze?.inSqueeze,
      volumeSurge: sniperSignals.volumeSurge || null
    } : null,
    // Pattern memory
    patternMatch: patternMatch?.found ? {
      matches: patternMatch.matches,
      winRate: patternMatch.winRate,
      isBestPattern: patternMatch.isBestPattern
    } : null,
    // Market cycle analysis (halving + seasonality)
    marketCycle: marketCycle ? {
      phase: marketCycle.cyclePhase?.phase,
      monthsSinceHalving: marketCycle.cyclePhase?.monthsSinceHalving,
      month: marketCycle.seasonality?.monthName,
      overallBias: marketCycle.overallBias,
      recommendation: marketCycle.recommendation,
      longBias: marketCycle.longBias
    } : null
  };
}

function buildTradeRecommendation(direction, tradeLevels, confidence, signal, sniperSignals) {
  // Allow trades with SNIPER signals even without standard signals
  const validSignals = ['LONG', 'SHORT', 'STRONG_LONG', 'STRONG_SHORT', 'SNIPER_LONG', 'SNIPER_SHORT'];

  if (!tradeLevels || (!validSignals.includes(signal) && signal === 'HOLD')) {
    return null;
  }

  const levels = direction === 'long' ? tradeLevels.long : tradeLevels.short;

  if (!levels) {
    return null;
  }

  // Lower R:R requirement for sniper signals (they're predictive)
  const minRR = signal.includes('SNIPER') ? 1.0 : 1.2;
  if (levels.rr < minRR) {
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

  // Sniper trades can be more aggressive due to early entry
  if (signal.includes('SNIPER') && confidence >= 0.7) {
    positionSize = 'normal';
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
    atrPercent: tradeLevels.atrPct,
    isSniper: signal.includes('SNIPER')
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
  const validSignals = ['LONG', 'SHORT', 'STRONG_LONG', 'STRONG_SHORT', 'SNIPER_LONG', 'SNIPER_SHORT'];

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
