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
 */
(function () {
  const settings = globalThis.QUEUE_REFRESH_CONFIG;
  if (!settings) return; // controller.js already throws a clear error for this.

  const LOG_INTERVAL_MS = settings.logIntervalMs;
  const SHOT_INTERVAL_MS = settings.screenshotIntervalMs;

  let timer = null;

  /** Everything the page can tell us right now. */
  function readSample() {
    const text = document.body ? document.body.innerText : '';
    const place = globalThis.__queueRefreshReadPosition(text);
    const waiting = globalThis.__queueRefreshReadCount(text);

    let state = 'unknown';
    if (place) state = 'in-queue';
    else if (waiting !== null) state = 'not-joined';

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
    const { logActive, logLastShotAt = 0 } = await chrome.storage.local.get([
      'logActive',
      'logLastShotAt'
    ]);
    if (!logActive) return stop();

    const sample = readSample();
    publish(sample);
    await ask({ type: 'log-sample', sample });

    // Checked on every tick rather than kept on its own timer, so a page
    // reload cannot double-fire it or reset the screenshot clock.
    if (Date.now() - logLastShotAt >= SHOT_INTERVAL_MS) {
      await ask({ type: 'log-shot' });
    }
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

  async function start() {
    await ask({ type: 'log-start', url: location.href });
    run();
  }

  async function finish() {
    stop();
    await ask({ type: 'log-stop' });
  }

  // Resume after the join loop's reload, without starting a fresh session.
  chrome.storage.local.get('logActive').then(({ logActive }) => {
    if (logActive) run();
  });

  globalThis.__queueRefreshLogger = { start, stop: finish, readSample, sampleNow };
})();
