const test = require('node:test');
const assert = require('node:assert');
const { formatUpdate, formatElapsed } = require('../src/telegram.js');

const inQueue = { position: 412, total: 456, state: 'in-queue', waiting: null };

test('leads with the position, which is what the phone is for', () => {
  assert.strictEqual(
    formatUpdate(inQueue, null, 0),
    'Queue Refresh\nPosition 412 of 456\nElapsed 0s'
  );
});

test('spells out which way the queue moved', () => {
  assert.ok(formatUpdate(inQueue, 456, 60e3).includes('Up 44 since the last update'));
  assert.ok(formatUpdate(inQueue, 400, 60e3).includes('Back 12 since the last update'));
  assert.ok(formatUpdate(inQueue, 412, 60e3).includes('No movement since the last update'));
});

test('says so plainly when not in the queue yet', () => {
  const sample = { position: null, total: null, waiting: 442, state: 'not-joined' };
  assert.ok(formatUpdate(sample, null, 0).includes('Not in the queue yet. 442 waiting'));
});

test('does not invent a number when the page says nothing', () => {
  const sample = { position: null, total: null, waiting: null, state: 'unknown' };
  const text = formatUpdate(sample, null, 0);
  assert.ok(text.includes('No queue reading on the page'));
  assert.ok(!/\d+ of \d+/.test(text));
});

test('reads elapsed time at a glance', () => {
  assert.strictEqual(formatElapsed(0), '0s');
  assert.strictEqual(formatElapsed(45e3), '45s');
  assert.strictEqual(formatElapsed(5 * 60e3), '5m');
  assert.strictEqual(formatElapsed(3 * 3600e3 + 4 * 60e3), '3h 04m');
});

const { formatCheck } = require('../src/telegram.js');

const READY = new Date(2026, 9, 13, 8, 0).getTime();
const MIN = 60e3;

test('a refresh reports the estimate and the join time', () => {
  const text = formatCheck({
    estimate: { min: 60, max: 120 },
    waiting: 568,
    action: 'wait',
    readyAt: READY,
    joinAt: READY - 60 * MIN,
    now: READY - 112 * MIN
  });
  assert.strictEqual(
    text,
    'Queue Refresh\nEstimated 60–120 min to front\n568 waiting\n' +
      'Ready at 08:00\nJoining at 07:00 (in 52m)'
  );
});

test('a refresh says why it is not joining', () => {
  const base = { waiting: null, readyAt: READY, joinAt: null, now: READY - 90 * MIN };
  assert.ok(
    formatCheck({ ...base, estimate: { min: 0, max: 2 }, action: 'short' })
      .includes('Estimated 0–2 min to front\nReady at 08:00\nQueue is short. Not joining: join by hand')
  );
  assert.ok(
    formatCheck({ ...base, estimate: null, action: 'no-estimate' })
      .includes('No time estimate on the page\nReady at 08:00\nNot joining without an estimate')
  );
});

test('a refresh that joins says so', () => {
  const text = formatCheck({
    estimate: { min: 150, max: 150 }, waiting: 900, action: 'join',
    readyAt: READY, joinAt: READY - 150 * MIN, now: READY - 120 * MIN
  });
  assert.ok(text.includes('Estimated 150 min to front'));
  assert.ok(text.endsWith('Joining now'));
});

const { parseCommand, armValue, formatStatus, MAX_COMMAND_AGE_MS } = require('../src/telegram.js');

const CHAT = '123456789';
const NOW = new Date(2026, 9, 26, 20, 0).getTime();

function update(text, { chatId = 123456789, ageMs = 0 } = {}) {
  return { update_id: 1, message: { text, chat: { id: chatId }, date: (NOW - ageMs) / 1000 } };
}

test('reads a command and its argument', () => {
  assert.deepStrictEqual(parseCommand(update('/join'), CHAT, NOW), { command: 'join', arg: '' });
  assert.deepStrictEqual(parseCommand(update('/arm 21:30'), CHAT, NOW), { command: 'arm', arg: '21:30' });
  assert.deepStrictEqual(parseCommand(update('/Status@QueueBot'), CHAT, NOW), { command: 'status', arg: '' });
});

test('ignores anyone but your own chat', () => {
  assert.strictEqual(parseCommand(update('/join', { chatId: 999 }), CHAT, NOW), null);
});

test('ignores a command left over from earlier', () => {
  assert.strictEqual(parseCommand(update('/join', { ageMs: MAX_COMMAND_AGE_MS + 1000 }), CHAT, NOW), null);
  assert.ok(parseCommand(update('/join', { ageMs: 60e3 }), CHAT, NOW));
});

test('answers plain text and unknown commands with help', () => {
  assert.strictEqual(parseCommand(update('hello'), CHAT, NOW), null);
  assert.deepStrictEqual(parseCommand(update('/dance'), CHAT, NOW), { command: 'help', arg: '' });
  assert.strictEqual(parseCommand({ update_id: 2 }, CHAT, NOW), null);
});

test('arms for the next time the clock shows', () => {
  assert.strictEqual(armValue('21:30', NOW), '2026-10-26T21:30');
  assert.strictEqual(armValue('6.05', NOW), '2026-10-27T06:05');
  assert.strictEqual(armValue('20:00', NOW), '2026-10-27T20:00');
});

test('refuses what is not a time', () => {
  assert.strictEqual(armValue('', NOW), null);
  assert.strictEqual(armValue('tomorrow', NOW), null);
  assert.strictEqual(armValue('24:00', NOW), null);
  assert.strictEqual(armValue('21:60', NOW), null);
});

const { splitArgs } = require('../src/telegram.js');

test('takes the campaign and the time in either order', () => {
  assert.deepStrictEqual(splitArgs('signal 21:30'), { name: 'signal', time: '21:30' });
  assert.deepStrictEqual(splitArgs('21:30 signal'), { name: 'signal', time: '21:30' });
  assert.deepStrictEqual(splitArgs('guild prism'), { name: 'guild prism', time: '' });
  assert.deepStrictEqual(splitArgs(''), { name: '', time: '' });
});

test('status gives each campaign its own block', () => {
  const text = formatStatus({
    campaigns: [
      {
        name: 'Guild Signal V2',
        status: {
          text: 'Stopped: no enabled "Join queue" button after 30s.',
          at: new Date(2026, 9, 26, 17, 13).getTime(),
          running: false
        },
        reading: { state: 'not-joined', waiting: 434, at: NOW - 14 * 60e3 }
      },
      {
        name: 'Guild Prism V2',
        status: { text: 'Attempt 3: queue full.', at: new Date(2026, 9, 26, 19, 59).getTime(), running: true },
        reading: { state: 'in-queue', position: 40, total: 456, at: NOW - 30e3 }
      }
    ],
    logging: null,
    arm: null
  }, NOW);

  assert.strictEqual(text, [
    'Queue Refresh · status',
    '',
    'Guild Signal V2',
    'Join loop: stopped',
    'Last (17:13): Stopped: no enabled "Join queue" button after 30s.',
    'Queue: not joined, 434 waiting (read 14m ago)',
    '',
    'Guild Prism V2',
    'Join loop: running',
    'Last (19:59): Attempt 3: queue full.',
    'Queue: position 40 of 456 (read 30s ago)',
    '',
    'Logging: off',
    'Armed: no'
  ].join('\n'));
});

test('status says plainly when a tab has said nothing yet', () => {
  const text = formatStatus({ campaigns: [{ name: 'Guild Prism V2' }], logging: null, arm: null }, NOW);
  assert.ok(text.includes('Guild Prism V2\nJoin loop: not started\nQueue: no reading yet'));
  assert.ok(formatStatus({ campaigns: [], logging: null, arm: null }, NOW).includes('No campaign tab is open.'));
});

test('status names the campaign that is logging and the one that is armed', () => {
  const text = formatStatus({
    campaigns: [],
    logging: { campaign: 'Guild Signal V2', startedAt: NOW - 64 * 60e3 },
    arm: {
      campaign: 'Guild Prism V2',
      readyAt: new Date(2026, 9, 27, 8, 0).getTime(),
      joinAt: new Date(2026, 9, 27, 7, 0).getTime()
    }
  }, NOW);
  assert.ok(text.endsWith('Logging: Guild Signal V2, for 1h 04m\nArmed: Guild Prism V2, ready 08:00, joining 07:00'));
});

const { formatEstimate, readingChanges, describeLoad, STALE_PAGE_MS } = require('../src/telegram.js');

test('writes an estimate the way the page does', () => {
  assert.strictEqual(formatEstimate({ min: 75, max: 135 }), '75–135 min to front');
  assert.strictEqual(formatEstimate({ min: 45, max: 45 }), '45 min to front');
});

test('a position update carries the estimate when the page shows one', () => {
  const sample = { ...inQueue, estimate: { min: 20, max: 40 } };
  assert.strictEqual(
    formatUpdate(sample, null, 0),
    'Queue Refresh\nPosition 412 of 456\nEstimated 20–40 min to front\nElapsed 0s'
  );
  assert.ok(!formatUpdate(inQueue, null, 0).includes('Estimated'));
});

test('lists what moved since the page loaded', () => {
  const first = { position: null, waiting: 434, estimate: { min: 75, max: 135 } };
  assert.deepStrictEqual(
    readingChanges(first, { position: null, waiting: 431, estimate: { min: 70, max: 130 } }),
    ['434 → 431 waiting', '75–135 → 70–130 min']
  );
  assert.deepStrictEqual(readingChanges(first, { ...first }), []);
  // Joining is a change of view, not a number moving.
  assert.deepStrictEqual(
    readingChanges({ position: 40, waiting: null, estimate: null }, { position: 35, waiting: null, estimate: null }),
    ['position 40 → 35']
  );
});

test('says whether the page needs a refresh', () => {
  const first = { position: null, waiting: 434, estimate: { min: 75, max: 135 } };
  const reading = (age, latest = first) => ({ ...latest, loadedAt: NOW - age, first });

  assert.strictEqual(
    describeLoad(reading(47 * 60e3), NOW, '/refresh prism'),
    'Page loaded 47m ago, unchanged since. /refresh prism for fresh numbers'
  );
  assert.strictEqual(describeLoad(reading(3 * 60e3), NOW, '/refresh'), 'Page loaded 3m ago, unchanged since');
  assert.strictEqual(
    describeLoad(reading(STALE_PAGE_MS * 3, { ...first, waiting: 431 }), NOW, '/refresh'),
    'Page loaded 30m ago. Changed since, without a refresh: 434 → 431 waiting'
  );
  // A reading stored before this was tracked says nothing rather than guess.
  assert.strictEqual(describeLoad({ waiting: 434, at: NOW }, NOW, '/refresh'), null);
});

test('status shows the estimate, the page age, and a stale reading', () => {
  const first = { position: null, waiting: 434, estimate: { min: 75, max: 135 } };
  const text = formatStatus({
    campaigns: [{
      name: 'Guild Prism V2',
      reading: { state: 'not-joined', waiting: 434, estimate: { min: 75, max: 135 }, at: NOW, loadedAt: NOW - 47 * 60e3, first },
      refreshAs: '/refresh prism',
      live: false
    }],
    logging: null,
    arm: null
  }, NOW);
  assert.ok(text.includes([
    'Guild Prism V2',
    'Join loop: not started',
    'Queue: not joined, 434 waiting (read just now)',
    'Estimate: 75–135 min to front',
    'Not readable right now, so this is the last stored reading',
    'Page loaded 47m ago, unchanged since. /refresh prism for fresh numbers'
  ].join('\n')));
});

test('a running join loop gets no refresh hint: it reloads the page itself', () => {
  const first = { position: null, waiting: 434, estimate: null };
  const text = formatStatus({
    campaigns: [{
      name: 'Guild Signal V2',
      status: { text: 'Attempt 4: queue full.', at: NOW, running: true },
      reading: { state: 'not-joined', waiting: 434, at: NOW, loadedAt: NOW - 47 * 60e3, first },
      refreshAs: '/refresh signal'
    }],
    logging: null,
    arm: null
  }, NOW);
  assert.ok(text.includes('Page loaded 47m ago, unchanged since\n'));
  assert.ok(!text.includes('/refresh'));
});
