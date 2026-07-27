// pilot-login-outlook-cdp.js - sign the authorized test account into the
// already-running CDP Chrome profile on 127.0.0.1:18792.
//
// Inputs:
//   PILOT_TEST_EMAIL
//   PILOT_TEST_PASSWORD
// Optional:
//   PILOT_CDP_ENDPOINT (default http://127.0.0.1:18792)
//
// Output avoids printing the password or message bodies.

const path = require('node:path');

const cdp = process.env.PILOT_CDP_ENDPOINT || 'http://127.0.0.1:18792';
const email = process.env.PILOT_TEST_EMAIL;
const password = process.env.PILOT_TEST_PASSWORD;

if (!email || !password) {
  console.error('STATE: MISSING_CREDENTIAL_ENV');
  process.exit(2);
}

const playwrightPath = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'Ministry of Education',
  'resources',
  'openclaw',
  'node_modules',
  'playwright-core',
);

const { chromium } = require(playwrightPath);

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).slice(0, 160);
  }
}

async function clickIfVisible(page, selectors, timeout = 2500) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.click({ timeout: 5000 });
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  return null;
}

async function fillIfVisible(page, selectors, value, timeout = 5000) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.fill(value, { timeout: 10000 });
        return selector;
      }
    } catch {
      // Try next selector.
    }
  }
  return null;
}

async function main() {
  console.log(`CDP: ${cdp}`);
  const browser = await chromium.connectOverCDP(cdp, { timeout: 10000 });
  const context = browser.contexts()[0] || await browser.newContext();
  let page = context.pages().find((p) => /login\.microsoftonline|outlook\./i.test(p.url()));
  page ||= context.pages()[0] || await context.newPage();

  if (!/outlook\.office|outlook\.cloud|login\.microsoftonline/i.test(page.url())) {
    await page.goto('https://outlook.office.com/mail/inbox', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  console.log(`URL_BEFORE: ${redactUrl(page.url())}`);

  if (/outlook\.(office|cloud|office365)\.com\/mail/i.test(page.url())) {
    console.log('STATE: OUTLOOK_ALREADY_SIGNED_IN');
    await browser.close();
    return;
  }

  const emailSelector = await fillIfVisible(page, [
    'input[type="email"]',
    'input[name="loginfmt"]',
    '#i0116',
  ], email, 10000);
  if (emailSelector) {
    console.log('EMAIL_FILLED: yes');
    await clickIfVisible(page, [
      'input[type="submit"]',
      'button[type="submit"]',
      '#idSIButton9',
      'text=/^Next$/i',
    ], 10000);
  } else {
    console.log('EMAIL_FILLED: no');
  }

  const passwordSelector = await fillIfVisible(page, [
    'input[type="password"]',
    'input[name="passwd"]',
    '#i0118',
  ], password, 30000);
  if (!passwordSelector) {
    console.log(`STATE: PASSWORD_FIELD_NOT_FOUND url=${redactUrl(page.url())}`);
    await browser.close();
    process.exit(10);
  }

  console.log('PASSWORD_FILLED: yes');
  await clickIfVisible(page, [
    'input[type="submit"]',
    'button[type="submit"]',
    '#idSIButton9',
    'text=/^Sign in$/i',
  ], 10000);

  await page.waitForTimeout(3000);
  await clickIfVisible(page, [
    '#idSIButton9',
    'input[type="submit"]',
    'button[type="submit"]',
    'text=/^Yes$/i',
    'text=/^Stay signed in$/i',
  ], 5000);

  await page.waitForURL(/outlook\.(office|cloud|office365)\.com\/mail/i, {
    timeout: 60000,
  }).catch(() => {});
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

  console.log(`URL_AFTER: ${redactUrl(page.url())}`);
  if (/outlook\.(office|cloud|office365)\.com\/mail/i.test(page.url())) {
    console.log('STATE: OUTLOOK_SIGNED_IN');
  } else if (/mfa|proof|conditionalaccess|error|login/i.test(page.url())) {
    console.log('STATE: LOGIN_BLOCKED_OR_NEEDS_INTERACTION');
  } else {
    console.log('STATE: LOGIN_AMBIGUOUS');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(`STATE: LOGIN_SCRIPT_FAILED`);
  console.error(`ERROR: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
