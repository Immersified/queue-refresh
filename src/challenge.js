/**
 * Spots a Cloudflare interstitial standing in front of the queue page.
 *
 * Cloudflare serves the challenge from the site's own domain, so the content
 * scripts still run on it. What they see is a page with no Join button, no
 * position line and no waiting count -- which on its own looks exactly like a
 * page that is merely slow. The loop would reload into it until it ran out of
 * attempts and the night would end in silence.
 *
 * Nothing here tries to pass the challenge, because nothing here can. The
 * checkbox sits in a cross-origin iframe the content script cannot reach, and a
 * scripted click carries isTrusted: false, which the widget rejects. The
 * checkbox is only the visible part of a fingerprinting check anyway. The job
 * of this file is to notice, so the phone can ring while there is still a night
 * left to save.
 */
(function (root) {
  // Cloudflare's own interstitial title, unchanged for years.
  const TITLE = /just a moment/i;

  // The wording moves around between challenge types, so several phrasings.
  const TEXT = new RegExp(
    [
      'verify (that )?you are human',
      'checking your browser',
      'checking if the site connection is secure',
      'review the security of your connection',
      'needs to review the security'
    ].join('|'),
    'i'
  );

  // What the widget puts in the DOM. Read by the caller, which has a document;
  // this file stays pure so the tests can run in Node.
  const WIDGET_SELECTOR = [
    '#challenge-form',
    '#challenge-running',
    '#cf-challenge-running',
    '.cf-turnstile',
    'iframe[src*="challenges.cloudflare.com"]'
  ].join(', ');

  /**
   * @param {string}  title     document.title
   * @param {string}  text      document.body.innerText
   * @param {boolean} hasWidget whether WIDGET_SELECTOR matched
   * @returns {boolean}
   *
   * Any one signal is enough. Cloudflare serves several different challenge
   * pages and they do not agree on which of these they show, so requiring two
   * would mean missing the ones that only ever offer one.
   */
  function isChallengePage({ title = '', text = '', hasWidget = false } = {}) {
    if (hasWidget === true) return true;
    if (typeof title === 'string' && TITLE.test(title)) return true;
    return typeof text === 'string' && TEXT.test(text);
  }

  root.__queueRefreshChallenge = { isChallengePage, WIDGET_SELECTOR };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isChallengePage, WIDGET_SELECTOR };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
