/**
 * Drives one attempt per page load: find the button, click it, read the result,
 * and either reload for another try or stop. Loop state lives in sessionStorage
 * so it survives the reload; it is cleared when the tab closes.
 */
(function () {
  const RESULT_EVENT = 'queue-refresh:result';
  const BUTTON_LABEL = 'Join queue';

  const KEY_ACTIVE = 'queueRefresh.active';
  const KEY_ATTEMPTS = 'queueRefresh.attempts';

  const RETRY_DELAY_MS = 10000;
  const BUTTON_TIMEOUT_MS = 30000;
  const RESPONSE_TIMEOUT_MS = 15000;
  const POLL_INTERVAL_MS = 250;
  const MAX_ATTEMPTS = 200;

  const isActive = () => sessionStorage.getItem(KEY_ACTIVE) === '1';

  function setStatus(text) {
    console.log('[Queue Refresh]', text);
    chrome.storage.local.set({ status: text, updatedAt: Date.now() });
  }

  function stop(text) {
    sessionStorage.setItem(KEY_ACTIVE, '0');
    setStatus(text);
  }

  function findJoinButton() {
    return Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === BUTTON_LABEL
    );
  }

  function waitForButton() {
    return new Promise((resolve) => {
      const deadline = Date.now() + BUTTON_TIMEOUT_MS;
      const poll = () => {
        const button = findJoinButton();
        if (button && !button.disabled) return resolve(button);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(poll, POLL_INTERVAL_MS);
      };
      poll();
    });
  }

  function waitForResult() {
    return new Promise((resolve) => {
      const finish = (result) => {
        clearTimeout(timer);
        window.removeEventListener(RESULT_EVENT, onResult);
        resolve(result);
      };
      const onResult = (event) => {
        try {
          finish(JSON.parse(event.detail));
        } catch (e) {
          finish({ status: 'error', message: 'Unreadable response from the page.' });
        }
      };
      const timer = setTimeout(() => finish({ status: 'timeout' }), RESPONSE_TIMEOUT_MS);
      window.addEventListener(RESULT_EVENT, onResult);
    });
  }

  async function runAttempt() {
    if (!isActive()) return;

    const attempt = Number(sessionStorage.getItem(KEY_ATTEMPTS) || '0') + 1;
    sessionStorage.setItem(KEY_ATTEMPTS, String(attempt));

    if (attempt > MAX_ATTEMPTS) {
      return stop(`Stopped: hit the ${MAX_ATTEMPTS} attempt limit.`);
    }

    setStatus(`Attempt ${attempt}: looking for the "${BUTTON_LABEL}" button.`);
    const button = await waitForButton();
    if (!button) {
      return stop(`Stopped: no enabled "${BUTTON_LABEL}" button after 30s.`);
    }

    const result = waitForResult();
    button.click();
    setStatus(`Attempt ${attempt}: clicked, waiting for the server.`);
    const { status, message } = await result;

    if (status === 'full') {
      setStatus(`Attempt ${attempt}: queue full. Refreshing in 10s.`);
      setTimeout(() => {
        if (isActive()) location.reload();
      }, RETRY_DELAY_MS);
      return;
    }

    const detail = message ? ` ${message}` : '';
    if (status === 'joined') return stop(`Joined the queue on attempt ${attempt}.`);
    if (status === 'timeout') return stop(`Stopped: no joinTaskQueue response within 15s.`);
    return stop(`Stopped on attempt ${attempt}:${detail}`);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start') {
      sessionStorage.setItem(KEY_ACTIVE, '1');
      sessionStorage.setItem(KEY_ATTEMPTS, '0');
      runAttempt();
    }
    if (message.type === 'stop') {
      stop('Stopped by you.');
    }
    sendResponse({ active: isActive() });
    return false;
  });

  // Resume automatically after the reload we triggered ourselves.
  runAttempt();
})();
