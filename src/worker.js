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

async function startSession(url) {
  const folder = sessionFolder(url, new Date());
  await chrome.storage.local.set({
    logActive: true,
    logSession: folder,
    logRows: [],
    logShots: 0,
    logStartedAt: Date.now(),
    logLastShotAt: 0
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

async function takeShot(tabId) {
  const store = await chrome.storage.local.get(['logSession', 'logShots']);
  if (!store.logSession) return;

  // Claimed before the capture so a failure cannot spin on every tick.
  const count = (store.logShots || 0) + 1;
  await chrome.storage.local.set({ logShots: count, logLastShotAt: Date.now() });

  try {
    const tab = await chrome.tabs.get(tabId);
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const name = `shot-${String(count).padStart(4, '0')}_${stamp}.png`;

    await save(image, `${ROOT}/${store.logSession}/${name}`);
  } catch (error) {
    // The tab must be the visible one in its window for a capture to work.
    // Say so loudly rather than discovering a night of blank folders later.
    await setStatus(`Screenshot failed: ${error.message}`);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const done = (value) => sendResponse(value ?? null);

  if (message.type === 'log-start') startSession(message.url).then(done);
  else if (message.type === 'log-sample') addSample(message.sample).then(done);
  else if (message.type === 'log-shot') takeShot(sender.tab.id).then(done);
  else if (message.type === 'log-stop') stopSession().then(done);
  else return false;

  return true; // The handlers are async; keep the channel open.
});
