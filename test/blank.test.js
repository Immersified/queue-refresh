const test = require('node:test');
const assert = require('node:assert');
const { isBlankPage } = require('../src/blank.js');

test('an empty page is blank', () => {
  assert.strictEqual(isBlankPage(''), true);
});

test('whitespace only is still blank', () => {
  assert.strictEqual(isBlankPage('\n\n   \t\n'), true);
});

test('the zero-width characters a shell leaves behind are still blank', () => {
  assert.strictEqual(isBlankPage('﻿​  '), true);
});

test('the join page is not blank', () => {
  assert.strictEqual(isBlankPage('442 experts currently waiting\nJoin queue'), false);
});

test('the in-queue page is not blank', () => {
  assert.strictEqual(isBlankPage('Position 412 of 456\nLeave queue'), false);
});

test('a Cloudflare challenge is not blank', () => {
  // It says something, so it is the challenge detector's business, not ours.
  assert.strictEqual(isBlankPage('Verify you are human'), false);
});

test('one stray character is enough to count as rendered', () => {
  assert.strictEqual(isBlankPage('.'), false);
});

test('a page we could not read is not called blank', () => {
  // Reloading on a bad read would be a loop with no evidence behind it.
  assert.strictEqual(isBlankPage(undefined), false);
  assert.strictEqual(isBlankPage(null), false);
});
