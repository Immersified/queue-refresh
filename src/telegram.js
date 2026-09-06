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

  root.__queueRefreshTelegram = { formatUpdate, formatElapsed };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatUpdate, formatElapsed };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
