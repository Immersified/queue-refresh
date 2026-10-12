/**
 * Reads "Estimated 60–120 min to front if you join now" off the queue page.
 * Shared by the content script and the Node tests.
 */
(function (root) {
  // Plain page text, like the waiting count. Accepts a range ("60–120 min"),
  // a single value ("45 min") and an upper bound ("under 2 minutes"). The dash
  // can be any of the three a page is likely to use, or the word "to".
  const ESTIMATE_PATTERN = new RegExp(
    '(?:estimated|wait(?:ing)?\\s+time(?:\\s+is)?)\\s*:?\\s*' +
      '(?:(under|less\\s+than|<)\\s*)?' +
      '(\\d+)' +
      '(?:\\s*(?:[-\\u2013\\u2014]|to)\\s*(\\d+))?' +
      '\\s*(min(?:ute)?s?|h(?:ou)?rs?|h)\\b',
    'i'
  );

  // A wait longer than a week is a misread, not a wait.
  const MAX_MINUTES = 7 * 24 * 60;

  /**
   * @param {string} text page text, usually document.body.innerText
   * @returns {{min: number, max: number}|null} minutes, or null when the page
   *   does not say, or says something that cannot be true.
   */
  function readWaitEstimate(text) {
    if (typeof text !== 'string') return null;

    const match = ESTIMATE_PATTERN.exec(text);
    if (!match) return null;

    const [, under, first, second, unit] = match;
    const scale = /^h/i.test(unit) ? 60 : 1;

    // "under 2 min" means anywhere from now to two minutes.
    const min = under ? 0 : Number(first) * scale;
    const max = Number(second ?? first) * scale;

    if (min > max || max > MAX_MINUTES) return null;
    return { min, max };
  }

  root.__queueRefreshReadEstimate = readWaitEstimate;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { readWaitEstimate };
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
