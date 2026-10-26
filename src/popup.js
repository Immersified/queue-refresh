const statusEl = document.getElementById('status');
const tabEl = document.getElementById('tab');
const queueEl = document.getElementById('queue');
const logEl = document.getElementById('log');
const shotsEl = document.getElementById('shots');
const telegramEl = document.getElementById('telegram');
const whenEl = document.getElementById('when');
const countdownEl = document.getElementById('countdown');
const autoStartEl = document.getElementById('auto-start');
const hintEl = document.querySelector('#launch .hint');
const challengeEl = document.getElementById('challenge');
const { formatCountdown, nextCheckAt } = globalThis.__queueRefreshSchedule;
const { statusKey, readingKey } = globalThis.__queueRefreshCampaign;

// The campaign of the tab you are looking at, as its page reports it. Null
// until the page answers, and on a page that is not a campaign.
let tabCampaign = null;

/**
 * This tab's own line when it has one. Otherwise the shared line, which is
 * whichever tab spoke last, so it says whose it is.
 */
function render(stored) {
  const own = tabCampaign && stored[statusKey(tabCampaign)];
  if (own) {
    statusEl.textContent = own.text;
    tabEl.textContent = `This tab: ${tabCampaign} · join loop ${own.running ? 'running' : 'stopped'}`;
    return;
  }
  if (tabCampaign) tabEl.textContent = `This tab: ${tabCampaign}`;

  const { status, statusCampaign } = stored;
  const text = status || 'Idle.';
  statusEl.textContent = statusCampaign && status ? `${statusCampaign}: ${text}` : text;
}

/** This tab's own reading, in the shape renderQueue already takes. */
function queueFields(stored) {
  const reading = tabCampaign && stored[readingKey(tabCampaign)];
  if (!reading) return stored;
  return {
    queueState: reading.state,
    queuePosition: reading.position,
    queueTotal: reading.total,
    queueCount: reading.waiting,
    queueCountAt: reading.at
  };
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
  } else if (queueState === 'offer-expired') {
    body = [bold('Task offer expired'), '. You are out of the queue.'];
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

function renderLog({ logActive, logStatus, logSession, logShotStatus, logCampaign }) {
  if (!logActive) {
    logEl.textContent = logStatus || 'Not logging.';
  } else {
    // One session for all tabs, so it names the campaign it belongs to.
    const which = logCampaign ? `Logging ${logCampaign}\n` : '';
    logEl.textContent = `${which}${logStatus || 'Logging…'}\nFolder: queue-refresh/${logSession}/`;
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

function describeEstimate(estimate, at) {
  if (!estimate) return '';
  const range = estimate.min === estimate.max ? estimate.max : `${estimate.min}–${estimate.max}`;
  return `Estimate ${range} min (read ${describeAge(Date.now() - at)}).`;
}

function renderSchedule(stored) {
  const { scheduleArmed, scheduleReadyAt, scheduleJoinAt, scheduleStatus } = stored;
  const armed = Boolean(scheduleArmed && scheduleReadyAt);
  countdownEl.classList.toggle('armed', armed);

  if (!armed) {
    countdownEl.textContent = scheduleStatus || 'Not armed.';
    return;
  }

  const now = Date.now();
  const lines = [`Ready at ${new Date(scheduleReadyAt).toLocaleString()}`];
  if (stored.scheduleCampaign) lines.push(`For ${stored.scheduleCampaign}`);
  if (scheduleJoinAt) {
    lines.push(`Joining in ${formatCountdown(scheduleJoinAt - now)} ` +
      `(${new Date(scheduleJoinAt).toLocaleTimeString()})`);
  }
  const check = nextCheckAt({
    readyAt: scheduleReadyAt,
    lastCheckAt: stored.scheduleLastCheckAt
  });
  lines.push(`Next estimate check in ${formatCountdown(check - now)}`);

  const estimate = describeEstimate(stored.scheduleEstimate, stored.scheduleEstimateAt);
  if (estimate) lines.push(estimate);
  if (scheduleStatus) lines.push(scheduleStatus);
  countdownEl.textContent = lines.join('\n');
}

function renderLaunch({ autoStart, autoStartPending }) {
  // Not touched while it has focus, or a storage tick could undo a click that
  // has not been written yet.
  if (document.activeElement !== autoStartEl) autoStartEl.checked = Boolean(autoStart);

  hintEl.textContent = autoStartPending
    ? 'Browser started. Waiting for the queue tab to wake up…'
    : 'Wakes the pinned queue tab while an arm is ahead. The arm decides when to join.';
}

// Only ever shown when it happened recently: a challenge from three nights ago
// is history, not a thing to act on.
const CHALLENGE_SHOW_MS = 3600000;

function renderChallenge({ challengeAt }) {
  const recent = challengeAt && Date.now() - challengeAt < CHALLENGE_SHOW_MS;
  challengeEl.textContent = recent
    ? `Cloudflare asked for verification ${describeAge(Date.now() - challengeAt)}. Clear it by hand.`
    : '';
}

async function send(type, extra = {}, { quiet = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const answer = await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    if (answer && answer.campaign && answer.campaign !== tabCampaign) {
      tabCampaign = answer.campaign;
      refresh();
    }
    return true;
  } catch (e) {
    // Only a button press earns an error; the reading on open stays silent.
    // A campaign tab that was open before the extension was reloaded lands
    // here too, and that is the usual case, so it is named first.
    if (!quiet) {
      statusEl.textContent =
        'This tab is not answering. Reload it (F5) and try again. Still nothing: ' +
        'run node build.js and reload the extension. Not a campaign page: it is not covered.';
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

// Storage, not .env: this is a setting you turn on once and leave, and putting
// it in .env would mean node build.js and an extension reload to change it.
// Unticking also clears a pending start, so it cannot fire after you said no.
autoStartEl.addEventListener('change', () => {
  const on = autoStartEl.checked;
  const patch = { autoStart: on };
  if (!on) patch.autoStartPending = false;
  chrome.storage.local.set(patch);
});

const KEYS = [
  'status',
  'statusCampaign',
  'scheduleCampaign',
  'queueCount',
  'queueCountAt',
  'queuePosition',
  'queueTotal',
  'queueState',
  'logActive',
  'logStatus',
  'logSession',
  'logCampaign',
  'logShotStatus',
  'logTelegramStatus',
  'scheduleArmed',
  'scheduleReadyAt',
  'scheduleJoinAt',
  'scheduleLastCheckAt',
  'scheduleEstimate',
  'scheduleEstimateAt',
  'scheduleStatus',
  'scheduleInput',
  'autoStart',
  'autoStartPending',
  'challengeAt'
];

let latest = {};

function refresh() {
  const keys = tabCampaign ? [...KEYS, statusKey(tabCampaign), readingKey(tabCampaign)] : KEYS;
  chrome.storage.local.get(keys).then((stored) => {
    latest = stored;
    render(stored);
    renderQueue(queueFields(stored));
    renderLog(stored);
    renderTelegram(stored);
    renderSchedule(stored);
    renderLaunch(stored);
    renderChallenge(stored);
    if (stored.scheduleInput && !whenEl.value) whenEl.value = stored.scheduleInput;
  });
}

refresh();
chrome.storage.onChanged.addListener(refresh);

// The buttons act on the tab you are looking at. The title stands in until
// the page answers with its campaign.
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab && tab.title && !tabCampaign) tabEl.textContent = `This tab: ${tab.title}`;
});

// The countdown has to move on its own; storage only changes when armed state does.
setInterval(() => renderSchedule(latest), 1000);

// Ask the page for a reading taken now, rather than trusting what is stored.
send('read-count', {}, { quiet: true });
