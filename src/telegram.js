/**
 * Builds the text that goes to the phone. Pure, so the wording can be checked
 * without a bot token or a network.
 */
(function (root) {
  function formatElapsed(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    if (minutes) return `${minutes}m`;
    return `${total}s`;
  }

  /**
   * A routine position update.
   *
   * @param {object} sample     latest reading: position, total, state
   * @param {number|null} previous the position in the last message sent, so the
   *   movement between updates is visible without opening the CSV
   * @param {number} elapsedMs  time since the session started
   */
  function formatUpdate(sample, previous, elapsedMs) {
    const lines = ['Queue Refresh'];

    if (typeof sample.position === 'number') {
      lines.push(`Position ${sample.position} of ${sample.total}`);

      if (typeof previous === 'number') {
        const moved = previous - sample.position;
        // Sign spelled out: "-3" on a phone is ambiguous about which way the
        // queue went, and the direction is the whole reason for the line.
        if (moved > 0) lines.push(`Up ${moved} since the last update`);
        else if (moved < 0) lines.push(`Back ${-moved} since the last update`);
        else lines.push('No movement since the last update');
      }
    } else if (typeof sample.waiting === 'number') {
      lines.push(`Not in the queue yet. ${sample.waiting} waiting`);
    } else {
      lines.push('No queue reading on the page');
    }

    lines.push(`Elapsed ${formatElapsed(elapsedMs)}`);
    return lines.join('\n');
  }

  // Wall-clock time on this machine, the same clock the popup's picker uses.
  function formatClock(ms) {
    const date = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * The message sent on every scheduled refresh: what the page said, and what
   * was decided because of it.
   *
   * @param {object} check  estimate, waiting, action, readyAt, joinAt, now
   */
  function formatCheck({ estimate, waiting, action, readyAt, joinAt, now }) {
    const lines = ['Queue Refresh'];

    if (estimate) {
      const range = estimate.min === estimate.max
        ? `${estimate.max}`
        : `${estimate.min}–${estimate.max}`;
      lines.push(`Estimated ${range} min to front`);
    } else {
      lines.push('No time estimate on the page');
    }
    if (typeof waiting === 'number') lines.push(`${waiting} waiting`);

    lines.push(`Ready at ${formatClock(readyAt)}`);

    if (action === 'wait') {
      lines.push(`Joining at ${formatClock(joinAt)} (in ${formatElapsed(joinAt - now)})`);
    } else if (action === 'join') {
      lines.push('Joining now');
    } else if (action === 'short') {
      lines.push('Queue is short. Not joining: join by hand');
    } else {
      lines.push('Not joining without an estimate');
    }

    return lines.join('\n');
  }

  const api = { formatUpdate, formatElapsed, formatCheck };
  root.__queueRefreshTelegram = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
