const test = require('node:test');
const assert = require('node:assert');
const { readOfferExpired, readJoinPrompt, exitReason } = require('../src/queue-exit.js');

const EXPIRED_PAGE = [
  'Task queue · HL Grading Les Artistes V2',
  'Task offer expired',
  'Join the queue to get the next available task.',
  '316 experts currently waiting',
  'Estimated 35-65 min to front if you join now'
].join('\n');

const LEFT_PAGE = [
  'Task queue · HL Grading Les Artistes V2',
  'Join the queue to get the next available task.',
  '417 experts currently waiting',
  'Estimated 60-120 min to front if you join now'
].join('\n');

const IN_QUEUE_PAGE = [
  "You're in line for the next available task.",
  'Position 412 of 456'
].join('\n');

test('spots the expired offer notice', () => {
  assert.strictEqual(readOfferExpired(EXPIRED_PAGE), true);
  assert.strictEqual(readOfferExpired(LEFT_PAGE), false);
  assert.strictEqual(readOfferExpired(IN_QUEUE_PAGE), false);
});

test('spots the invitation to join, which only shows when you are out', () => {
  assert.strictEqual(readJoinPrompt(LEFT_PAGE), true);
  assert.strictEqual(readJoinPrompt(EXPIRED_PAGE), true);
  assert.strictEqual(readJoinPrompt(IN_QUEUE_PAGE), false);
});

test('does not mistake being in line for the invitation to join', () => {
  assert.strictEqual(readJoinPrompt("You're in line for the next available task."), false);
});

test('handles a page that is not a string yet', () => {
  assert.strictEqual(readOfferExpired(null), false);
  assert.strictEqual(readJoinPrompt(undefined), false);
});

test('ends the session for the two ways out, and names which', () => {
  assert.strictEqual(exitReason('offer-expired'), 'offer-expired');
  assert.strictEqual(exitReason('not-joined'), 'not-in-queue');
});

test('carries on while still in the queue', () => {
  assert.strictEqual(exitReason('in-queue'), null);
});

test('carries on when the page has not rendered, which is not evidence of leaving', () => {
  assert.strictEqual(exitReason('unknown'), null);
});
