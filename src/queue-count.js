/**
 * Reads "442 experts currently waiting" off the queue page.
 * Shared by the content script and the Node tests.
 */
(function (root) {
  // The count is plain page text, so no generated class name or React id is
  // involved. Whitespace is loose because innerText wraps where it likes.
  // The lookbehind keeps "4.5 experts" from being read as 5.
  const COUNT_PATTERN = /(?<![\d.,])(\d[\d,\u00A0\u202F ]*)\s+experts?\s+currently\s+waiting/i;

  // A queue longer than this is a misread, not a queue.
  const MAX_QUEUE_LENGTH = 100000;

  /**
   * @param {string} text page text, usually document.body.innerText
   * @returns {number|null} the count, or null when the page does not say.
   */
  function readQueueCount(text) {
    if (typeof text !== 'string') return null;

    const match = COUNT_PATTERN.exec(text);
    if (!match) return null;

    // Thousands separators only: a period could be a decimal point, so a value
    // carrying one is left to fail the integer check below.
    const digits = match[1].replace(/[,\u00A0\u202F ]/g, '');
    const count = Number(digits);

    if (!Number.isInteger(count) || count < 0 || count > MAX_QUEUE_LENGTH) return null;
    return count;
  }

  root.__queueRefreshReadCount = readQueueCount;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { readQueueCount, MAX_QUEUE_LENGTH };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
