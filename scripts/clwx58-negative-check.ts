/**
 * CLWX-58 SAFETY half: a human-looking open draft must NEVER be auto-discarded.
 *
 * Seeds a draft whose subject does NOT match the automation allowlist, then
 * calls draftEmail again: the recovery must REFUSE, name the blocking draft,
 * and the second draft must fail with draftLeftOpen=true. Cleanup uses the
 * standalone cleanup script semantics (explicit discard) at the end.
 * Exit 0 PASS / 1 FAIL / 2 lane.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const actions = new OutlookActions(driver, new VlmGrounder());
  const HUMAN_SUBJECT = 'PTA meeting agenda notes';

  const open = await actions.open();
  if (open.status !== 'opened') { console.log(`LANE: open=${open.status}`); process.exit(2); }

  console.log('Step 1: seed a HUMAN-looking draft (must survive recovery)');
  const first = await actions.draftEmail({
    to: ['test.fac@fac.edu.tt'], subject: HUMAN_SUBJECT,
    body: 'Notes a principal might be mid-writing. Do not touch.',
  });
  console.log(`  → ${first.status} leftOpen=${first.draftLeftOpen}`);
  if (first.status !== 'drafted') { console.log('  ✗ could not seed'); process.exit(2); }

  console.log('Step 2: second draft must be BLOCKED with the human draft named');
  const second = await actions.draftEmail({
    to: ['test.fac@fac.edu.tt'], subject: `eval ${new Date().toISOString().slice(11, 19)}`,
    body: 'should be blocked',
  });
  const blocked = second.status !== 'drafted';
  const named = (second.message ?? '').includes(HUMAN_SUBJECT);
  console.log(`  → status=${second.status} named=${named} msg=${(second.message ?? '').slice(0, 140)}`);

  console.log('Step 3: verify the human draft is STILL OPEN (never discarded)');
  const page = await driver.ensureOutlookTab();
  const stillOpen = await (actions as unknown as { hasAnyVisibleOpenDraft: (p: unknown) => Promise<boolean> })
    .hasAnyVisibleOpenDraft(page);
  console.log(`  → stillOpen=${stillOpen}`);

  console.log('Step 4: cleanup (explicit, test-owned)');
  await (actions as unknown as { discardOwnCompose: (p: unknown) => Promise<void> }).discardOwnCompose(page);

  if (blocked && named && stillOpen) { console.log('\nCLWX58-NEG PASS — human draft protected and named'); process.exit(0); }
  console.log('\nCLWX58-NEG FAIL');
  process.exit(1);
}

main().catch((err) => { console.error('INFRA:', err instanceof Error ? err.message : String(err)); process.exit(2); });
