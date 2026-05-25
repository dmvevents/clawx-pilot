/**
 * Live send test against test.fac@fac.edu.tt.
 * Drafts → asserts hard-confirm gate refuses on subject mismatch →
 * confirms with matching subject → sends. End-to-end proof that the
 * full path (LLM-shaped tool call → action → real Outlook click → sent)
 * works on moe.10.
 *
 * After this lands, the inbox will have 1+ messages and the v2-eval
 * skipped rows can run with content.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  const subject = `MoE smoke ${new Date().toISOString().slice(11, 19)}`;
  const body = 'Live send test from ClawX moe.10 — populating the inbox so the eval suite has rows to read.';

  console.log('Step 1: open');
  const o = await actions.open();
  console.log('  →', o.status);

  console.log('Step 2: draft');
  const d = await actions.draftEmail({ to: 'test.fac@fac.edu.tt', subject, body });
  console.log('  →', d.status, 'leftOpen=', d.draftLeftOpen);
  if (d.status !== 'drafted') {
    console.log('  ✗ aborting — could not draft');
    process.exit(1);
  }

  console.log('Step 3: assert subject-mismatch refuses');
  const refused = await actions.sendEmail({
    to: 'test.fac@fac.edu.tt',
    subject: 'WRONG SUBJECT',
    body,
    confirm: true,
  });
  console.log('  →', refused.status, refused.reason ?? '');
  if (refused.status !== 'refused') {
    console.log('  ✗ aborting — subject-match gate did not refuse');
    process.exit(1);
  }

  console.log('Step 4: send with matching subject + confirm:true');
  const sent = await actions.sendEmail({
    to: 'test.fac@fac.edu.tt',
    subject,
    body,
    confirm: true,
  });
  console.log('  →', sent.status, sent.reason ?? sent.message ?? '');
  if (sent.status !== 'sent') {
    console.log('  ✗ aborting — send did not complete');
    process.exit(1);
  }

  console.log('\n=== SEND PASS ===');
  console.log(`Subject: ${subject}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
});
