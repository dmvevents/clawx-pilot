import { completeSetup, expect, test } from './fixtures/electron';

/**
 * Microsoft 365 connection setup states (harness/specs/tasks/
 * graph-connection-setup-states.md).
 *
 * On a vanilla install (no microsoft-graph.json tenant defaults) the section
 * must say plainly that nothing is connected and that email tools answer
 * from the demo mailbox; after an administrator saves tenant + client id it
 * must transition to a signed-out state with a Sign in action — without ever
 * presenting the mock mailbox as a live connection. Actual sign-in requires
 * the account holder and is out of scope for automated tests.
 */
test.describe('Microsoft 365 connection setup states', () => {
  test('vanilla install shows unconfigured, saving config yields signed_out with Sign in', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();

    const section = page.getByTestId('settings-msgraph-section');
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();

    // Unconfigured: explicit state + admin form, and honest demo-mailbox copy.
    const state = page.getByTestId('msgraph-connection-state');
    await expect(state).toHaveAttribute('data-state', 'unconfigured');
    await expect(state).toContainText('Not connected');
    await expect(state).toContainText('demo mailbox');
    await expect(page.getByTestId('msgraph-tenant-input')).toBeVisible();
    await expect(page.getByTestId('msgraph-clientid-input')).toBeVisible();
    await expect(page.getByTestId('msgraph-signin-btn')).toHaveCount(0);

    // Administrator saves the (non-secret) tenant + client id values.
    await page.getByTestId('msgraph-tenant-input').fill('moe.gov.tt');
    await page
      .getByTestId('msgraph-clientid-input')
      .fill('11111111-2222-3333-4444-555555555555');
    await section.getByRole('button', { name: 'Save configuration' }).click();

    // Configured but signed out: saving must not claim any connection.
    await expect(state).toHaveAttribute('data-state', 'signed_out');
    await expect(state).toContainText('Not signed in');
    await expect(page.getByTestId('msgraph-signin-btn')).toBeVisible();
    await expect(page.getByTestId('msgraph-signin-btn')).toBeEnabled();
    // Signed out ⇒ reads would be served by fixtures; the badge must say so.
    await expect(state).toContainText('Mock mailbox');
  });
});
