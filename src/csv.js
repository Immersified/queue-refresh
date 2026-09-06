/**
 * Turns logged samples into CSV text, and names the folder each session
 * writes into. Pure functions so the tests can check them without a browser.
 */
(function (root) {
  const COLUMNS = [
    'timestamp',
    'elapsed_seconds',
    'position',
    'total',
    'waiting',
    'state',
    'url'
  ];

  function escapeCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(rows) {
    const lines = [COLUMNS.join(',')];
    for (const row of rows) {
      lines.push(COLUMNS.map((column) => escapeCell(row[column])).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  const pad = (n) => String(n).padStart(2, '0');

  /**
   * One folder per queue session, sortable by name and tagged with the
   * campaign so sessions from different campaigns stay comparable.
   *   https://feather.openai.com/campaigns/e27f8b7b-7b84-...
   *     -> 2026-09-06_1916_e27f8b7b
   */
  function sessionFolder(url, date) {
    const stamp =
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `_${pad(date.getHours())}${pad(date.getMinutes())}`;

    let slug = '';
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      // Windows rejects a lot of punctuation in paths, so keep it boring.
      slug = last.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8);
    } catch (e) {
      // A URL we cannot read just means no slug; the timestamp still works.
    }

    return slug ? `${stamp}_${slug}` : stamp;
  }

  root.__queueRefreshCsv = { toCsv, sessionFolder, COLUMNS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { toCsv, sessionFolder, COLUMNS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
