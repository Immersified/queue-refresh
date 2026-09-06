#!/usr/bin/env node
/**
 * Reads .env and generates the two files Chrome actually loads:
 *   - manifest.json   from manifest.template.json, with the site URL filled in
 *   - src/config.js   runtime numbers for the controller
 *
 * Chrome cannot read .env itself, so this runs once per settings change.
 * Both outputs are gitignored, so committing never overwrites your setup.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const FIELDS = [
  { key: 'SITE_URL', type: 'url' },
  { key: 'MAX_ATTEMPTS', type: 'count' },
  { key: 'RETRY_INTERVAL_MIN_SECONDS', type: 'delay' },
  { key: 'RETRY_INTERVAL_MAX_SECONDS', type: 'delay' },
  { key: 'RESPONSE_TIMEOUT_SECONDS', type: 'count' },
  { key: 'CLICK_DELAY_SECONDS', type: 'delay' },
  { key: 'LOG_INTERVAL_SECONDS', type: 'count' },
  { key: 'SCREENSHOT_INTERVAL_SECONDS', type: 'count' }
];

function parseEnv(text) {
  const values = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key) values[key] = value;
  }
  return values;
}

/**
 * Turns any page URL into a host-wide match pattern, so a link that changes
 * path (a new campaign) never needs a rebuild. The path, query and port are
 * dropped: match patterns cannot carry a port, and matching the whole host is
 * the point.
 *   https://app.site.com/campaigns/abc?tab=tasks -> https://app.site.com/*
 */
function toMatchPattern(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    return null;
  }
  if (!parsed.hostname) return null;
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

/**
 * Telegram is optional, so it sits outside FIELDS, which is the required list.
 * Both halves or neither: a token with nowhere to send is a silent no-op, and
 * finding that out at 6am is exactly the kind of surprise .env checks exist to
 * prevent.
 */
function validateTelegram(values, config, problems) {
  const token = (values.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (values.TELEGRAM_CHAT_ID || '').trim();

  if (!token && !chat) return;

  if (!token) return problems.push('TELEGRAM_CHAT_ID is set but TELEGRAM_BOT_TOKEN is not.');
  if (!chat) return problems.push('TELEGRAM_BOT_TOKEN is set but TELEGRAM_CHAT_ID is not.');

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    // Deliberately not echoed back: it is a credential.
    problems.push('TELEGRAM_BOT_TOKEN does not look like a bot token (123456:ABC-DEF...).');
  }
  if (!/^-?\d+$/.test(chat)) {
    problems.push(`TELEGRAM_CHAT_ID must be a number, negative for a group (got "${chat}").`);
  }

  const raw = values.TELEGRAM_INTERVAL_SECONDS;
  const interval = raw === undefined || raw === '' ? 300 : Number(raw);
  if (!Number.isInteger(interval) || interval < 1) {
    problems.push(`TELEGRAM_INTERVAL_SECONDS must be a whole number of at least 1 (got "${raw}").`);
  }

  config.TELEGRAM_BOT_TOKEN = token;
  config.TELEGRAM_CHAT_ID = chat;
  config.TELEGRAM_INTERVAL_SECONDS = interval;
}

function validate(values) {
  const problems = [];
  const config = {};

  if (values.RETRY_INTERVAL_SECONDS !== undefined && !values.RETRY_INTERVAL_MIN_SECONDS) {
    problems.push(
      'RETRY_INTERVAL_SECONDS was replaced by RETRY_INTERVAL_MIN_SECONDS and ' +
      'RETRY_INTERVAL_MAX_SECONDS. Swap that line for the two new ones in .env.'
    );
  }

  for (const { key, type } of FIELDS) {
    const value = values[key];

    if (value === undefined || value === '') {
      problems.push(`${key} is missing.`);
      continue;
    }

    if (type === 'url') {
      if (!/^https?:\/\/\S+$/.test(value)) {
        problems.push(`${key} must start with http:// or https:// (got "${value}").`);
      } else if (value.includes('REPLACE-ME')) {
        problems.push(`${key} is still the placeholder. Put your real site URL in .env.`);
      } else {
        const pattern = toMatchPattern(value);
        if (!pattern) {
          problems.push(`${key} is not a URL I can read (got "${value}").`);
        } else {
          config[key] = pattern;
        }
      }
      continue;
    }

    const number = Number(value);

    if (type === 'delay') {
      if (!Number.isFinite(number) || number < 0) {
        problems.push(`${key} must be 0 or more (got "${value}").`);
      } else {
        config[key] = number;
      }
      continue;
    }

    if (!Number.isInteger(number) || number < 1) {
      problems.push(`${key} must be a whole number of at least 1 (got "${value}").`);
    } else {
      config[key] = number;
    }
  }

  const { RETRY_INTERVAL_MIN_SECONDS: min, RETRY_INTERVAL_MAX_SECONDS: max } = config;
  if (min !== undefined && max !== undefined && min > max) {
    problems.push(
      `RETRY_INTERVAL_MIN_SECONDS (${min}) cannot be larger than ` +
      `RETRY_INTERVAL_MAX_SECONDS (${max}).`
    );
  }

  const { LOG_INTERVAL_SECONDS: log, SCREENSHOT_INTERVAL_SECONDS: shot } = config;
  // The screenshot check rides on the logging tick, so it can never be the
  // faster of the two.
  if (log !== undefined && shot !== undefined && shot < log) {
    problems.push(
      `SCREENSHOT_INTERVAL_SECONDS (${shot}) cannot be smaller than ` +
      `LOG_INTERVAL_SECONDS (${log}).`
    );
  }

  validateTelegram(values, config, problems);

  if (problems.length) {
    throw new Error(`Problems in .env:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}

function readConfig(envPath) {
  if (!fs.existsSync(envPath)) {
    throw new Error('No .env found. Copy .env.example to .env and fill it in.');
  }
  return validate(parseEnv(fs.readFileSync(envPath, 'utf8')));
}

/**
 * Swaps the __SITE_URL__ slot for the real pattern, in place. Anything else in
 * those lists is left alone, which is how "<all_urls>" survives: screenshots
 * need it, and it must not be overwritten by the site pattern.
 */
function fillTemplate(manifest, siteUrl) {
  const swap = (entry) => (entry === '__SITE_URL__' ? siteUrl : entry);

  manifest.host_permissions = manifest.host_permissions.map(swap);
  for (const script of manifest.content_scripts) {
    script.matches = script.matches.map(swap);
  }
  return manifest;
}

function writeManifest(config) {
  const template = path.join(ROOT, 'manifest.template.json');
  if (!fs.existsSync(template)) {
    throw new Error('manifest.template.json is missing.');
  }

  const manifest = fillTemplate(JSON.parse(fs.readFileSync(template, 'utf8')), config.SITE_URL);
  fs.writeFileSync(path.join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** null when it is off, so the worker has one thing to check. */
function telegramLiteral(config) {
  if (!config.TELEGRAM_BOT_TOKEN) return 'null';
  return JSON.stringify({
    token: config.TELEGRAM_BOT_TOKEN,
    chatId: config.TELEGRAM_CHAT_ID,
    intervalMs: config.TELEGRAM_INTERVAL_SECONDS * 1000
  });
}

function writeRuntimeConfig(config) {
  const body = `// Generated by build.js from .env. Do not edit by hand.
globalThis.QUEUE_REFRESH_CONFIG = {
  maxAttempts: ${config.MAX_ATTEMPTS},
  retryDelayMinMs: ${Math.round(config.RETRY_INTERVAL_MIN_SECONDS * 1000)},
  retryDelayMaxMs: ${Math.round(config.RETRY_INTERVAL_MAX_SECONDS * 1000)},
  responseTimeoutMs: ${config.RESPONSE_TIMEOUT_SECONDS * 1000},
  clickDelayMs: ${Math.round(config.CLICK_DELAY_SECONDS * 1000)},
  logIntervalMs: ${config.LOG_INTERVAL_SECONDS * 1000},
  screenshotIntervalMs: ${config.SCREENSHOT_INTERVAL_SECONDS * 1000},
  telegram: ${telegramLiteral(config)}
};
`;
  fs.writeFileSync(path.join(ROOT, 'src', 'config.js'), body);
}

function main() {
  const config = readConfig(path.join(ROOT, '.env'));
  writeManifest(config);
  writeRuntimeConfig(config);

  console.log('Extension updated from .env:');
  console.log(`  site              ${config.SITE_URL}`);
  console.log(`  max attempts      ${config.MAX_ATTEMPTS}`);
  console.log(
    `  retry interval    ${config.RETRY_INTERVAL_MIN_SECONDS}s to ` +
    `${config.RETRY_INTERVAL_MAX_SECONDS}s, random`
  );
  console.log(`  response timeout  ${config.RESPONSE_TIMEOUT_SECONDS}s`);
  console.log(`  click delay       ${config.CLICK_DELAY_SECONDS}s`);
  console.log(`  csv row every     ${config.LOG_INTERVAL_SECONDS}s`);
  console.log(`  screenshot every  ${config.SCREENSHOT_INTERVAL_SECONDS}s`);
  // The token is never printed. It is a credential and this output gets pasted.
  console.log(
    `  telegram          ${
      config.TELEGRAM_BOT_TOKEN
        ? `on, chat ${config.TELEGRAM_CHAT_ID}, every ${config.TELEGRAM_INTERVAL_SECONDS}s`
        : 'off'
    }`
  );
  console.log('\nNow press the reload arrow on the extension in chrome://extensions.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { parseEnv, validate, readConfig, toMatchPattern, fillTemplate };
