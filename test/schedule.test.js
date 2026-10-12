const test = require('node:test');
const assert = require('node:assert');
const { parseSchedule, formatCountdown } = require('../src/schedule.js');

test('reads a datetime-local value as local wall-clock time', () => {
  const at = parseSchedule('2026-09-07T06:03');
  const date = new Date(at);
  assert.strictEqual(date.getFullYear(), 2026);
  assert.strictEqual(date.getMonth(), 8);
  assert.strictEqual(date.getDate(), 7);
  assert.strictEqual(date.getHours(), 6);
  assert.strictEqual(date.getMinutes(), 3);
});

test('accepts the seconds some browsers add', () => {
  assert.strictEqual(new Date(parseSchedule('2026-09-07T06:03:30')).getSeconds(), 30);
});

test('rejects a date the calendar does not have', () => {
  assert.strictEqual(parseSchedule('2026-02-30T06:03'), null);
});

test('rejects anything that is not a datetime-local value', () => {
  assert.strictEqual(parseSchedule('tomorrow at six'), null);
  assert.strictEqual(parseSchedule('2026-09-07'), null);
  assert.strictEqual(parseSchedule('06:03'), null);
  assert.strictEqual(parseSchedule(''), null);
  assert.strictEqual(parseSchedule(null), null);
});

test('does not silently accept a timezone it would then ignore', () => {
  assert.strictEqual(parseSchedule('2026-09-07T06:03Z'), null);
});

test('counts down in the two units that matter', () => {
  assert.strictEqual(formatCountdown(8 * 3600e3 + 42 * 60e3), '8h 42m');
  assert.strictEqual(formatCountdown(5 * 60e3 + 9e3), '5m 9s');
  assert.strictEqual(formatCountdown(9e3), '9s');
});

test('says now once the moment has passed', () => {
  assert.strictEqual(formatCountdown(0), 'now');
  assert.strictEqual(formatCountdown(-5000), 'now');
});

const { planJoin, nextCheckAt, launchDue, WATCH_MS, CHECK_EVERY_MS } = require('../src/schedule.js');

const READY = Date.UTC(2026, 9, 13, 8, 0);
const MIN = 60e3;

test('joins on the shortest estimate, so the front comes no earlier than ready', () => {
  const plan = planJoin({ readyAt: READY, estimate: { min: 60, max: 120 }, now: READY - 120 * MIN });
  assert.deepStrictEqual(plan, { action: 'wait', joinAt: READY - 60 * MIN });
});

test('joins straight away when the join time has already passed', () => {
  const plan = planJoin({ readyAt: READY, estimate: { min: 150, max: 200 }, now: READY - 120 * MIN });
  assert.strictEqual(plan.action, 'join');
});

test('joins at exactly the join time', () => {
  const plan = planJoin({ readyAt: READY, estimate: { min: 60, max: 120 }, now: READY - 60 * MIN });
  assert.strictEqual(plan.action, 'join');
});

test('leaves a queue of 30 minutes or less to be joined by hand', () => {
  const now = READY - 120 * MIN;
  assert.strictEqual(planJoin({ readyAt: READY, estimate: { min: 20, max: 30 }, now }).action, 'short');
  assert.strictEqual(planJoin({ readyAt: READY, estimate: { min: 0, max: 2 }, now }).action, 'short');
  assert.strictEqual(planJoin({ readyAt: READY, estimate: { min: 20, max: 31 }, now }).action, 'wait');
});

test('does not join without an estimate', () => {
  assert.deepStrictEqual(
    planJoin({ readyAt: READY, estimate: null, now: READY - 120 * MIN }),
    { action: 'no-estimate', joinAt: null }
  );
});

test('first check is two hours before ready, then every fifteen minutes', () => {
  assert.strictEqual(nextCheckAt({ readyAt: READY, lastCheckAt: null }), READY - WATCH_MS);
  const last = READY - 100 * MIN;
  assert.strictEqual(nextCheckAt({ readyAt: READY, lastCheckAt: last }), last + CHECK_EVERY_MS);
  assert.strictEqual(CHECK_EVERY_MS, 15 * MIN);
  assert.strictEqual(WATCH_MS, 120 * MIN);
});

test('a browser start wakes the tab only for an arm still ahead', () => {
  assert.strictEqual(launchDue({ armed: true, readyAt: READY, now: READY - 125 * MIN }), true);
  assert.strictEqual(launchDue({ armed: true, readyAt: READY, now: READY + 24 * 60 * MIN }), false);
  assert.strictEqual(launchDue({ armed: false, readyAt: READY, now: READY - MIN }), false);
  assert.strictEqual(launchDue({ armed: true, readyAt: null, now: READY - MIN }), false);
});
