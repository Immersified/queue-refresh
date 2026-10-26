const test = require('node:test');
const assert = require('node:assert');
const { readCampaign, pickTabs, shortName } = require('../src/campaign.js');

test('reads the campaign off the queue line', () => {
  const page = [
    'Guild Signal V2',
    'Task queue · Guild Signal V2',
    'Join the queue to get the next available task.',
    '434 experts currently waiting'
  ].join('\n');
  assert.strictEqual(readCampaign(page, 'something else'), 'Guild Signal V2');
});

test('falls back to the tab title', () => {
  assert.strictEqual(readCampaign('Position 40 of 456', 'Guild Prism V2'), 'Guild Prism V2');
  assert.strictEqual(readCampaign('', '  '), null);
  assert.strictEqual(readCampaign(undefined, undefined), null);
});

const TABS = [{ id: 1, title: 'Guild Signal V2' }, { id: 2, title: 'Guild Prism V2' }];

test('picks a tab by any part of its name, ignoring case', () => {
  assert.deepStrictEqual(pickTabs(TABS, 'prism').map((t) => t.id), [2]);
  assert.deepStrictEqual(pickTabs(TABS, 'SIGNAL').map((t) => t.id), [1]);
  assert.deepStrictEqual(pickTabs(TABS, 'guild').map((t) => t.id), [1, 2]);
  assert.deepStrictEqual(pickTabs(TABS, 'nope'), []);
});

test('no name means every tab', () => {
  assert.strictEqual(pickTabs(TABS, '').length, 2);
});

test('shortens a name to the word that sets it apart', () => {
  assert.strictEqual(shortName('Guild Signal V2', ['Guild Prism V2']), 'signal');
  assert.strictEqual(shortName('Guild Prism V2', ['Guild Signal V2']), 'prism');
  assert.strictEqual(shortName('Guild Prism V2', []), 'guild');
});
