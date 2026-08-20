const statusEl = document.getElementById('status');

function render(text) {
  statusEl.textContent = text || 'Idle.';
}

async function send(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
  } catch (e) {
    render('This page is not covered by the extension. Check "matches" in manifest.json.');
  }
}

document.getElementById('start').addEventListener('click', () => send('start'));
document.getElementById('stop').addEventListener('click', () => send('stop'));

chrome.storage.local.get('status').then(({ status }) => render(status));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.status) render(changes.status.newValue);
});
