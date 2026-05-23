/**
 * Quick smoke test for the VLM grounder against a real Outlook screenshot.
 * Confirms Bedrock Sonnet 4.5 can find the New Mail button. No mocks.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  await driver.ensureBrowser();
  await driver.ensureOutlookTab();

  const shot = await driver.screenshotViewport();
  console.log(`Screenshot ${shot.width}x${shot.height}, ${shot.png.length} bytes`);

  const t0 = Date.now();
  const result = await grounder.ground({
    screenshotPng: shot.png,
    imageWidth: shot.width,
    imageHeight: shot.height,
    question:
      'The "New mail" button in the Outlook toolbar at the top-left. It opens a blank compose pane.',
  });
  console.log(`grounded in ${Date.now() - t0}ms`);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
