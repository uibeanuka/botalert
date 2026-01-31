/**
 * News Impact Learning System
 *
 * Learns the relationship between news events and price movements:
 * - Tracks news at time of publication
 * - Monitors price changes 5min, 15min, 1h, 4h after news
 * - Builds keyword → impact correlation database
 * - Learns which sources are most reliable predictors
 */

const fs = require('fs');
const path = require('path');
const { fetchCryptoNews } = require('./sentimentEngine');

const NEWS_LEARNING_FILE = path.join(__dirname, '../data/news_learning.json');

// Learning state
let newsLearning = {
  // Track news events for impact measurement
  pendingNews: [], // News waiting for price impact measurement

  // Learned correlations
  keywords: {}, // keyword → { bullishHits, bearishHits, neutralHits, avgImpact }
  sources: {},  // source → { accuracy, avgImpact, count }
  patterns: {}, // pattern type → { winRate, avgMove }

  // Overall statistics
  stats: {
    totalNewsProcessed: 0,
    correctPredictions: 0,
    avgPriceImpact: 0,
    lastUpdate: 0
  }
};

// Keywords that typically move markets
const IMPACTFUL_KEYWORDS = {
  high_bullish: ['etf approved', 'institutional adoption', 'partnership', 'upgrade', 'halving', 'ath', 'all-time high', 'bullish'],
  high_bearish: ['hack', 'exploit', 'sec lawsuit', 'banned', 'regulation', 'crash', 'liquidation', 'fraud', 'scam'],
  medium_bullish: ['integration', 'launch', 'accumulation', 'whale buy', 'support'],
  medium_bearish: ['sell-off', 'dump', 'warning', 'delay', 'postpone', 'fud']
};

/**
 * Process new news item and queue for impact measurement
 */
function trackNewsEvent(newsItem, symbol, priceAtNews) {
  const entry = {
    id: newsItem.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: newsItem.title,
    source: newsItem.source,
    sentiment: newsItem.sentiment,
    keywords: extractKeywords(newsItem.title),
    symbol,
    priceAtNews,
    timestamp: Date.now(),
    // Will be filled in later
    priceAfter5min: null,
    priceAfter15min: null,
    priceAfter1h: null,
    priceAfter4h: null,
    actualImpact: null
  };

  newsLearning.pendingNews.push(entry);

  // Limit pending news to prevent memory bloat
  if (newsLearning.pendingNews.length > 500) {
    newsLearning.pendingNews = newsLearning.pendingNews.slice(-400);
  }

  console.log(`[NEWS LEARN] Tracking: "${newsItem.title.substring(0, 50)}..." for ${symbol}`);

  return entry.id;
}

/**
 * Extract relevant keywords from news title
 */
function extractKeywords(title) {
  const lower = title.toLowerCase();
  const found = [];

  for (const [category, keywords] of Object.entries(IMPACTFUL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        found.push({ keyword, category });
      }
    }
  }

  return found;
}

/**
 * Update price data for pending news items
 * Call this periodically with latest prices
 */
function updatePendingNewsPrices(symbol, currentPrice) {
  const now = Date.now();

  for (const news of newsLearning.pendingNews) {
    if (news.symbol !== symbol) continue;

    const elapsed = now - news.timestamp;

    // Update price checkpoints
    if (!news.priceAfter5min && elapsed >= 5 * 60 * 1000) {
      news.priceAfter5min = currentPrice;
    }
    if (!news.priceAfter15min && elapsed >= 15 * 60 * 1000) {
      news.priceAfter15min = currentPrice;
    }
    if (!news.priceAfter1h && elapsed >= 60 * 60 * 1000) {
      news.priceAfter1h = currentPrice;
    }
    if (!news.priceAfter4h && elapsed >= 4 * 60 * 60 * 1000) {
      news.priceAfter4h = currentPrice;

      // News item complete - calculate impact and learn
      learnFromCompletedNews(news);
    }
  }

  // Clean up completed news items (older than 4h + buffer)
  newsLearning.pendingNews = newsLearning.pendingNews.filter(n => {
    return now - n.timestamp < 5 * 60 * 60 * 1000; // 5 hours
  });
}

/**
 * Learn from a completed news tracking cycle
 */
function learnFromCompletedNews(news) {
  if (news.actualImpact !== null) return; // Already processed

  // Calculate actual price impact
  const impact5m = news.priceAfter5min ? ((news.priceAfter5min - news.priceAtNews) / news.priceAtNews) * 100 : 0;
  const impact15m = news.priceAfter15min ? ((news.priceAfter15min - news.priceAtNews) / news.priceAtNews) * 100 : 0;
  const impact1h = news.priceAfter1h ? ((news.priceAfter1h - news.priceAtNews) / news.priceAtNews) * 100 : 0;
  const impact4h = news.priceAfter4h ? ((news.priceAfter4h - news.priceAtNews) / news.priceAtNews) * 100 : 0;

  // Use the maximum absolute impact as the measure
  const impacts = [impact5m, impact15m, impact1h, impact4h];
  const maxImpact = impacts.reduce((max, i) => Math.abs(i) > Math.abs(max) ? i : max, 0);

  news.actualImpact = {
    at5min: impact5m,
    at15min: impact15m,
    at1h: impact1h,
    at4h: impact4h,
    max: maxImpact
  };

  // Determine if prediction was correct
  const predictedBullish = news.sentiment === 'bullish';
  const predictedBearish = news.sentiment === 'bearish';
  const actualBullish = maxImpact > 0.5;
  const actualBearish = maxImpact < -0.5;
  const wasCorrect = (predictedBullish && actualBullish) || (predictedBearish && actualBearish);

  // Update keyword learnings
  for (const { keyword, category } of news.keywords) {
    if (!newsLearning.keywords[keyword]) {
      newsLearning.keywords[keyword] = {
        bullishHits: 0,
        bearishHits: 0,
        neutralHits: 0,
        totalImpact: 0,
        count: 0
      };
    }

    const kw = newsLearning.keywords[keyword];
    kw.count++;
    kw.totalImpact += maxImpact;

    if (actualBullish) kw.bullishHits++;
    else if (actualBearish) kw.bearishHits++;
    else kw.neutralHits++;
  }

  // Update source learnings
  const source = news.source || 'unknown';
  if (!newsLearning.sources[source]) {
    newsLearning.sources[source] = {
      correct: 0,
      incorrect: 0,
      totalImpact: 0,
      count: 0
    };
  }

  const src = newsLearning.sources[source];
  src.count++;
  src.totalImpact += Math.abs(maxImpact);
  if (wasCorrect) src.correct++;
  else src.incorrect++;

  // Update overall stats
  newsLearning.stats.totalNewsProcessed++;
  if (wasCorrect) newsLearning.stats.correctPredictions++;
  newsLearning.stats.avgPriceImpact = (
    (newsLearning.stats.avgPriceImpact * (newsLearning.stats.totalNewsProcessed - 1) + Math.abs(maxImpact))
    / newsLearning.stats.totalNewsProcessed
  );
  newsLearning.stats.lastUpdate = Date.now();

  console.log(`[NEWS LEARN] Completed: "${news.title.substring(0, 40)}..." | Predicted: ${news.sentiment} | Actual: ${maxImpact.toFixed(2)}% | ${wasCorrect ? 'CORRECT' : 'WRONG'}`);

  saveNewsLearning();
}

/**
 * Get news-based trading signal adjustment
 */
function getNewsSignalAdjustment(symbol, newsItems) {
  if (!newsItems || newsItems.length === 0) {
    return { adjustment: 0, confidence: 0, reason: 'No news' };
  }

  let totalAdjustment = 0;
  let totalWeight = 0;
  const reasons = [];

  for (const news of newsItems.slice(0, 5)) { // Top 5 most recent
    let newsWeight = 1;
    let newsAdjustment = 0;

    // Source reliability
    const sourceData = newsLearning.sources[news.source];
    if (sourceData && sourceData.count >= 5) {
      const accuracy = sourceData.correct / sourceData.count;
      newsWeight *= accuracy; // Weight by source accuracy

      if (accuracy >= 0.7) {
        reasons.push(`Reliable source: ${news.source} (${(accuracy * 100).toFixed(0)}%)`);
      }
    }

    // Keyword impact
    const keywords = extractKeywords(news.title);
    for (const { keyword } of keywords) {
      const kwData = newsLearning.keywords[keyword];
      if (kwData && kwData.count >= 3) {
        const avgImpact = kwData.totalImpact / kwData.count;
        newsAdjustment += avgImpact * 0.01; // Scale to reasonable range

        if (Math.abs(avgImpact) >= 1) {
          reasons.push(`Impact keyword: "${keyword}" (avg ${avgImpact.toFixed(1)}%)`);
        }
      }
    }

    // Sentiment-based adjustment
    if (news.sentiment === 'bullish') {
      newsAdjustment += 0.02;
    } else if (news.sentiment === 'bearish') {
      newsAdjustment -= 0.02;
    }

    totalAdjustment += newsAdjustment * newsWeight;
    totalWeight += newsWeight;
  }

  const finalAdjustment = totalWeight > 0 ? totalAdjustment / totalWeight : 0;
  const confidence = Math.min(100, newsLearning.stats.totalNewsProcessed / 10);

  return {
    adjustment: Math.round(finalAdjustment * 100) / 100,
    confidence,
    reason: reasons.length > 0 ? reasons.join('; ') : 'Neutral news',
    stats: {
      newsAnalyzed: newsItems.length,
      totalLearned: newsLearning.stats.totalNewsProcessed,
      accuracy: newsLearning.stats.totalNewsProcessed > 0
        ? (newsLearning.stats.correctPredictions / newsLearning.stats.totalNewsProcessed * 100).toFixed(1) + '%'
        : 'N/A'
    }
  };
}

/**
 * Get top impactful keywords learned
 */
function getTopKeywords(limit = 10) {
  return Object.entries(newsLearning.keywords)
    .filter(([_, data]) => data.count >= 3)
    .map(([keyword, data]) => ({
      keyword,
      avgImpact: (data.totalImpact / data.count).toFixed(2),
      bullishRate: ((data.bullishHits / data.count) * 100).toFixed(0) + '%',
      bearishRate: ((data.bearishHits / data.count) * 100).toFixed(0) + '%',
      occurrences: data.count
    }))
    .sort((a, b) => Math.abs(b.avgImpact) - Math.abs(a.avgImpact))
    .slice(0, limit);
}

/**
 * Get source reliability rankings
 */
function getSourceRankings() {
  return Object.entries(newsLearning.sources)
    .filter(([_, data]) => data.count >= 5)
    .map(([source, data]) => ({
      source,
      accuracy: ((data.correct / data.count) * 100).toFixed(0) + '%',
      avgImpact: (data.totalImpact / data.count).toFixed(2),
      count: data.count
    }))
    .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy));
}

/**
 * Get learning status for API
 */
function getNewsLearningStatus() {
  return {
    stats: {
      ...newsLearning.stats,
      accuracy: newsLearning.stats.totalNewsProcessed > 0
        ? ((newsLearning.stats.correctPredictions / newsLearning.stats.totalNewsProcessed) * 100).toFixed(1) + '%'
        : 'N/A',
      pendingCount: newsLearning.pendingNews.length
    },
    topKeywords: getTopKeywords(10),
    sourceRankings: getSourceRankings(),
    recentNews: newsLearning.pendingNews.slice(-10).map(n => ({
      title: n.title.substring(0, 60),
      sentiment: n.sentiment,
      symbol: n.symbol,
      tracked: new Date(n.timestamp).toISOString(),
      hasImpact: n.actualImpact !== null
    }))
  };
}

/**
 * Save learning data
 */
function saveNewsLearning() {
  try {
    const dir = path.dirname(NEWS_LEARNING_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Don't save pending news (too large), just save learned patterns
    const toSave = {
      keywords: newsLearning.keywords,
      sources: newsLearning.sources,
      patterns: newsLearning.patterns,
      stats: newsLearning.stats
    };

    fs.writeFileSync(NEWS_LEARNING_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.warn('[NEWS LEARN] Could not save:', err.message);
  }
}

/**
 * Load learning data
 */
function loadNewsLearning() {
  try {
    if (fs.existsSync(NEWS_LEARNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(NEWS_LEARNING_FILE, 'utf-8'));
      newsLearning = {
        ...newsLearning,
        keywords: data.keywords || {},
        sources: data.sources || {},
        patterns: data.patterns || {},
        stats: data.stats || newsLearning.stats
      };
      console.log(`[NEWS LEARN] Loaded ${newsLearning.stats.totalNewsProcessed} learned news events`);
    }
  } catch (err) {
    console.warn('[NEWS LEARN] Could not load:', err.message);
  }
}

// Initialize
loadNewsLearning();

// Auto-save periodically
setInterval(saveNewsLearning, 300000); // Every 5 minutes

module.exports = {
  trackNewsEvent,
  updatePendingNewsPrices,
  getNewsSignalAdjustment,
  getNewsLearningStatus,
  getTopKeywords,
  getSourceRankings
};
