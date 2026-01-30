/**
 * Sniper Confirmation Wait System
 *
 * When main indicators say one direction but sniper disagrees,
 * instead of blocking forever, we wait for sniper to confirm.
 * Once confirmed, the trade is allowed with a bonus for patience.
 */

// Pending confirmations: symbol -> { direction, startTime, mainScore, sniperDir, attempts }
const pendingConfirmations = new Map();

// Configuration
const CONFIRMATION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours max wait
const MAX_CHECK_ATTEMPTS = 48; // At 5min intervals = 4 hours
const CONFIRMATION_BONUS = 0.05; // 5% confidence bonus when confirmed

/**
 * Check if a trade should wait for sniper confirmation
 * Returns: { shouldWait, shouldEnter, reason, bonus }
 */
function checkSniperConfirmation(symbol, mainDirection, mainScore, sniperDirection, sniperScore, sniperIsActive) {
  const now = Date.now();
  const key = `${symbol}-${mainDirection}`;

  // No conflict = no waiting needed
  if (!sniperIsActive || !sniperDirection) {
    // Clear any pending wait for this symbol/direction
    pendingConfirmations.delete(key);
    return { shouldWait: false, shouldEnter: true, reason: null, bonus: 0 };
  }

  // Sniper agrees with direction = enter immediately
  const sniperAgrees =
    (mainDirection === 'long' && sniperDirection === 'bullish') ||
    (mainDirection === 'short' && sniperDirection === 'bearish');

  if (sniperAgrees) {
    const pending = pendingConfirmations.get(key);
    pendingConfirmations.delete(key);

    if (pending) {
      // Was waiting, now confirmed - give bonus for patience
      const waitTime = now - pending.startTime;
      const waitMinutes = Math.round(waitTime / 60000);
      return {
        shouldWait: false,
        shouldEnter: true,
        reason: `SNIPER CONFIRMED after ${waitMinutes}min wait`,
        bonus: CONFIRMATION_BONUS
      };
    }

    // No prior wait, sniper just agrees
    return { shouldWait: false, shouldEnter: true, reason: null, bonus: 0 };
  }

  // Sniper conflicts - check if we're already waiting
  const pending = pendingConfirmations.get(key);

  if (pending) {
    pending.attempts++;
    pending.lastCheck = now;

    // Check timeout
    if (now - pending.startTime > CONFIRMATION_TIMEOUT_MS || pending.attempts > MAX_CHECK_ATTEMPTS) {
      pendingConfirmations.delete(key);
      return {
        shouldWait: false,
        shouldEnter: false, // Skip this trade - waited too long
        reason: `SNIPER TIMEOUT: Waited ${Math.round((now - pending.startTime) / 60000)}min, sniper still ${sniperDirection}`,
        bonus: 0
      };
    }

    // Still waiting
    const waitMinutes = Math.round((now - pending.startTime) / 60000);
    return {
      shouldWait: true,
      shouldEnter: false,
      reason: `SNIPER WAIT: ${mainDirection.toUpperCase()} pending, sniper ${sniperDirection} (${waitMinutes}min/${Math.round(CONFIRMATION_TIMEOUT_MS / 60000)}min)`,
      bonus: 0
    };
  }

  // Start new wait
  pendingConfirmations.set(key, {
    direction: mainDirection,
    startTime: now,
    lastCheck: now,
    mainScore,
    sniperDir: sniperDirection,
    sniperScore,
    attempts: 1
  });

  return {
    shouldWait: true,
    shouldEnter: false,
    reason: `SNIPER WAIT STARTED: ${mainDirection.toUpperCase()} vs ${sniperDirection} sniper - monitoring`,
    bonus: 0
  };
}

/**
 * Get all pending confirmations for monitoring
 */
function getPendingConfirmations() {
  const result = [];
  const now = Date.now();

  for (const [key, pending] of pendingConfirmations.entries()) {
    const [symbol, direction] = key.split('-');
    result.push({
      symbol,
      direction,
      waitingFor: pending.sniperDir === 'bullish' ? 'bearish' : 'bullish',
      waitTime: Math.round((now - pending.startTime) / 60000),
      attempts: pending.attempts,
      maxWait: Math.round(CONFIRMATION_TIMEOUT_MS / 60000)
    });
  }

  return result;
}

/**
 * Clear pending confirmation for a symbol (e.g., when manually closing)
 */
function clearPendingConfirmation(symbol, direction = null) {
  if (direction) {
    pendingConfirmations.delete(`${symbol}-${direction}`);
  } else {
    // Clear both directions
    pendingConfirmations.delete(`${symbol}-long`);
    pendingConfirmations.delete(`${symbol}-short`);
  }
}

/**
 * Clear all expired confirmations (cleanup)
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [key, pending] of pendingConfirmations.entries()) {
    if (now - pending.startTime > CONFIRMATION_TIMEOUT_MS) {
      pendingConfirmations.delete(key);
    }
  }
}

module.exports = {
  checkSniperConfirmation,
  getPendingConfirmations,
  clearPendingConfirmation,
  cleanupExpired,
  CONFIRMATION_TIMEOUT_MS,
  CONFIRMATION_BONUS
};
