// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  defaultChromeCdpProfileDir,
  defaultChromeUserDataDir,
  diagnoseChromeCdp,
  ensureChromeCdpReady,
  type ChromeCdpRuntime,
} from '../../electron/services/chrome-cdp';

const userDataDir = 'C:\\Users\\Teacher\\AppData\\Local\\Google\\Chrome\\User Data';
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const env = {
  LOCALAPPDATA: 'C:\\Users\\Teacher\\AppData\\Local',
  APPDATA: 'C:\\Users\\Teacher\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
} as NodeJS.ProcessEnv;
const home = 'C:\\Users\\Teacher';

// The dedicated, NON-default automation profile the fixed launcher must use.
// Chrome M136+ refuses --remote-debugging-port on the OS-default dir (CLWX-73).
const cdpProfileDir = defaultChromeCdpProfileDir('win32', env, home);

function baseRuntime(overrides: Partial<ChromeCdpRuntime> = {}): ChromeCdpRuntime {
  return {
    platform: 'win32',
    env,
    homedir: home,
    existsSync: (candidate) => candidate === chromeExecutable,
    listChromeProcesses: vi.fn(async () => []),
    // Deterministic, no real process spawn for the diagnosis version probe.
    chromeProductVersion: vi.fn(async () => '136.0.7103.93'),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('chrome-cdp diagnostics', () => {
  it('resolves a non-default, user-owned CDP profile that is NOT the OS default dir', () => {
    // The whole fix hinges on this: the automation profile must differ from the
    // OS-default Chrome dir Chrome M136+ refuses remote debugging on, and it must
    // be an ordinary user profile (never a managed / "Ministry of Education" one).
    expect(cdpProfileDir).not.toBe(defaultChromeUserDataDir('win32', env, home));
    expect(cdpProfileDir).not.toContain('Ministry of Education');
    expect(cdpProfileDir).toContain('C:\\Users\\Teacher');
  });

  it('reports cdp_ready when the Chrome debugging endpoint responds', async () => {
    const runtime = baseRuntime({
      fetchJson: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/136.0.0.0', 'User-Agent': 'Chrome' },
      })),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result).toMatchObject({
      state: 'cdp_ready',
      action: 'none',
      browser: 'Chrome/136.0.0.0',
      chromeProcessCount: 0,
    });
  });

  it('returns chrome_not_found before attempting process repair', async () => {
    const listChromeProcesses = vi.fn(async () => []);
    const runtime = baseRuntime({
      existsSync: () => false,
      listChromeProcesses,
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('chrome_not_found');
    expect(result.action).toBe('install_chrome');
    expect(listChromeProcesses).not.toHaveBeenCalled();
  });

  it('launches system Chrome on the dedicated NON-default profile when CDP is closed (CLWX-73)', async () => {
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 4321, kill: vi.fn() }));
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/136.0.0.0' },
      });
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson,
      listChromeProcesses: vi.fn(async () => []),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);

    expect(result.state).toBe('cdp_ready');
    // The launch MUST use the dedicated non-default profile, never the OS default.
    expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
      '--remote-debugging-port=18792',
      `--user-data-dir=${cdpProfileDir}`,
      '--restore-last-session',
    ]));
    const launchArgs = spawnDetached.mock.calls[0][1];
    expect(launchArgs).not.toContain(`--user-data-dir=${userDataDir}`);
    expect(JSON.stringify(launchArgs)).not.toContain('Ministry of Education');
  });

  it('does not fight the user\'s already-open default Chrome; launches the dedicated profile alongside it (CLWX-73)', async () => {
    // The user's real Chrome is open on the DEFAULT profile with no debug port.
    // We must NOT tell them to close it — we launch our own non-default profile.
    let now = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 77, kill: vi.fn() }));
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      listChromeProcesses: vi.fn(async () => [
        { pid: 42, commandLine: `"${chromeExecutable}" --profile-directory=Default` },
        { pid: 43, commandLine: `"${chromeExecutable}" --type=renderer` },
      ]),
      sleep: vi.fn(async (ms: number) => {
        now += ms;
      }),
    });

    try {
      const result = await ensureChromeCdpReady(
        { userDataDir, chromeExecutable, waitMs: 1, allowManagedProfileFallback: true },
        runtime,
      );

      // A default-profile Chrome must not be misread as our locked profile.
      expect(result.state).not.toBe('profile_locked_close_chrome');
      // We launched our dedicated non-default profile (port never bound here → timeout).
      expect(spawnDetached).toHaveBeenCalledTimes(1);
      expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
        `--user-data-dir=${cdpProfileDir}`,
      ]));
      expect(JSON.stringify(spawnDetached.mock.calls[0][1])).not.toContain('Ministry of Education');
    } finally {
      dateNow.mockRestore();
    }
  });

  it('kills the Chrome we spawned on port-bind timeout and never launches a managed profile (CLWX-73)', async () => {
    let now = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const kill = vi.fn();
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 9099, kill }));
    // Endpoint never becomes reachable — the launch times out.
    const fetchJson = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson,
      listChromeProcesses: vi.fn(async () => []),
      sleep: vi.fn(async (ms: number) => {
        now += ms;
      }),
    });

    try {
      const result = await ensureChromeCdpReady(
        { userDataDir, chromeExecutable, waitMs: 1, allowManagedProfileFallback: true },
        runtime,
      );

      expect(result.state).toBe('port_bind_timeout');
      expect(result.message).toMatch(/open google chrome and sign in to outlook/i);
      // Exactly one launch, on the dedicated non-default profile.
      expect(spawnDetached).toHaveBeenCalledTimes(1);
      expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
        `--user-data-dir=${cdpProfileDir}`,
      ]));
      // We must kill the Chrome WE spawned so it is not misread as a lock later.
      expect(kill).toHaveBeenCalledTimes(1);
      // The managed / "Ministry of Education" profile must never be launched.
      for (const call of spawnDetached.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('Ministry of Education');
      }
    } finally {
      dateNow.mockRestore();
    }
  });

  it('reports profile_locked_close_chrome when our automation profile is already running (CLWX-73)', async () => {
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 1, kill: vi.fn() }));
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      // Our own dedicated CDP profile is already open but CDP is unreachable.
      listChromeProcesses: vi.fn(async () => [
        { pid: 51, commandLine: `"${chromeExecutable}" --user-data-dir=${cdpProfileDir} --remote-debugging-port=18792` },
      ]),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('profile_locked_close_chrome');
    expect(result.action).toBe('close_chrome_then_retry');
    expect(result.targetProfileProcessCount).toBe(1);
    // Do NOT launch a duplicate we cannot attach to.
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('derives the launch debug port from a custom CDP endpoint', async () => {
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 12, kill: vi.fn() }));
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/136.0.0.0' },
      });
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson,
      listChromeProcesses: vi.fn(async () => []),
    });

    const result = await ensureChromeCdpReady(
      { cdpEndpoint: 'http://127.0.0.1:18793', userDataDir, chromeExecutable, waitMs: 1_000 },
      runtime,
    );

    expect(result).toMatchObject({
      state: 'cdp_ready',
      cdpEndpoint: 'http://127.0.0.1:18793',
      debugPort: 18793,
    });
    expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
      '--remote-debugging-port=18793',
      `--user-data-dir=${cdpProfileDir}`,
    ]));
  });
});
