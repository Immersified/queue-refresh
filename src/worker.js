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
importScripts('/src/csv.js');

const { toCsv, sessionFolder } = globalThis.__queueRefreshCsv;

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
    logShotStatus: 'No screenshot yet.'
  });
  await setStatus(`Logging to ${ROOT}/${folder}/`);
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

async function stopSession() {
  await writeCsv();
  const { logRows = [], logSession } = await chrome.storage.local.get([
    'logRows',
    'logSession'
  ]);
  await chrome.storage.local.set({ logActive: false });
  await setStatus(`Session finished: ${logRows.length} rows in ${ROOT}/${logSession}/`);
}

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
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const done = (value) => sendResponse(value ?? null);

  if (message.type === 'log-start') startSession(message.url).then(done);
  else if (message.type === 'log-sample') addSample(message.sample).then(done);
  else if (message.type === 'log-shot') takeShot(sender.tab.id).then(done);
  else if (message.type === 'test-shot') {
    takeShot(sender.tab.id, { scheduled: false }).then(done);
  }
  else if (message.type === 'log-stop') stopSession().then(done);
  else if (message.type === 'schedule-set') {
    chrome.alarms.create(ALARM, { when: message.at });
    done();
  } else if (message.type === 'schedule-clear') {
    chrome.alarms.clear(ALARM).then(done);
  }
  else return false;

  return true; // The handlers are async; keep the channel open.
});
