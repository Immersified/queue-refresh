/**
 * The arming clock's arithmetic. Pure functions, so the tests can check the
 * awkward cases without a browser or a fake clock.
 */
(function (root) {
  // What <input type="datetime-local"> hands back, seconds optional.
  const INPUT_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

  /**
   * Turns "2026-09-07T06:03" into a timestamp on the machine's own clock.
   * Deliberately no timezone: you type the wall-clock time the server shows,
   * and that is the time it fires.
   *
   * @returns {number|null} null when the text is not a date this can trust.
   */
  function parseSchedule(value) {
    if (typeof value !== 'string') return null;

    const match = INPUT_PATTERN.exec(value.trim());
    if (!match) return null;

    // Defaulted before the conversion: an absent seconds group is undefined,
    // and Number(undefined) is NaN, which would poison the whole date.
    const [, year, month, day, hour, minute, second = '0'] = match;
    const parts = [year, month, day, hour, minute, second].map(Number);
    const [yyyy, mm, dd, hh, min, ss] = parts;
    const date = new Date(yyyy, mm - 1, dd, hh, min, ss);

    // Date rolls a bad day over rather than refusing it: 2026-02-30 comes back
    // as 2 March. Read the parts back and insist they are the ones asked for,
    // so a typo cannot arm the schedule for a day you did not choose.
    if (
      date.getFullYear() !== yyyy ||
      date.getMonth() !== mm - 1 ||
      date.getDate() !== dd ||
      date.getHours() !== hh ||
      date.getMinutes() !== min
    ) {
      return null;
    }

    return date.getTime();
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'now';

    const total = Math.round(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    // Only ever two units: the third is noise at every scale that matters.
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  // Checking starts this long before the ready time, and repeats this often.
  const WATCH_MS = 2 * 3600e3;
  const CHECK_EVERY_MS = 15 * 60e3;

  // A queue whose longest estimate is this short is joined by hand.
  const SHORT_QUEUE_MINUTES = 30;

  /**
   * What to do with one reading of the estimate.
   *
   * Joins on the shortest estimate, so the front is reached at the ready time
   * at the earliest, never before it. Arriving early means an offer that
   * lapses and a second trip through the queue; arriving late only means a
   * wait.
   *
   * @param {number} readyAt  when the task should be ready, ms
   * @param {{min: number, max: number}|null} estimate minutes to the front
   * @param {number} now
   * @returns {{action: 'join'|'wait'|'short'|'no-estimate', joinAt: number|null}}
   */
  function planJoin({ readyAt, estimate, now }) {
    if (!estimate) return { action: 'no-estimate', joinAt: null };
    if (estimate.max <= SHORT_QUEUE_MINUTES) return { action: 'short', joinAt: null };

    const joinAt = readyAt - estimate.min * 60e3;
    return { action: joinAt <= now ? 'join' : 'wait', joinAt };
  }

  /**
   * When the page is next due a reload for a fresh estimate: two hours before
   * the ready time, then every fifteen minutes after the last check. A time in
   * the past just means "now".
   */
  function nextCheckAt({ readyAt, lastCheckAt }) {
    return lastCheckAt ? lastCheckAt + CHECK_EVERY_MS : readyAt - WATCH_MS;
  }

  /**
   * Should a browser start wake the queue tab? Only for an arm that is still
   * ahead of us: a launch on any other day does nothing.
   */
  function launchDue({ armed, readyAt, now }) {
    return Boolean(armed && readyAt && now < readyAt);
  }

  const api = {
    parseSchedule,
    formatCountdown,
    planJoin,
    nextCheckAt,
    launchDue,
    WATCH_MS,
    CHECK_EVERY_MS,
    SHORT_QUEUE_MINUTES
  };
  root.__queueRefreshSchedule = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
