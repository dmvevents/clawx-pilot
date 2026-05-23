/**
 * Standalone smoke test for outlook-browser-v2.
 *
 * Bypasses Electron / IPC / host-API entirely. Imports the v2 manager
 * directly, drives a Playwright session against the Chrome already
 * running on 127.0.0.1:18792 (debug port), and reports what happened.
 *
 * Pre-reqs:
 *   1. Chrome running with --remote-debugging-port=18792 (any user data dir;
 *      isolated dir at /tmp/clawx-outlook-test recommended).
 *   2. The user is signed into an Outlook account in that Chrome session.
 *   3. ANTHROPIC_API_KEY exported in the env (only needed if VLM fallback fires).
 *
 * Run:
 *   ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY pnpm exec tsx scripts/v2-smoke.mjs
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

async function main() {
  console.log('=== outlook-browser-v2 smoke ===');

  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  console.log('[1/2] open()');
  const t0 = Date.now();
  const result = await actions.open();
  console.log(`  -> ${Date.now() - t0}ms status=${result.status} url=${result.url}`);
  if (result.message) console.log(`  message: ${result.message}`);

  if (result.status === 'opened') {
    console.log('[2/2] readInbox(5)');
    const t1 = Date.now();
    const inbox = await actions.readInbox(5);
    console.log(`  -> ${Date.now() - t1}ms status=${inbox.status} messages=${inbox.messages.length}`);
    inbox.messages.slice(0, 5).forEach((m, i) => {
      console.log(`    [${i}] ${m.unread ? 'UNREAD' : '     '} | ${m.sender.slice(0, 30).padEnd(30)} | ${m.subject.slice(0, 50)}`);
    });
  } else {
    console.log('  (skipping readInbox - open() returned non-opened status)');
  }
  console.log('=== done ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
