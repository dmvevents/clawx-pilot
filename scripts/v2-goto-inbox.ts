/** Force-navigate the Outlook tab back to /mail/ to escape the read pane. */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab({ forceNavigate: true });
  await page.waitForLoadState('domcontentloaded');
  console.log('URL:', page.url());
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
