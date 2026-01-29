/**
 * Machine Learning Signal Generator
 * Uses statistical learning to improve trading predictions
 * Features: Feature engineering, model training, prediction scoring
 */

const fs = require('fs');
const path = require('path');

const MODEL_FILE = path.join(__dirname, '../data/ml_model.json');
const TRAINING_DATA_FILE = path.join(__dirname, '../data/training_data.json');

// Model state
let model = {
  weights: {},
  featureStats: {},
  performance: {
    accuracy: 0,
    precision: 0,
    recall: 0,
    f1Score: 0,
    totalPredictions: 0,
    correctPredictions: 0
  },
  lastTraining: null,
  version: 1
};

let trainingData = [];

// Load model on startup
function loadModel() {
  try {
    if (fs.existsSync(MODEL_FILE)) {
      const data = fs.readFileSync(MODEL_FILE, 'utf-8');
      model = JSON.parse(data);
      console.log(`[ML] Loaded model v${model.version} with ${Object.keys(model.weights).length} features`);
    }
    if (fs.existsSync(TRAINING_DATA_FILE)) {
      const data = fs.readFileSync(TRAINING_DATA_FILE, 'utf-8');
      trainingData = JSON.parse(data);
      console.log(`[ML] Loaded ${trainingData.length} training samples`);
    }
  } catch (err) {
    console.warn('[ML] Could not load model:', err.message);
  }
}

// Save model to disk
function saveModel() {
  try {
    const dir = path.dirname(MODEL_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MODEL_FILE, JSON.stringify(model, null, 2));
    fs.writeFileSync(TRAINING_DATA_FILE, JSON.stringify(trainingData.slice(-10000))); // Keep last 10k
  } catch (err) {
    console.warn('[ML] Could not save model:', err.message);
  }
}

/**
 * Extract features from indicators for ML prediction
 * @param {Object} indicators - Technical indicators
 * @returns {Object} Normalized feature vector
 */
function extractFeatures(indicators) {
  if (!indicators) return null;

  const {
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
    sniperSignals,
    currentPrice
  } = indicators;

  // Base features
  const features = {
    // RSI features
    rsi: normalize(rsi, 0, 100),
    rsiOversold: rsi < 30 ? 1 : 0,
    rsiOverbought: rsi > 70 ? 1 : 0,
    rsiNeutral: rsi >= 30 && rsi <= 70 ? 1 : 0,
    rsiMomentum: rsi > 50 ? (rsi - 50) / 50 : (rsi - 50) / 50,

    // MACD features
    macdHistogram: normalize(macd?.histogram || 0, -10, 10),
    macdSignalDiff: normalize((macd?.MACD || 0) - (macd?.signal || 0), -5, 5),
    macdBullish: (macd?.histogram || 0) > 0 ? 1 : 0,
    macdCrossover: detectMACDCrossover(macd),

    // Bollinger features
    bbPosition: bollinger?.pb !== undefined ? bollinger.pb : 0.5,
    bbWidth: bollinger?.upper && bollinger?.lower ?
      (bollinger.upper - bollinger.lower) / bollinger.middle : 0,
    bbLowerTouch: (bollinger?.pb || 0.5) < 0.1 ? 1 : 0,
    bbUpperTouch: (bollinger?.pb || 0.5) > 0.9 ? 1 : 0,

    // KDJ features
    kdjK: normalize(kdj?.k || 50, 0, 100),
    kdjD: normalize(kdj?.d || 50, 0, 100),
    kdjJ: normalize(kdj?.j || 50, -50, 150),
    kdjOversold: (kdj?.j || 50) < 20 ? 1 : 0,
    kdjOverbought: (kdj?.j || 50) > 80 ? 1 : 0,

    // Trend features
    trendStrength: encodeTrendStrength(trend?.direction),
    trendUp: trend?.direction?.includes('UP') ? 1 : 0,
    trendDown: trend?.direction?.includes('DOWN') ? 1 : 0,
    trendScore: normalize(trend?.score || 0, -5, 5),

    // EMA features
    priceAboveEma20: currentPrice && ema?.ema20 ? (currentPrice > ema.ema20 ? 1 : 0) : 0.5,
    priceAboveEma50: currentPrice && ema?.ema50 ? (currentPrice > ema.ema50 ? 1 : 0) : 0.5,
    priceAboveEma200: currentPrice && ema?.ema200 ? (currentPrice > ema.ema200 ? 1 : 0) : 0.5,
    emaAlignment: calculateEMAAlignment(ema, currentPrice),

    // Volume features
    volumeRatio: normalize(volumeRatio || 1, 0, 5),
    volumeSpike: volumeSpike ? 1 : 0,
    volumeHigh: (volumeRatio || 1) > 2 ? 1 : 0,
    volumeLow: (volumeRatio || 1) < 0.5 ? 1 : 0,

    // ATR/Volatility features
    atrPercent: currentPrice && atr ? normalize(atr / currentPrice * 100, 0, 10) : 0.5,
    highVolatility: currentPrice && atr ? ((atr / currentPrice * 100) > 3 ? 1 : 0) : 0,
    lowVolatility: currentPrice && atr ? ((atr / currentPrice * 100) < 1 ? 1 : 0) : 0,

    // Support/Resistance features
    nearSupport: currentPrice && support ?
      ((currentPrice - support) / currentPrice < 0.02 ? 1 : 0) : 0,
    nearResistance: currentPrice && resistance ?
      ((resistance - currentPrice) / currentPrice < 0.02 ? 1 : 0) : 0,
    pricePosition: currentPrice && support && resistance && resistance > support ?
      (currentPrice - support) / (resistance - support) : 0.5,

    // Breakout features
    breakoutUp: breakout?.direction === 'up' ? 1 : 0,
    breakoutDown: breakout?.direction === 'down' ? 1 : 0,

    // Pattern features
    hasBullishPattern: patterns?.some(p =>
      ['BULLISH_ENGULFING', 'HAMMER', 'MORNING_STAR'].includes(p)) ? 1 : 0,
    hasBearishPattern: patterns?.some(p =>
      ['BEARISH_ENGULFING', 'SHOOTING_STAR', 'EVENING_STAR'].includes(p)) ? 1 : 0,
    hasDoji: patterns?.includes('DOJI') ? 1 : 0,

    // Sniper signal features
    sniperScore: normalize(sniperSignals?.score?.score || 0, 0, 100),
    hasDivergence: sniperSignals?.divergence?.type ? 1 : 0,
    divergenceBullish: sniperSignals?.divergence?.type === 'bullish' ? 1 : 0,
    divergenceBearish: sniperSignals?.divergence?.type === 'bearish' ? 1 : 0,
    hasVolumeAccumulation: sniperSignals?.volumeAccumulation?.detected ? 1 : 0,
    accumulationBullish: sniperSignals?.volumeAccumulation?.direction === 'bullish' ? 1 : 0,
    hasEarlyBreakout: sniperSignals?.earlyBreakout?.type ? 1 : 0,
    hasMomentumBuilding: sniperSignals?.momentumBuilding?.detected ? 1 : 0,
    inSqueeze: sniperSignals?.squeeze?.inSqueeze ? 1 : 0,
    hasVolumeSurge: sniperSignals?.volumeSurge?.detected ? 1 : 0,
    volumeSurgeIntensity: normalize(sniperSignals?.volumeSurge?.intensity || 0, 0, 10),
    isExplosive: sniperSignals?.volumeSurge?.isExplosive ? 1 : 0
  };

  // Add interaction features
  features.rsiMacdConfluence = features.rsi * features.macdBullish;
  features.trendVolumeConfluence = features.trendUp * features.volumeSpike;
  features.bbRsiConfluence = features.bbLowerTouch * features.rsiOversold;
  features.sniperTrendConfluence = features.sniperScore * features.trendStrength;

  return features;
}

/**
 * ML Prediction using weighted feature scoring
 * @param {Object} indicators - Technical indicators
 * @returns {Object} ML prediction with confidence
 */
function generateMLSignal(indicators) {
  const features = extractFeatures(indicators);
  if (!features) {
    return {
      signal: 'HOLD',
      confidence: 0.5,
      mlScore: 0,
      features: null
    };
  }

  // Calculate weighted score
  let bullScore = 0;
  let bearScore = 0;

  for (const [featureName, featureValue] of Object.entries(features)) {
    const weight = model.weights[featureName] || getDefaultWeight(featureName);

    if (weight > 0) {
      bullScore += featureValue * weight;
    } else {
      bearScore += featureValue * Math.abs(weight);
    }
  }

  // Normalize scores
  const totalWeight = Object.values(model.weights).reduce((a, b) => a + Math.abs(b), 0) || 100;
  bullScore = bullScore / totalWeight * 100;
  bearScore = bearScore / totalWeight * 100;

  // Calculate signal
  const scoreDiff = bullScore - bearScore;
  let signal = 'HOLD';
  let confidence = 0.5;
  let direction = 'neutral';

  if (scoreDiff > 15) {
    signal = scoreDiff > 30 ? 'STRONG_LONG' : 'LONG';
    direction = 'long';
    confidence = 0.5 + Math.min(scoreDiff / 100, 0.45);
  } else if (scoreDiff < -15) {
    signal = scoreDiff < -30 ? 'STRONG_SHORT' : 'SHORT';
    direction = 'short';
    confidence = 0.5 + Math.min(Math.abs(scoreDiff) / 100, 0.45);
  }

  // Sniper signal boost
  if (features.sniperScore > 0.5) {
    confidence = Math.min(confidence + 0.05, 0.95);
    if (signal === 'LONG' || signal === 'STRONG_LONG') {
      signal = 'ML_SNIPER_LONG';
    } else if (signal === 'SHORT' || signal === 'STRONG_SHORT') {
      signal = 'ML_SNIPER_SHORT';
    }
  }

  return {
    signal,
    direction,
    confidence: round(confidence, 2),
    mlScore: round(scoreDiff, 2),
    bullScore: round(bullScore, 2),
    bearScore: round(bearScore, 2),
    topFeatures: getTopFeatures(features, model.weights),
    features,
    modelVersion: model.version
  };
}

/**
 * Add training sample for model improvement
 * @param {Object} indicators - Technical indicators at entry
 * @param {string} direction - 'long' or 'short'
 * @param {number} outcome - Actual PnL or 1 for win, -1 for loss
 */
function addTrainingSample(indicators, direction, outcome) {
  const features = extractFeatures(indicators);
  if (!features) return;

  const sample = {
    features,
    direction,
    outcome, // 1 for win, -1 for loss, or actual PnL
    timestamp: Date.now()
  };

  trainingData.push(sample);

  // Auto-retrain periodically
  if (trainingData.length % 100 === 0) {
    trainModel();
  }

  // Save periodically
  if (trainingData.length % 50 === 0) {
    saveModel();
  }
}

/**
 * Train model using gradient descent on historical data
 */
function trainModel() {
  if (trainingData.length < 50) {
    console.log('[ML] Not enough training data');
    return;
  }

  console.log(`[ML] Training on ${trainingData.length} samples...`);

  // Initialize weights if empty
  if (Object.keys(model.weights).length === 0) {
    initializeWeights();
  }

  const learningRate = 0.01;
  const epochs = 100;
  const batchSize = 32;

  // Separate long and short samples
  const longSamples = trainingData.filter(s => s.direction === 'long');
  const shortSamples = trainingData.filter(s => s.direction === 'short');

  // Train on batches
  for (let epoch = 0; epoch < epochs; epoch++) {
    let epochLoss = 0;

    // Shuffle data
    const shuffled = [...trainingData].sort(() => Math.random() - 0.5);

    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      const gradients = {};

      for (const sample of batch) {
        // Predict
        const prediction = predictFromFeatures(sample.features);
        const target = sample.outcome > 0 ? 1 : 0;
        const error = target - prediction;
        epochLoss += error * error;

        // Calculate gradients
        for (const [feature, value] of Object.entries(sample.features)) {
          if (!gradients[feature]) gradients[feature] = 0;
          gradients[feature] += error * value * (sample.direction === 'long' ? 1 : -1);
        }
      }

      // Update weights
      for (const [feature, gradient] of Object.entries(gradients)) {
        if (!model.weights[feature]) model.weights[feature] = 0;
        model.weights[feature] += learningRate * gradient / batch.length;

        // L2 regularization
        model.weights[feature] *= 0.999;
      }
    }

    // Early stopping if converged
    if (epoch > 10 && epochLoss / trainingData.length < 0.01) {
      break;
    }
  }

  // Update performance metrics
  evaluateModel();

  model.lastTraining = Date.now();
  model.version++;

  console.log(`[ML] Training complete. Model v${model.version}, Accuracy: ${model.performance.accuracy}%`);
  saveModel();
}

/**
 * Predict probability from features using current weights
 */
function predictFromFeatures(features) {
  let score = 0;
  for (const [feature, value] of Object.entries(features)) {
    score += value * (model.weights[feature] || 0);
  }
  // Sigmoid activation
  return 1 / (1 + Math.exp(-score / 10));
}

/**
 * Evaluate model on training data
 */
function evaluateModel() {
  if (trainingData.length === 0) return;

  let correct = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const sample of trainingData) {
    const prediction = predictFromFeatures(sample.features);
    const predictedWin = prediction > 0.5;
    const actualWin = sample.outcome > 0;

    if (predictedWin === actualWin) correct++;
    if (predictedWin && actualWin) truePositives++;
    if (predictedWin && !actualWin) falsePositives++;
    if (!predictedWin && actualWin) falseNegatives++;
  }

  const precision = truePositives / (truePositives + falsePositives) || 0;
  const recall = truePositives / (truePositives + falseNegatives) || 0;

  model.performance = {
    accuracy: round((correct / trainingData.length) * 100, 1),
    precision: round(precision * 100, 1),
    recall: round(recall * 100, 1),
    f1Score: round((2 * precision * recall / (precision + recall)) * 100, 1) || 0,
    totalPredictions: trainingData.length,
    correctPredictions: correct
  };
}

/**
 * Initialize weights with reasonable defaults
 */
function initializeWeights() {
  model.weights = {
    // RSI features
    rsi: -0.5,
    rsiOversold: 2.0,
    rsiOverbought: -2.0,
    rsiNeutral: 0,
    rsiMomentum: 1.0,

    // MACD features
    macdHistogram: 1.5,
    macdSignalDiff: 1.0,
    macdBullish: 1.5,
    macdCrossover: 2.0,

    // Bollinger features
    bbPosition: -0.5,
    bbWidth: 0.5,
    bbLowerTouch: 2.0,
    bbUpperTouch: -2.0,

    // KDJ features
    kdjK: 0,
    kdjD: 0,
    kdjJ: 0.5,
    kdjOversold: 1.5,
    kdjOverbought: -1.5,

    // Trend features
    trendStrength: 2.0,
    trendUp: 2.5,
    trendDown: -2.5,
    trendScore: 1.0,

    // EMA features
    priceAboveEma20: 1.0,
    priceAboveEma50: 1.5,
    priceAboveEma200: 2.0,
    emaAlignment: 2.0,

    // Volume features
    volumeRatio: 1.0,
    volumeSpike: 1.5,
    volumeHigh: 1.0,
    volumeLow: -0.5,

    // Volatility features
    atrPercent: 0.5,
    highVolatility: 0.5,
    lowVolatility: -0.5,

    // Support/Resistance features
    nearSupport: 1.5,
    nearResistance: -1.5,
    pricePosition: -0.5,

    // Breakout features
    breakoutUp: 2.5,
    breakoutDown: -2.5,

    // Pattern features
    hasBullishPattern: 2.0,
    hasBearishPattern: -2.0,
    hasDoji: -0.5,

    // Sniper features
    sniperScore: 2.5,
    hasDivergence: 1.5,
    divergenceBullish: 2.0,
    divergenceBearish: -2.0,
    hasVolumeAccumulation: 1.5,
    accumulationBullish: 1.0,
    hasEarlyBreakout: 1.5,
    hasMomentumBuilding: 1.5,
    inSqueeze: 1.0,
    hasVolumeSurge: 2.0,
    volumeSurgeIntensity: 1.5,
    isExplosive: 2.5,

    // Interaction features
    rsiMacdConfluence: 1.5,
    trendVolumeConfluence: 2.0,
    bbRsiConfluence: 2.0,
    sniperTrendConfluence: 2.0
  };
}

/**
 * Get default weight for a feature
 */
function getDefaultWeight(featureName) {
  const defaults = {
    bullish: 1.5,
    bearish: -1.5,
    oversold: 1.5,
    overbought: -1.5,
    up: 1.0,
    down: -1.0
  };

  for (const [keyword, weight] of Object.entries(defaults)) {
    if (featureName.toLowerCase().includes(keyword)) {
      return weight;
    }
  }

  return 0;
}

/**
 * Get top contributing features for a prediction
 */
function getTopFeatures(features, weights) {
  const contributions = [];

  for (const [feature, value] of Object.entries(features)) {
    const weight = weights[feature] || 0;
    const contribution = value * weight;
    if (Math.abs(contribution) > 0.1) {
      contributions.push({
        feature,
        value: round(value, 2),
        weight: round(weight, 2),
        contribution: round(contribution, 2)
      });
    }
  }

  contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return contributions.slice(0, 5);
}

// Helper functions
function normalize(value, min, max) {
  if (value === undefined || value === null) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function round(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function encodeTrendStrength(direction) {
  const encoding = {
    'STRONG_UP': 1,
    'UP': 0.5,
    'NEUTRAL': 0,
    'DOWN': -0.5,
    'STRONG_DOWN': -1
  };
  return encoding[direction] || 0;
}

function detectMACDCrossover(macd) {
  if (!macd) return 0;
  const { MACD: line, signal } = macd;
  if (line > signal && line > 0) return 1; // Bullish crossover
  if (line < signal && line < 0) return -1; // Bearish crossover
  return 0;
}

function calculateEMAAlignment(ema, currentPrice) {
  if (!ema || !currentPrice) return 0.5;

  const { ema20, ema50, ema200 } = ema;
  let score = 0;

  // Perfect bullish alignment: price > ema20 > ema50 > ema200
  if (currentPrice > ema20) score += 0.25;
  if (ema20 > ema50) score += 0.25;
  if (ema50 > ema200) score += 0.25;
  if (currentPrice > ema200) score += 0.25;

  return score;
}

/**
 * Get model statistics
 */
function getModelStats() {
  return {
    version: model.version,
    performance: model.performance,
    lastTraining: model.lastTraining ? new Date(model.lastTraining).toISOString() : null,
    totalFeatures: Object.keys(model.weights).length,
    trainingDataSize: trainingData.length,
    topWeights: Object.entries(model.weights)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 10)
      .map(([feature, weight]) => ({ feature, weight: round(weight, 3) }))
  };
}

/**
 * Feature importance analysis
 */
function getFeatureImportance() {
  const importance = {};

  for (const [feature, weight] of Object.entries(model.weights)) {
    importance[feature] = {
      weight: round(weight, 3),
      absWeight: round(Math.abs(weight), 3),
      direction: weight > 0 ? 'bullish' : weight < 0 ? 'bearish' : 'neutral'
    };
  }

  return Object.entries(importance)
    .sort((a, b) => b[1].absWeight - a[1].absWeight)
    .slice(0, 20)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

// Initialize on load
loadModel();

module.exports = {
  extractFeatures,
  generateMLSignal,
  addTrainingSample,
  trainModel,
  getModelStats,
  getFeatureImportance,
  saveModel,
  loadModel
};
