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

  // ---------------------------------------------------------------- commands

  const COMMANDS = ['join', 'stop', 'status', 'arm', 'help'];

  // Telegram keeps unread messages for a day. A /join sent last night and only
  // picked up now must not fire, so anything older than this is dropped.
  const MAX_COMMAND_AGE_MS = 5 * 60e3;

  const HELP = [
    'Queue Refresh commands',
    '/join - press Start on the queue tab',
    '/stop - press Stop',
    '/status - each open campaign: loop, last message, queue',
    '/arm 21:30 - set the ready time',
    'With two campaigns open, add which one: /join prism, /arm signal 21:30'
  ].join('\n');

  /**
   * One update from getUpdates, reduced to a command we may act on.
   *
   * Only your own chat counts: anyone can find a bot and message it, and a
   * stranger must not be able to join the queue for you.
   *
   * @returns {{command: string, arg: string}|null}
   */
  function parseCommand(update, chatId, now) {
    const message = update && update.message;
    if (!message || typeof message.text !== 'string') return null;
    if (String(message.chat && message.chat.id) !== String(chatId)) return null;
    if (now - message.date * 1000 > MAX_COMMAND_AGE_MS) return null;

    // "/join@MyQueueBot" is what a group chat sends.
    const match = /^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/.exec(message.text.trim());
    if (!match) return null;

    const command = match[1].toLowerCase();
    return { command: COMMANDS.includes(command) ? command : 'help', arg: (match[2] || '').trim() };
  }

  const TIME = /^(\d{1,2})[:.](\d{2})$/;

  /**
   * "signal 21:30" or "21:30 signal" -> the campaign and the time, in either
   * order, because nobody remembers which way round it goes.
   *
   * @returns {{name: string, time: string}}
   */
  function splitArgs(arg) {
    const words = String(arg || '').trim().split(/\s+/).filter(Boolean);
    const time = words.find((word) => TIME.test(word)) || '';
    const name = words.filter((word) => word !== time).join(' ');
    return { name, time };
  }

  /**
   * "21:30" -> the next 21:30 on this machine's clock, in the form the popup's
   * picker produces, so the arm reads it exactly as it reads the picker.
   *
   * @returns {string|null} null when the text is not a time.
   */
  function armValue(text, now) {
    const match = TIME.exec(String(text).trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;

    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    // A time already gone today means tomorrow: that is what "arm 06:00" at
    // midnight means.
    if (date.getTime() <= now) date.setDate(date.getDate() + 1);

    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** "Queue: position 40 of 456", from one campaign's own reading. */
  function describeReading(reading, now) {
    if (!reading) return 'Queue: no reading yet';

    let text;
    if (reading.state === 'in-queue') {
      text = `Queue: position ${reading.position} of ${reading.total}`;
    } else if (reading.state === 'offer-expired') {
      text = 'Queue: task offer expired';
    } else if (typeof reading.waiting === 'number') {
      text = `Queue: not joined, ${reading.waiting} waiting`;
    } else {
      text = 'Queue: not joined';
    }
    return `${text} (read ${formatElapsed(now - reading.at)} ago)`;
  }

  /**
   * The reply to /status: one block per open campaign, each with its own
   * line, so nothing one tab said can be read as the other's.
   *
   * @param {Array<{name, status, reading}>} campaigns status is
   *   {text, at, running}, reading is {state, position, total, waiting, at};
   *   either may be missing when that tab has not said anything yet
   * @param {{campaign, startedAt}|null} logging
   * @param {{campaign, readyAt, joinAt}|null} arm
   */
  function formatStatus({ campaigns, logging, arm }, now) {
    const blocks = ['Queue Refresh · status'];

    if (!campaigns.length) blocks.push('No campaign tab is open.');

    for (const { name, status, reading } of campaigns) {
      const lines = [name];
      if (status) {
        lines.push(`Join loop: ${status.running ? 'running' : 'stopped'}`);
        lines.push(`Last (${formatClock(status.at)}): ${status.text}`);
      } else {
        lines.push('Join loop: not started');
      }
      lines.push(describeReading(reading, now));
      blocks.push(lines.join('\n'));
    }

    const footer = [];
    footer.push(logging
      ? `Logging: ${logging.campaign || 'on'}, for ${formatElapsed(now - logging.startedAt)}`
      : 'Logging: off');
    if (arm) {
      const join = arm.joinAt ? `, joining ${formatClock(arm.joinAt)}` : '';
      footer.push(`Armed: ${arm.campaign || 'yes'}, ready ${formatClock(arm.readyAt)}${join}`);
    } else {
      footer.push('Armed: no');
    }
    blocks.push(footer.join('\n'));

    return blocks.join('\n\n');
  }

  const api = {
    formatUpdate,
    formatElapsed,
    formatCheck,
    parseCommand,
    armValue,
    splitArgs,
    formatStatus,
    HELP,
    MAX_COMMAND_AGE_MS
  };
  root.__queueRefreshTelegram = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
