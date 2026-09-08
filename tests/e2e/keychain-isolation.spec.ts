import { closeElectronApp, expect, test } from './fixtures/electron';

test('macOS isolated profiles can encrypt and relaunch without the operator Keychain', async ({
  electronApp,
  launchElectronApp,
  userDataDir,
}) => {
  test.skip(process.platform !== 'darwin', 'macOS Keychain isolation');

  const plaintext = 'synthetic-e2e-storage-round-trip';
  const encrypted = await electronApp.evaluate(({ app, safeStorage }, value) => {
    if (!app.commandLine.hasSwitch('use-mock-keychain')
      || !app.commandLine.getSwitchValue('disable-features').split(',').includes('UseKeychainKeyProvider')) {
      throw new Error('Refusing to exercise secure storage without test Keychain isolation');
    }
    return {
      userData: app.getPath('userData'),
      ciphertext: Array.from(safeStorage.encryptString(value)),
    };
  }, plaintext);
  expect(encrypted.userData).toBe(userDataDir);
  expect(encrypted.ciphertext.length).toBeGreaterThan(0);
  await expect((await electronApp.firstWindow()).getByTestId('setup-page')).toBeVisible();
  await closeElectronApp(electronApp);

  const relaunched = await launchElectronApp();
  try {
    const recovered = await relaunched.evaluate(({ app, safeStorage }, ciphertext) => ({
      userData: app.getPath('userData'),
      plaintext: safeStorage.decryptString(Buffer.from(ciphertext)),
    }), encrypted.ciphertext);
    expect(recovered.userData).toBe(userDataDir);
    expect(recovered.plaintext).toBe(plaintext);
    await expect((await relaunched.firstWindow()).getByTestId('setup-page')).toBeVisible();
  } finally {
    await closeElectronApp(relaunched);
  }
});
