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
