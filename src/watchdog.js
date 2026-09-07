/**
 * Decides when the queue page has stopped living and needs reviving.
 *
 * A page on a disconnected RDP session gets its renderer suspended: the tab is
 * still there, the timers are frozen, and nothing tells the extension. The
 * heartbeat is how a frozen page gives itself away, since a frozen one cannot
 * write a fresh timestamp.
 */
(function (root) {
  /**
   * @param {number} heartbeatAt last time the page said it was alive
   * @param {number} revivedAt   last time we tried to fix it
   * @param {number} now
   * @param {number} staleMs     silence that counts as dead
   * @param {number} cooldownMs  time a revive gets to work before another
   * @returns {boolean}
   */
  function shouldRevive({ heartbeatAt = 0, revivedAt = 0, now, staleMs, cooldownMs }) {
    // A reload takes a moment to produce its first heartbeat. Without this the
    // watchdog would reload the page again every minute, forever.
    if (now - revivedAt < cooldownMs) return false;
    return now - heartbeatAt >= staleMs;
  }

  root.__queueRefreshWatchdog = { shouldRevive };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { shouldRevive };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
