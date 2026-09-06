/**
 * Reads "Position 412 of 456" off the in-queue screen.
 * Shared by the content script and the Node tests.
 */
(function (root) {
  // Plain page text, like the waiting count: no generated class or React id.
  // Whitespace is loose because innerText wraps where it likes.
  const POSITION_PATTERN =
    /position\s+(\d[\d,\u00A0\u202F ]*?)\s+of\s+(\d[\d,\u00A0\u202F ]*)/i;

  // A queue longer than this is a misread, not a queue.
  const MAX_QUEUE_LENGTH = 100000;

  function toCount(raw) {
    // Thousands separators only: a period could be a decimal point, so a value
    // carrying one fails the integer check below rather than being guessed at.
    const digits = raw.replace(/[,\u00A0\u202F ]/g, '');
    const value = Number(digits);
    if (!Number.isInteger(value) || value < 0 || value > MAX_QUEUE_LENGTH) return null;
    return value;
  }

  /**
   * @param {string} text page text, usually document.body.innerText
   * @returns {{position: number, total: number}|null} null when the page does
   *   not say, or says something that cannot be true.
   */
  function readQueuePosition(text) {
    if (typeof text !== 'string') return null;

    const match = POSITION_PATTERN.exec(text);
    if (!match) return null;

    const position = toCount(match[1]);
    const total = toCount(match[2]);
    if (position === null || total === null) return null;

    // Positions are 1-based and cannot sit past the end of the queue.
    if (position < 1 || position > total) return null;

    return { position, total };
  }

  root.__queueRefreshReadPosition = readQueuePosition;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { readQueuePosition, MAX_QUEUE_LENGTH };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
