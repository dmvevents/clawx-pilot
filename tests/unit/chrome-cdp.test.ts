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

  it('falls back to a managed Chrome profile when the default profile is locked', async () => {
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
      fetchJson: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: { Browser: 'Chrome/126.0.0.0' },
        }),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
      '--remote-debugging-port=18792',
      '--user-data-dir=C:\\Users\\Teacher\\AppData\\Roaming\\Ministry of Education\\Chrome CDP Profile',
      '--restore-last-session',
    ]));
  });

  it('can preserve the legacy close-Chrome instruction when managed fallback is disabled', async () => {
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
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });

    const result = await ensureChromeCdpReady(
      { userDataDir, chromeExecutable, allowManagedProfileFallback: false },
      runtime,
    );

    expect(result).toMatchObject({
      state: 'profile_locked_close_chrome',
      action: 'close_chrome_then_retry',
      chromeProcessCount: 2,
      targetProfileProcessCount: 1,
    });
    expect(spawnDetached).not.toHaveBeenCalled();
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
