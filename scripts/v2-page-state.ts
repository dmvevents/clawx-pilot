/**
 * Quick state probe — what URL is the Outlook tab on right now, and what
 * does the visible viewport look like? Saves a screenshot to /tmp.
 *
 * Run: pnpm exec tsx scripts/v2-page-state.ts
 */
import { writeFileSync } from 'fs';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab();
  const url = page.url();
  const title = await page.title();
  console.log('URL:', url);
  console.log('TITLE:', title);

  const shot = await driver.screenshotViewport();
  const path = '/tmp/outlook-page-state.png';
  writeFileSync(path, shot.png);
  console.log(`Saved screenshot: ${path} (${shot.width}x${shot.height})`);

  // Probe: how many aria-labelled rows are visible right now?
  const rows = await page.evaluate(() => {
    const els = document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]');
    return Array.from(els).slice(0, 5).map((el) => el.getAttribute('aria-label') ?? '');
  });
  console.log(`Found ${rows.length} aria-labelled rows. First few:`);
  rows.forEach((r, i) => console.log(`  [${i}] ${r.slice(0, 100)}`));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
