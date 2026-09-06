/**
 * Drives one attempt per page load: find the button, click it, read the result,
 * and either reload for another try or stop. Loop state lives in sessionStorage
 * so it survives the reload; it is cleared when the tab closes.
 */
(function () {
  const RESULT_EVENT = 'queue-refresh:result';
  const BUTTON_LABEL = 'Join queue';
  // Only shown once you are in the queue, so it is a second, independent
  // answer to "am I already in?" that does not depend on the position line.
  const LEAVE_LABEL = 'Leave queue';

  const KEY_ACTIVE = 'queueRefresh.active';
  const KEY_ATTEMPTS = 'queueRefresh.attempts';

  const logger = globalThis.__queueRefreshLogger;
  const schedule = globalThis.__queueRefreshSchedule;

  // Set in .env, written into src/config.js by build.js.
  const settings = globalThis.QUEUE_REFRESH_CONFIG;
  if (!settings) {
    throw new Error('[Queue Refresh] src/config.js is missing. Run: node build.js');
  }

  const RETRY_DELAY_MIN_MS = settings.retryDelayMinMs;
  const RETRY_DELAY_MAX_MS = settings.retryDelayMaxMs;
  const RESPONSE_TIMEOUT_MS = settings.responseTimeoutMs;
  const MAX_ATTEMPTS = settings.maxAttempts;
  const CLICK_DELAY_MS = settings.clickDelayMs;

  const BUTTON_TIMEOUT_MS = 30000;
  const POLL_INTERVAL_MS = 250;

  // The count is rendered by the app, so it arrives after the script does.
  const COUNT_TIMEOUT_MS = 20000;
  const COUNT_POLL_INTERVAL_MS = 500;

  const isActive = () => sessionStorage.getItem(KEY_ACTIVE) === '1';

  function setStatus(text) {
    console.log('[Queue Refresh]', text);
    chrome.storage.local.set({ status: text, updatedAt: Date.now() });
  }

  function stop(text) {
    sessionStorage.setItem(KEY_ACTIVE, '0');
    setStatus(text);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // A random wait per retry, so the requests do not land on a fixed rhythm.
  const nextRetryDelay = () =>
    RETRY_DELAY_MIN_MS + Math.random() * (RETRY_DELAY_MAX_MS - RETRY_DELAY_MIN_MS);

  function findButton(label) {
    return Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === label
    );
  }

  const findJoinButton = () => findButton(BUTTON_LABEL);

  /**
   * Two signals, either of which is enough: the "Position N of M" line, and a
   * Leave queue button. One page can be slow to render the other, and joining
   * twice is the thing we must not do.
   */
  function alreadyInQueue() {
    return logger.readSample().state === 'in-queue' || Boolean(findButton(LEAVE_LABEL));
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

  // Keep looking until the app has rendered the queue line, then stop. A page
  // without one (any other page on the site) simply times out and goes quiet.
  // Only for the popup's benefit: once a logging session runs, its own tick
  // takes over and nothing in the join loop depends on either number.
  function watchCount() {
    const deadline = Date.now() + COUNT_TIMEOUT_MS;
    const poll = () => {
      if (logger.sampleNow().state !== 'unknown') return;
      if (Date.now() >= deadline) return;
      setTimeout(poll, COUNT_POLL_INTERVAL_MS);
    };
    poll();
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

    // Checked every attempt, not just at the start: a reload can land on a
    // page where we are already through, and clicking again would be wrong.
    if (alreadyInQueue()) {
      return stop('Already in the queue. Not joining again; still logging.');
    }

    const attempt = Number(sessionStorage.getItem(KEY_ATTEMPTS) || '0') + 1;
    sessionStorage.setItem(KEY_ATTEMPTS, String(attempt));

    if (attempt > MAX_ATTEMPTS) {
      return stop(`Stopped: hit the ${MAX_ATTEMPTS} attempt limit.`);
    }

    if (CLICK_DELAY_MS > 0) {
      setStatus(`Attempt ${attempt}: letting the page settle for ${CLICK_DELAY_MS / 1000}s.`);
      await sleep(CLICK_DELAY_MS);
      if (!isActive()) return;
    }

    setStatus(`Attempt ${attempt}: looking for the "${BUTTON_LABEL}" button.`);
    const button = await waitForButton();
    if (!button) {
      return stop(`Stopped: no enabled "${BUTTON_LABEL}" button after ${BUTTON_TIMEOUT_MS / 1000}s.`);
    }

    const result = waitForResult();
    button.click();
    setStatus(`Attempt ${attempt}: clicked, waiting for the server.`);
    const { status, message } = await result;

    if (status === 'full') {
      const wait = nextRetryDelay();
      setStatus(`Attempt ${attempt}: queue full. Refreshing in ${(wait / 1000).toFixed(1)}s.`);
      setTimeout(() => {
        if (isActive()) location.reload();
      }, wait);
      return;
    }

    const detail = message ? ` ${message}` : '';
    if (status === 'joined') {
      return stop(`Joined the queue on attempt ${attempt}. Still logging.`);
    }
    if (status === 'timeout') {
      return stop(`Stopped: no joinTaskQueue response within ${RESPONSE_TIMEOUT_MS / 1000}s.`);
    }
    return stop(`Stopped on attempt ${attempt}:${detail}`);
  }

  // ---------------------------------------------------------------- schedule

  const SCHEDULE_TICK_MS = 1000;
  let scheduleTimer = null;

  function setScheduleStatus(text) {
    console.log('[Queue Refresh] schedule:', text);
    chrome.storage.local.set({ scheduleStatus: text });
  }

  /**
   * The moment has arrived. Claims the arm first so the page tick and the
   * worker's alarm cannot both fire it, then does exactly one of two things:
   * join, or stand down because we are already in.
   */
  async function fireSchedule() {
    const { scheduleArmed } = await chrome.storage.local.get('scheduleArmed');
    if (!scheduleArmed) return;

    // Claimed before anything else happens, so a second trigger finds it gone.
    await chrome.storage.local.set({ scheduleArmed: false });
    stopScheduleTick();

    // Logging starts either way: being already in the queue is still a night
    // of position data, and that is what we are here to collect.
    logger.start();

    if (alreadyInQueue()) {
      setScheduleStatus('Fired, but you were already in the queue. Join skipped.');
      setStatus('Already in the queue. Not joining; logging instead.');
      return;
    }

    setScheduleStatus('Fired. Joining now.');
    sessionStorage.setItem(KEY_ACTIVE, '1');
    sessionStorage.setItem(KEY_ATTEMPTS, '0');

    // A page that has sat open for hours may hold a stale button or a dead
    // session, so start the attempt from a fresh load rather than this one.
    location.reload();
  }

  function stopScheduleTick() {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }

  /**
   * The page's own clock is the accurate one, and the tab has to be alive to
   * click anyway. chrome.alarms in the worker is the backstop, not the driver.
   */
  function startScheduleTick() {
    if (scheduleTimer) return;
    scheduleTimer = setInterval(async () => {
      const { scheduleArmed, scheduleAt } = await chrome.storage.local.get([
        'scheduleArmed',
        'scheduleAt'
      ]);
      if (!scheduleArmed || !scheduleAt) return stopScheduleTick();
      if (Date.now() >= scheduleAt) fireSchedule();
    }, SCHEDULE_TICK_MS);
  }

  async function arm(value) {
    const at = schedule.parseSchedule(value);
    if (at === null) {
      return setScheduleStatus('That is not a date I can read. Use the picker.');
    }
    if (at <= Date.now()) {
      return setScheduleStatus('That time has already passed.');
    }
    if (alreadyInQueue()) {
      // Arming would be a no-op that looked like a plan for the night.
      return setScheduleStatus(
        'You are already in the queue. Nothing to schedule; press Log only.'
      );
    }

    await chrome.storage.local.set({ scheduleArmed: true, scheduleAt: at, scheduleInput: value });
    await chrome.runtime.sendMessage({ type: 'schedule-set', at }).catch(() => null);
    setScheduleStatus(`Armed for ${new Date(at).toLocaleString()}.`);
    startScheduleTick();
  }

  async function disarm() {
    await chrome.storage.local.set({ scheduleArmed: false });
    await chrome.runtime.sendMessage({ type: 'schedule-clear' }).catch(() => null);
    stopScheduleTick();
    setScheduleStatus('Disarmed.');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'start') {
      sessionStorage.setItem(KEY_ACTIVE, '1');
      sessionStorage.setItem(KEY_ATTEMPTS, '0');
      logger.start();
      runAttempt();
    }
    if (message.type === 'log-only') {
      // Already in the queue by hand: gather data without touching the button.
      logger.start();
      setStatus('Logging only. The join button is not being touched.');
    }
    if (message.type === 'stop') {
      logger.stop();
      stop('Stopped by you.');
    }
    if (message.type === 'stop-logging') {
      // Leaves the join loop alone: only the logging session ends.
      logger.stop();
    }
    if (message.type === 'test-shot') {
      chrome.runtime.sendMessage({ type: 'test-shot' });
    }
    if (message.type === 'read-count') {
      logger.sampleNow();
    }
    if (message.type === 'arm') arm(message.value);
    if (message.type === 'disarm') disarm();
    if (message.type === 'schedule-fire') fireSchedule();
    sendResponse({ active: isActive() });
    return false;
  });

  // Resume automatically after the reload we triggered ourselves.
  runAttempt();
  watchCount();

  // An arm has to survive the reloads and outlive any one page.
  chrome.storage.local.get('scheduleArmed').then(({ scheduleArmed }) => {
    if (scheduleArmed) startScheduleTick();
  });
})();
