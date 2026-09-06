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
