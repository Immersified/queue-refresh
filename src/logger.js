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

  // When this page loaded, and its first real reading. A later reading that
  // differs without a reload in between is the evidence that the page updates
  // by itself; one that never differs says the numbers need a refresh.
  const loadedAt = Date.now();
  let firstReading = null;
  let firstCampaign = null;

  /** Everything the page can tell us right now. */
  function readSample() {
    const text = document.body ? document.body.innerText : '';
    const place = globalThis.__queueRefreshReadPosition(text);
    const waiting = globalThis.__queueRefreshReadCount(text);
    const estimate = globalThis.__queueRefreshReadEstimate(text);

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
      estimate,
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

    // The fields above are whichever tab read last. Each campaign also keeps
    // its own reading, but only a real one: a half-rendered page says nothing.
    const reading = campaignReading(sample);
    if (reading) patch[globalThis.__queueRefreshCampaign.readingKey(reading.name)] = reading.record;
    chrome.storage.local.set(patch);
    return reading && reading.record;
  }

  /** This campaign's reading, with what the page said when it first loaded. */
  function campaignReading(sample) {
    const campaignNow = globalThis.__queueRefreshCurrentCampaign;
    const name = campaignNow && campaignNow();
    if (!name || sample.state === 'unknown') return null;

    const { position, total, waiting, estimate, state, at } = sample;
    // A campaign switched inside the tab, without a reload, starts over.
    if (!firstReading || firstCampaign !== name) {
      firstReading = { position, waiting, estimate, at };
      firstCampaign = name;
    }
    return {
      name,
      record: { position, total, waiting, estimate, state, at, loadedAt, first: firstReading }
    };
  }

  /**
   * Read the page now and push it to the popup. Used when no session runs.
   * The sample comes back with this campaign's stored reading attached, so a
   * caller can answer with it without waiting on storage.
   */
  function sampleNow() {
    const sample = readSample();
    return { ...sample, campaignReading: publish(sample) };
  }

  const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  async function tick() {
    const {
      logActive,
      logCampaign,
      logLastShotAt = 0,
      logExitStreak = 0
    } = await chrome.storage.local.get([
      'logActive',
      'logCampaign',
      'logLastShotAt',
      'logExitStreak'
    ]);
    if (!logActive) return stop();

    const sample = readSample();
    publish(sample);

    // Every campaign tab runs this clock, but the session belongs to one. The
    // others would log their own rows into it, double the screenshots past
    // Chrome's per-second limit, and end it the moment they read "not joined".
    if (!isSessionTab(logCampaign)) return;

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

  /** Older sessions stored the tab title rather than the campaign name. */
  function isSessionTab(logCampaign) {
    if (!logCampaign) return true;
    const campaignNow = globalThis.__queueRefreshCurrentCampaign;
    return (campaignNow && campaignNow()) === logCampaign || document.title === logCampaign;
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
    const campaignNow = globalThis.__queueRefreshCurrentCampaign;
    await ask({ type: 'log-start', url: location.href, campaign: campaignNow && campaignNow() });
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
