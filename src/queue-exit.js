/**
 * Spots the two ways a queue run ends, so logging stops instead of filling the
 * CSV with rows that carry no position.
 *
 * Both end states look much the same on the page: the "Position N of M" line is
 * replaced by the waiting count and an invitation to join. The difference is
 * whether an offer came and lapsed first, which is worth recording separately
 * because it means the front of the queue was actually reached.
 */
(function (root) {
  const OFFER_EXPIRED = /task\s+offer\s+expired/i;
  const JOIN_PROMPT = /join\s+the\s+queue\s+to\s+get/i;

  const readOfferExpired = (text) =>
    typeof text === 'string' && OFFER_EXPIRED.test(text);

  const readJoinPrompt = (text) => typeof text === 'string' && JOIN_PROMPT.test(text);

  /**
   * @param {string} state from readSample
   * @returns {string|null} why the session should end, or null to carry on.
   *
   * "unknown" deliberately means carry on. A page mid-load says nothing at all,
   * and a blank read is not evidence of having left.
   */
  function exitReason(state) {
    if (state === 'offer-expired') return 'offer-expired';
    if (state === 'not-joined') return 'not-in-queue';
    return null;
  }

  root.__queueRefreshExit = { readOfferExpired, readJoinPrompt, exitReason };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { readOfferExpired, readJoinPrompt, exitReason };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
