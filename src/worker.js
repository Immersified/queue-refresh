/**
 * The file writer. Only an extension page or worker can reach chrome.downloads
 * and chrome.tabs.captureVisibleTab, so the content script sends samples here.
 *
 * Everything lands under the browser's Downloads folder:
 *   Downloads/queue-refresh/<session>/log.csv
 *   Downloads/queue-refresh/<session>/shot-0001_191632.png
 *
 * An extension cannot write anywhere else without a native messaging host.
 *
 * The worker is killed whenever it goes idle, so no state is kept in memory:
 * every handler reads and writes chrome.storage.local.
 */
importScripts('/src/csv.js', '/src/config.js', '/src/telegram.js', '/src/watchdog.js');

const { toCsv, sessionFolder } = globalThis.__queueRefreshCsv;
const { formatUpdate } = globalThis.__queueRefreshTelegram;
const { shouldRevive } = globalThis.__queueRefreshWatchdog;

// null when .env carries no token, which is how Telegram stays optional.
const TELEGRAM = (globalThis.QUEUE_REFRESH_CONFIG || {}).telegram || null;

const ROOT = 'queue-refresh';

function toDataUrl(text, mime) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

function save(url, filename) {
  // overwrite so the CSV is replaced in place rather than piling up as
  // log (1).csv, log (2).csv ... Screenshots get unique names instead.
  return chrome.downloads.download({ url, filename, conflictAction: 'overwrite' });
}

function setStatus(text) {
  console.log('[Queue Refresh]', text);
  return chrome.storage.local.set({ logStatus: text });
}

// Its own key, not logStatus: a screenshot failure has to outlive the CSV
// tick that lands a second later, or it is invisible.
function setShotStatus(text) {
  console.log('[Queue Refresh] screenshot:', text);
  return chrome.storage.local.set({ logShotStatus: text });
}

async function startSession(url) {
  const folder = sessionFolder(url, new Date());
  await chrome.storage.local.set({
    logActive: true,
    logSession: folder,
    logRows: [],
    logShots: 0,
    logStartedAt: Date.now(),
    logLastShotAt: 0,
    logShotStatus: 'No screenshot yet.',
    telegramAt: 0,
    telegramPosition: null
  });
  await setStatus(`Logging to ${ROOT}/${folder}/`);
  // Worth a buzz: it means the join landed.
  await notify(`Queue Refresh\nIn the queue. Logging to ${folder}`, { silent: false });
  return folder;
}

async function writeCsv() {
  const { logRows = [], logSession } = await chrome.storage.local.get([
    'logRows',
    'logSession'
  ]);
  if (!logSession) return;
  await save(toDataUrl(toCsv(logRows), 'text/csv'), `${ROOT}/${logSession}/log.csv`);
}

async function addSample(sample) {
  const store = await chrome.storage.local.get([
    'logRows',
    'logSession',
    'logStartedAt'
  ]);
  if (!store.logSession) return;

  const rows = store.logRows || [];
  rows.push({
    timestamp: new Date(sample.at).toISOString(),
    elapsed_seconds: Math.round((sample.at - store.logStartedAt) / 1000),
    position: sample.position,
    total: sample.total,
    waiting: sample.waiting,
    state: sample.state,
    url: sample.url
  });

  await chrome.storage.local.set({ logRows: rows });
  await writeCsv();
  await maybeNotify(sample, store.logStartedAt);

  const where = sample.position !== null ? `position ${sample.position}` : sample.state;
  await setStatus(`${rows.length} rows logged, latest: ${where}.`);
}

/**
 * JPEG rather than PNG. The image travels to chrome.downloads as a data: URL,
 * and a full-width PNG base64s into megabytes, which downloads rejects. At
 * quality 85 the position line is still perfectly readable.
 *
 * @param {boolean} scheduled false for a manual test shot, which must not
 *   reset the interval or the next real capture slips by a full period.
 */
async function takeShot(tabId, { scheduled = true } = {}) {
  const store = await chrome.storage.local.get(['logSession', 'logShots']);
  if (!store.logSession) {
    return setShotStatus('No session running. Press Start or Log only first.');
  }

  // Claimed before the capture so a failure cannot spin on every tick.
  const count = (store.logShots || 0) + 1;
  const patch = { logShots: count };
  if (scheduled) patch.logLastShotAt = Date.now();
  await chrome.storage.local.set(patch);

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      throw new Error('the queue tab is not the visible tab in its window');
    }

    const image = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 85
    });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = `shot-${String(count).padStart(4, '0')}_${stamp}.jpg`;

    await save(image, `${ROOT}/${store.logSession}/${name}`);
    await setShotStatus(`${count} saved, latest ${name}`);
  } catch (error) {
    // Hand the number back so a failed attempt does not burn a slot, and keep
    // the reason on its own key where the next CSV row cannot erase it.
    await chrome.storage.local.set({ logShots: count - 1 });
    await setShotStatus(`FAILED: ${error.message}`);
  }
}

// Reaching the front and letting the offer lapse is a different outcome from
// simply not being in the queue, and the difference matters to the formula.
const ENDINGS = {
  'offer-expired': 'Task offer expired. You reached the front.',
  'not-in-queue': 'No longer in the queue.'
};

async function stopSession(reason) {
  await writeCsv();
  const { logRows = [], logSession } = await chrome.storage.local.get([
    'logRows',
    'logSession'
  ]);
  await chrome.storage.local.set({ logActive: false, logExitStreak: 0 });

  const why = ENDINGS[reason] || 'Stopped by hand.';
  await setStatus(`${why} ${logRows.length} rows in ${ROOT}/${logSession}/`);
  await notify(
    `Queue Refresh\n${why}\nLogging stopped, ${logRows.length} rows saved.`,
    { silent: false }
  );
}

// ------------------------------------------------------------------ telegram

/**
 * Fire and forget. A phone notification is never worth breaking a night of
 * logging over, so every failure is caught and parked in the popup instead.
 *
 * @param {boolean} silent routine position updates arrive without a buzz;
 *   joining, stopping and failing are worth waking the phone for.
 */
async function notify(text, { silent = true } = {}) {
  if (!TELEGRAM) return;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM.token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM.chatId,
          text,
          disable_notification: silent
        })
      }
    );

    if (!response.ok) {
      // Telegram explains itself well; pass its own words through.
      const body = await response.json().catch(() => ({}));
      throw new Error(body.description || `HTTP ${response.status}`);
    }
    await chrome.storage.local.set({ logTelegramStatus: `sent ${new Date().toLocaleTimeString()}` });
  } catch (error) {
    await chrome.storage.local.set({ logTelegramStatus: `FAILED: ${error.message}` });
  }
}

/** Rides the CSV tick, but on its own interval so the phone is not spammed. */
async function maybeNotify(sample, startedAt) {
  if (!TELEGRAM) return;

  const store = await chrome.storage.local.get(['telegramAt', 'telegramPosition']);
  const last = store.telegramAt || 0;
  if (Date.now() - last < TELEGRAM.intervalMs) return;

  await chrome.storage.local.set({
    telegramAt: Date.now(),
    telegramPosition: sample.position
  });
  await notify(formatUpdate(sample, store.telegramPosition ?? null, Date.now() - startedAt));
}

// ------------------------------------------------------------------ watchdog

const WATCHDOG = 'queue-refresh:watchdog';

// Three minutes of silence from a page that beats every thirty seconds.
const STALE_MS = 180000;
const REVIVE_COOLDOWN_MS = 180000;

const siteMatches = () => chrome.runtime.getManifest().content_scripts[0].matches;

/**
 * Puts the queue page back in front, loaded and visible.
 *
 * Bringing the tab forward is not cosmetic: a screenshot can only capture the
 * visible tab, and a background tab has its timers throttled to once a minute.
 */
async function revive(reason) {
  const { lastSeenUrl } = await chrome.storage.local.get('lastSeenUrl');
  await chrome.storage.local.set({ watchdogRevivedAt: Date.now() });

  const tabs = await chrome.tabs.query({ url: siteMatches() });

  if (!tabs.length) {
    if (!lastSeenUrl) {
      return setWatchdogStatus(`${reason}, but no queue tab and no URL to reopen.`);
    }
    await chrome.tabs.create({ url: lastSeenUrl, active: true });
    return setWatchdogStatus(`${reason}. Reopened ${lastSeenUrl}`);
  }

  const [tab] = tabs;
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.tabs.reload(tab.id);
  await setWatchdogStatus(`${reason}. Reloaded and brought to the front.`);
}

function setWatchdogStatus(text) {
  console.log('[Queue Refresh] watchdog:', text);
  return chrome.storage.local.set({ watchdogStatus: text });
}

async function checkAlive() {
  const store = await chrome.storage.local.get([
    'logActive',
    'scheduleArmed',
    'pageHeartbeatAt',
    'watchdogRevivedAt'
  ]);

  // Nothing is depending on the page, so a quiet one is not a problem.
  if (!store.logActive && !store.scheduleArmed) return;

  const due = shouldRevive({
    heartbeatAt: store.pageHeartbeatAt,
    revivedAt: store.watchdogRevivedAt,
    now: Date.now(),
    staleMs: STALE_MS,
    cooldownMs: REVIVE_COOLDOWN_MS
  });
  if (!due) return;

  const quiet = Math.round((Date.now() - (store.pageHeartbeatAt || 0)) / 1000);
  await revive(`Page silent for ${quiet}s`);
  await notify(`Queue Refresh\nPage had stopped responding. Reloaded it.`, { silent: false });
}

// Alarms keep firing when page timers do not, which is the whole point of
// putting the watchdog here rather than in the page it is watching.
chrome.alarms.create(WATCHDOG, { periodInMinutes: 1 });

// ------------------------------------------------------------------ schedule

const ALARM = 'queue-refresh:schedule';

/**
 * The backstop. The page's own timer is the accurate trigger, but Edge
 * throttles timers in a background tab to once a minute, so an alarm covers
 * the case where the queue tab is not the one in front.
 */
async function fireAlarm() {
  const { scheduleArmed } = await chrome.storage.local.get('scheduleArmed');
  if (!scheduleArmed) return;

  // The site pattern is already in the manifest; no need to repeat it here.
  const [matches] = chrome.runtime.getManifest().content_scripts.map((s) => s.matches);
  const tabs = await chrome.tabs.query({ url: matches });

  if (!tabs.length) {
    return setStatus('Schedule fired, but no queue tab is open. Nothing to click.');
  }

  // The content script does the deciding; it is the one that can see the page.
  for (const tab of tabs) {
    await chrome.tabs.sendMessage(tab.id, { type: 'schedule-fire' }).catch(() => null);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) fireAlarm();
  if (alarm.name === WATCHDOG) checkAlive();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const done = (value) => sendResponse(value ?? null);

  if (message.type === 'log-start') startSession(message.url).then(done);
  else if (message.type === 'log-sample') addSample(message.sample).then(done);
  else if (message.type === 'log-shot') takeShot(sender.tab.id).then(done);
  else if (message.type === 'test-shot') {
    takeShot(sender.tab.id, { scheduled: false }).then(done);
  }
  else if (message.type === 'log-stop') stopSession(message.reason).then(done);
  else if (message.type === 'schedule-set') {
    chrome.alarms.create(ALARM, { when: message.at });
    done();
  } else if (message.type === 'schedule-clear') {
    chrome.alarms.clear(ALARM).then(done);
  }
  else return false;

  return true; // The handlers are async; keep the channel open.
});
