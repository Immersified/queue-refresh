/**
 * Runs in the page's own JS context before the app boots, so it can see every
 * GraphQL response. Reports joinTaskQueue outcomes to the controller as a DOM
 * event carrying a JSON string (strings cross the isolated-world boundary safely).
 */
(function () {
  const RESULT_EVENT = 'queue-refresh:result';

  function report(text) {
    const result = window.__queueRefreshClassify(text);
    if (!result) return;
    window.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: JSON.stringify(result) }));
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const pending = originalFetch.apply(this, args);
    pending.then((response) => {
      response.clone().text().then(report).catch(() => {});
    }).catch(() => {});
    return pending;
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (typeof this.responseText === 'string') report(this.responseText);
      } catch (e) {
        // responseText throws for binary responseTypes; nothing to read there.
      }
    });
    return originalSend.apply(this, args);
  };
})();
