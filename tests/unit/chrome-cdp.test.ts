// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultChromeCdpProfileDir,
  defaultChromeUserDataDir,
  defaultDescribeLoopbackPortOwner,
  diagnoseChromeCdp,
  ensureChromeCdpReady,
  resetChromeCdpSpawnOwnershipForTests,
  verifyCdpEndpointOwnershipForAttach,
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

// CLWX-130: deterministic Windows loopback ownership fixtures. The "ours"
// owner is a same-session Chrome on OUR dedicated automation profile.
const oursOwner = {
  status: 'ok' as const,
  pid: 4444,
  sessionId: 2,
  currentSessionId: 2,
  commandLine: `"${chromeExecutable}" --remote-debugging-port=18792 --user-data-dir=${cdpProfileDir}`,
};

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
    // Deterministic ownership probe — tests on macOS/Linux must never run the
    // real PowerShell query (CLWX-130).
    describeLoopbackPortOwner: vi.fn(async () => oursOwner),
    ...overrides,
  };
}

// Positive spawn ownership is process-lifetime memory keyed by port; clear it
// between cases so one row's launch cannot vouch for another row's endpoint.
beforeEach(() => {
  resetChromeCdpSpawnOwnershipForTests();
});

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

describe('chrome-cdp Windows endpoint ownership (CLWX-130)', () => {
  const readyFetch = () =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: { Browser: 'Chrome/136.0.0.0', 'User-Agent': 'Chrome' },
    }));

  it('SUCCESS control: same-session Chrome on our automation profile is cdp_ready', async () => {
    const describeLoopbackPortOwner = vi.fn(async () => oursOwner);
    const runtime = baseRuntime({ fetchJson: readyFetch(), describeLoopbackPortOwner });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(result.endpointOwnerPid).toBe(4444);
    expect(result.endpointOwnerSessionId).toBe(2);
    expect(result.currentSessionId).toBe(2);
    expect(describeLoopbackPortOwner).toHaveBeenCalledWith(18792);
  });

  it('WRONG SESSION: a responding endpoint owned by another Windows session is refused, not ready, and never launched over', async () => {
    const spawnDetached = vi.fn(() => ({ pid: 1, kill: vi.fn() }));
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      spawnDetached,
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 4860,
        sessionId: 1,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --remote-debugging-port=18792 --user-data-dir=C:\\Users\\OtherUser\\SomeProfile`,
      })),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('foreign_endpoint_owner');
    expect(result.action).toBe('resolve_port_conflict');
    expect(result.endpointOwnerSessionId).toBe(1);
    expect(result.currentSessionId).toBe(2);
    // Windows-appropriate, truthful guidance — never a Mac menu bar, never a kill.
    expect(result.message).toMatch(/different windows user/i);
    expect(result.message).not.toMatch(/menu ?bar|macos|mac\b/i);
    // CLWX-130 review finding 2: the principal IS in their own session — the
    // guidance must never tell them to sign in to it.
    expect(result.message).not.toMatch(/sign in to your own windows session/i);
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('USER-PROFILE LAUNCH, same session: the principal\'s own debug-enabled Chrome is cdp_ready, not foreign (CLWX-130 review finding 2)', async () => {
    // The documented pilot launch (windows-pilot/scripts/pilot-attach-chrome-cdp.ps1)
    // starts SYSTEM Chrome with --remote-debugging-port on the REAL user profile.
    // profile=user is the hard rule: that Chrome is the preferred attach target.
    // Calling it foreign demoted the documented working path to a refusal.
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 8056,
        sessionId: 2,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --remote-debugging-port=18792 --user-data-dir="${userDataDir}"`,
      })),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(result.endpointOwnerPid).toBe(8056);
  });

  it('PROFILE CONFLICT, same session: a Chrome NOT started for automation is refused with same-session guidance, not a sign-in instruction', async () => {
    // Same session, readable command line, but no --remote-debugging-port flag:
    // this process was not started to be driven. Refuse truthfully — and since
    // the principal is already in this session, never tell them to sign into it.
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 8056,
        sessionId: 2,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --profile-directory=Default`,
      })),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('foreign_endpoint_owner');
    expect(result.action).toBe('resolve_port_conflict');
    expect(result.message).toMatch(/this windows session/i);
    expect(result.message).not.toMatch(/sign in/i);
    expect(result.message).not.toMatch(/different windows user/i);
  });

  it('MANAGED PROFILE control: a Chrome on the deprecated managed dir is refused even with the debug flag in our session (CLWX-73)', async () => {
    const managedDir = 'C:\\Users\\Teacher\\AppData\\Roaming\\Ministry of Education\\Chrome CDP Profile';
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 6001,
        sessionId: 2,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --remote-debugging-port=18792 --user-data-dir="${managedDir}"`,
      })),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('foreign_endpoint_owner');
    expect(result.error).toMatch(/managed profile/i);
  });

  it('UNKNOWN IDENTITY: an unattributable endpoint owner is reported truthfully, never as ready', async () => {
    const spawnDetached = vi.fn(() => ({ pid: 1, kill: vi.fn() }));
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      spawnDetached,
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'unknown' as const,
        error: 'Get-NetTCPConnection timed out',
      })),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('endpoint_owner_unverified');
    expect(result.action).toBe('retry');
    expect(result.message).toMatch(/could not confirm/i);
    expect(result.message).not.toMatch(/menu ?bar|macos/i);
    // Unknown is not permission to launch a duplicate or pick another port.
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('a probe that throws degrades to endpoint_owner_unverified instead of a false ready', async () => {
    const runtime = baseRuntime({
      fetchJson: readyFetch(),
      describeLoopbackPortOwner: vi.fn(async () => {
        throw new Error('powershell missing');
      }),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('endpoint_owner_unverified');
  });

  it('POST-LAUNCH control: a port answering after our launch but owned by a foreign session kills OUR spawn and refuses', async () => {
    const kill = vi.fn();
    const spawnDetached = vi.fn(() => ({ pid: 9099, kill }));
    const fetchJson = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } });
    const runtime = baseRuntime({
      spawnDetached,
      fetchJson,
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 4860,
        sessionId: 1,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --user-data-dir=C:\\Users\\OtherUser\\SomeProfile`,
      })),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);

    expect(result.state).toBe('foreign_endpoint_owner');
    // We kill only the Chrome WE spawned (no-orphan rule); the foreign PID is untouched.
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('MISSING CHROME control: an unreachable endpoint with no Chrome installed still says install_chrome, no ownership query', async () => {
    const describeLoopbackPortOwner = vi.fn(async () => oursOwner);
    const runtime = baseRuntime({
      existsSync: () => false,
      describeLoopbackPortOwner,
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('chrome_not_found');
    expect(result.action).toBe('install_chrome');
    expect(describeLoopbackPortOwner).not.toHaveBeenCalled();
  });

  it('TIMEOUT control: a never-binding launch still reports port_bind_timeout, not an ownership state', async () => {
    let now = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const kill = vi.fn();
    const runtime = baseRuntime({
      spawnDetached: vi.fn(() => ({ pid: 1, kill })),
      fetchJson: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      sleep: vi.fn(async (ms: number) => {
        now += ms;
      }),
    });

    try {
      const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1 }, runtime);
      expect(result.state).toBe('port_bind_timeout');
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('PLATFORM control: macOS never runs the Windows ownership query and keeps its existing ready contract', async () => {
    const describeLoopbackPortOwner = vi.fn(async () => oursOwner);
    const runtime = baseRuntime({
      platform: 'darwin',
      homedir: '/Users/teacher',
      env: {} as NodeJS.ProcessEnv,
      existsSync: () => true,
      fetchJson: readyFetch(),
      describeLoopbackPortOwner,
    });

    const result = await diagnoseChromeCdp({}, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(describeLoopbackPortOwner).not.toHaveBeenCalled();
  });

  it('EXPLICIT NON-LOOPBACK endpoint keeps its existing contract without a loopback ownership claim', async () => {
    const describeLoopbackPortOwner = vi.fn(async () => oursOwner);
    const runtime = baseRuntime({ fetchJson: readyFetch(), describeLoopbackPortOwner });

    const result = await diagnoseChromeCdp(
      { cdpEndpoint: 'http://192.168.7.20:18792', userDataDir, chromeExecutable },
      runtime,
    );

    expect(result.state).toBe('cdp_ready');
    expect(describeLoopbackPortOwner).not.toHaveBeenCalled();
  });
});

// ── CLWX-130 review finding 1: positive spawn ownership; unknown is never a kill ─
describe('chrome-cdp positive spawn ownership (CLWX-130 review finding 1)', () => {
  const readyFetch = () =>
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: { Browser: 'Chrome/136.0.0.0', 'User-Agent': 'Chrome' },
    }));

  it('CIM-DENIED box: the endpoint owned by OUR freshly spawned PID is cdp_ready and is NOT killed', async () => {
    // Hardened Windows: Get-NetTCPConnection works (PID readable) but
    // Win32_Process metadata is denied (no sessionId/commandLine). The prior
    // build classified this "unverified" and killed the Chrome it had just
    // launched — with the principal's restored tabs — on every retry.
    const kill = vi.fn();
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } });
    const runtime = baseRuntime({
      fetchJson,
      spawnDetached: vi.fn(() => ({ pid: 9099, kill })),
      describeLoopbackPortOwner: vi.fn(async () => ({ status: 'ok' as const, pid: 9099, currentSessionId: 2 })),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(kill).not.toHaveBeenCalled();
  });

  it('post-launch UNVERIFIED owner refuses readiness but NEVER kills the browser', async () => {
    // The listener may well be the Chrome we just launched; unknown identity is
    // not a kill authorization. Truthful refusal, browser left alone.
    const kill = vi.fn();
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } });
    const runtime = baseRuntime({
      fetchJson,
      spawnDetached: vi.fn(() => ({ pid: 9099, kill })),
      // Not even a PID: the ownership query itself fails.
      describeLoopbackPortOwner: vi.fn(async () => ({ status: 'unknown' as const, error: 'access denied' })),
    });

    const result = await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);

    expect(result.state).toBe('endpoint_owner_unverified');
    expect(kill).not.toHaveBeenCalled();
  });

  it('spawn ownership persists: a later diagnose recognizes the PID we launched even with unreadable metadata', async () => {
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } });
    const describeLoopbackPortOwner = vi.fn(async () => ({ status: 'ok' as const, pid: 9099, currentSessionId: 2 }));
    const runtime = baseRuntime({
      fetchJson,
      spawnDetached: vi.fn(() => ({ pid: 9099, kill: vi.fn() })),
      describeLoopbackPortOwner,
    });

    await ensureChromeCdpReady({ userDataDir, chromeExecutable, waitMs: 1_000 }, runtime);
    // A separate diagnose call (no spawn handle in scope) still recognizes ours.
    const diagnosed = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, baseRuntime({
      fetchJson: readyFetch(),
      describeLoopbackPortOwner,
    }));

    expect(diagnosed.state).toBe('cdp_ready');
  });

  it('re-probes once before concluding: a transient probe failure does not demote a healthy endpoint', async () => {
    const describeLoopbackPortOwner = vi.fn()
      .mockResolvedValueOnce({ status: 'unknown', error: 'transient CIM failure' })
      .mockResolvedValue(oursOwner);
    const runtime = baseRuntime({ fetchJson: readyFetch(), describeLoopbackPortOwner });

    const result = await diagnoseChromeCdp({ userDataDir, chromeExecutable }, runtime);

    expect(result.state).toBe('cdp_ready');
    expect(describeLoopbackPortOwner).toHaveBeenCalledTimes(2);
  });
});

// ── CLWX-130 review finding 4: ownership and readiness share ONE endpoint identity ─
describe('chrome-cdp endpoint/port identity (CLWX-130 review finding 4)', () => {
  it('derives the ownership port from the endpoint when a conflicting debugPort option is passed', async () => {
    const probedPorts: number[] = [];
    const runtime = baseRuntime({
      fetchJson: vi.fn(async () => ({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } })),
      describeLoopbackPortOwner: vi.fn(async (port: number) => {
        probedPorts.push(port);
        return {
          status: 'ok' as const,
          pid: 5,
          sessionId: 2,
          currentSessionId: 2,
          commandLine: `"${chromeExecutable}" --remote-debugging-port=19492 --user-data-dir=${cdpProfileDir}`,
        };
      }),
    });

    const result = await diagnoseChromeCdp(
      { cdpEndpoint: 'http://127.0.0.1:19492', debugPort: 18792, userDataDir, chromeExecutable },
      runtime,
    );

    // Pre-fix: ownership was checked on 18792 while readiness probed 19492 —
    // cdp_ready granted from a DIFFERENT port's owner (review probe 3).
    expect(probedPorts).toEqual([19492]);
    expect(result.debugPort).toBe(19492);
    expect(result.state).toBe('cdp_ready');
  });

  it('launches on the endpoint-derived port when endpoint and debugPort options disagree', async () => {
    const spawnDetached = vi.fn((_file: string, _args: string[]) => ({ pid: 12, kill: vi.fn() }));
    const fetchJson = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200, json: { Browser: 'Chrome/136.0.0.0' } });
    const runtime = baseRuntime({ spawnDetached, fetchJson, listChromeProcesses: vi.fn(async () => []) });

    const result = await ensureChromeCdpReady(
      { cdpEndpoint: 'http://127.0.0.1:19492', debugPort: 18792, userDataDir, chromeExecutable, waitMs: 1_000 },
      runtime,
    );

    expect(result.state).toBe('cdp_ready');
    expect(spawnDetached).toHaveBeenCalledWith(chromeExecutable, expect.arrayContaining([
      '--remote-debugging-port=19492',
    ]));
    expect(spawnDetached.mock.calls[0][1]).not.toContain('--remote-debugging-port=18792');
  });
});

// ── CLWX-130 review finding 3: the attach gate the drivers consult pre-connect ─
describe('verifyCdpEndpointOwnershipForAttach (CLWX-130 review finding 3)', () => {
  it('refuses attach when the loopback endpoint is owned by another Windows session', async () => {
    const runtime = baseRuntime({
      describeLoopbackPortOwner: vi.fn(async () => ({
        status: 'ok' as const,
        pid: 4860,
        sessionId: 1,
        currentSessionId: 2,
        commandLine: `"${chromeExecutable}" --remote-debugging-port=18792 --user-data-dir=C:\\Users\\OtherUser\\SomeProfile`,
      })),
    });

    const decision = await verifyCdpEndpointOwnershipForAttach({ userDataDir, chromeExecutable }, runtime);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.status.state).toBe('foreign_endpoint_owner');
      expect(decision.status.message).toMatch(/different windows user/i);
    }
  });

  it('refuses attach fail-closed when the owner cannot be verified', async () => {
    const runtime = baseRuntime({
      describeLoopbackPortOwner: vi.fn(async () => ({ status: 'unknown' as const, error: 'access denied' })),
    });

    const decision = await verifyCdpEndpointOwnershipForAttach({ userDataDir, chromeExecutable }, runtime);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.status.state).toBe('endpoint_owner_unverified');
  });

  it('allows attach when the endpoint is ours, when no listener exists, on macOS and on non-loopback endpoints', async () => {
    const ours = await verifyCdpEndpointOwnershipForAttach({ userDataDir, chromeExecutable }, baseRuntime());
    expect(ours.allowed).toBe(true);

    // No listener: nothing to protect; the connect that follows fails honestly
    // and routes into the repair path.
    const empty = await verifyCdpEndpointOwnershipForAttach({ userDataDir, chromeExecutable }, baseRuntime({
      describeLoopbackPortOwner: vi.fn(async () => ({ status: 'no_listener' as const })),
    }));
    expect(empty.allowed).toBe(true);

    const darwinProbe = vi.fn(async () => oursOwner);
    const darwin = await verifyCdpEndpointOwnershipForAttach({}, baseRuntime({
      platform: 'darwin',
      homedir: '/Users/teacher',
      env: {} as NodeJS.ProcessEnv,
      existsSync: () => true,
      describeLoopbackPortOwner: darwinProbe,
    }));
    expect(darwin.allowed).toBe(true);
    expect(darwinProbe).not.toHaveBeenCalled();

    const remoteProbe = vi.fn(async () => oursOwner);
    const remote = await verifyCdpEndpointOwnershipForAttach(
      { cdpEndpoint: 'http://192.168.7.20:18792', userDataDir, chromeExecutable },
      baseRuntime({ describeLoopbackPortOwner: remoteProbe }),
    );
    expect(remote.allowed).toBe(true);
    expect(remoteProbe).not.toHaveBeenCalled();
  });
});

// ── CLWX-130 review finding 5: the REAL PowerShell probe's parse/error paths ──
// Exercised against a controlled `powershell.exe` process fixture on PATH, not
// injected ownership results: the probe genuinely spawns a process, reads its
// stdout and parses it. Skipped on real Windows, where the fixture cannot
// shadow System32's PowerShell — the genuine probe there belongs to the
// installed-Windows evidence lane (NOT_RUN, recorded in the evidence doc).
describe.runIf(process.platform !== 'win32')('defaultDescribeLoopbackPortOwner process fixture (CLWX-130 review finding 5)', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'clwx130-ps-fixture-'));
  const argsLog = join(fixtureDir, 'invocations.log');
  const originalPath = process.env.PATH;

  // The fixture behaves per CLWX_TEST_PROBE_* env: exits non-zero, or prints
  // the provided stdout. It records its argv so the command under test is
  // inspectable (validated integer port, -NoProfile) — a real fixture check,
  // not an injected result.
  writeFileSync(join(fixtureDir, 'powershell.exe'), [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> "${argsLog}"`,
    'if [ -n "$CLWX_TEST_PROBE_EXIT" ]; then exit "$CLWX_TEST_PROBE_EXIT"; fi',
    'printf \'%s\' "$CLWX_TEST_PROBE_STDOUT"',
    '',
  ].join('\n'));
  chmodSync(join(fixtureDir, 'powershell.exe'), 0o755);

  beforeEach(() => {
    process.env.PATH = `${fixtureDir}:${originalPath}`;
    delete process.env.CLWX_TEST_PROBE_EXIT;
    delete process.env.CLWX_TEST_PROBE_STDOUT;
    if (existsSync(argsLog)) rmSync(argsLog);
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    delete process.env.CLWX_TEST_PROBE_EXIT;
    delete process.env.CLWX_TEST_PROBE_STDOUT;
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('rejects invalid ports without spawning any process', async () => {
    for (const port of [0, -1, 65536, 18792.5, Number.NaN]) {
      const owner = await defaultDescribeLoopbackPortOwner(port);
      expect(owner).toEqual({ status: 'unknown', error: 'invalid port' });
    }
    expect(existsSync(argsLog)).toBe(false);
  });

  it('parses a no_listener payload', async () => {
    process.env.CLWX_TEST_PROBE_STDOUT = '{"status":"no_listener"}';
    expect(await defaultDescribeLoopbackPortOwner(18792)).toEqual({ status: 'no_listener' });
  });

  it('parses a full ok payload and interpolates ONLY the validated integer port', async () => {
    process.env.CLWX_TEST_PROBE_STDOUT = '{"status":"ok","pid":4860,"sessionId":1,"currentSessionId":2,"commandLine":"chrome.exe --remote-debugging-port=18792"}';
    const owner = await defaultDescribeLoopbackPortOwner(18792);
    expect(owner).toEqual({
      status: 'ok',
      pid: 4860,
      sessionId: 1,
      currentSessionId: 2,
      commandLine: 'chrome.exe --remote-debugging-port=18792',
    });
    const invocation = readFileSync(argsLog, 'utf8');
    expect(invocation).toContain('-NoProfile');
    expect(invocation).toContain('-LocalPort 18792');
  });

  it('treats a null commandLine (CIM denied) as undefined, not the string "null"', async () => {
    process.env.CLWX_TEST_PROBE_STDOUT = '{"status":"ok","pid":4860,"currentSessionId":2,"commandLine":null}';
    const owner = await defaultDescribeLoopbackPortOwner(18792);
    expect(owner.status).toBe('ok');
    expect(owner.pid).toBe(4860);
    expect(owner.commandLine).toBeUndefined();
    expect(owner.sessionId).toBeUndefined();
  });

  it('degrades malformed stdout to unknown, never to ownership', async () => {
    process.env.CLWX_TEST_PROBE_STDOUT = 'Get-NetTCPConnection : Access is denied.';
    const owner = await defaultDescribeLoopbackPortOwner(18792);
    expect(owner.status).toBe('unknown');
  });

  it('degrades an unrecognized payload status to unknown', async () => {
    process.env.CLWX_TEST_PROBE_STDOUT = '{"status":"weird"}';
    expect(await defaultDescribeLoopbackPortOwner(18792)).toEqual({ status: 'unknown', error: 'unrecognized probe payload' });
  });

  it('degrades a failing probe process to unknown with the error preserved', async () => {
    process.env.CLWX_TEST_PROBE_EXIT = '1';
    const owner = await defaultDescribeLoopbackPortOwner(18792);
    expect(owner.status).toBe('unknown');
    expect(owner.error).toBeTruthy();
  });
});
