#!/usr/bin/env node

const crypto = require('node:crypto');
const { chromium } = require('playwright-core');

const endpoint = process.argv[2] || 'http://127.0.0.1:18792';
const closeResponseTabs = process.argv.includes('--close-response-tabs');

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function summarizeUrl(raw) {
  try {
    const u = new URL(raw);
    const id = u.searchParams.get('id') || u.searchParams.get('FormId') || u.searchParams.get('formId') || '';
    return {
      host: u.host,
      pathname: u.pathname,
      hasId: Boolean(id),
      idHash: id ? digest(id) : null,
    };
  } catch {
    return { host: null, pathname: null, hasId: false, idHash: null };
  }
}

(async () => {
  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const rows = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (!/forms\.(office\.com|cloud\.microsoft)/i.test(url)) continue;
        if (closeResponseTabs && /\/Pages\/ResponsePage\.aspx/i.test(url)) {
          await page.close().catch(() => null);
          rows.push({ ...summarizeUrl(url), closed: true });
          continue;
        }
        const title = await page.title().catch(() => '');
        const h1 = await page.locator('h1').first().textContent({ timeout: 1000 }).catch(() => '');
        const questionItems = page.locator('[data-automation-id="questionItem"], [role="listitem"]');
        const questionCount = await questionItems.count().catch(() => 0);
        const questions = [];
        for (let i = 0; i < Math.min(questionCount, 16); i += 1) {
          const text = await questionItems.nth(i).innerText({ timeout: 1000 }).catch(() => '');
          questions.push(text.replace(/\s+/g, ' ').trim().slice(0, 180));
        }
        const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
        rows.push({
          ...summarizeUrl(url),
          title,
          h1: (h1 || '').trim().slice(0, 120),
          questionCount,
          questions,
          bodySample: bodyText.replace(/\s+/g, ' ').trim().slice(0, 260),
        });
      }
    }
    console.log(JSON.stringify({ state: 'FORMS_CDP_INSPECT_DONE', endpoint, pages: rows }, null, 2));
  } finally {
    await browser.close().catch(() => null);
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
