/**
 * Economic Calendar - Tracks major macro events affecting crypto
 *
 * High-impact events that move markets:
 * - Federal Reserve rate decisions (FOMC)
 * - CPI/Inflation reports
 * - Employment data (NFP)
 * - GDP reports
 * - ECB/other central bank decisions
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CALENDAR_CACHE_FILE = path.join(__dirname, '../data/economic_calendar.json');

// Pre-defined 2024-2025 high-impact events (updated periodically)
// These are the scheduled dates - actual times vary
const SCHEDULED_EVENTS = [
  // 2025 FOMC Meetings (Fed rate decisions) - usually 2pm ET
  { date: '2025-01-29', type: 'FOMC', name: 'FOMC Rate Decision', impact: 'HIGH' },
  { date: '2025-03-19', type: 'FOMC', name: 'FOMC Rate Decision + Projections', impact: 'HIGH' },
  { date: '2025-05-07', type: 'FOMC', name: 'FOMC Rate Decision', impact: 'HIGH' },
  { date: '2025-06-18', type: 'FOMC', name: 'FOMC Rate Decision + Projections', impact: 'HIGH' },
  { date: '2025-07-30', type: 'FOMC', name: 'FOMC Rate Decision', impact: 'HIGH' },
  { date: '2025-09-17', type: 'FOMC', name: 'FOMC Rate Decision + Projections', impact: 'HIGH' },
  { date: '2025-11-05', type: 'FOMC', name: 'FOMC Rate Decision', impact: 'HIGH' },
  { date: '2025-12-17', type: 'FOMC', name: 'FOMC Rate Decision + Projections', impact: 'HIGH' },

  // 2025 CPI releases (usually 8:30am ET, mid-month)
  { date: '2025-01-15', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-02-12', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-03-12', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-04-10', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-05-13', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-06-11', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-07-10', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-08-13', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-09-11', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-10-10', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-11-13', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2025-12-11', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },

  // 2026 events (partial)
  { date: '2026-01-14', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2026-01-28', type: 'FOMC', name: 'FOMC Rate Decision', impact: 'HIGH' },
  { date: '2026-02-11', type: 'CPI', name: 'CPI Inflation Report', impact: 'HIGH' },
  { date: '2026-03-18', type: 'FOMC', name: 'FOMC Rate Decision + Projections', impact: 'HIGH' },

  // Non-Farm Payrolls (first Friday of each month, 8:30am ET)
  { date: '2025-02-07', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-03-07', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-04-04', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-05-02', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-06-06', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-07-03', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-08-01', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-09-05', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-10-03', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-11-07', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
  { date: '2025-12-05', type: 'NFP', name: 'Non-Farm Payrolls', impact: 'HIGH' },
];

// Track learned event impacts
let eventImpactLearning = {
  events: {},
  lastUpdate: 0
};

/**
 * Check if there's a high-impact event today or within window
 */
function checkUpcomingEvents(hoursAhead = 24) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  const today = now.toISOString().split('T')[0];
  const cutoffDate = cutoff.toISOString().split('T')[0];

  const upcoming = SCHEDULED_EVENTS.filter(event => {
    return event.date >= today && event.date <= cutoffDate;
  });

  const todayEvents = upcoming.filter(e => e.date === today);
  const soonEvents = upcoming.filter(e => e.date !== today);

  return {
    hasEventToday: todayEvents.length > 0,
    todayEvents,
    upcomingEvents: soonEvents,
    riskLevel: todayEvents.length > 0 ? 'HIGH' : soonEvents.length > 0 ? 'MEDIUM' : 'LOW',
    recommendation: todayEvents.length > 0
      ? 'Reduce position sizes, expect high volatility'
      : soonEvents.length > 0
      ? 'Event approaching - monitor closely'
      : 'No major events scheduled'
  };
}

/**
 * Get trading adjustment based on economic events
 */
function getEventTradingAdjustment() {
  const events = checkUpcomingEvents(8); // 8 hours ahead

  let positionSizeMultiplier = 1.0;
  let confidenceBoost = 0;
  const warnings = [];

  if (events.hasEventToday) {
    const eventTypes = events.todayEvents.map(e => e.type);

    if (eventTypes.includes('FOMC')) {
      positionSizeMultiplier = 0.3; // 70% reduction during FOMC
      warnings.push('FOMC today - extreme volatility expected');
    } else if (eventTypes.includes('CPI')) {
      positionSizeMultiplier = 0.5; // 50% reduction during CPI
      warnings.push('CPI release today - high volatility expected');
    } else if (eventTypes.includes('NFP')) {
      positionSizeMultiplier = 0.6; // 40% reduction during NFP
      warnings.push('NFP today - expect volatility spike');
    }
  }

  // Upcoming events (within 8 hours)
  if (events.upcomingEvents.length > 0) {
    const upcomingTypes = events.upcomingEvents.map(e => e.type);
    if (upcomingTypes.includes('FOMC') || upcomingTypes.includes('CPI')) {
      positionSizeMultiplier = Math.min(positionSizeMultiplier, 0.7);
      warnings.push(`${upcomingTypes[0]} event approaching - reduce exposure`);
    }
  }

  return {
    positionSizeMultiplier,
    confidenceBoost,
    warnings,
    events: events.todayEvents.concat(events.upcomingEvents)
  };
}

/**
 * Learn from event impact on price
 * Call this after an event to record how it affected the market
 */
function learnFromEvent(eventType, eventDate, priceChange, volatilityIncrease) {
  const key = `${eventType}-${eventDate}`;

  if (!eventImpactLearning.events[key]) {
    eventImpactLearning.events[key] = {
      type: eventType,
      date: eventDate,
      observations: []
    };
  }

  eventImpactLearning.events[key].observations.push({
    priceChange: priceChange,
    volatility: volatilityIncrease,
    timestamp: Date.now()
  });

  eventImpactLearning.lastUpdate = Date.now();
  saveCalendarCache();
}

/**
 * Get average impact of event type
 */
function getEventTypeImpact(eventType) {
  const events = Object.values(eventImpactLearning.events)
    .filter(e => e.type === eventType);

  if (events.length === 0) {
    // Default impacts based on historical data
    const defaults = {
      FOMC: { avgPriceMove: 3.5, avgVolatility: 2.5 },
      CPI: { avgPriceMove: 2.0, avgVolatility: 1.8 },
      NFP: { avgPriceMove: 1.5, avgVolatility: 1.5 },
      GDP: { avgPriceMove: 1.0, avgVolatility: 1.2 }
    };
    return defaults[eventType] || { avgPriceMove: 1.0, avgVolatility: 1.0 };
  }

  const allObs = events.flatMap(e => e.observations);
  const avgPriceMove = allObs.reduce((s, o) => s + Math.abs(o.priceChange), 0) / allObs.length;
  const avgVolatility = allObs.reduce((s, o) => s + o.volatility, 0) / allObs.length;

  return { avgPriceMove, avgVolatility };
}

/**
 * Load cached calendar data
 */
function loadCalendarCache() {
  try {
    if (fs.existsSync(CALENDAR_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CALENDAR_CACHE_FILE, 'utf-8'));
      eventImpactLearning = { ...eventImpactLearning, ...data };
      console.log('[CALENDAR] Loaded event learning data');
    }
  } catch (err) {
    console.warn('[CALENDAR] Could not load cache:', err.message);
  }
}

/**
 * Save calendar cache
 */
function saveCalendarCache() {
  try {
    const dir = path.dirname(CALENDAR_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CALENDAR_CACHE_FILE, JSON.stringify(eventImpactLearning, null, 2));
  } catch (err) {
    console.warn('[CALENDAR] Could not save cache:', err.message);
  }
}

/**
 * Get status for API
 */
function getCalendarStatus() {
  const upcoming = checkUpcomingEvents(48);
  const adjustment = getEventTradingAdjustment();

  return {
    now: new Date().toISOString(),
    today: new Date().toISOString().split('T')[0],
    riskLevel: upcoming.riskLevel,
    todayEvents: upcoming.todayEvents,
    next48Hours: upcoming.upcomingEvents,
    tradingAdjustment: adjustment,
    learnedEvents: Object.keys(eventImpactLearning.events).length,
    eventTypeImpacts: {
      FOMC: getEventTypeImpact('FOMC'),
      CPI: getEventTypeImpact('CPI'),
      NFP: getEventTypeImpact('NFP')
    }
  };
}

// Initialize
loadCalendarCache();

module.exports = {
  checkUpcomingEvents,
  getEventTradingAdjustment,
  learnFromEvent,
  getEventTypeImpact,
  getCalendarStatus,
  SCHEDULED_EVENTS
};
