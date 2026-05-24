/**
 * Reset Outlook test state between eval runs:
 *  1. Close any open compose pane (Esc key)
 *  2. Navigate to Drafts folder
 *  3. Select-all + delete (those are eval-harness drafts)
 *  4. Navigate back to inbox
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab();

  // 1. Close compose if any (Esc usually closes Fluent dialogs/panels)
  await driver.pressKey('Escape');
  await driver.sleep(400);
  await driver.pressKey('Escape');
  await driver.sleep(400);

  // 2. Navigate to Drafts folder. Outlook keyboard shortcut: Ctrl+Shift+D
  // (sometimes conflicts) — instead, navigate by URL fragment or click
  // the Drafts treeitem.
  const draftsLink = page.getByRole('treeitem', { name: /^drafts/i }).first();
  if ((await draftsLink.count()) > 0) {
    await draftsLink.click({ timeout: 5_000 }).catch(() => null);
    await driver.sleep(1000);
  }

  // 3. Select all, delete. Avoid accidental select-all on the entire inbox
  // by being scoped to whichever folder is open. Use Ctrl+A then Delete.
  await driver.pressKey('Control+a');
  await driver.sleep(200);
  await driver.pressKey('Delete');
  await driver.sleep(800);

  // 4. Confirm dialog if any (Outlook sometimes asks "Move N items?")
  const confirm = page.getByRole('button', { name: /^(ok|yes|delete)$/i }).first();
  if ((await confirm.count()) > 0) {
    await confirm.click({ timeout: 3_000 }).catch(() => null);
    await driver.sleep(600);
  }

  // 5. Navigate back to Inbox
  const inboxLink = page.getByRole('treeitem', { name: /^inbox/i }).first();
  if ((await inboxLink.count()) > 0) {
    await inboxLink.click({ timeout: 5_000 }).catch(() => null);
    await driver.sleep(1000);
  }

  console.log('cleanup done; URL:', page.url());
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
