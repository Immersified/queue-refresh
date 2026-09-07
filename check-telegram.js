#!/usr/bin/env node
/**
 * Sends one test message using the Telegram settings already in .env.
 *
 * Run this before touching the extension. It separates "the token and chat id
 * are right" from "the extension is wired up", which are different problems
 * with different fixes, and it reads the token from .env so it never has to be
 * retyped or pasted anywhere.
 *
 *   node check-telegram.js
 */
const fs = require('fs');
const path = require('path');
const { parseEnv, validateTelegram } = require('./build.js');

// Telegram explains itself well, but not always in terms of what to go and do.
const ADVICE = {
  'chat not found':
    'Open Telegram, find your bot, and send it any message. A bot cannot start\n' +
    '  a conversation, so it can only reply to someone who spoke to it first.',
  Unauthorized:
    'The token is wrong or has been revoked. Check TELEGRAM_BOT_TOKEN against\n' +
    '  what BotFather sent, or run /revoke and paste the new one.',
  'bot was blocked by the user': 'Unblock the bot in Telegram, then try again.'
};

function adviseOn(description) {
  const hit = Object.keys(ADVICE).find((key) => description.includes(key));
  return hit ? `\n  ${ADVICE[hit]}` : '';
}

/**
 * Only the Telegram half is checked. A wrong SITE_URL has nothing to do with
 * whether a bot token works, and should not stand in the way of finding out.
 */
function readTelegramConfig() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('No .env found. Copy .env.example to .env and fill it in.');
  }

  const config = {};
  const problems = [];
  validateTelegram(parseEnv(fs.readFileSync(envPath, 'utf8')), config, problems);

  if (problems.length) throw new Error(`Problems in .env:\n  - ${problems.join('\n  - ')}`);
  return config;
}

async function main() {
  const config = readTelegramConfig();

  if (!config.TELEGRAM_BOT_TOKEN) {
    console.log('Telegram is off: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are blank in .env.');
    return;
  }

  // The chat id is safe to show and is the usual thing to get wrong. The token
  // is never printed.
  console.log(`Sending a test message to chat ${config.TELEGRAM_CHAT_ID}...`);

  const response = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text: 'Queue Refresh: test message. If you can read this, it works.'
      })
    }
  );

  const body = await response.json().catch(() => ({}));

  if (body.ok) {
    console.log('Sent. Check your phone.');
    return;
  }

  const description = body.description || `HTTP ${response.status}`;
  throw new Error(`Telegram said: ${description}${adviseOn(description)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
