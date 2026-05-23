/**
 * Verify draftEmail() opens a compose pane and fills it correctly.
 * Does NOT send — just leaves the draft open.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  console.log('[1] draftEmail to self');
  const t0 = Date.now();
  const r = await actions.draftEmail({
    to: 'test.fac@fac.edu.tt',
    subject: 'v2 smoke ' + new Date().toISOString().slice(11, 19),
    body: 'This is an automated draft from outlook-browser-v2. Do not send. Close this draft.',
  });
  console.log(`  -> ${Date.now() - t0}ms — status=${r.status} draftLeftOpen=${r.draftLeftOpen}`);
  if (r.message) console.log(`  message: ${r.message}`);
  console.log(`  preview.to=${r.preview.to.join(',')} subject="${r.preview.subject}"`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
