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
  // Remembered per tab, so a Cloudflare page or a half-rendered one still
  // knows which campaign it belongs to.
  const KEY_CAMPAIGN = 'queueRefresh.campaign';

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
  const campaigns = globalThis.__queueRefreshCampaign;
  if (!campaigns) {
    throw new Error('[Queue Refresh] src/campaign.js is not loaded. Run: node build.js');
  }
  const readEstimate = globalThis.__queueRefreshReadEstimate;
  if (!readEstimate) {
    throw new Error('[Queue Refresh] src/queue-estimate.js is not loaded. Run: node build.js');
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

  const pageText = () => (document.body ? document.body.innerText : '');

  /** "Guild Signal V2": which of the open campaigns this tab is. */
  function campaign() {
    const fromQueueLine = campaigns.readCampaign(pageText(), null);
    if (fromQueueLine) sessionStorage.setItem(KEY_CAMPAIGN, fromQueueLine);
    return sessionStorage.getItem(KEY_CAMPAIGN) || campaigns.readCampaign('', document.title);
  }
  // The logger labels its readings with this.
  globalThis.__queueRefreshCurrentCampaign = campaign;

  /**
   * The shared line is whatever tab spoke last. Each campaign also keeps its
   * own, so the popup and /status can show a tab's line and not its neighbour's.
   */
  function setStatus(text) {
    console.log('[Queue Refresh]', text);
    const name = campaign();
    const now = Date.now();
    const patch = { status: text, statusCampaign: name, updatedAt: now };
    if (name) patch[campaigns.statusKey(name)] = { text, at: now, running: isActive() };
    chrome.storage.local.set(patch);
  }

  function stop(text) {
    sessionStorage.setItem(KEY_ACTIVE, '0');
    setStatus(text);
  }

  /**
   * A stop nobody asked for. Sent to the phone too: after a /join from
   * Telegram, this is the only way to hear that it did not work.
   */
  function fail(text) {
    stop(text);
    tellWorker({ type: 'notify', text: `Queue Refresh\n${text}`, silent: false });
  }

  /** What is on the page instead, so a missing button can be explained. */
  function describeButtons() {
    const labels = Array.from(document.querySelectorAll('button'))
      .map((button) => button.textContent.trim())
      .filter(Boolean);
    const unique = [...new Set(labels)].slice(0, 8);
    return unique.length ? `Buttons on the page: ${unique.join(', ')}` : 'No buttons on the page.';
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
      logger.start();
      return stop('Already in the queue. Not joining again; logging.');
    }

    const attempt = Number(sessionStorage.getItem(KEY_ATTEMPTS) || '0') + 1;

    if (attempt > MAX_ATTEMPTS) {
      return fail(`Stopped: hit the ${MAX_ATTEMPTS} attempt limit.`);
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

      const disabled = findJoinButton() ? ' It is there, but disabled.' : '';
      return fail(
        `Stopped: no enabled "${BUTTON_LABEL}" button after ${BUTTON_TIMEOUT_MS / 1000}s.` +
          `${disabled}\n${describeButtons()}`
      );
    }

    // Counted here, not on arrival, so the attempt budget is spent on clicks:
    // a run of blank pages must not use up the night's attempts.
    sessionStorage.setItem(KEY_ATTEMPTS, String(attempt));
    sessionStorage.setItem(KEY_BLANKS, '0');

    const result = waitForResult();
    button.click();
    setStatus(`Attempt ${attempt}: clicked, waiting for the server.`);
    const { status, message } = await result;

    if (status === 'full' || status === 'limit' || status === 'backoff') {
      // The site saying it has had enough retries earns a longer pause.
      const wait = status === 'backoff' ? 2 * nextRetryDelay() : nextRetryDelay();
      const why = { full: 'queue full', limit: 'one-task limit', backoff: 'max retries exceeded' }[status];
      setStatus(`Attempt ${attempt}: ${why}. Refreshing in ${(wait / 1000).toFixed(1)}s.`);
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
      return fail(`Stopped: no joinTaskQueue response within ${RESPONSE_TIMEOUT_MS / 1000}s.`);
    }
    return fail(`Stopped on attempt ${attempt}:${detail}`);
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
      return fail(`Stopped: the page came back blank ${MAX_BLANK_RELOADS} times in a row.`);
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
    chrome.runtime.sendMessage({ type: 'challenge', signal, campaign: campaign() }).catch(() => null);
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
   * Waking the tab is all a browser start does. When to join is the arm's
   * decision, made from the page's own estimate; the worker only wakes the
   * tab while an arm is still ahead, so a launch on any other day does
   * nothing.
   *
   * The flag lives in chrome.storage rather than sessionStorage because a
   * fresh browser has no sessionStorage to read. Claiming it is what tells the
   * watchdog the tab is awake.
   */
  async function claimAutoStart() {
    const { autoStartPending } = await chrome.storage.local.get('autoStartPending');
    if (!autoStartPending) return;

    await chrome.storage.local.set({ autoStartPending: false });
    setStatus('Browser started and the queue tab is awake. The schedule decides when to join.');
  }

  // ---------------------------------------------------------------- schedule

  // You set when the task should be READY. The join time follows from the
  // page's "Estimated 60–120 min to front", read afresh every fifteen minutes
  // from two hours out. The arithmetic is in schedule.js.

  const SCHEDULE_TICK_MS = 1000;
  // The estimate is rendered by the app, so it arrives after the script does.
  const ESTIMATE_TIMEOUT_MS = 20000;
  const ESTIMATE_POLL_MS = 500;

  let scheduleTimer = null;

  function setScheduleStatus(text) {
    console.log('[Queue Refresh] schedule:', text);
    chrome.storage.local.set({ scheduleStatus: text });
  }

  // Labelled, so the phone can say which campaign a message is about.
  const tellWorker = (message) =>
    chrome.runtime.sendMessage({ campaign: campaign(), ...message }).catch(() => null);

  /**
   * An arm belongs to the campaign it was set on. Every tab on the site ticks,
   * so without this the first tab to notice would join, whichever it was. An
   * arm from before campaigns were recorded has none and belongs to any tab.
   */
  const isMine = (armedFor) => !armedFor || campaign() === armedFor;

  // A fresh load has not rendered the queue line yet; give it the time an
  // estimate gets before deciding the arm is someone else's.
  function waitUntilMine(armedFor) {
    return new Promise((resolve) => {
      const deadline = Date.now() + ESTIMATE_TIMEOUT_MS;
      const poll = () => {
        if (isMine(armedFor)) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, ESTIMATE_POLL_MS);
      };
      poll();
    });
  }

  async function clearArm(text) {
    await chrome.storage.local.set({
      scheduleArmed: false,
      scheduleJoinAt: null,
      scheduleCheckPending: false
    });
    await tellWorker({ type: 'schedule-clear' });
    stopScheduleTick();
    setScheduleStatus(text);
  }

  /**
   * The join time has arrived. Claims the arm first so the page tick and the
   * worker's alarm cannot both fire it, then does exactly one of two things:
   * join, or stand down because we are already in.
   */
  async function fireSchedule() {
    const { scheduleArmed } = await chrome.storage.local.get('scheduleArmed');
    if (!scheduleArmed) return;

    // Claimed before anything else happens, so a second trigger finds it gone.
    await chrome.storage.local.set({ scheduleArmed: false, scheduleJoinAt: null });
    await tellWorker({ type: 'schedule-clear' });
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
   * One step of the arm: join if the join time has come, give up if the ready
   * time has, or reload for a fresh estimate if a check is due.
   */
  async function scheduleTick() {
    const store = await chrome.storage.local.get([
      'scheduleArmed',
      'scheduleReadyAt',
      'scheduleJoinAt',
      'scheduleLastCheckAt',
      'scheduleCampaign'
    ]);
    if (!store.scheduleArmed || !store.scheduleReadyAt) return stopScheduleTick();
    // Not stopped: a page still rendering may turn out to be the one.
    if (!isMine(store.scheduleCampaign)) return;

    const now = Date.now();
    if (store.scheduleJoinAt && now >= store.scheduleJoinAt) return fireSchedule();

    if (now >= store.scheduleReadyAt) {
      await clearArm('Ready time reached without joining. Disarmed.');
      return tellWorker({
        type: 'notify',
        text: 'Queue Refresh\nReady time reached without joining. Disarmed.',
        silent: false
      });
    }

    const due = schedule.nextCheckAt({
      readyAt: store.scheduleReadyAt,
      lastCheckAt: store.scheduleLastCheckAt
    });
    if (now >= due) startCheck(now);
  }

  /** Reload the page: the estimate only updates on a fresh load. */
  async function startCheck(now) {
    stopScheduleTick();
    await chrome.storage.local.set({ scheduleLastCheckAt: now, scheduleCheckPending: true });
    setScheduleStatus('Refreshing for a fresh time estimate.');
    location.reload();
  }

  function waitForEstimate() {
    return new Promise((resolve) => {
      const deadline = Date.now() + ESTIMATE_TIMEOUT_MS;
      const poll = () => {
        const estimate = readEstimate(pageText());
        if (estimate || alreadyInQueue()) return resolve(estimate);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(poll, ESTIMATE_POLL_MS);
      };
      poll();
    });
  }

  /**
   * The reload startCheck asked for has landed. Read the estimate, decide,
   * and tell the phone either way.
   */
  async function runCheck() {
    const { scheduleArmed, scheduleCheckPending, scheduleReadyAt, scheduleCampaign } =
      await chrome.storage.local.get([
        'scheduleArmed',
        'scheduleCheckPending',
        'scheduleReadyAt',
        'scheduleCampaign'
      ]);
    if (!scheduleArmed || !scheduleCheckPending) return;
    if (!(await waitUntilMine(scheduleCampaign))) return;

    // Claimed first, so a second tab on the site cannot run the same check.
    await chrome.storage.local.set({ scheduleCheckPending: false });

    const estimate = await waitForEstimate();

    if (alreadyInQueue()) {
      logger.start();
      return clearArm('You are already in the queue. Disarmed; logging instead.');
    }

    const now = Date.now();
    const plan = schedule.planJoin({ readyAt: scheduleReadyAt, estimate, now });

    // No estimate clears an earlier join time too: no reading, no join.
    await chrome.storage.local.set({
      scheduleJoinAt: plan.joinAt,
      scheduleEstimate: estimate,
      scheduleEstimateAt: now
    });

    await tellWorker({
      type: 'schedule-report',
      check: {
        estimate,
        waiting: globalThis.__queueRefreshReadCount(pageText()),
        action: plan.action,
        readyAt: scheduleReadyAt,
        joinAt: plan.joinAt,
        now
      }
    });

    if (plan.action === 'join') return fireSchedule();

    if (plan.action === 'wait') {
      // Backstop for a background tab whose timers Edge has throttled.
      await tellWorker({ type: 'schedule-set', at: plan.joinAt });
      setScheduleStatus(`Joining at ${new Date(plan.joinAt).toLocaleTimeString()}.`);
    } else if (plan.action === 'short') {
      setScheduleStatus(
        `Queue is ${schedule.SHORT_QUEUE_MINUTES} min or less. Not joining; join by hand.`
      );
    } else {
      setScheduleStatus('No time estimate on the page. Not joining; checking again later.');
    }
    startScheduleTick();
  }

  /**
   * The page's own clock is the accurate one, and the tab has to be alive to
   * click anyway. chrome.alarms in the worker is the backstop, not the driver.
   */
  function startScheduleTick() {
    if (scheduleTimer) return;
    scheduleTimer = setInterval(scheduleTick, SCHEDULE_TICK_MS);
  }

  async function arm(value) {
    const readyAt = schedule.parseSchedule(value);
    if (readyAt === null) {
      return setScheduleStatus('That is not a date I can read. Use the picker.');
    }
    if (readyAt <= Date.now()) {
      return setScheduleStatus('That time has already passed.');
    }
    if (alreadyInQueue()) {
      // Arming would be a no-op that looked like a plan for the night.
      return setScheduleStatus(
        'You are already in the queue. Nothing to schedule; press Log only.'
      );
    }

    await chrome.storage.local.set({
      scheduleArmed: true,
      scheduleReadyAt: readyAt,
      scheduleJoinAt: null,
      scheduleLastCheckAt: null,
      scheduleCheckPending: false,
      scheduleEstimate: null,
      scheduleInput: value,
      scheduleCampaign: campaign()
    });

    const firstCheck = schedule.nextCheckAt({ readyAt, lastCheckAt: null });
    await tellWorker({ type: 'schedule-set', at: Math.max(firstCheck, Date.now()) });
    setScheduleStatus(
      `Armed for ${campaign()}. Ready at ${new Date(readyAt).toLocaleString()}. ` +
        `Checking the estimate from ${new Date(firstCheck).toLocaleTimeString()}.`
    );
    startScheduleTick();
  }

  const disarm = () => clearArm('Disarmed.');

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
      // Answered with the reading itself, so /status can show the page as it
      // is now rather than as it was when last stored.
      const { campaignReading } = logger.sampleNow();
      sendResponse({ active: isActive(), campaign: campaign(), reading: campaignReading });
      return false;
    }
    if (message.type === 'arm') {
      // Answered once armed, so a Telegram /arm can reply with what happened.
      arm(message.value)
        .then(() => chrome.storage.local.get('scheduleStatus'))
        .then(({ scheduleStatus }) =>
          sendResponse({ active: isActive(), campaign: campaign(), schedule: scheduleStatus }));
      return true;
    }
    if (message.type === 'disarm') disarm();
    if (message.type === 'schedule-tick') scheduleTick();
    sendResponse({ active: isActive(), campaign: campaign() });
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
    runCheck();
  }

  boot();

  // An arm has to survive the reloads and outlive any one page.
  chrome.storage.local.get('scheduleArmed').then(({ scheduleArmed }) => {
    if (scheduleArmed) startScheduleTick();
  });
})();
