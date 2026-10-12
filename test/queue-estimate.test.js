const test = require('node:test');
const assert = require('node:assert');
const { readWaitEstimate } = require('../src/queue-estimate.js');

test('reads the range from the queue page', () => {
  const text =
    'Join the queue to get the next available task.\n568 experts currently waiting\n' +
    'Estimated 60–120 min to front if you join now';
  assert.deepStrictEqual(readWaitEstimate(text), { min: 60, max: 120 });
});

test('accepts the other dashes and the word "to"', () => {
  assert.deepStrictEqual(readWaitEstimate('Estimated 60-120 min'), { min: 60, max: 120 });
  assert.deepStrictEqual(readWaitEstimate('Estimated 60 — 120 min'), { min: 60, max: 120 });
  assert.deepStrictEqual(readWaitEstimate('Estimated 60 to 120 minutes'), { min: 60, max: 120 });
});

test('reads "under" as anywhere from now up to that', () => {
  assert.deepStrictEqual(readWaitEstimate('Estimated under 2 min to front'), { min: 0, max: 2 });
  assert.deepStrictEqual(readWaitEstimate('Waiting time is under 2 minutes'), { min: 0, max: 2 });
});

test('reads a single value as both ends', () => {
  assert.deepStrictEqual(readWaitEstimate('Estimated 45 min to front'), { min: 45, max: 45 });
});

test('turns hours into minutes', () => {
  assert.deepStrictEqual(readWaitEstimate('Estimated 1–2 hours to front'), { min: 60, max: 120 });
  assert.deepStrictEqual(readWaitEstimate('Estimated 2 h'), { min: 120, max: 120 });
});

test('returns null when the page does not say', () => {
  assert.strictEqual(readWaitEstimate('568 experts currently waiting'), null);
  assert.strictEqual(readWaitEstimate(''), null);
  assert.strictEqual(readWaitEstimate(null), null);
});

test('refuses a range that runs backwards or past a week', () => {
  assert.strictEqual(readWaitEstimate('Estimated 120–60 min'), null);
  assert.strictEqual(readWaitEstimate('Estimated 20000 min'), null);
});
