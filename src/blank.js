/**
 * Spots a page that came back blank.
 *
 * A reload sometimes lands on nothing at all: the app shell never renders, so
 * there is no Join button, no position line, no waiting count and no text. It
 * looks the same as a page that is merely slow, which is why the loop used to
 * wait out the button timeout and then stop for the night.
 *
 * It is not a Cloudflare challenge either -- a challenge page says something,
 * and this one says nothing -- so it needs its own answer. The answer is the
 * one a human sitting at the machine would reach for: press F5.
 */
(function (root) {
  // Whitespace, non-breaking spaces and the zero-width characters a React
  // shell can leave behind. All of them render as an empty page.
  const INVISIBLE = /[\s ​-‍﻿]/g;

  /**
   * @param {string} text page text, usually document.body.innerText, or ''
   *   when there is no body at all.
   * @returns {boolean} true when the page shows nothing a person could read.
   *
   * Anything that is not a string means we could not look, and a page we could
   * not look at is not evidence of a blank one.
   */
  function isBlankPage(text) {
    if (typeof text !== 'string') return false;
    return text.replace(INVISIBLE, '').length === 0;
  }

  root.__queueRefreshBlank = { isBlankPage };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isBlankPage };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
