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

  root.__queueRefreshSchedule = { parseSchedule, formatCountdown };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseSchedule, formatCountdown };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
