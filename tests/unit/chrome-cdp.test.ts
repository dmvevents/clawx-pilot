// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  diagnoseChromeCdp,
  ensureChromeCdpReady,
  type ChromeCdpRuntime,
} from '../../electron/services/chrome-cdp';

const userDataDir = 'C:\\Users\\Teacher\\AppData\\Local\\Google\\Chrome\\User Data';
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function baseRuntime(overrides: Partial<ChromeCdpRuntime> = {}): ChromeCdpRuntime {
  return {
    platform: 'win32',
    env: {
      LOCALAPPDATA: 'C:\\Users\\Teacher\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    },
    homedir: 'C:\\Users\\Teacher',
    existsSync: (candidate) => candidate === chromeExecutable,
    listChromeProcesses: vi.fn(async () => []),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('chrome-cdp diagnostics', () => {
  it('reports cdp_ready when the Chrome debugging endpoint responds', async () => {
    const runtime = baseRuntime({
      fetchJson: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/126.0.0.0', 'User-Agent': 'Chrome' },
      })),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result).toMatchObject({
      state: 'cdp_ready',
      action: 'none',
      browser: 'Chrome/126.0.0.0',
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

  it('never launches a managed Chrome profile when the default profile is locked (CLWX-73)', async () => {
    const spawnDetached = vi.fn();
    const runtime = baseRuntime({
      spawnDetached,
      listChromeProcesses: vi.fn(async () => [
        {
          pid: 42,
          commandLine: `"${chromeExecutable}" --profile-directory=Default`,
        },
        {
          pid: 43,
          commandLine: `"${chromeExecutable}" --type=renderer`,
        },
      ]),
      // Managed fallback is gone, so even if a caller opts in it must NOT
      // spawn a throwaway profile. Keep the endpoint unreachable throughout.
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });

    const result = await ensureChromeCdpReady(
      { userDataDir, chromeExecutable, allowManagedProfileFallback: true },
      runtime,
    );

    // Degrade READABLY to the close-Chrome instruction; never a managed profile.
    expect(result).toMatchObject({
      state: 'profile_locked_close_chrome',
      action: 'close_chrome_then_retry',
      chromeProcessCount: 2,
      targetProfileProcessCount: 1,
    });
    expect(result.message).toMatch(/close all chrome windows/i);
    expect(spawnDetached).not.toHaveBeenCalled();
    // The ClawX-managed CDP profile path must never appear.
    for (const call of spawnDetached.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Chrome CDP Profile');
    }
  });

  it('launches system Chrome with CDP when the target profile is closed', async () => {
    const spawnDetached = vi.fn();
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/126.0.0.0' },
      });
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson,
      listChromeProcesses: vi.fn(async () => []),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
      '--remote-debugging-port=18792',
      `--user-data-dir=${userDataDir}`,
      '--restore-last-session',
    ]));
  });

  it('never launches a managed profile when the default profile launch never binds CDP; refuses readably (CLWX-73)', async () => {
    let now = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const spawnDetached = vi.fn();
    // Endpoint never becomes reachable — the user-profile launch times out.
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

      // Timeout must surface as a principal-readable port_bind_timeout, NOT a
      // silent managed-profile launch.
      expect(result.state).toBe('port_bind_timeout');
      expect(result.message).toMatch(/open google chrome and sign in to outlook/i);
      // Exactly one launch, and it used the user's OWN profile.
      expect(spawnDetached).toHaveBeenCalledTimes(1);
      expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
        `--user-data-dir=${userDataDir}`,
      ]));
      // The ClawX-managed CDP profile must never be launched.
      for (const call of spawnDetached.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('Chrome CDP Profile');
      }
    } finally {
      dateNow.mockRestore();
    }
  });

  it('derives the launch debug port from a custom CDP endpoint', async () => {
    const spawnDetached = vi.fn();
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: { Browser: 'Chrome/126.0.0.0' },
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
      `--user-data-dir=${userDataDir}`,
    ]));
  });
});
