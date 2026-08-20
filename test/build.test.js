const test = require('node:test');
const assert = require('node:assert');
const { parseEnv, validate } = require('../build.js');

const good = {
  SITE_URL: 'https://app.example.com/*',
  MAX_ATTEMPTS: '200',
  RETRY_INTERVAL_SECONDS: '10',
  RESPONSE_TIMEOUT_SECONDS: '15',
  CLICK_DELAY_SECONDS: '1'
};

test('parses keys, skipping comments and blank lines', () => {
  const text = '# a comment\n\nSITE_URL=https://app.example.com/*\nMAX_ATTEMPTS=5\n';
  assert.deepStrictEqual(parseEnv(text), {
    SITE_URL: 'https://app.example.com/*',
    MAX_ATTEMPTS: '5'
  });
});

test('strips surrounding quotes and whitespace', () => {
  assert.deepStrictEqual(parseEnv('  SITE_URL = "https://a.com/*" '), {
    SITE_URL: 'https://a.com/*'
  });
});

test('keeps = signs that appear inside a value', () => {
  assert.deepStrictEqual(parseEnv('SITE_URL=https://a.com/?x=1'), {
    SITE_URL: 'https://a.com/?x=1'
  });
});

test('accepts a valid config and converts numbers', () => {
  assert.deepStrictEqual(validate(good), {
    SITE_URL: 'https://app.example.com/*',
    MAX_ATTEMPTS: 200,
    RETRY_INTERVAL_SECONDS: 10,
    RESPONSE_TIMEOUT_SECONDS: 15,
    CLICK_DELAY_SECONDS: 1
  });
});

test('accepts a fractional click delay', () => {
  assert.strictEqual(validate({ ...good, CLICK_DELAY_SECONDS: '0.5' }).CLICK_DELAY_SECONDS, 0.5);
});

test('accepts a click delay of zero', () => {
  assert.strictEqual(validate({ ...good, CLICK_DELAY_SECONDS: '0' }).CLICK_DELAY_SECONDS, 0);
});

test('rejects a negative click delay', () => {
  assert.throws(() => validate({ ...good, CLICK_DELAY_SECONDS: '-1' }), /0 or more/);
});

test('appends the /* match suffix when it is missing', () => {
  const config = validate({ ...good, SITE_URL: 'https://app.example.com' });
  assert.strictEqual(config.SITE_URL, 'https://app.example.com/*');
});

test('rejects the untouched placeholder', () => {
  assert.throws(
    () => validate({ ...good, SITE_URL: 'https://REPLACE-ME.example.com/*' }),
    /still the placeholder/
  );
});

test('rejects a URL without a scheme', () => {
  assert.throws(() => validate({ ...good, SITE_URL: 'app.example.com' }), /must start with http/);
});

test('rejects non-numeric and zero values', () => {
  assert.throws(() => validate({ ...good, MAX_ATTEMPTS: 'lots' }), /whole number/);
  assert.throws(() => validate({ ...good, RETRY_INTERVAL_SECONDS: '0' }), /whole number/);
  assert.throws(() => validate({ ...good, RESPONSE_TIMEOUT_SECONDS: '1.5' }), /whole number/);
});

test('reports every missing field at once', () => {
  assert.throws(() => validate({}), (error) => {
    assert.match(error.message, /SITE_URL is missing/);
    assert.match(error.message, /RESPONSE_TIMEOUT_SECONDS is missing/);
    return true;
  });
});
