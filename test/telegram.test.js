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

test('status gives position, logging and arm', () => {
  const text = formatStatus({
    queueState: 'in-queue', queuePosition: 40, queueTotal: 456, queueCountAt: NOW - 90e3,
    logActive: true, scheduleArmed: false, status: 'Joined the queue on attempt 3. Logging now.'
  }, NOW);
  assert.strictEqual(
    text,
    'Queue Refresh\nPosition 40 of 456\nRead 1m ago\nLogging\nNot armed\n' +
      'Joined the queue on attempt 3. Logging now.'
  );
});

test('status shows the arm and the queue length before joining', () => {
  const text = formatStatus({
    queueCount: 568, scheduleArmed: true,
    scheduleReadyAt: new Date(2026, 9, 27, 8, 0).getTime(),
    scheduleJoinAt: new Date(2026, 9, 27, 7, 0).getTime()
  }, NOW);
  assert.ok(text.includes('Not in the queue. 568 waiting\nNot logging\nArmed. Ready at 08:00\nJoining at 07:00'));
  assert.ok(formatStatus({}, NOW).includes('No queue reading'));
});

const { splitArgs } = require('../src/telegram.js');

test('takes the campaign and the time in either order', () => {
  assert.deepStrictEqual(splitArgs('signal 21:30'), { name: 'signal', time: '21:30' });
  assert.deepStrictEqual(splitArgs('21:30 signal'), { name: 'signal', time: '21:30' });
  assert.deepStrictEqual(splitArgs('guild prism'), { name: 'guild prism', time: '' });
  assert.deepStrictEqual(splitArgs(''), { name: '', time: '' });
});

test('status says which campaign the status line and the arm belong to', () => {
  const text = formatStatus({
    scheduleArmed: true, scheduleCampaign: 'Guild Prism V2',
    scheduleReadyAt: new Date(2026, 9, 27, 8, 0).getTime(),
    status: 'Attempt 3: queue full.', statusCampaign: 'Guild Signal V2'
  }, NOW, ['Guild Signal V2', 'Guild Prism V2']);
  assert.ok(text.startsWith('Queue Refresh\nOpen: Guild Signal V2, Guild Prism V2\n'));
  assert.ok(text.includes('Armed for Guild Prism V2. Ready at 08:00'));
  assert.ok(text.endsWith('Guild Signal V2: Attempt 3: queue full.'));
});
