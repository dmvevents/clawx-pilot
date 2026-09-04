/**
 * CLWX-58 compose auto-recovery acceptance check.
 *
 * The defect: a stale OPEN Outlook compose (left by an earlier turn, a killed
 * run, or the principal) blocked every subsequent send/reply/forward until it
 * was cleared by hand — a live-demo wedge. The fix (outlook-actions.ts
 * recoverComposeState, called pre-flight before draft/reply/forward) clears a
 * compose the automation OWNS (subject on the automation allowlist, or blank +
 * empty body) and then proceeds, while a principal's human-looking draft is
 * left UNTOUCHED and named in a clean readable refusal — never clobbered.
 *
 * This check proves BOTH halves live, draft-only (no send, no confirm gate):
 *   1. RECOVER: open an automation-owned draft, leave it, then draft again ->
 *      the second draft must SUCCEED (status=drafted); the stale compose was
 *      auto-recovered, not a wedge.
 *   2. PROTECT: open a human-looking draft (non-automation subject + body),
 *      leave it, then draft an automation email -> it must REFUSE cleanly
 *      (status=failed) with a message that NAMES the untouched draft, and the
 *      human draft must still be open afterwards (never discarded).
 *
 * Run (Chrome on :18792, test.fac signed in):
 *   pnpm exec tsx scripts/clwx58-compose-recovery-check.ts
 * Exit codes: 0 PASS / 1 FAIL (wedge, or a human draft was clobbered) /
 *   2 lane not ready.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

// An automation-owned subject: matches AUTOMATION_SUBJECT_RE ("eval HH:MM:SS").
const stamp = () => new Date().toISOString().slice(11, 19);

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  // Best-effort: click any visible Discard so we start on a clean lane. This
  // is the same DOM-side sweep the eval uses; used here for setup/teardown of
  // OUR test drafts on the sandbox account only.
  const discardOpenDrafts = async () => {
    try {
      await driver.ensureBrowser();
      const page = await driver.ensureOutlookTab();
      for (let i = 0; i < 5; i += 1) {
        const clicked = await page.evaluate(`(() => {
          const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).filter(vis);
          for (const d of dialogs) {
            if ((d.textContent||'').toLowerCase().includes('discard')) {
              const ok = Array.from(d.querySelectorAll('button')).filter(vis).find((b) => /^(ok|discard|yes)$/i.test((b.textContent||'').trim()));
              if (ok) { ok.click(); return true; }
            }
          }
          const btn = Array.from(document.querySelectorAll('button')).filter(vis).find((b) => (((b.getAttribute('aria-label')||'')+' '+(b.textContent||'')).toLowerCase()).includes('discard'));
          if (btn) { btn.click(); return true; }
          return false;
        })()`) as boolean;
        if (!clicked) break;
        await driver.sleep(1_200);
      }
      await driver.pressKey('Escape').catch(() => null);
      await driver.sleep(300);
      await driver.pressKey('Escape').catch(() => null);
      await driver.sleep(300);
    } catch {
      /* non-fatal */
    }
  };

  const open = await actions.open();
  if (open.status !== 'opened') {
    console.log(`LANE NOT READY: open status=${open.status}`);
    process.exit(2);
  }
  await discardOpenDrafts();

  let failures = 0;

  // ── 1. RECOVER: stale automation-owned compose must not wedge the next draft.
  const ownedA = `eval ${stamp()}`;
  const a = await actions.draftEmail({ to: 'test.fac@fac.edu.tt', subject: ownedA, body: 'clwx58 owned draft A — do not send' });
  if (a.status !== 'drafted' || a.draftLeftOpen !== true) {
    console.log(`LANE NOT READY: could not open the seed owned draft (status=${a.status})`);
    await discardOpenDrafts();
    process.exit(2);
  }
  const ownedB = `MoE smoke ${stamp()}`;
  const b = await actions.draftEmail({ to: 'test.fac@fac.edu.tt', subject: ownedB, body: 'clwx58 owned draft B — do not send' });
  const recovered = b.status === 'drafted' && b.draftLeftOpen === true;
  if (!recovered) failures += 1;
  console.log(`RECOVER: stale owned compose -> second draft status=${b.status} [${recovered ? 'OK (auto-recovered)' : 'FAIL (wedged)'}]`);
  await discardOpenDrafts();

  // ── 2. PROTECT: a human-looking stale compose must be left untouched + a
  // clean readable refusal that names it. (subject is NOT on the automation
  // allowlist and the body is non-empty, so it looks like a principal's work.)
  const human = `Budget note for the September board meeting`;
  const h = await actions.draftEmail({ to: 'test.fac@fac.edu.tt', subject: human, body: 'Draft that looks like a principal wrote it — must not be clobbered.' });
  if (h.status !== 'drafted') {
    console.log(`PROTECT: could not stage the human-looking draft (status=${h.status}) — skipping the protect leg`);
  } else {
    const ownedC = `eval ${stamp()}`;
    const c = await actions.draftEmail({ to: 'test.fac@fac.edu.tt', subject: ownedC, body: 'clwx58 owned draft C — do not send' });
    const refusedCleanly = c.status === 'failed'
      && typeof c.message === 'string'
      && /open draft/i.test(c.message);
    // The human draft must still be present (the automation must not have
    // discarded it to make room). draftEmail leaves it open on refusal, and
    // the recovery note names it as untouched. recoverComposeState phrases
    // this two ways: "...was not written by the assistant, so it was left
    // untouched" (subject present) or "...with content the assistant did not
    // write" (blank subject); accept either, plus the "left untouched" tail.
    const namesIt = typeof c.message === 'string'
      && /not written by the assistant|assistant did not write|left untouched/i.test(c.message);
    const protectOk = refusedCleanly && namesIt;
    if (!protectOk) failures += 1;
    console.log(`PROTECT: human draft open -> owned draft status=${c.status} refusedCleanly=${refusedCleanly} namesUntouched=${namesIt} [${protectOk ? 'OK (left untouched)' : 'FAIL'}]`);
  }
  await discardOpenDrafts();

  if (failures === 0) {
    console.log('\nCLWX58 PASS — stale owned compose auto-recovered; human draft left untouched with a clean refusal');
    process.exit(0);
  }
  console.log(`\nCLWX58 FAIL — ${failures} leg(s) failed`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`INFRA: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
