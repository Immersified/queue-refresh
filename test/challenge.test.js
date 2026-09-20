const test = require('node:test');
const assert = require('node:assert');
const { isChallengePage, WIDGET_SELECTOR } = require('../src/challenge.js');

test('spots the classic interstitial by its title', () => {
  assert.strictEqual(isChallengePage({ title: 'Just a moment...' }), true);
});

test('spots the interactive challenge by its wording', () => {
  assert.strictEqual(
    isChallengePage({ text: 'Verify you are human by completing the action below.' }),
    true
  );
});

test('spots the older browser check', () => {
  assert.strictEqual(
    isChallengePage({ text: 'Checking your browser before accessing feather.openai.com' }),
    true
  );
});

test('spots the connection-security wording', () => {
  assert.strictEqual(
    isChallengePage({ text: 'feather.openai.com needs to review the security of your connection' }),
    true
  );
});

test('the widget alone is enough, whatever the page says', () => {
  assert.strictEqual(isChallengePage({ title: '', text: '', hasWidget: true }), true);
});

test('leaves the real queue page alone', () => {
  assert.strictEqual(
    isChallengePage({
      title: 'HL Grading Les Artistes V2',
      text: 'Position 412 of 456\nLeave queue'
    }),
    false
  );
});

test('leaves the join page alone', () => {
  assert.strictEqual(
    isChallengePage({
      title: 'HL Grading Les Artistes V2',
      text: '442 experts currently waiting\nJoin queue'
    }),
    false
  );
});

test('a blank page is not a challenge', () => {
  // A page mid-load says nothing at all. Guessing "challenge" there would stop
  // the loop on every slow load.
  assert.strictEqual(isChallengePage({ title: '', text: '' }), false);
});

test('nothing at all is not a challenge', () => {
  assert.strictEqual(isChallengePage(), false);
});

test('survives a caller that hands it the wrong types', () => {
  assert.strictEqual(isChallengePage({ title: null, text: undefined }), false);
});

test('hasWidget only counts when it is really true', () => {
  // querySelector returns null, not false, when nothing matches.
  assert.strictEqual(isChallengePage({ hasWidget: null }), false);
});

test('the widget selector covers the iframe Cloudflare actually renders', () => {
  assert.match(WIDGET_SELECTOR, /challenges\.cloudflare\.com/);
});
