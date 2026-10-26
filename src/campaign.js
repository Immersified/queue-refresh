/**
 * Which campaign a page or tab is, so two open campaigns can be told apart.
 * Shared by the content script, the worker and the Node tests.
 */
(function (root) {
  // "Task queue · Guild Signal V2" sits above the Join button. The separator is
  // a middle dot, but any dot or dash is accepted in case it changes.
  const QUEUE_LINE = /Task queue\s*[·•\-–—]\s*([^\n]+)/i;

  /**
   * @param {string} text  page text, usually document.body.innerText
   * @param {string} title document.title, the fallback
   * @returns {string|null}
   */
  function readCampaign(text, title) {
    const match = typeof text === 'string' ? QUEUE_LINE.exec(text) : null;
    const name = match ? match[1] : title;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  }

  /**
   * The tabs a Telegram command means. No name means every tab; a name is any
   * part of the campaign, so "prism" finds "Guild Prism V2".
   *
   * @param {Array<{title: string}>} tabs
   */
  function pickTabs(tabs, name) {
    if (!name) return tabs;
    const wanted = name.trim().toLowerCase();
    return tabs.filter((tab) => (tab.title || '').toLowerCase().includes(wanted));
  }

  /** "Guild Signal V2" -> "signal": the word that tells it apart from the others. */
  function shortName(title, others) {
    const words = (title || '').toLowerCase().split(/\s+/).filter(Boolean);
    const shared = (word) =>
      others.every((other) => (other || '').toLowerCase().split(/\s+/).includes(word));
    return words.find((word) => !shared(word)) || words[0] || '';
  }

  // One storage key per campaign rather than one shared object, so two tabs
  // writing at the same moment cannot overwrite each other's entry.
  const statusKey = (name) => `campaign-status:${name}`;
  const readingKey = (name) => `campaign-reading:${name}`;

  const api = { readCampaign, pickTabs, shortName, statusKey, readingKey };
  root.__queueRefreshCampaign = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
