/**
 * Pull the Forms-scoped Bearer from cookies (NOT MSAL).
 * AADAuth.forms is the Forms-issued JWT; that's what the captured request used.
 */
import { chromium } from 'playwright-core';

async function main() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18792');
  const ctx = browser.contexts()[0];
  if (!ctx) { console.error('no contexts'); process.exit(1); }
  const cookies = await ctx.cookies('https://forms.office.com');
  console.log(`Got ${cookies.length} cookies for forms.office.com:\n`);
  for (const c of cookies) {
    const v = c.value;
    const looksJwt = v.startsWith('eyJ');
    console.log(`  ${c.name.padEnd(40)} len=${String(v.length).padStart(5)} ${looksJwt ? '[JWT]' : ''} preview="${v.slice(0, 40)}..."`);
  }
  console.log('\nForms-related cookies:');
  for (const c of cookies) {
    if (/forms|aadauth|oidc/i.test(c.name)) {
      console.log(`\n  ${c.name} (${c.value.length} chars):`);
      console.log(`    ${c.value.slice(0, 120)}...`);
    }
  }
  await browser.close().catch(() => null);
}

main().catch((err) => { console.error(err); process.exit(1); });
