const test = require('node:test');
const assert = require('node:assert');
const { readQueueCount, MAX_QUEUE_LENGTH } = require('../src/queue-count.js');

test('reads the count from the live wording', () => {
  assert.strictEqual(readQueueCount('442 experts currently waiting'), 442);
});

test('reads it out of surrounding page text', () => {
  const page = [
    'Task queue · HL Content Grading (Les Artistes) V2',
    'Join the queue to get the next available task.',
    '442 experts currently waiting',
    'Queue order can vary because task eligibility differs by expert.'
  ].join('\n');
  assert.strictEqual(readQueueCount(page), 442);
});

test('handles the singular', () => {
  assert.strictEqual(readQueueCount('1 expert currently waiting'), 1);
});

test('an empty queue is a real reading, not a miss', () => {
  assert.strictEqual(readQueueCount('0 experts currently waiting'), 0);
});

test('tolerates the whitespace innerText happens to produce', () => {
  assert.strictEqual(readQueueCount('442\nexperts   currently\twaiting'), 442);
});

test('accepts thousands separators', () => {
  assert.strictEqual(readQueueCount('1,234 experts currently waiting'), 1234);
  assert.strictEqual(readQueueCount('1 234 experts currently waiting'), 1234);
});

test('returns null when the page does not say', () => {
  assert.strictEqual(readQueueCount('You are next in line.'), null);
  assert.strictEqual(readQueueCount(''), null);
});

test('returns null for non-string input', () => {
  assert.strictEqual(readQueueCount(null), null);
  assert.strictEqual(readQueueCount(undefined), null);
  assert.strictEqual(readQueueCount(442), null);
});

test('does not read a fragment of a decimal as the count', () => {
  assert.strictEqual(readQueueCount('4.5 experts currently waiting'), null);
});

test('rejects an implausible count rather than trusting it', () => {
  assert.strictEqual(readQueueCount(`${MAX_QUEUE_LENGTH + 1} experts currently waiting`), null);
  assert.strictEqual(readQueueCount(`${MAX_QUEUE_LENGTH} experts currently waiting`), MAX_QUEUE_LENGTH);
});

test('needs the whole phrase, not just a number', () => {
  assert.strictEqual(readQueueCount('442 experts'), null);
  assert.strictEqual(readQueueCount('442 tasks currently waiting'), null);
});

test('takes the first count when the phrase appears twice', () => {
  assert.strictEqual(
    readQueueCount('442 experts currently waiting\n\n7 experts currently waiting'),
    442
  );
});
