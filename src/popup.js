const statusEl = document.getElementById('status');
const queueEl = document.getElementById('queue');

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
function renderQueue({ queueCount, queueCountAt }) {
  if (typeof queueCount !== 'number') {
    queueEl.textContent = 'Queue length: not shown on this page.';
    return;
  }
  const people = queueCount === 1 ? 'expert' : 'experts';
  const count = document.createElement('b');
  count.textContent = String(queueCount);

  queueEl.replaceChildren('Queue length: ', count, ` ${people} waiting`);

  if (queueCountAt) {
    const age = document.createElement('span');
    age.className = 'age';
    age.textContent = ` (read ${describeAge(Date.now() - queueCountAt)})`;
    queueEl.append(age);
  }
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

chrome.storage.local.get(['status', 'queueCount', 'queueCountAt']).then((stored) => {
  render(stored.status);
  renderQueue(stored);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.status) render(changes.status.newValue);
  if (changes.queueCount || changes.queueCountAt) {
    chrome.storage.local.get(['queueCount', 'queueCountAt']).then(renderQueue);
  }
});

// Ask the page for a reading taken now, rather than trusting what is stored.
send('read-count', { quiet: true });
