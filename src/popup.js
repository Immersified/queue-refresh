const statusEl = document.getElementById('status');
const queueEl = document.getElementById('queue');
const logEl = document.getElementById('log');

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

function renderLog({ logActive, logStatus, logSession }) {
  if (!logActive) {
    logEl.textContent = logStatus || 'Not logging.';
    return;
  }
  logEl.textContent = `${logStatus || 'Logging…'}\nFolder: queue-refresh/${logSession}/`;
}

async function send(type, { quiet = false } = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
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

const KEYS = [
  'status',
  'queueCount',
  'queueCountAt',
  'queuePosition',
  'queueTotal',
  'queueState',
  'logActive',
  'logStatus',
  'logSession'
];

function refresh() {
  chrome.storage.local.get(KEYS).then((stored) => {
    render(stored.status);
    renderQueue(stored);
    renderLog(stored);
  });
}

refresh();
chrome.storage.onChanged.addListener(refresh);

// Ask the page for a reading taken now, rather than trusting what is stored.
send('read-count', { quiet: true });
