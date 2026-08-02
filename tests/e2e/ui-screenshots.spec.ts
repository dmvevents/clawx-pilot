/**
 * UI screenshot harness for the E2E design-review pass (2026-08-01).
 *
 * Drives the real Electron renderer through the principal-facing screens and
 * saves full-page PNGs to /tmp/clawx-ui-screens for out-of-band VLM grading
 * (Opus vision via bedrock-runtime). This is NOT an assertion-heavy spec — it
 * captures evidence. It fails only if a target screen never renders.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SHOT_DIR = process.env.CLAWX_SHOT_DIR || '/tmp/clawx-ui-screens';

async function shoot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
}

test.describe('UI screenshot capture', () => {
  test.setTimeout(120_000);

  test('captures the setup wizard on a fresh profile', async ({ launchElectronApp }) => {
    await mkdir(SHOT_DIR, { recursive: true });
    const app = await launchElectronApp(); // no skipSetup → fresh onboarding
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 30_000 });
      await shoot(page, '01-setup-welcome');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('captures the core principal-facing screens', async ({ launchElectronApp }) => {
    await mkdir(SHOT_DIR, { recursive: true });
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await shoot(page, '02-chat');

      const screens: Array<{ nav: string; page: string; shot: string }> = [
        { nav: 'sidebar-nav-models', page: 'models-page', shot: '03-models' },
        { nav: 'sidebar-nav-agents', page: 'agents-page', shot: '04-agents' },
        { nav: 'sidebar-nav-channels', page: 'channels-page', shot: '05-channels' },
        { nav: 'sidebar-nav-skills', page: 'skills-page', shot: '06-skills' },
        { nav: 'sidebar-nav-cron', page: 'cron-page', shot: '07-cron' },
        { nav: 'sidebar-nav-settings', page: 'settings-page', shot: '08-settings' },
      ];

      for (const screen of screens) {
        const navItem = page.getByTestId(screen.nav);
        if (await navItem.count() === 0) continue;
        await navItem.click();
        // Best-effort: some pages may not carry the exact testid; still shoot.
        try {
          await expect(page.getByTestId(screen.page)).toBeVisible({ timeout: 10_000 });
        } catch {
          // capture whatever rendered so the VLM can judge it anyway
        }
        await shoot(page, screen.shot);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
});
