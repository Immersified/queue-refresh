const statusEl = document.getElementById('status');
const queueEl = document.getElementById('queue');
const logEl = document.getElementById('log');
const shotsEl = document.getElementById('shots');
const telegramEl = document.getElementById('telegram');
const whenEl = document.getElementById('when');
const countdownEl = document.getElementById('countdown');
const { formatCountdown } = globalThis.__queueRefreshSchedule;

function render(text) {
  statusEl.textContent = text || 'Idle.';
}

function describeAge(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

// The reading is shown with its age, so a value left over from an earlier page
// is never mistaken for what the queue says right now.
function renderQueue(stored) {
  const { queuePosition, queueTotal, queueCount, queueCountAt, queueState } = stored;

  let body = null;
  if (queueState === 'in-queue' && typeof queuePosition === 'number') {
    body = [`Position `, bold(String(queuePosition)), ` of ${queueTotal}`];
  } else if (typeof queueCount === 'number') {
    const people = queueCount === 1 ? 'expert' : 'experts';
    body = ['Queue length: ', bold(String(queueCount)), ` ${people} waiting`];
  }

  if (!body) {
    queueEl.textContent = 'Queue: not shown on this page.';
    return;
  }

  queueEl.replaceChildren(...body);

  if (queueCountAt) {
    const age = document.createElement('span');
    age.className = 'age';
    age.textContent = ` (read ${describeAge(Date.now() - queueCountAt)})`;
    queueEl.append(age);
  }
}

function bold(text) {
  const el = document.createElement('b');
  el.textContent = text;
  return el;
}

function renderLog({ logActive, logStatus, logSession, logShotStatus }) {
  if (!logActive) {
    logEl.textContent = logStatus || 'Not logging.';
  } else {
    logEl.textContent = `${logStatus || 'Logging…'}\nFolder: queue-refresh/${logSession}/`;
  }

  // Its own line, because a screenshot failure is the one thing that goes
  // unnoticed until the folder turns out to be empty in the morning.
  const shots = logShotStatus || '';
  shotsEl.textContent = shots ? `Screenshots: ${shots}` : '';
  shotsEl.classList.toggle('failed', shots.startsWith('FAILED'));
}

function renderTelegram({ logTelegramStatus }) {
  const text = logTelegramStatus || '';
  telegramEl.textContent = text ? `Telegram: ${text}` : '';
  telegramEl.classList.toggle('failed', text.startsWith('FAILED'));
}

function renderSchedule({ scheduleArmed, scheduleAt, scheduleStatus }) {
  const armed = Boolean(scheduleArmed && scheduleAt);
  countdownEl.classList.toggle('armed', armed);

  if (!armed) {
    countdownEl.textContent = scheduleStatus || 'Not armed.';
    return;
  }
  const left = scheduleAt - Date.now();
  countdownEl.textContent =
    `Joining in ${formatCountdown(left)} (${new Date(scheduleAt).toLocaleString()})`;
}

async function send(type, extra = {}, { quiet = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    return true;
  } catch (e) {
    // Only a button press earns an error; the reading on open stays silent.
    if (!quiet) {
      render('This page is not covered by the extension. Check "matches" in manifest.json.');
    }
    return false;
  }
}

document.getElementById('start').addEventListener('click', () => send('start'));
document.getElementById('stop').addEventListener('click', () => send('stop'));
document.getElementById('log-only').addEventListener('click', () => send('log-only'));
document.getElementById('stop-logging').addEventListener('click', () => send('stop-logging'));
document.getElementById('test-shot').addEventListener('click', () => send('test-shot'));
document.getElementById('arm').addEventListener('click', () => send('arm', { value: whenEl.value }));
document.getElementById('disarm').addEventListener('click', () => send('disarm'));

// Typing is kept even if the popup closes before you press Arm.
whenEl.addEventListener('change', () => chrome.storage.local.set({ scheduleInput: whenEl.value }));

const KEYS = [
  'status',
  'queueCount',
  'queueCountAt',
  'queuePosition',
  'queueTotal',
  'queueState',
  'logActive',
  'logStatus',
  'logSession',
  'logShotStatus',
  'logTelegramStatus',
  'scheduleArmed',
  'scheduleAt',
  'scheduleStatus',
  'scheduleInput'
];

let latest = {};

function refresh() {
  chrome.storage.local.get(KEYS).then((stored) => {
    latest = stored;
    render(stored.status);
    renderQueue(stored);
    renderLog(stored);
    renderTelegram(stored);
    renderSchedule(stored);
    if (stored.scheduleInput && !whenEl.value) whenEl.value = stored.scheduleInput;
  });
}

refresh();
chrome.storage.onChanged.addListener(refresh);

// The countdown has to move on its own; storage only changes when armed state does.
setInterval(() => renderSchedule(latest), 1000);

// Ask the page for a reading taken now, rather than trusting what is stored.
send('read-count', {}, { quiet: true });
