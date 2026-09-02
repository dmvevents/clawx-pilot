/**
 * RAJ-3 reproduce-or-refute: "reply action archives the original email".
 *
 * Scenario: read the inbox, open a reply draft on the newest message, close
 * the reply WITHOUT sending, then re-read the inbox and assert the original
 * message is still there (not archived/moved). Same harness construction as
 * v2-eval.ts. Sandbox lane only; nothing is dispatched.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

(async () => {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  console.log('Step 1: read inbox (before)');
  const before = await actions.readInbox(5);
  if (before.status !== 'ok' || !before.messages?.length) {
    console.error('FATAL: could not read inbox:', before.status);
    process.exit(2);
  }
  const target = before.messages[0];
  console.log(`  target: id=${(target.id ?? '').slice(0, 18)}… subject="${(target.subject ?? '').slice(0, 40)}"`);

  console.log('Step 2: open reply draft (never dispatched)');
  const reply = await actions.reply({
    id: target.id!,
    body: 'RAJ-3 archive-check probe reply. Not for delivery.',
  });
  console.log(`  reply status: ${reply.status}`);

  console.log('Step 3: discard the reply pane');
  const page = await driver.ensureOutlookTab();
  for (let i = 0; i < 3; i += 1) {
    const discard = page.locator('button[aria-label*="Discard" i], button:has-text("Discard")');
    if (await discard.count()) {
      await discard.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const confirm = page.locator('button:has-text("Discard"), button:has-text("OK")');
      if (await confirm.count()) await confirm.first().click({ timeout: 2000 }).catch(() => {});
      break;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
  }

  console.log('Step 4: re-read inbox (after) and assert original still present');
  const after = await actions.readInbox(10);
  const stillThere = (after.messages ?? []).some((m) => m.id === target.id
    || ((m.subject ?? '') === (target.subject ?? '') && (m.from ?? '') === (target.from ?? '')));
  console.log(`  original present after reply flow: ${stillThere}`);
  console.log(stillThere
    ? 'RAJ-3 VERDICT: NOT REPRODUCED — reply flow does not archive the original.'
    : 'RAJ-3 VERDICT: REPRODUCED — original missing from inbox after reply flow!');
  await driver.close().catch(() => {});
  process.exit(stillThere ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e instanceof Error ? e.message : String(e)); process.exit(2); });
