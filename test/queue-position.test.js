const test = require('node:test');
const assert = require('node:assert');
const { readQueuePosition } = require('../src/queue-position.js');

test('reads the position line off the in-queue screen', () => {
  const page = [
    'Task queue · HL Grading Les Artistes V2',
    "You're in line for the next available task.",
    "We're not sure how long the wait will be.",
    'Position 412 of 456',
    'Enable browser notifications'
  ].join('\n');
  assert.deepStrictEqual(readQueuePosition(page), { position: 412, total: 456 });
});

test('survives the whitespace innerText invents', () => {
  assert.deepStrictEqual(readQueuePosition('Position\n  7\n of\t20'), { position: 7, total: 20 });
});

test('reads thousands separators', () => {
  assert.deepStrictEqual(readQueuePosition('Position 1,412 of 2,000'), {
    position: 1412,
    total: 2000
  });
});

test('is case insensitive', () => {
  assert.deepStrictEqual(readQueuePosition('POSITION 3 OF 9'), { position: 3, total: 9 });
});

test('rejects a position past the end of the queue', () => {
  assert.strictEqual(readQueuePosition('Position 500 of 456'), null);
});

test('rejects a zero position, which is not how they are numbered', () => {
  assert.strictEqual(readQueuePosition('Position 0 of 456'), null);
});

test('rejects an implausible queue rather than trusting it', () => {
  assert.strictEqual(readQueuePosition('Position 1 of 999999999'), null);
});

test('ignores a decimal, which is never a position', () => {
  assert.strictEqual(readQueuePosition('Position 4.5 of 20'), null);
});

test('returns null when the page does not say', () => {
  assert.strictEqual(readQueuePosition('442 experts currently waiting'), null);
  assert.strictEqual(readQueuePosition('Position unknown'), null);
  assert.strictEqual(readQueuePosition(''), null);
  assert.strictEqual(readQueuePosition(null), null);
});
