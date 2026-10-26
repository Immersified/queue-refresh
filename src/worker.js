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
importScripts(
  '/src/csv.js',
  '/src/config.js',
  '/src/telegram.js',
  '/src/watchdog.js',
  '/src/schedule.js',
  '/src/campaign.js'
);

const { toCsv, sessionFolder } = globalThis.__queueRefreshCsv;
const {
  formatUpdate,
  formatCheck,
  parseCommand,
  armValue,
  splitArgs,
  formatStatus,
  HELP
} = globalThis.__queueRefreshTelegram;
const { shouldRevive } = globalThis.__queueRefreshWatchdog;
const { launchDue } = globalThis.__queueRefreshSchedule;
const { pickTabs, shortName } = globalThis.__queueRefreshCampaign;

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

async function startSession(url, campaign) {
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
  await notify(`Queue Refresh\nIn the queue. Logging to ${folder}`, { silent: false, campaign });
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

async function addSample(sample, campaign) {
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
  await maybeNotify(sample, store.logStartedAt, campaign);

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
/**
 * One retry, because "image readback failed" is what Chrome says when there
 * was nothing composited to read: a page mid-navigation, or a tab that has
 * only just come to the front. A second costs nothing and usually lands.
 */
async function capture(windowId) {
  const shoot = () =>
    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 85 });

  try {
    return await shoot();
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    return shoot();
  }
}

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

    const image = await capture(tab.windowId);

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

async function stopSession(reason, campaign) {
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
    { silent: false, campaign }
  );
}

// ------------------------------------------------------------------ telegram

/**
 * Fire and forget. A phone notification is never worth breaking a night of
 * logging over, so every failure is caught and parked in the popup instead.
 *
 * @param {boolean} silent routine position updates arrive without a buzz;
 *   joining, stopping and failing are worth waking the phone for.
 * @param {string} campaign goes in the heading, so with two campaigns open
 *   every message says which one it is about.
 */
async function notify(text, { silent = true, campaign = null } = {}) {
  if (!TELEGRAM) return;
  if (campaign) text = text.replace(/^Queue Refresh/, `Queue Refresh · ${campaign}`);

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
async function maybeNotify(sample, startedAt, campaign) {
  if (!TELEGRAM) return;

  const store = await chrome.storage.local.get(['telegramAt', 'telegramPosition']);
  const last = store.telegramAt || 0;
  if (Date.now() - last < TELEGRAM.intervalMs) return;

  await chrome.storage.local.set({
    telegramAt: Date.now(),
    telegramPosition: sample.position
  });
  await notify(formatUpdate(sample, store.telegramPosition ?? null, Date.now() - startedAt), {
    campaign
  });
}

// ------------------------------------------------------- telegram commands

const COMMAND_POLL = 'queue-refresh:telegram-commands';

const loud = (text, campaign = null) =>
  notify(`Queue Refresh\n${text}`, { silent: false, campaign });

const NO_TAB = 'No queue tab is open, or the page is not answering. Open it in the browser first.';

/**
 * The one tab a command means. With one campaign open no name is needed; with
 * two, a command without one is answered with the choices rather than guessed.
 *
 * @param {string} example how the command goes, for the "which one?" reply
 * @returns {Promise<{tab: object}|{reply: string}>}
 */
async function chooseTab(name, example) {
  const tabs = await chrome.tabs.query({ url: siteMatches() });
  if (!tabs.length) return { reply: NO_TAB };

  const picked = pickTabs(tabs, name);
  const titles = (list) => list.map((tab) => tab.title);

  if (!picked.length) {
    return { reply: `No open campaign matches "${name}". Open: ${titles(tabs).join(', ')}` };
  }
  if (picked.length > 1) {
    const choices = picked.map((tab) => {
      const others = titles(picked).filter((title) => title !== tab.title);
      return `/${example.replace('NAME', shortName(tab.title, others))}`;
    });
    return { reply: `Which campaign?\n${choices.join('\n')}` };
  }
  return { tab: picked[0] };
}

/**
 * The same thing as pressing a popup button, on that tab rather than the
 * active one. Brought to the front first: a background tab has its timers
 * throttled and cannot be screenshotted.
 *
 * @returns {Promise<object|null>} the page's answer, null when it did not answer
 */
async function pressOnTab(tab, type, extra = {}) {
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  await chrome.tabs.update(tab.id, { active: true });
  return chrome.tabs.sendMessage(tab.id, { type, ...extra }).catch(() => null);
}

async function runCommand({ command, arg }) {
  const { name, time } = splitArgs(arg);

  if (command === 'join') {
    const choice = await chooseTab(name, 'join NAME');
    if (!choice.tab) return loud(choice.reply);
    const answer = await pressOnTab(choice.tab, 'start');
    return loud(answer ? 'Joining. Pressed Start.' : NO_TAB, choice.tab.title);
  }

  if (command === 'stop') {
    const choice = await chooseTab(name, 'stop NAME');
    if (!choice.tab) return loud(choice.reply);
    const answer = await pressOnTab(choice.tab, 'stop');
    if (!answer) return loud(NO_TAB, choice.tab.title);
    // Stop leaves an arm alone, as the popup's Stop does. Say so, or a stop
    // sent at night reads as the end of everything.
    const { scheduleArmed, scheduleCampaign } = await chrome.storage.local.get([
      'scheduleArmed',
      'scheduleCampaign'
    ]);
    const armed = scheduleCampaign ? `Still armed for ${scheduleCampaign}` : 'Still armed';
    return loud(
      scheduleArmed ? `Stopped. ${armed}: disarm in the popup.` : 'Stopped.',
      choice.tab.title
    );
  }

  if (command === 'arm') {
    const value = armValue(time, Date.now());
    if (!value) return loud('Send the ready time as /arm 21:30');
    const choice = await chooseTab(name, `arm NAME ${time}`);
    if (!choice.tab) return loud(choice.reply);
    const answer = await pressOnTab(choice.tab, 'arm', { value });
    return loud(answer ? answer.schedule || 'Armed.' : NO_TAB, choice.tab.title);
  }

  if (command === 'status') {
    const tabs = await chrome.tabs.query({ url: siteMatches() });
    const store = await chrome.storage.local.get([
      'status',
      'queueState',
      'queuePosition',
      'queueTotal',
      'queueCount',
      'queueCountAt',
      'logActive',
      'scheduleArmed',
      'scheduleReadyAt',
      'scheduleJoinAt',
      'scheduleCampaign',
      'statusCampaign'
    ]);
    const open = tabs.map((tab) => tab.title);
    return notify(formatStatus(store, Date.now(), open), { silent: false });
  }

  return notify(HELP, { silent: false });
}

/**
 * Picks up anything sent to the bot since the last look.
 *
 * Short polls on an alarm rather than one long poll: the worker is killed
 * when idle, and an alarm is what reliably wakes it again.
 */
async function pollCommands() {
  if (!TELEGRAM) return;

  try {
    const { telegramOffset = 0 } = await chrome.storage.local.get('telegramOffset');
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM.token}/getUpdates` +
        `?offset=${telegramOffset}&timeout=0&allowed_updates=${encodeURIComponent('["message"]')}`
    );
    const body = await response.json().catch(() => ({}));
    if (!body.ok) throw new Error(body.description || `HTTP ${response.status}`);
    if (!body.result.length) return;

    // Claimed before acting, so a worker killed mid-command cannot run it twice.
    const last = body.result[body.result.length - 1].update_id;
    await chrome.storage.local.set({ telegramOffset: last + 1 });

    for (const update of body.result) {
      const command = parseCommand(update, TELEGRAM.chatId, Date.now());
      if (command) await runCommand(command);
    }
  } catch (error) {
    await chrome.storage.local.set({ logTelegramStatus: `FAILED reading commands: ${error.message}` });
  }
}

// Thirty seconds is the shortest alarm Chrome allows.
if (TELEGRAM) chrome.alarms.create(COMMAND_POLL, { periodInMinutes: 0.5 });

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
async function revive(reason, { allowCreate = true } = {}) {
  const { lastSeenUrl, scheduleCampaign } = await chrome.storage.local.get([
    'lastSeenUrl',
    'scheduleCampaign'
  ]);
  const tabs = await chrome.tabs.query({ url: siteMatches() });

  if (!tabs.length) {
    // Straight after a browser start the tab strip is rebuilt before the tabs
    // can be queried. Opening lastSeenUrl here would leave a second tab beside
    // the pinned one the moment it comes back, so that path says nothing and
    // waits for the next watchdog tick, by which time the tabs are there.
    if (!allowCreate) {
      return setWatchdogStatus(`${reason}, but the tabs are not back yet. Waiting.`);
    }
    if (!lastSeenUrl) {
      return setWatchdogStatus(`${reason}, but no queue tab and no URL to reopen.`);
    }
    await chrome.storage.local.set({ watchdogRevivedAt: Date.now() });
    await chrome.tabs.create({ url: lastSeenUrl, active: true });
    return setWatchdogStatus(`${reason}. Reopened ${lastSeenUrl}`);
  }

  // Set only once we are actually acting, so a tick that did nothing does not
  // spend the cooldown that the next real attempt needs.
  await chrome.storage.local.set({ watchdogRevivedAt: Date.now() });

  // With two campaigns open, the armed one is the tab that has to be awake.
  const [tab] = [...pickTabs(tabs, scheduleCampaign), ...tabs];
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
    'autoStartPending',
    'pageHeartbeatAt',
    'watchdogRevivedAt'
  ]);

  // Nothing is depending on the page, so a quiet one is not a problem. An
  // unclaimed auto-start counts: it means the browser started, the tab has not
  // woken up yet, and something has to keep trying.
  if (!store.logActive && !store.scheduleArmed && !store.autoStartPending) return;

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

// ----------------------------------------------------------------- autostart

/**
 * Edge has just started.
 *
 * The queue tab is pinned, so it comes back -- but a restored tab is an empty
 * placeholder until something activates it. That is why it has always needed a
 * click, and chrome.tabs.update({active: true}) is that click, in code. No
 * separate program and no screen coordinates: the pinned tab also carries the
 * campaign URL, so a campaign that changes needs nothing changed here.
 *
 * The first attempt usually finds no tabs at all, because the tab strip is
 * rebuilt before the tabs can be queried. The watchdog covers that: an
 * unclaimed autoStartPending keeps it awake until the tab answers.
 *
 * Only while an arm is still ahead. A browser started on any other day, by a
 * daily task or a Windows update, does nothing.
 */
async function startOnLaunch() {
  const { autoStart, scheduleArmed, scheduleReadyAt } = await chrome.storage.local.get([
    'autoStart',
    'scheduleArmed',
    'scheduleReadyAt'
  ]);
  if (!autoStart) return;

  if (!launchDue({ armed: scheduleArmed, readyAt: scheduleReadyAt, now: Date.now() })) {
    return setStatus('Browser started, but nothing is armed for an upcoming ready time.');
  }

  await chrome.storage.local.set({ autoStartPending: true });
  await setStatus('Browser started. Waking the queue tab.');
  await revive('Browser started', { allowCreate: false });
}

chrome.runtime.onStartup.addListener(startOnLaunch);

// ---------------------------------------------------------------- cloudflare

/**
 * The page is behind a Cloudflare interstitial. Nothing here can clear it, so
 * the only useful thing is to say so loudly enough to wake somebody.
 */
async function reportChallenge(tabId, signal, campaign) {
  const because = signal ? `\nSpotted by ${signal}.` : '';
  await chrome.storage.local.set({ challengeAt: Date.now(), challengeSignal: signal ?? null });
  await setStatus('Cloudflare is asking for verification. Stopped until it is cleared.');
  await notify(
    'Queue Refresh\nCloudflare is asking you to verify.\n' +
      `The run is stopped until you clear it by hand.${because}`,
    { silent: false, campaign }
  );

  // Worth trying even though it only lands when a session is already running:
  // a picture of the challenge is how you find out which kind it was without
  // having been there. takeShot parks its own reason in the popup otherwise.
  if (tabId !== undefined) await takeShot(tabId, { scheduled: false });
}

/**
 * The page came back by itself. Take the red banner down, because a warning
 * that is no longer true is worse than none: it is the one you learn to
 * ignore. Quietly -- the loud message has already been sent.
 */
async function clearChallenge(campaign) {
  const { challengeAt } = await chrome.storage.local.get('challengeAt');
  if (!challengeAt) return;

  await chrome.storage.local.set({ challengeAt: null, challengeSignal: null });
  await setStatus('Cloudflare cleared itself. The page is back.');
  await notify('Queue Refresh\nCloudflare cleared itself. Carrying on.', { campaign });
}

// ------------------------------------------------------------------ schedule

const ALARM = 'queue-refresh:schedule';

/**
 * The backstop. The page's own timer is the accurate trigger, but Edge
 * throttles timers in a background tab to once a minute, so an alarm nudges
 * the page at the first check and at the join time.
 */
async function fireAlarm() {
  const { scheduleArmed } = await chrome.storage.local.get('scheduleArmed');
  if (!scheduleArmed) return;

  // The site pattern is already in the manifest; no need to repeat it here.
  const [matches] = chrome.runtime.getManifest().content_scripts.map((s) => s.matches);
  const tabs = await chrome.tabs.query({ url: matches });

  if (!tabs.length) {
    return setStatus('Schedule is due, but no queue tab is open. Nothing to do.');
  }

  // The content script does the deciding; it is the one that can see the page.
  for (const tab of tabs) {
    await chrome.tabs.sendMessage(tab.id, { type: 'schedule-tick' }).catch(() => null);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) fireAlarm();
  if (alarm.name === WATCHDOG) checkAlive();
  if (alarm.name === COMMAND_POLL) pollCommands();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const done = (value) => sendResponse(value ?? null);
  // The controller names its campaign; the logger does not, but its page is
  // the campaign page, so the tab title says the same thing.
  const campaign = message.campaign || (sender.tab && sender.tab.title) || null;

  if (message.type === 'log-start') startSession(message.url, campaign).then(done);
  else if (message.type === 'log-sample') addSample(message.sample, campaign).then(done);
  else if (message.type === 'log-shot') takeShot(sender.tab.id).then(done);
  else if (message.type === 'test-shot') {
    takeShot(sender.tab.id, { scheduled: false }).then(done);
  }
  else if (message.type === 'log-stop') stopSession(message.reason, campaign).then(done);
  else if (message.type === 'challenge') {
    reportChallenge(sender.tab && sender.tab.id, message.signal, campaign).then(done);
  }
  else if (message.type === 'challenge-cleared') clearChallenge(campaign).then(done);
  else if (message.type === 'schedule-set') {
    chrome.alarms.create(ALARM, { when: message.at });
    done();
  } else if (message.type === 'schedule-clear') {
    chrome.alarms.clear(ALARM).then(done);
  } else if (message.type === 'schedule-report') {
    // Every refresh reaches the phone. Silent while there is a join time to
    // wait for; loud when it joins now or will not join at all.
    const silent = message.check.action === 'wait';
    notify(formatCheck(message.check), { silent, campaign }).then(done);
  } else if (message.type === 'notify') {
    notify(message.text, { silent: message.silent, campaign }).then(done);
  }
  else return false;

  return true; // The handlers are async; keep the channel open.
});
