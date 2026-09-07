const test = require('node:test');
const assert = require('node:assert');
const { shouldRevive } = require('../src/watchdog.js');

const base = { now: 1_000_000, staleMs: 180_000, cooldownMs: 180_000 };

test('leaves a page that is still beating alone', () => {
  assert.strictEqual(shouldRevive({ ...base, heartbeatAt: base.now - 30_000 }), false);
});

test('revives a page that has gone quiet', () => {
  assert.strictEqual(shouldRevive({ ...base, heartbeatAt: base.now - 200_000 }), true);
});

test('treats a page that never reported at all as dead', () => {
  assert.strictEqual(shouldRevive({ ...base, heartbeatAt: 0 }), true);
});

test('waits out the cooldown so it does not reload on a loop', () => {
  assert.strictEqual(
    shouldRevive({ ...base, heartbeatAt: 0, revivedAt: base.now - 60_000 }),
    false
  );
});

test('tries again once the cooldown has passed and it is still dead', () => {
  assert.strictEqual(
    shouldRevive({ ...base, heartbeatAt: 0, revivedAt: base.now - 200_000 }),
    true
  );
});

test('takes silence exactly at the threshold as dead', () => {
  assert.strictEqual(shouldRevive({ ...base, heartbeatAt: base.now - 180_000 }), true);
});
