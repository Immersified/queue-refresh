const test = require('node:test');
const assert = require('node:assert');
const { toCsv, sessionFolder } = require('../src/csv.js');

test('writes a header even with no rows', () => {
  assert.strictEqual(
    toCsv([]),
    'timestamp,elapsed_seconds,position,total,waiting,state,url\n'
  );
});

test('writes a row in column order, blanking what was not read', () => {
  const csv = toCsv([
    {
      timestamp: '2026-09-06T19:16:00.000Z',
      elapsed_seconds: 0,
      position: 412,
      total: 456,
      waiting: null,
      state: 'in-queue',
      url: 'https://feather.openai.com/campaigns/abc'
    }
  ]);
  assert.strictEqual(
    csv.split('\n')[1],
    '2026-09-06T19:16:00.000Z,0,412,456,,in-queue,https://feather.openai.com/campaigns/abc'
  );
});

test('quotes a value carrying a comma so columns cannot shift', () => {
  const csv = toCsv([{ state: 'stopped, by hand', url: 'https://x/y?a=1,2' }]);
  const row = csv.split('\n')[1];
  assert.ok(row.includes('"stopped, by hand"'));
  assert.ok(row.includes('"https://x/y?a=1,2"'));
});

test('escapes an embedded quote', () => {
  assert.ok(toCsv([{ state: 'said "full"' }]).includes('"said ""full"""'));
});

test('names a session folder by time and campaign', () => {
  const url = 'https://feather.openai.com/campaigns/e27f8b7b-7b84-408b-801d-7437f012e1c1?tab=tasks';
  assert.strictEqual(sessionFolder(url, new Date(2026, 8, 6, 19, 16)), '2026-09-06_1916_e27f8b7b');
});

test('pads so folders sort in the order they happened', () => {
  const url = 'https://feather.openai.com/campaigns/abc';
  assert.strictEqual(sessionFolder(url, new Date(2026, 0, 2, 6, 3)), '2026-01-02_0603_abc');
});

test('still names a folder when the URL has no campaign', () => {
  assert.strictEqual(sessionFolder('https://feather.openai.com/', new Date(2026, 8, 6, 19, 16)), '2026-09-06_1916');
  assert.strictEqual(sessionFolder('not a url', new Date(2026, 8, 6, 19, 16)), '2026-09-06_1916');
});
