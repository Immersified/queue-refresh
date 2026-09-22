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
  const KEY_BLANKS = 'queueRefresh.blanks';
  // Why the loop stopped, so a stop that was Cloudflare's doing can be undone
  // when Cloudflare goes away, and one you asked for cannot.
  const KEY_HALTED_BY = 'queueRefresh.haltedBy';
  const KEY_RESUMES = 'queueRefresh.challengeResumes';

  const logger = globalThis.__queueRefreshLogger;
  const schedule = globalThis.__queueRefreshSchedule;
  const challenge = globalThis.__queueRefreshChallenge;
  const blank = globalThis.__queueRefreshBlank;
  // Added to manifest.template.json after the first release, so a folder that
  // was pulled but not rebuilt has an old manifest.json that never loads it.
  // Say which command fixes it rather than failing on a TypeError later.
  if (!challenge) {
    throw new Error('[Queue Refresh] src/challenge.js is not loaded. Run: node build.js');
  }
  if (!blank) {
    throw new Error('[Queue Refresh] src/blank.js is not loaded. Run: node build.js');
  }

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

  // A blank page costs the button timeout plus a retry delay, so this is about
  // twelve minutes of an empty page before the loop gives up on it. Bounded
  // because reloading forever is how one Cloudflare challenge becomes a run of
  // them, and a site that is truly down will not come back by being asked.
  const MAX_BLANK_RELOADS = 20;

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

  const pageText = () => (document.body ? document.body.innerText : '');

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
      logger.start();
      return stop('Already in the queue. Not joining again; logging.');
    }

    const attempt = Number(sessionStorage.getItem(KEY_ATTEMPTS) || '0') + 1;

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
      // Nothing rendered at all: reload rather than end the night on a page
      // that never got the chance to answer. A page that did render, but has
      // no button, is a different page and still stops the loop.
      if (blank.isBlankPage(pageText())) return reloadBlankPage();

      return stop(`Stopped: no enabled "${BUTTON_LABEL}" button after ${BUTTON_TIMEOUT_MS / 1000}s.`);
    }

    // Counted here, not on arrival, so the attempt budget is spent on clicks:
    // a run of blank pages must not use up the night's attempts.
    sessionStorage.setItem(KEY_ATTEMPTS, String(attempt));
    sessionStorage.setItem(KEY_BLANKS, '0');

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
      // The only reason to log is a position to log. That starts here.
      logger.start();
      return stop(`Joined the queue on attempt ${attempt}. Logging now.`);
    }
    if (status === 'timeout') {
      return stop(`Stopped: no joinTaskQueue response within ${RESPONSE_TIMEOUT_MS / 1000}s.`);
    }
    return stop(`Stopped on attempt ${attempt}:${detail}`);
  }

  /**
   * The page came back blank. Press F5, in effect, and keep the loop alive.
   *
   * Counted separately from the attempts, because no click happened, and
   * counted consecutively: a page that renders again resets it, so a bad patch
   * in the middle of a long night does not end it.
   */
  function reloadBlankPage() {
    const blanks = Number(sessionStorage.getItem(KEY_BLANKS) || '0') + 1;
    sessionStorage.setItem(KEY_BLANKS, String(blanks));

    if (blanks > MAX_BLANK_RELOADS) {
      return stop(`Stopped: the page came back blank ${MAX_BLANK_RELOADS} times in a row.`);
    }

    const wait = nextRetryDelay();
    setStatus(
      `Blank page (${blanks} of ${MAX_BLANK_RELOADS}). Refreshing in ${(wait / 1000).toFixed(1)}s.`
    );
    setTimeout(() => {
      if (isActive()) location.reload();
    }, wait);
  }

  // -------------------------------------------------------------- cloudflare

  // The automatic challenge passes itself and takes the page with it. Only the
  // kind that waits for a human is worth waking anyone up for, so the
  // automatic one gets this long to finish first.
  //
  // Eight seconds was not enough. On 22 September 2026 one cleared by itself
  // and the campaign page came back, but the report had already gone out and
  // the night was over. Waiting on a real challenge costs a minute; reporting
  // one that would have cleared costs the night, so the wait is the cheap side
  // of that trade.
  const CHALLENGE_GRACE_MS = 60000;
  const CHALLENGE_POLL_MS = 1000;

  // A challenge that keeps coming back is not clearing itself, whatever any
  // one page looked like. After this many, the loop stays down.
  const MAX_CHALLENGE_RESUMES = 3;

  /**
   * Is a Cloudflare interstitial standing in front of the page right now?
   *
   * A page still showing queue content is not a challenge page, whatever else
   * is in the DOM. That guard is here rather than in challenge.js so the
   * detector stays a pure function the tests can reach.
   */
  function challengeBlocking() {
    if (alreadyInQueue() || findJoinButton()) return null;

    return challenge.challengeSignal({
      title: document.title,
      text: pageText(),
      hasWidget: Boolean(document.querySelector(challenge.WIDGET_SELECTOR))
    });
  }

  /**
   * Stop, and make some noise.
   *
   * Deliberately does not reload. Reloading is what turns one challenge into a
   * run of them, and every reload is another request Cloudflare counts. The
   * arm, if there is one, is left alone: clear the challenge before it fires
   * and the night still happens.
   */
  function haltForChallenge(signal) {
    sessionStorage.setItem(KEY_ACTIVE, '0');
    sessionStorage.setItem(KEY_HALTED_BY, 'challenge');
    setStatus(`Cloudflare is asking for verification, going by ${signal}. Stopped; clear it by hand.`);
    chrome.runtime.sendMessage({ type: 'challenge', signal }).catch(() => null);
  }

  /** @returns {Promise<boolean>} true when the page is blocked and we stopped. */
  async function guardChallenge() {
    if (!challengeBlocking()) return false;

    setStatus('Cloudflare check on the page. Giving it up to a minute to pass by itself.');

    // Polled rather than slept through: the moment it clears we carry on, and
    // if it clears the way it usually does -- by navigating the page away --
    // this script is gone before it can report anything at all.
    const deadline = Date.now() + CHALLENGE_GRACE_MS;
    while (Date.now() < deadline) {
      await sleep(CHALLENGE_POLL_MS);
      if (!challengeBlocking()) return false;
    }

    // Still there after a full minute, so it is the kind that waits for a
    // human. What it fired on now is what gets reported.
    const signal = challengeBlocking();
    if (!signal) return false;

    haltForChallenge(signal);
    return true;
  }

  /**
   * Last time round, Cloudflare stopped the loop. If the page is back, that
   * stop was a mistake nobody asked for, so take it back.
   *
   * The page has to prove itself first: an empty page and a challenge page
   * look much the same, so this waits for a Join button (or a position) the
   * same way an attempt would, and stays stopped if neither turns up.
   */
  async function resumeAfterChallenge() {
    setStatus('Cloudflare stopped the last run. Waiting to see if the page is back.');

    const button = await waitForButton();
    if (!button && !alreadyInQueue()) {
      return setStatus('Cloudflare stopped the last run and the page is still not back.');
    }

    sessionStorage.removeItem(KEY_HALTED_BY);
    chrome.runtime.sendMessage({ type: 'challenge-cleared' }).catch(() => null);

    const resumes = Number(sessionStorage.getItem(KEY_RESUMES) || '0') + 1;
    sessionStorage.setItem(KEY_RESUMES, String(resumes));

    if (resumes > MAX_CHALLENGE_RESUMES) {
      return setStatus(
        `Cloudflare cleared itself again, ${resumes} times now. Left stopped; press Start.`
      );
    }

    sessionStorage.setItem(KEY_ACTIVE, '1');
    setStatus(
      `Cloudflare cleared itself and the page is back. Carrying on ` +
        `(${resumes} of ${MAX_CHALLENGE_RESUMES}).`
    );
  }

  // --------------------------------------------------------------- autostart

  /**
   * Edge has just started and the worker woke this tab.
   *
   * The flag lives in chrome.storage rather than sessionStorage because a
   * fresh browser has no sessionStorage to read. It is claimed before it is
   * used, so two tabs on the same site cannot both take it.
   */
  async function claimAutoStart() {
    const { autoStartPending } = await chrome.storage.local.get('autoStartPending');
    if (!autoStartPending) return;

    await chrome.storage.local.set({ autoStartPending: false });
    setStatus('Auto-start: the browser has just started. Joining.');

    // runAttempt's own in-queue guard covers the case where we are already
    // through, so there is nothing to check here.
    sessionStorage.setItem(KEY_ACTIVE, '1');
    sessionStorage.setItem(KEY_ATTEMPTS, '0');
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

    if (alreadyInQueue()) {
      // Already through, so there is a queue position to record right now.
      logger.start();
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
      sessionStorage.setItem(KEY_RESUMES, '0');
      sessionStorage.removeItem(KEY_HALTED_BY);
      runAttempt();
    }
    if (message.type === 'log-only') {
      // Already in the queue by hand: gather data without touching the button.
      logger.start();
      setStatus('Logging only. The join button is not being touched.');
    }
    if (message.type === 'stop') {
      logger.stop();
      // Yours, not Cloudflare's, so nothing may undo it later.
      sessionStorage.removeItem(KEY_HALTED_BY);
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

  // ------------------------------------------------------------- heartbeat

  // A suspended renderer cannot write this, which is exactly how the worker
  // finds out the page has stopped living. Runs whether or not we are logging.
  const HEARTBEAT_MS = 30000;

  function beat() {
    chrome.storage.local.set({ pageHeartbeatAt: Date.now(), lastSeenUrl: location.href });
  }

  beat();
  setInterval(beat, HEARTBEAT_MS);

  /**
   * Every page load comes through here, whether it is the first of the night,
   * one the retry loop triggered, or the one the worker woke on browser start.
   *
   * Order matters: a page behind a Cloudflare challenge has no button to find
   * and no position to read, so anything that runs before the check would
   * spend its attempts on a page that cannot answer.
   */
  async function boot() {
    if (await guardChallenge()) return;

    await claimAutoStart();

    // Nothing above found a challenge, so if one stopped the last run it has
    // gone. Take the stop back, if the page can show it is really back.
    if (sessionStorage.getItem(KEY_HALTED_BY) === 'challenge') {
      await resumeAfterChallenge();
    }

    // Resume automatically after the reload we triggered ourselves.
    runAttempt();
    watchCount();
  }

  boot();

  // An arm has to survive the reloads and outlive any one page.
  chrome.storage.local.get('scheduleArmed').then(({ scheduleArmed }) => {
    if (scheduleArmed) startScheduleTick();
  });
})();
