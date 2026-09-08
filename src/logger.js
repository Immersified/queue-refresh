/**
 * The logging clock.
 *
 * It lives in the page rather than the service worker for two reasons: an MV3
 * worker is killed after ~30s idle, and chrome.alarms cannot go below a minute.
 * The page is open anyway, so its timers are the reliable ones. The worker does
 * the file writing, because only it can reach chrome.downloads.
 *
 * Two independent cadences, both from .env:
 *   LOG_INTERVAL_SECONDS         a CSV row
 *   SCREENSHOT_INTERVAL_SECONDS  a PNG of the visible tab
 *
 * Session state lives in chrome.storage.local, so the reloads the join loop
 * triggers do not restart the session or lose rows.
 *
 * A session begins only once there is a queue position to record: on a
 * successful join, or on finding we were already in. Logging the climb is the
 * point, and rows from the retry loop carry no position at all.
 */
(function () {
  const settings = globalThis.QUEUE_REFRESH_CONFIG;
  if (!settings) return; // controller.js already throws a clear error for this.

  const LOG_INTERVAL_MS = settings.logIntervalMs;
  const SHOT_INTERVAL_MS = settings.screenshotIntervalMs;

  const { readOfferExpired, readJoinPrompt, exitReason } = globalThis.__queueRefreshExit;

  // Two readings, not one. A page can render the join view for a moment while
  // hydrating, and ending a night's session on a single frame would be a
  // worse bug than the one this fixes.
  const EXIT_CONFIRMATIONS = 2;

  let timer = null;

  /** Everything the page can tell us right now. */
  function readSample() {
    const text = document.body ? document.body.innerText : '';
    const place = globalThis.__queueRefreshReadPosition(text);
    const waiting = globalThis.__queueRefreshReadCount(text);

    // Order matters: a position on the page beats everything, because it is
    // the only reading that means we are still in.
    let state = 'unknown';
    if (place) state = 'in-queue';
    else if (readOfferExpired(text)) state = 'offer-expired';
    else if (waiting !== null || readJoinPrompt(text)) state = 'not-joined';

    return {
      at: Date.now(),
      url: location.href,
      position: place ? place.position : null,
      total: place ? place.total : null,
      waiting,
      state
    };
  }
  globalThis.__queueRefreshReadSample = readSample;

  /**
   * Mirror the newest reading into storage for the popup. A missing value
   * leaves the previous one alone, so a blank render never overwrites a good
   * reading with nothing.
   */
  function publish(sample) {
    const patch = { queueSampleAt: sample.at, queueState: sample.state };
    if (sample.position !== null) {
      patch.queuePosition = sample.position;
      patch.queueTotal = sample.total;
    }
    if (sample.waiting !== null) patch.queueCount = sample.waiting;
    if (sample.position !== null || sample.waiting !== null) {
      patch.queueCountAt = sample.at;
    }
    chrome.storage.local.set(patch);
  }

  /** Read the page now and push it to the popup. Used when no session runs. */
  function sampleNow() {
    const sample = readSample();
    publish(sample);
    return sample;
  }

  const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  async function tick() {
    const {
      logActive,
      logLastShotAt = 0,
      logExitStreak = 0
    } = await chrome.storage.local.get(['logActive', 'logLastShotAt', 'logExitStreak']);
    if (!logActive) return stop();

    const sample = readSample();
    publish(sample);

    // Logged before any decision to stop: the row that shows the queue run
    // ending is the most interesting one in the file.
    await ask({ type: 'log-sample', sample });

    // Checked on every tick rather than kept on its own timer, so a page
    // reload cannot double-fire it or reset the screenshot clock.
    if (Date.now() - logLastShotAt >= SHOT_INTERVAL_MS) {
      await ask({ type: 'log-shot' });
    }

    const reason = exitReason(sample.state);
    if (!reason) {
      // The streak lives in storage because a reload would otherwise reset it
      // and a page that reloads often could never reach the threshold.
      if (logExitStreak) await chrome.storage.local.set({ logExitStreak: 0 });
      return;
    }

    const streak = logExitStreak + 1;
    await chrome.storage.local.set({ logExitStreak: streak });
    if (streak >= EXIT_CONFIRMATIONS) await finish(reason);
  }

  function run() {
    if (timer) return;
    timer = setInterval(tick, LOG_INTERVAL_MS);
    tick(); // A baseline row and screenshot straight away.
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  /**
   * Begins a session, or picks up the one already running.
   *
   * The callers are the moments we find ourselves in the queue, and several of
   * them repeat: the in-queue guard runs on every page load. Starting a fresh
   * session there would mint a new folder and throw away the rows collected so
   * far, so an active session is joined rather than replaced.
   */
  async function start() {
    const { logActive } = await chrome.storage.local.get('logActive');
    if (logActive) return run();

    await chrome.storage.local.set({ logExitStreak: 0 });
    await ask({ type: 'log-start', url: location.href });
    run();
  }

  async function finish(reason) {
    stop();
    await ask({ type: 'log-stop', reason });
  }

  // Resume after the join loop's reload, without starting a fresh session.
  chrome.storage.local.get('logActive').then(({ logActive }) => {
    if (logActive) run();
  });

  globalThis.__queueRefreshLogger = { start, stop: finish, readSample, sampleNow };
})();
