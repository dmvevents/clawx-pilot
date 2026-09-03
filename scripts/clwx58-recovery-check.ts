/**
 * CLWX-58/70 live acceptance: compose auto-recovery on a seeded stale draft.
 *
 * Scenario (test.fac sandbox, Chrome CDP :18792):
 *   1. draftEmail #1 — leaves an automation draft open (subject "eval hh:mm:ss").
 *   2. draftEmail #2 — the OLD behavior hard-blocked ("already has an open
 *      draft"); the NEW behavior must auto-recover (discard the automation
 *      draft, allowlist-gated) and produce draft #2.
 *   3. Cleanup: discard draft #2.
 * Exit 0 PASS / 1 FAIL / 2 lane. No sends; confirm gates never touched.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const actions = new OutlookActions(driver, new VlmGrounder());
  const stamp = () => new Date().toISOString().slice(11, 19);

  const open = await actions.open();
  if (open.status !== 'opened') { console.log(`LANE: open=${open.status}`); process.exit(2); }

  console.log('Step 1: seed a stale automation draft');
  const first = await actions.draftEmail({
    to: ['test.fac@fac.edu.tt'], subject: `eval ${stamp()}`,
    body: 'Eval harness draft — do not send (CLWX-58 seed)', confirm: false,
  });
  console.log(`  → ${first.status} leftOpen=${first.draftLeftOpen}`);
  if (first.status !== 'drafted') { console.log('  ✗ could not seed'); process.exit(2); }

  console.log('Step 2: second draft must auto-recover, not block');
  const second = await actions.draftEmail({
    to: ['test.fac@fac.edu.tt'], subject: `eval ${stamp()}`,
    body: 'Eval harness draft — do not send (CLWX-58 second)', confirm: false,
  });
  console.log(`  → ${second.status} msg=${(second.message ?? '').slice(0, 90)}`);

  console.log('Step 3: cleanup');
  const page = await driver.ensureOutlookTab();
  // Reuse the recovery machinery itself for cleanup (it owns this draft).
  await (actions as unknown as { recoverComposeState: (p: unknown) => Promise<{ cleared: boolean; note: string }> })
    .recoverComposeState(page).then((r) => console.log(`  → cleanup: cleared=${r.cleared} (${r.note})`)).catch(() => null);

  if (second.status === 'drafted') { console.log('\nCLWX58 PASS — auto-recovery cleared the stale automation draft'); process.exit(0); }
  console.log('\nCLWX58 FAIL — second draft did not succeed');
  process.exit(1);
}

main().catch((err) => { console.error('INFRA:', err instanceof Error ? err.message : String(err)); process.exit(2); });
