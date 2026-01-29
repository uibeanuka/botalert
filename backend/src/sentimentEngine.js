/**
 * Sentiment Analysis Engine
 * Aggregates news, social media, and market sentiment for trading decisions
 *
 * Data Sources:
 * - CryptoPanic API (news)
 * - Alternative.me Fear & Greed Index
 * - LunarCrush (social metrics) - optional
 * - Twitter/X sentiment analysis
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Environment configuration (Railway auto-picks these)
const CRYPTOPANIC_API_KEY = process.env.CRYPTOPANIC_API_KEY || '';
const LUNARCRUSH_API_KEY = process.env.LUNARCRUSH_API_KEY || '';
const NEWS_POLL_INTERVAL = Number(process.env.NEWS_POLL_INTERVAL || 300000); // 5 minutes

const SENTIMENT_CACHE_FILE = path.join(__dirname, '../data/sentiment_cache.json');

// Sentiment state
let sentimentState = {
  fearGreedIndex: { value: 50, classification: 'Neutral', timestamp: 0 },
  newsItems: [],
  socialSentiment: {},
  overallSentiment: 'neutral',
  lastUpdate: 0
};

// Cache for API responses
const cache = {
  fearGreed: { data: null, expiry: 0 },
  news: { data: null, expiry: 0 },
  social: {}
};

/**
 * Fetch Fear & Greed Index from Alternative.me
 * Free API, no key required
 */
async function fetchFearGreedIndex() {
  try {
    // Check cache (valid for 1 hour)
    if (cache.fearGreed.data && Date.now() < cache.fearGreed.expiry) {
      return cache.fearGreed.data;
    }

    const response = await axios.get('https://api.alternative.me/fng/?limit=7', {
      timeout: 10000
    });

    if (response.data?.data?.length > 0) {
      const current = response.data.data[0];
      const history = response.data.data;

      const result = {
        value: parseInt(current.value),
        classification: current.value_classification,
        timestamp: parseInt(current.timestamp) * 1000,
        trend: calculateFearGreedTrend(history),
        history: history.map(h => ({
          value: parseInt(h.value),
          classification: h.value_classification,
          date: new Date(parseInt(h.timestamp) * 1000).toISOString().split('T')[0]
        }))
      };

      // Cache for 1 hour
      cache.fearGreed = { data: result, expiry: Date.now() + 3600000 };
      sentimentState.fearGreedIndex = result;

      return result;
    }
  } catch (err) {
    console.error('[SENTIMENT] Fear & Greed fetch failed:', err.message);
  }

  return sentimentState.fearGreedIndex;
}

/**
 * Calculate Fear & Greed trend from history
 */
function calculateFearGreedTrend(history) {
  if (history.length < 2) return 'stable';

  const current = parseInt(history[0].value);
  const previous = parseInt(history[1].value);
  const weekAgo = history.length >= 7 ? parseInt(history[6].value) : previous;

  const shortTermChange = current - previous;
  const longTermChange = current - weekAgo;

  if (shortTermChange > 10 && longTermChange > 15) return 'strongly_improving';
  if (shortTermChange > 5) return 'improving';
  if (shortTermChange < -10 && longTermChange < -15) return 'strongly_declining';
  if (shortTermChange < -5) return 'declining';
  return 'stable';
}

/**
 * Fetch crypto news from CryptoPanic
 */
async function fetchCryptoNews(symbol = null) {
  try {
    // Check cache (valid for 5 minutes)
    const cacheKey = symbol || 'all';
    if (cache.news[cacheKey] && Date.now() < cache.news[cacheKey].expiry) {
      return cache.news[cacheKey].data;
    }

    let url = 'https://cryptopanic.com/api/v1/posts/';

    // Build query params
    const params = new URLSearchParams({
      auth_token: CRYPTOPANIC_API_KEY || 'free',
      public: 'true',
      kind: 'news',
      filter: 'important'
    });

    if (symbol) {
      // Extract base currency (e.g., BTC from BTCUSDT)
      const currency = symbol.replace(/USDT|BUSD|USD|USDC/i, '');
      params.append('currencies', currency);
    }

    const response = await axios.get(`${url}?${params.toString()}`, {
      timeout: 10000
    });

    if (response.data?.results) {
      const newsItems = response.data.results.slice(0, 20).map(item => ({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source?.title || 'Unknown',
        publishedAt: item.published_at,
        currencies: item.currencies?.map(c => c.code) || [],
        sentiment: analyzeNewsSentiment(item),
        votes: {
          positive: item.votes?.positive || 0,
          negative: item.votes?.negative || 0,
          important: item.votes?.important || 0
        }
      }));

      // Calculate overall news sentiment
      const sentimentScore = calculateNewsSentimentScore(newsItems);

      const result = {
        items: newsItems,
        count: newsItems.length,
        sentimentScore,
        sentiment: sentimentScore > 0.2 ? 'bullish' : sentimentScore < -0.2 ? 'bearish' : 'neutral',
        lastUpdate: Date.now()
      };

      // Cache for 5 minutes
      cache.news[cacheKey] = { data: result, expiry: Date.now() + 300000 };
      sentimentState.newsItems = newsItems;

      return result;
    }
  } catch (err) {
    // CryptoPanic might not be available or key missing
    console.warn('[SENTIMENT] News fetch failed (API key may be missing):', err.message);
  }

  return { items: [], count: 0, sentimentScore: 0, sentiment: 'neutral', lastUpdate: Date.now() };
}

/**
 * Analyze sentiment from news title and metadata
 */
function analyzeNewsSentiment(newsItem) {
  const title = (newsItem.title || '').toLowerCase();

  // Bullish keywords
  const bullishWords = [
    'surge', 'soar', 'rally', 'bullish', 'breakout', 'ath', 'all-time high',
    'adoption', 'partnership', 'launch', 'upgrade', 'approved', 'institutional',
    'buy', 'accumulate', 'moon', 'pump', 'green', 'recovery', 'growth'
  ];

  // Bearish keywords
  const bearishWords = [
    'crash', 'plunge', 'dump', 'bearish', 'breakdown', 'hack', 'exploit',
    'ban', 'regulation', 'lawsuit', 'sec', 'fraud', 'scam', 'liquidation',
    'sell', 'fear', 'panic', 'red', 'decline', 'drop', 'fall', 'warning'
  ];

  let score = 0;

  for (const word of bullishWords) {
    if (title.includes(word)) score += 1;
  }

  for (const word of bearishWords) {
    if (title.includes(word)) score -= 1;
  }

  // Factor in community votes
  const votes = newsItem.votes || {};
  score += (votes.positive || 0) * 0.1;
  score -= (votes.negative || 0) * 0.1;

  if (score > 1) return 'bullish';
  if (score < -1) return 'bearish';
  return 'neutral';
}

/**
 * Calculate aggregate news sentiment score (-1 to 1)
 */
function calculateNewsSentimentScore(newsItems) {
  if (newsItems.length === 0) return 0;

  let totalScore = 0;

  for (const item of newsItems) {
    if (item.sentiment === 'bullish') totalScore += 1;
    else if (item.sentiment === 'bearish') totalScore -= 1;
  }

  return totalScore / newsItems.length;
}

/**
 * Fetch social metrics from LunarCrush (if API key provided)
 */
async function fetchSocialMetrics(symbol) {
  if (!LUNARCRUSH_API_KEY) {
    return { available: false, reason: 'LUNARCRUSH_API_KEY not configured' };
  }

  try {
    const currency = symbol.replace(/USDT|BUSD|USD|USDC/i, '');

    // Check cache (valid for 10 minutes)
    if (cache.social[currency] && Date.now() < cache.social[currency].expiry) {
      return cache.social[currency].data;
    }

    const response = await axios.get('https://lunarcrush.com/api3/coins', {
      params: {
        key: LUNARCRUSH_API_KEY,
        symbol: currency,
        data_points: 1
      },
      timeout: 10000
    });

    if (response.data?.data?.[0]) {
      const coin = response.data.data[0];

      const result = {
        available: true,
        symbol: currency,
        galaxyScore: coin.galaxy_score || 0, // 0-100 overall score
        altRank: coin.alt_rank || 0,
        socialVolume: coin.social_volume || 0,
        socialScore: coin.social_score || 0,
        socialDominance: coin.social_dominance || 0,
        marketDominance: coin.market_dominance || 0,
        sentiment: coin.average_sentiment || 0, // 1-5 scale
        sentimentNormalized: ((coin.average_sentiment || 3) - 3) / 2, // -1 to 1
        twitterVolume: coin.tweet_volume_24h || 0,
        newsVolume: coin.news_24h || 0,
        trend: coin.social_volume_change_24h > 20 ? 'viral' :
               coin.social_volume_change_24h > 0 ? 'increasing' :
               coin.social_volume_change_24h < -20 ? 'declining' : 'stable',
        lastUpdate: Date.now()
      };

      // Cache for 10 minutes
      cache.social[currency] = { data: result, expiry: Date.now() + 600000 };
      sentimentState.socialSentiment[currency] = result;

      return result;
    }
  } catch (err) {
    console.warn('[SENTIMENT] LunarCrush fetch failed:', err.message);
  }

  return { available: false, reason: 'API request failed' };
}

/**
 * Get combined sentiment analysis for a symbol
 */
async function getSymbolSentiment(symbol) {
  const [fearGreed, news, social] = await Promise.all([
    fetchFearGreedIndex(),
    fetchCryptoNews(symbol),
    fetchSocialMetrics(symbol)
  ]);

  // Calculate combined sentiment score
  let sentimentScore = 0;
  let factors = 0;

  // Fear & Greed contribution (0-100 normalized to -1 to 1)
  const fgNormalized = (fearGreed.value - 50) / 50;
  sentimentScore += fgNormalized * 0.3;
  factors++;

  // News contribution
  if (news.count > 0) {
    sentimentScore += news.sentimentScore * 0.35;
    factors++;
  }

  // Social contribution
  if (social.available) {
    sentimentScore += social.sentimentNormalized * 0.35;
    factors++;
  }

  // Normalize
  const combinedScore = factors > 0 ? sentimentScore / factors * (factors / 3) : 0;

  // Determine sentiment classification
  let classification = 'neutral';
  if (combinedScore > 0.3) classification = 'bullish';
  else if (combinedScore > 0.15) classification = 'slightly_bullish';
  else if (combinedScore < -0.3) classification = 'bearish';
  else if (combinedScore < -0.15) classification = 'slightly_bearish';

  // Generate trading signal adjustment
  const signalAdjustment = calculateSignalAdjustment(combinedScore, fearGreed, news);

  return {
    symbol,
    timestamp: Date.now(),

    combined: {
      score: round(combinedScore, 3),
      classification,
      signalAdjustment
    },

    fearGreed: {
      value: fearGreed.value,
      classification: fearGreed.classification,
      trend: fearGreed.trend,
      signal: getFearGreedSignal(fearGreed.value)
    },

    news: {
      count: news.count,
      sentiment: news.sentiment,
      score: round(news.sentimentScore, 3),
      topHeadlines: news.items.slice(0, 3).map(n => ({
        title: n.title,
        sentiment: n.sentiment,
        source: n.source
      }))
    },

    social: social.available ? {
      galaxyScore: social.galaxyScore,
      sentiment: social.sentiment,
      trend: social.trend,
      volume: social.socialVolume
    } : { available: false },

    recommendations: generateSentimentRecommendations(combinedScore, fearGreed, news, social)
  };
}

/**
 * Get Fear & Greed trading signal
 */
function getFearGreedSignal(value) {
  if (value <= 20) return { action: 'STRONG_BUY', reason: 'Extreme fear - potential bottom' };
  if (value <= 35) return { action: 'BUY', reason: 'Fear - accumulation zone' };
  if (value >= 80) return { action: 'STRONG_SELL', reason: 'Extreme greed - potential top' };
  if (value >= 65) return { action: 'SELL', reason: 'Greed - consider taking profits' };
  return { action: 'HOLD', reason: 'Neutral sentiment' };
}

/**
 * Calculate signal adjustment based on sentiment
 */
function calculateSignalAdjustment(combinedScore, fearGreed, news) {
  let adjustment = {
    confidenceModifier: 0,
    biasDirection: 'none',
    reasoning: []
  };

  // Fear & Greed extreme readings
  if (fearGreed.value <= 25) {
    adjustment.confidenceModifier += 0.05;
    adjustment.biasDirection = 'long';
    adjustment.reasoning.push('Extreme fear suggests buying opportunity');
  } else if (fearGreed.value >= 75) {
    adjustment.confidenceModifier += 0.05;
    adjustment.biasDirection = 'short';
    adjustment.reasoning.push('Extreme greed suggests caution');
  }

  // Strong news sentiment
  if (Math.abs(news.sentimentScore) > 0.5) {
    adjustment.confidenceModifier += 0.03;
    adjustment.biasDirection = news.sentimentScore > 0 ? 'long' : 'short';
    adjustment.reasoning.push(`Strong ${news.sentiment} news sentiment`);
  }

  // Combined score extremes
  if (combinedScore > 0.4) {
    adjustment.confidenceModifier += 0.02;
    adjustment.reasoning.push('Overall bullish sentiment alignment');
  } else if (combinedScore < -0.4) {
    adjustment.confidenceModifier += 0.02;
    adjustment.reasoning.push('Overall bearish sentiment alignment');
  }

  return adjustment;
}

/**
 * Generate sentiment-based recommendations
 */
function generateSentimentRecommendations(combinedScore, fearGreed, news, social) {
  const recommendations = [];

  // Fear & Greed recommendations
  if (fearGreed.value <= 20) {
    recommendations.push({
      type: 'CONTRARIAN',
      priority: 'high',
      message: 'Extreme fear zone - historically good buying opportunity',
      action: 'Consider accumulating'
    });
  } else if (fearGreed.value >= 80) {
    recommendations.push({
      type: 'WARNING',
      priority: 'high',
      message: 'Extreme greed zone - market may be overextended',
      action: 'Consider taking profits'
    });
  }

  // Trend change detection
  if (fearGreed.trend === 'strongly_improving') {
    recommendations.push({
      type: 'TREND',
      priority: 'medium',
      message: 'Sentiment rapidly improving',
      action: 'Momentum may continue'
    });
  } else if (fearGreed.trend === 'strongly_declining') {
    recommendations.push({
      type: 'TREND',
      priority: 'medium',
      message: 'Sentiment rapidly declining',
      action: 'Consider reducing exposure'
    });
  }

  // News-based recommendations
  if (news.count > 0) {
    const bullishNews = news.items.filter(n => n.sentiment === 'bullish').length;
    const bearishNews = news.items.filter(n => n.sentiment === 'bearish').length;

    if (bullishNews > bearishNews * 2) {
      recommendations.push({
        type: 'NEWS',
        priority: 'medium',
        message: `Strong bullish news flow (${bullishNews} positive vs ${bearishNews} negative)`,
        action: 'News supports long bias'
      });
    } else if (bearishNews > bullishNews * 2) {
      recommendations.push({
        type: 'NEWS',
        priority: 'medium',
        message: `Strong bearish news flow (${bearishNews} negative vs ${bullishNews} positive)`,
        action: 'News supports caution'
      });
    }
  }

  // Social trending
  if (social.available && social.trend === 'viral') {
    recommendations.push({
      type: 'SOCIAL',
      priority: 'high',
      message: 'Asset going viral on social media',
      action: 'High volatility expected - trade with caution'
    });
  }

  return recommendations;
}

/**
 * Get overall market sentiment summary
 */
async function getMarketSentiment() {
  const fearGreed = await fetchFearGreedIndex();
  const news = await fetchCryptoNews();

  // Market-wide sentiment
  const btcSentiment = await getSymbolSentiment('BTCUSDT');
  const ethSentiment = await getSymbolSentiment('ETHUSDT');

  return {
    timestamp: Date.now(),

    market: {
      fearGreed: {
        value: fearGreed.value,
        classification: fearGreed.classification,
        trend: fearGreed.trend
      },
      newsFlow: news.sentiment,
      overallBias: fearGreed.value < 40 ? 'bullish' : fearGreed.value > 60 ? 'bearish' : 'neutral'
    },

    majors: {
      btc: {
        sentiment: btcSentiment.combined.classification,
        score: btcSentiment.combined.score
      },
      eth: {
        sentiment: ethSentiment.combined.classification,
        score: ethSentiment.combined.score
      }
    },

    topNews: news.items.slice(0, 5).map(n => ({
      title: n.title,
      sentiment: n.sentiment,
      source: n.source
    })),

    tradingConditions: assessTradingConditions(fearGreed, news)
  };
}

/**
 * Assess overall trading conditions
 */
function assessTradingConditions(fearGreed, news) {
  let conditions = 'normal';
  let warnings = [];

  if (fearGreed.value <= 15 || fearGreed.value >= 85) {
    conditions = 'extreme';
    warnings.push('Extreme sentiment - expect high volatility');
  }

  if (fearGreed.trend === 'strongly_declining' || fearGreed.trend === 'strongly_improving') {
    warnings.push('Rapid sentiment change - trend may reverse');
  }

  const bearishNewsRatio = news.items.filter(n => n.sentiment === 'bearish').length / Math.max(news.count, 1);
  if (bearishNewsRatio > 0.7) {
    conditions = 'bearish';
    warnings.push('Heavy bearish news flow');
  }

  return {
    conditions,
    warnings,
    recommendation: conditions === 'extreme'
      ? 'Use smaller position sizes'
      : conditions === 'bearish'
      ? 'Consider defensive positioning'
      : 'Normal trading conditions'
  };
}

/**
 * Load cached sentiment data
 */
function loadSentimentCache() {
  try {
    if (fs.existsSync(SENTIMENT_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENTIMENT_CACHE_FILE, 'utf-8'));
      sentimentState = { ...sentimentState, ...data };
      console.log('[SENTIMENT] Loaded cached sentiment data');
    }
  } catch (err) {
    console.warn('[SENTIMENT] Could not load cache:', err.message);
  }
}

/**
 * Save sentiment cache
 */
function saveSentimentCache() {
  try {
    const dir = path.dirname(SENTIMENT_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SENTIMENT_CACHE_FILE, JSON.stringify(sentimentState, null, 2));
  } catch (err) {
    console.warn('[SENTIMENT] Could not save cache:', err.message);
  }
}

function round(value, decimals = 2) {
  if (value === undefined || value === null || isNaN(value)) return 0;
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Initialize on load
loadSentimentCache();

// Auto-save cache periodically
setInterval(saveSentimentCache, 300000); // Every 5 minutes

module.exports = {
  fetchFearGreedIndex,
  fetchCryptoNews,
  fetchSocialMetrics,
  getSymbolSentiment,
  getMarketSentiment,
  getFearGreedSignal,
  calculateSignalAdjustment
};
