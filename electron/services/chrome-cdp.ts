import { spawn as spawnProcess, execFile as execFileCallback } from 'node:child_process';
import { existsSync as fsExistsSync } from 'node:fs';
import { homedir, platform as osPlatform } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../utils/logger';

const execFile = promisify(execFileCallback);

export const CHROME_CDP_PORT = 18792;
export const CHROME_CDP_ENDPOINT = `http://127.0.0.1:${CHROME_CDP_PORT}`;

export type ChromeCdpState =
  | 'cdp_ready'
  | 'chrome_not_found'
  | 'cdp_down_chrome_closed'
  | 'profile_locked_close_chrome'
  | 'launch_failed'
  | 'port_bind_timeout'
  /**
   * The loopback debug port answers HTTP but is CONFIRMED to be owned by a
   * process in another Windows session or on a different profile (CLWX-130).
   * We must not attach to, kill, or restart another user's Chrome, and we must
   * not silently pick a different port.
   */
  | 'foreign_endpoint_owner'
  /**
   * The loopback debug port answers HTTP but its owner could not be identified
   * on Windows. Truthfully NOT ready — a bare version probe is not proof the
   * current user's automation profile is attached (CLWX-130).
   */
  | 'endpoint_owner_unverified';

export interface ChromeProcessInfo {
  pid?: number;
  commandLine: string;
}

export interface ChromeCdpStatus {
  state: ChromeCdpState;
  cdpEndpoint: string;
  debugPort: number;
  userDataDir: string;
  chromeExecutable: string;
  chromeProcessCount: number;
  targetProfileProcessCount: number;
  remoteDebugProcessCount: number;
  browser?: string;
  userAgent?: string;
  message: string;
  action: 'none' | 'launch_chrome' | 'close_chrome_then_retry' | 'install_chrome' | 'retry' | 'resolve_port_conflict';
  error?: string;
  /** PID that owns the loopback debug port, when Windows ownership was checked. */
  endpointOwnerPid?: number;
  /** Windows session of the port owner, when identified. */
  endpointOwnerSessionId?: number;
  /** Windows session of the ClawX app itself, when identified. */
  currentSessionId?: number;
}

/** Handle to a Chrome process WE spawned, so we can kill it on attach timeout. */
export interface SpawnedChrome {
  pid?: number;
  kill: () => void;
}

export interface ChromeCdpOptions {
  cdpEndpoint?: string;
  debugPort?: number;
  userDataDir?: string;
  fallbackUserDataDir?: string;
  /**
   * The dedicated, non-default profile directory we launch Chrome with for CDP.
   * Chrome M136+ refuses `--remote-debugging-port` on the OS-default dir, so the
   * self-launch always uses this sibling profile instead (CLWX-73 / K1 / K2).
   */
  cdpProfileDir?: string;
  chromeExecutable?: string;
  waitMs?: number;
  /**
   * @deprecated Inert. A managed/throwaway Chromium profile is NEVER launched
   * (it trips Conditional Access — AADSTS53003). Kept only so existing callers
   * that still pass it type-check; remove once the callers stop passing it.
   */
  allowManagedProfileFallback?: boolean;
}

/**
 * Identity of the process listening on the loopback CDP port, as observed by a
 * bounded same-session Windows query (CLWX-130). `status: 'unknown'` means the
 * query itself failed or was inconclusive — it is never treated as ownership.
 */
export interface LoopbackPortOwner {
  status: 'ok' | 'no_listener' | 'unknown';
  pid?: number;
  sessionId?: number;
  /** Windows session of the querying (ClawX) process itself. */
  currentSessionId?: number;
  commandLine?: string;
  error?: string;
}

export interface ChromeCdpRuntime {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  existsSync?: (path: string) => boolean;
  fetchJson?: (url: string, timeoutMs: number) => Promise<{ ok: boolean; status: number; json?: unknown; text?: string }>;
  listChromeProcesses?: () => Promise<ChromeProcessInfo[]>;
  spawnDetached?: (file: string, args: string[]) => SpawnedChrome | void;
  chromeProductVersion?: (chromeExecutable: string, platform: NodeJS.Platform) => Promise<string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Injectable Windows loopback ownership probe for deterministic tests.
   * Only consulted on win32 for loopback endpoints; never on macOS/Linux.
   */
  describeLoopbackPortOwner?: (port: number) => Promise<LoopbackPortOwner>;
}

interface ChromeCdpConfig extends Required<ChromeCdpOptions> {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
}

interface CdpVersionPayload {
  Browser?: string;
  'User-Agent'?: string;
}

function joinForPlatform(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === 'win32' ? win32.join(...parts) : posix.join(...parts);
}

export function defaultChromeUserDataDir(
  platform: NodeJS.Platform = osPlatform(),
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  switch (platform) {
    case 'darwin':
      return joinForPlatform(platform, home, 'Library', 'Application Support', 'Google', 'Chrome');
    case 'win32': {
      const localAppData = env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local');
      return win32.join(localAppData, 'Google', 'Chrome', 'User Data');
    }
    case 'linux':
      return joinForPlatform(platform, home, '.config', 'google-chrome');
    default:
      return join(home, '.chrome');
  }
}

export function defaultManagedChromeUserDataDir(
  platform: NodeJS.Platform = osPlatform(),
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  switch (platform) {
    case 'darwin':
      return joinForPlatform(platform, home, 'Library', 'Application Support', 'Ministry of Education', 'Chrome CDP Profile');
    case 'win32': {
      const appData = env.APPDATA ?? win32.join(home, 'AppData', 'Roaming');
      return win32.join(appData, 'Ministry of Education', 'Chrome CDP Profile');
    }
    case 'linux':
      return joinForPlatform(platform, home, '.config', 'ministry-of-education', 'chrome-cdp-profile');
    default:
      return join(home, '.clawx', 'chrome-cdp-profile');
  }
}

/**
 * A user-owned but NON-default Chrome profile directory, used only to launch the
 * Chrome instance we drive over CDP.
 *
 * Chrome M136+ silently refuses `--remote-debugging-port` when Chrome is
 * launched against the OS-default user-data-dir, so the port never binds and we
 * time out (CLWX-73 / K1 / K2). Pointing the self-launch at a dedicated sibling
 * profile restores a working DevTools endpoint. This is an ORDINARY unmanaged
 * user profile under the user's own space — it is NOT managed Chromium and sets
 * no enterprise policy, so it does not trip Conditional Access the way a managed
 * profile would (AADSTS53003). It does start without SSO cookies, so the
 * principal signs into that window once.
 *
 * Mirrors windows-pilot/scripts/pilot-attach-chrome-cdp-demo.ps1.
 */
export function defaultChromeCdpProfileDir(
  platform: NodeJS.Platform = osPlatform(),
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  switch (platform) {
    case 'darwin':
      return joinForPlatform(platform, home, 'Library', 'Application Support', 'Google', 'Chrome ClawX CDP');
    case 'win32': {
      const localAppData = env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local');
      return win32.join(localAppData, 'Google', 'Chrome', 'ClawX CDP Profile');
    }
    case 'linux':
      return joinForPlatform(platform, home, '.config', 'google-chrome-clawx-cdp');
    default:
      return join(home, '.clawx', 'chrome-cdp-profile');
  }
}

export function defaultChromeExecutables(
  platform: NodeJS.Platform = osPlatform(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      ];
    case 'win32':
      return [
        win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        win32.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        win32.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
    case 'linux':
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
    default:
      return [];
  }
}

export function resolveChromeExecutable(
  platform: NodeJS.Platform = osPlatform(),
  env: NodeJS.ProcessEnv = process.env,
  existsSync: (path: string) => boolean = fsExistsSync,
): string {
  for (const candidate of defaultChromeExecutables(platform, env)) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return '';
}

function resolveConfig(opts: ChromeCdpOptions = {}, runtime: ChromeCdpRuntime = {}): ChromeCdpConfig {
  const platform = runtime.platform ?? osPlatform();
  const env = runtime.env ?? process.env;
  const home = runtime.homedir ?? homedir();
  const existsSync = runtime.existsSync ?? fsExistsSync;
  const cdpEndpoint = opts.cdpEndpoint ?? env.CLAWX_CHROME_CDP_ENDPOINT;
  const envDebugPort = Number.parseInt(String(env.CLAWX_CHROME_DEBUG_PORT ?? ''), 10);
  // ONE endpoint identity (CLWX-130 review finding): the ownership probe, the
  // launch args and the readiness probe must all describe the SAME endpoint.
  // When the endpoint URL carries a port, that port IS the identity — an
  // explicit debugPort option that disagrees is a config incoherence, and
  // silently honoring it let ownership be "verified" on one port while
  // readiness was probed on another. The endpoint-derived port wins; the
  // mismatch is logged so the caller's config error is visible, not masked.
  const endpointPort = debugPortFromEndpoint(cdpEndpoint);
  if (endpointPort !== undefined && opts.debugPort !== undefined && opts.debugPort !== endpointPort) {
    logger.warn(
      `[chrome-cdp] debugPort option (${opts.debugPort}) disagrees with the CDP endpoint port (${endpointPort}); using the endpoint port for launch, ownership and readiness`,
    );
  }
  const debugPort = endpointPort ?? opts.debugPort ?? (Number.isFinite(envDebugPort) ? envDebugPort : CHROME_CDP_PORT);
  const envWaitMs = Number.parseInt(String(env.CLAWX_CHROME_CDP_WAIT_MS ?? ''), 10);
  return {
    cdpEndpoint: cdpEndpoint ?? `http://127.0.0.1:${debugPort}`,
    debugPort,
    userDataDir: opts.userDataDir ?? env.CLAWX_CHROME_USER_DATA_DIR ?? defaultChromeUserDataDir(platform, env, home),
    fallbackUserDataDir: opts.fallbackUserDataDir
      ?? env.CLAWX_CHROME_FALLBACK_USER_DATA_DIR
      ?? defaultManagedChromeUserDataDir(platform, env, home),
    cdpProfileDir: opts.cdpProfileDir
      ?? env.CLAWX_CHROME_CDP_PROFILE_DIR
      ?? defaultChromeCdpProfileDir(platform, env, home),
    chromeExecutable: opts.chromeExecutable ?? env.CLAWX_CHROME_EXECUTABLE ?? resolveChromeExecutable(platform, env, existsSync),
    waitMs: opts.waitMs ?? (Number.isFinite(envWaitMs) ? envWaitMs : 12_000),
    allowManagedProfileFallback: opts.allowManagedProfileFallback
      ?? env.CLAWX_CHROME_MANAGED_PROFILE_FALLBACK !== '0',
    platform,
    env,
    homedir: home,
  };
}

function debugPortFromEndpoint(cdpEndpoint?: string): number | undefined {
  if (!cdpEndpoint) return undefined;
  try {
    const port = Number.parseInt(new URL(cdpEndpoint).port, 10);
    return Number.isFinite(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; json?: unknown; text?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function probeVersion(
  cfg: ChromeCdpConfig,
  runtime: ChromeCdpRuntime,
): Promise<{ ok: true; version: CdpVersionPayload } | { ok: false; error: string }> {
  const fetchJson = runtime.fetchJson ?? defaultFetchJson;
  try {
    const result = await fetchJson(`${cfg.cdpEndpoint}/json/version`, 2_000);
    if (!result.ok) {
      return { ok: false, error: `CDP /json/version returned HTTP ${result.status}` };
    }
    return { ok: true, version: (result.json ?? {}) as CdpVersionPayload };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * True when SOMETHING answers HTTP on the CDP endpoint, regardless of status
 * code. Used where the question is "is this port free?" rather than "is this
 * a ready CDP server?" — a non-2xx reply is still a listener.
 */
async function endpointAnswersHttp(cfg: ChromeCdpConfig, runtime: ChromeCdpRuntime): Promise<boolean> {
  const fetchJson = runtime.fetchJson ?? defaultFetchJson;
  try {
    await fetchJson(`${cfg.cdpEndpoint}/json/version`, 2_000);
    return true;
  } catch {
    return false;
  }
}

async function defaultListChromeProcesses(platform: NodeJS.Platform): Promise<ChromeProcessInfo[]> {
  if (platform === 'win32') {
    const command = [
      '$p = Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Select-Object ProcessId,CommandLine;',
      '$p | ConvertTo-Json -Compress',
    ].join(' ');
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      timeout: 5_000,
      windowsHide: true,
    });
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout) as Array<{ ProcessId?: number; CommandLine?: string }> | { ProcessId?: number; CommandLine?: string };
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({ pid: row.ProcessId, commandLine: row.CommandLine ?? '' }))
      .filter((row) => row.commandLine);
  }

  const { stdout } = await execFile('ps', ['-ax', '-o', 'pid=,command='], { timeout: 5_000 });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /(?:Google Chrome|google-chrome|chromium)/i.test(line))
    .map((line) => {
      const match = /^(\d+)\s+(.+)$/.exec(line);
      return { pid: match ? Number(match[1]) : undefined, commandLine: match ? match[2] : line };
    });
}

async function listChromeProcesses(runtime: ChromeCdpRuntime, platform: NodeJS.Platform): Promise<ChromeProcessInfo[]> {
  try {
    return runtime.listChromeProcesses
      ? await runtime.listChromeProcesses()
      : await defaultListChromeProcesses(platform);
  } catch (error) {
    logger.warn(`[chrome-cdp] Chrome process inventory failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Best-effort Chrome ProductVersion for diagnosis (no secrets — a version
 * string only). Chrome M136+ is the boundary where remote debugging on the
 * default dir stopped working, so logging the version makes a fresh-box attach
 * failure (K1 / K2) diagnosable from a pasted log.
 */
async function defaultChromeProductVersion(
  chromeExecutable: string,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  if (!chromeExecutable) return undefined;
  try {
    if (platform === 'win32') {
      const command = `(Get-Item -LiteralPath '${chromeExecutable.replace(/'/g, "''")}').VersionInfo.ProductVersion`;
      const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        timeout: 5_000,
        windowsHide: true,
      });
      return stdout.trim() || undefined;
    }
    const { stdout } = await execFile(chromeExecutable, ['--version'], { timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackEndpoint(cdpEndpoint: string): boolean {
  try {
    const host = new URL(cdpEndpoint).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Default Windows loopback ownership probe (CLWX-130). One bounded PowerShell
 * invocation; the only interpolated value is a validated integer port, so no
 * shell interpolation of untrusted strings is possible. Logs no secrets — the
 * command line is inspected in-process and only PID/session numbers surface.
 *
 * Exported so its real error/malformed/no-listener/invalid-port paths are
 * testable against a controlled `powershell.exe` process fixture, not only via
 * injected ownership results (CLWX-130 review finding 5).
 */
export async function defaultDescribeLoopbackPortOwner(port: number): Promise<LoopbackPortOwner> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { status: 'unknown', error: 'invalid port' };
  }
  // The listener query runs under `-ErrorAction Stop` so a cmdlet failure
  // (access denied, NetTCPIP module unavailable) is reported as an explicit
  // `error` status. Under SilentlyContinue it produced the same `$c = $null`
  // as a genuinely free port and was mis-reported as `no_listener`, which the
  // attach gate then treated as "nothing to protect". Only ObjectNotFound —
  // the cmdlet's own "no rows matched" signal — is a free port.
  const command = [
    `try { $c = Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object -First 1 }`,
    `catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound' -or $_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { $c = $null }`,
    `else { @{ status = 'error'; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress; exit 0 } };`,
    `if (-not $c) { @{ status = 'no_listener' } | ConvertTo-Json -Compress } else {`,
    `$o = [int]$c.OwningProcess;`,
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=$o" -ErrorAction SilentlyContinue;`,
    `$cur = (Get-Process -Id $Global:PID).SessionId;`,
    `@{ status = 'ok'; pid = $o; sessionId = $p.SessionId; currentSessionId = $cur; commandLine = $p.CommandLine } | ConvertTo-Json -Compress }`,
  ].join(' ');
  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      timeout: 5_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      status?: string;
      error?: string | null;
      pid?: number;
      sessionId?: number;
      currentSessionId?: number;
      commandLine?: string | null;
    };
    if (parsed.status === 'no_listener') return { status: 'no_listener' };
    if (parsed.status === 'error') {
      return {
        status: 'unknown',
        error: typeof parsed.error === 'string' && parsed.error.length > 0 ? parsed.error : 'port owner query failed',
      };
    }
    if (parsed.status !== 'ok') return { status: 'unknown', error: 'unrecognized probe payload' };
    return {
      status: 'ok',
      pid: typeof parsed.pid === 'number' ? parsed.pid : undefined,
      sessionId: typeof parsed.sessionId === 'number' ? parsed.sessionId : undefined,
      currentSessionId: typeof parsed.currentSessionId === 'number' ? parsed.currentSessionId : undefined,
      commandLine: typeof parsed.commandLine === 'string' ? parsed.commandLine : undefined,
    };
  } catch (error) {
    return { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
  }
}

type OwnershipRefusalVerdict = 'foreign_session' | 'profile_conflict' | 'unverified';
type EndpointOwnershipVerdict =
  | { verdict: 'ours' | 'skipped'; owner?: LoopbackPortOwner }
  | { verdict: OwnershipRefusalVerdict; owner: LoopbackPortOwner; reason: string };

/**
 * PIDs of Chrome processes THIS ClawX process spawned for CDP, keyed by debug
 * port. Positive spawn ownership (CLWX-130 review finding 1): on a hardened box
 * where `Get-NetTCPConnection` works but `Win32_Process` metadata is denied,
 * the probe can attribute the port to a PID without session/command-line
 * details. If that PID is the Chrome WE launched, the endpoint is ours by
 * construction — refusing (and worse, killing our own spawn) turned a working
 * launch into a permanent denial loop. Entries are removed when we kill the
 * spawn; process-lifetime memory only, never persisted.
 */
const spawnOwnedPortPids = new Map<number, number>();

/** Test seam only: clears the positive-spawn-ownership memory between cases. */
export function resetChromeCdpSpawnOwnershipForTests(): void {
  spawnOwnedPortPids.clear();
}

function isPositivelyOurSpawn(port: number, ownerPid: number | undefined, spawnedPid?: number): boolean {
  if (typeof ownerPid !== 'number') return false;
  if (typeof spawnedPid === 'number' && ownerPid === spawnedPid) return true;
  return spawnOwnedPortPids.get(port) === ownerPid;
}

/**
 * CLWX-130 boundary: a successful `/json/version` probe alone does not prove
 * the responding Chrome belongs to the current Windows session and a profile
 * we may drive — on a multi-session server the port can be owned by a Chrome
 * in another user's session. Verify ownership before claiming ready.
 * Windows loopback only; macOS/Linux and non-loopback endpoints keep their
 * existing contract.
 *
 * Verdicts are split by EVIDENCE, not lumped (review finding 2):
 * - `ours`            — our own spawn (PID match), our dedicated automation
 *                       profile, or the principal's own user-profile Chrome
 *                       deliberately started with this debug port (the
 *                       documented pilot launch; profile=user is the hard rule,
 *                       so that Chrome is MORE legitimate, not less).
 * - `foreign_session` — CONFIRMED owned by a different Windows session.
 * - `profile_conflict`— same/unknown session, but confirmed not a Chrome we
 *                       may drive (managed profile, no debug flag, or not
 *                       Chrome at all).
 * - `unverified`      — identity unreadable. Truthfully not ready; NEVER a
 *                       reason to kill anything.
 */
async function verifyEndpointOwnership(
  cfg: ChromeCdpConfig,
  runtime: ChromeCdpRuntime,
  spawnedPid?: number,
): Promise<EndpointOwnershipVerdict> {
  if (cfg.platform !== 'win32' || !isLoopbackEndpoint(cfg.cdpEndpoint)) {
    return { verdict: 'skipped' };
  }
  const describe = runtime.describeLoopbackPortOwner ?? defaultDescribeLoopbackPortOwner;
  const probeOnce = async (): Promise<LoopbackPortOwner> => {
    try {
      return await describe(cfg.debugPort);
    } catch (error) {
      return { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
  };
  let owner = await probeOnce();
  // One bounded re-probe before concluding anything negative: a transient
  // PowerShell/CIM hiccup must not demote a working endpoint (review finding 1).
  if (owner.status !== 'ok' || (typeof owner.commandLine !== 'string' && !isPositivelyOurSpawn(cfg.debugPort, owner.pid, spawnedPid))) {
    const retried = await probeOnce();
    if (retried.status === 'ok') owner = retried;
  }
  if (owner.status !== 'ok') {
    return {
      verdict: 'unverified',
      owner,
      reason: owner.status === 'no_listener'
        ? 'the CDP endpoint answered but no loopback listener could be attributed'
        : `port owner query failed: ${owner.error ?? 'unknown error'}`,
    };
  }
  // Positive spawn ownership beats unreadable metadata: the PID owning the
  // port is the Chrome THIS process launched, so no session/command-line
  // evidence is needed (and none may be readable on a hardened box).
  if (isPositivelyOurSpawn(cfg.debugPort, owner.pid, spawnedPid)) {
    return { verdict: 'ours', owner };
  }
  if (
    typeof owner.sessionId === 'number' &&
    typeof owner.currentSessionId === 'number' &&
    owner.sessionId !== owner.currentSessionId
  ) {
    return {
      verdict: 'foreign_session',
      owner,
      reason: `port ${cfg.debugPort} is owned by PID ${owner.pid ?? 'unknown'} in Windows session ${owner.sessionId}, not this session (${owner.currentSessionId})`,
    };
  }
  if (typeof owner.commandLine !== 'string' || owner.commandLine.length === 0) {
    return {
      verdict: 'unverified',
      owner,
      reason: `the command line of PID ${owner.pid ?? 'unknown'} owning port ${cfg.debugPort} could not be read`,
    };
  }
  const sameSessionConfirmed = typeof owner.sessionId === 'number'
    && typeof owner.currentSessionId === 'number'
    && owner.sessionId === owner.currentSessionId;
  // The managed / "Ministry of Education" profile is NEVER attachable —
  // Conditional Access blocks managed sessions (CLWX-73, AADSTS53003). Checked
  // BEFORE the user-profile acceptance because that dir also lives under the
  // user's home.
  if (normalizedPathForCompare(owner.commandLine, cfg.platform)
    .includes(normalizedPathForCompare(cfg.fallbackUserDataDir, cfg.platform))) {
    return {
      verdict: 'profile_conflict',
      owner,
      reason: `port ${cfg.debugPort} is owned by PID ${owner.pid ?? 'unknown'} on the deprecated managed profile, which ClawX must not drive`,
    };
  }
  if (commandUsesCdpProfile(owner.commandLine, cfg)) {
    return { verdict: 'ours', owner };
  }
  // The principal's OWN Chrome, deliberately started with this debug port
  // (windows-pilot/scripts/pilot-attach-chrome-cdp.ps1 launches system Chrome
  // with --remote-debugging-port on the real user profile). profile=user is
  // the hard rule — that Chrome is the PREFERRED attach target, not a foreign
  // one. Accepted when the session is confirmed ours, or when the explicit
  // --user-data-dir provably lives under this user's own home directory.
  if (
    !owner.commandLine.toLowerCase().includes('--type=')
    && commandUsesRemoteDebugPort(owner.commandLine, cfg.debugPort)
    && (sameSessionConfirmed || commandUsesUserOwnedProfileDir(owner.commandLine, cfg))
  ) {
    return { verdict: 'ours', owner };
  }
  if (sameSessionConfirmed) {
    return {
      verdict: 'profile_conflict',
      owner,
      reason: `port ${cfg.debugPort} is owned by PID ${owner.pid ?? 'unknown'} in this Windows session, but that process was not started for ClawX browser automation`,
    };
  }
  return {
    verdict: 'unverified',
    owner,
    reason: `port ${cfg.debugPort} is owned by PID ${owner.pid ?? 'unknown'} whose Windows session and automation profile could not both be confirmed`,
  };
}

function ownershipRefusalStatus(
  cfg: ChromeCdpConfig,
  check: Extract<EndpointOwnershipVerdict, { verdict: OwnershipRefusalVerdict }>,
): ChromeCdpStatus {
  const ownerExtras: Partial<ChromeCdpStatus> = {
    endpointOwnerPid: check.owner.pid,
    endpointOwnerSessionId: check.owner.sessionId,
    currentSessionId: check.owner.currentSessionId,
    error: check.reason,
  };
  // Wrong Windows session and same-session profile conflict are DIFFERENT
  // facts and need different guidance (CLWX-130 review finding 2). A principal
  // already signed into their own session must never be told to sign into it.
  if (check.verdict === 'foreign_session') {
    return buildStatus(
      cfg,
      'foreign_endpoint_owner',
      [],
      'The Chrome automation connection on this computer is in use by a different Windows user\'s session. ClawX will not use or close another user\'s Chrome. Ask your administrator to close Chrome in the other session, then retry from ClawX; if this keeps happening, contact support.',
      'resolve_port_conflict',
      ownerExtras,
    );
  }
  if (check.verdict === 'profile_conflict') {
    return buildStatus(
      cfg,
      'foreign_endpoint_owner',
      [],
      'Another Chrome window or program in this Windows session is using ClawX\'s browser automation connection, and it is not one ClawX can safely drive. Close extra Chrome windows, then retry from ClawX so it can reopen Chrome in automation mode. Your own tabs and sign-in are preserved.',
      'resolve_port_conflict',
      ownerExtras,
    );
  }
  return buildStatus(
    cfg,
    'endpoint_owner_unverified',
    [],
    'ClawX found a Chrome automation connection but could not confirm it belongs to your Windows session, so it will not report Chrome as ready. Close any extra Chrome windows, then retry from ClawX.',
    'retry',
    ownerExtras,
  );
}

function normalizedPathForCompare(pathValue: string, platform: NodeJS.Platform): string {
  const normalized = pathValue.replace(/\//g, '\\').toLowerCase();
  return platform === 'win32' ? normalized : pathValue;
}

/**
 * True when a Chrome process is running against OUR dedicated CDP profile dir.
 * A Chrome on the user's DEFAULT profile (no explicit `--user-data-dir`) is NOT
 * counted: we launch our dedicated profile alongside it rather than fighting it
 * (CLWX-73).
 */
function commandUsesCdpProfile(commandLine: string, cfg: ChromeCdpConfig): boolean {
  const lower = commandLine.toLowerCase();
  if (lower.includes('--type=')) return false;
  if (!lower.includes('user-data-dir')) return false;
  return normalizedPathForCompare(commandLine, cfg.platform).includes(
    normalizedPathForCompare(cfg.cdpProfileDir, cfg.platform),
  );
}

/**
 * True when the command line carries an explicit `--user-data-dir` that lives
 * under THIS user's own home directory (an ordinary user-owned profile — the
 * documented pilot launch target). Callers must exclude the managed dir first.
 */
function commandUsesUserOwnedProfileDir(commandLine: string, cfg: ChromeCdpConfig): boolean {
  const match = /--user-data-dir=(?:"([^"]+)"|([^\s"]+))/i.exec(commandLine);
  const dir = match?.[1] ?? match?.[2];
  if (!dir) return false;
  return isPathWithinDir(dir, cfg.homedir, cfg.platform);
}

/**
 * Path CONTAINMENT, not string prefix: `C:\Users\Teacher2\...` is not under
 * `C:\Users\Teacher`. Resolves `..` segments and slash variants, strips
 * trailing separators, compares case-insensitively on Windows, and requires
 * either equality or a separator immediately after the parent.
 */
function isPathWithinDir(candidate: string, parent: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? win32 : posix;
  const canonical = (value: string): string => {
    let normalized = pathApi.normalize(value.trim());
    if (platform === 'win32') normalized = normalized.toLowerCase();
    // Keep a bare root ("C:\" / "/") intact; strip trailing separators elsewhere.
    while (normalized.length > 1 && normalized.endsWith(pathApi.sep) && normalized !== pathApi.parse(normalized).root) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  };
  const parentPath = canonical(parent);
  const childPath = canonical(candidate);
  if (parentPath.length === 0 || childPath.length === 0) return false;
  if (childPath === parentPath) return true;
  const prefix = parentPath.endsWith(pathApi.sep) ? parentPath : parentPath + pathApi.sep;
  return childPath.startsWith(prefix);
}

function commandUsesRemoteDebugPort(commandLine: string, debugPort: number): boolean {
  const escaped = String(debugPort).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`--remote-debugging-port(?:=|\\s+)${escaped}\\b`, 'i').test(commandLine);
}

function buildStatus(
  cfg: ChromeCdpConfig,
  state: ChromeCdpState,
  processes: ChromeProcessInfo[],
  message: string,
  action: ChromeCdpStatus['action'],
  extras: Partial<ChromeCdpStatus> = {},
): ChromeCdpStatus {
  const targetProfileProcessCount = processes.filter((proc) => commandUsesCdpProfile(proc.commandLine, cfg)).length;
  const remoteDebugProcessCount = processes.filter((proc) => commandUsesRemoteDebugPort(proc.commandLine, cfg.debugPort)).length;
  return {
    state,
    cdpEndpoint: cfg.cdpEndpoint,
    debugPort: cfg.debugPort,
    userDataDir: cfg.cdpProfileDir,
    chromeExecutable: cfg.chromeExecutable,
    chromeProcessCount: processes.length,
    targetProfileProcessCount,
    remoteDebugProcessCount,
    message,
    action,
    ...extras,
  };
}

export async function diagnoseChromeCdp(
  opts: ChromeCdpOptions = {},
  runtime: ChromeCdpRuntime = {},
): Promise<ChromeCdpStatus> {
  const cfg = resolveConfig(opts, runtime);
  const ready = await probeVersion(cfg, runtime);
  if (ready.ok) {
    // CLWX-130: on Windows, an HTTP-responsive loopback port is not proof the
    // listener is OUR Chrome in OUR session. Verify before claiming ready.
    const ownership = await verifyEndpointOwnership(cfg, runtime);
    if (
      ownership.verdict === 'foreign_session'
      || ownership.verdict === 'profile_conflict'
      || ownership.verdict === 'unverified'
    ) {
      logger.warn(`[chrome-cdp] endpoint ownership ${ownership.verdict}: ${ownership.reason}`);
      return ownershipRefusalStatus(cfg, ownership);
    }
    return buildStatus(cfg, 'cdp_ready', [], 'Chrome browser automation is reachable.', 'none', {
      browser: ready.version.Browser,
      userAgent: ready.version['User-Agent'],
      endpointOwnerPid: ownership.owner?.pid,
      endpointOwnerSessionId: ownership.owner?.sessionId,
      currentSessionId: ownership.owner?.currentSessionId,
    });
  }

  const existsSync = runtime.existsSync ?? fsExistsSync;
  if (!cfg.chromeExecutable || !existsSync(cfg.chromeExecutable)) {
    return buildStatus(
      cfg,
      'chrome_not_found',
      [],
      'Google Chrome was not found. Install Chrome, then retry Outlook or Forms.',
      'install_chrome',
      { error: ready.error },
    );
  }

  const processes = await listChromeProcesses(runtime, cfg.platform);
  // A running DEFAULT-profile Chrome is NOT a blocker: we launch our dedicated,
  // non-default CDP profile alongside it (CLWX-73). Only OUR automation profile
  // already being open, or a Chrome already holding our debug port, should stop
  // us from launching a duplicate we cannot attach to.
  const cdpProfileProcessCount = processes.filter((proc) => commandUsesCdpProfile(proc.commandLine, cfg)).length;
  const remoteDebugProcessCount = processes.filter((proc) => commandUsesRemoteDebugPort(proc.commandLine, cfg.debugPort)).length;
  if (cdpProfileProcessCount > 0 || remoteDebugProcessCount > 0) {
    return buildStatus(
      cfg,
      'profile_locked_close_chrome',
      processes,
      'ClawX already has a Chrome automation window open but cannot attach to it yet. Close that Chrome window, then retry from ClawX so it can reopen Chrome in automation mode.',
      'close_chrome_then_retry',
      { error: ready.error },
    );
  }

  return buildStatus(
    cfg,
    'cdp_down_chrome_closed',
    processes,
    'Chrome browser automation is not ready and the ClawX automation profile is not currently locked. ClawX can safely launch system Chrome in automation mode.',
    'launch_chrome',
    { error: ready.error },
  );
}

function defaultSpawnDetached(file: string, args: string[]): SpawnedChrome {
  const child = spawnProcess(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  // Detach so Chrome outlives a transient call, but keep the handle so we can
  // kill THIS process if the debug port never binds (CLWX-73 no-orphan rule).
  child.unref();
  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    },
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchChromeForCdp(
  cfg: ChromeCdpConfig,
  runtime: ChromeCdpRuntime,
  initialError?: string,
): Promise<ChromeCdpStatus> {
  // Launch the user's SYSTEM Chrome against a dedicated, NON-default profile
  // dir. Chrome M136+ refuses remote debugging on the OS-default dir, so using
  // the default profile would never bind :debugPort (CLWX-73 / K1 / K2). This
  // is still an ordinary unmanaged user profile — never managed Chromium.
  const args = [
    `--remote-debugging-port=${cfg.debugPort}`,
    `--user-data-dir=${cfg.cdpProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session',
  ];

  // Log the Chrome ProductVersion (a version string only, no secrets) so a
  // fresh-box attach failure is diagnosable from a pasted log.
  try {
    const version = await (runtime.chromeProductVersion ?? defaultChromeProductVersion)(cfg.chromeExecutable, cfg.platform);
    if (version) logger.info(`[chrome-cdp] Chrome ProductVersion: ${version}`);
  } catch {
    /* diagnostics only — never block the launch */
  }

  let spawned: SpawnedChrome | void;
  try {
    logger.info(`[chrome-cdp] launching Chrome for CDP at ${cfg.cdpEndpoint} (dedicated automation profile)`);
    spawned = (runtime.spawnDetached ?? defaultSpawnDetached)(cfg.chromeExecutable, args);
    // Positive spawn ownership (CLWX-130): remember which PID WE launched for
    // this port, so later ownership probes that can read the PID but not the
    // process metadata still recognize our own Chrome instead of refusing it.
    if (spawned && typeof spawned.pid === 'number') {
      spawnOwnedPortPids.set(cfg.debugPort, spawned.pid);
    }
  } catch (error) {
    return buildStatus(
      cfg,
      'launch_failed',
      [],
      'ClawX could not start Google Chrome for automation. Open Google Chrome and sign in to Outlook, then retry from ClawX.',
      'retry',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }

  const sleep = runtime.sleep ?? defaultSleep;
  const deadline = Date.now() + cfg.waitMs;
  let lastError = initialError;
  while (Date.now() < deadline) {
    const ready = await probeVersion(cfg, runtime);
    if (ready.ok) {
      // CLWX-130: even after our own launch, confirm the responding listener is
      // OUR Chrome — on a multi-session Windows server another session's Chrome
      // may already hold the port while our spawn silently failed to bind.
      // The spawned PID is positive ownership: unreadable process metadata on a
      // hardened box must not demote (or worse, kill) our own working launch.
      const ownership = await verifyEndpointOwnership(cfg, runtime, spawned && typeof spawned.pid === 'number' ? spawned.pid : undefined);
      if (ownership.verdict === 'foreign_session' || ownership.verdict === 'profile_conflict') {
        logger.warn(`[chrome-cdp] post-launch endpoint ownership ${ownership.verdict}: ${ownership.reason}`);
        // The port is CONFIRMED held by someone else, so our spawn never bound
        // it. Kill the Chrome WE spawned (no-orphan rule); never touch theirs.
        if (spawned && typeof spawned.kill === 'function') {
          try {
            spawned.kill();
          } catch {
            /* already exited */
          }
        }
        spawnOwnedPortPids.delete(cfg.debugPort);
        return ownershipRefusalStatus(cfg, ownership);
      }
      if (ownership.verdict === 'unverified') {
        // Unknown identity is NOT a kill authorization (CLWX-130 review
        // finding 1): the listener may well be the Chrome we just launched,
        // holding the principal's restored tabs. Refuse readiness truthfully
        // and leave the browser alone.
        logger.warn(`[chrome-cdp] post-launch endpoint ownership unverified (browser left running): ${ownership.reason}`);
        return ownershipRefusalStatus(cfg, ownership);
      }
      return buildStatus(cfg, 'cdp_ready', [], 'Chrome browser automation is reachable after launch.', 'none', {
        browser: ready.version.Browser,
        userAgent: ready.version['User-Agent'],
        endpointOwnerPid: ownership.owner?.pid,
        endpointOwnerSessionId: ownership.owner?.sessionId,
        currentSessionId: ownership.owner?.currentSessionId,
      });
    }
    lastError = ready.error;
    await sleep(500);
  }

  // Timed out. Kill the Chrome WE spawned so a later diagnose does not misread
  // our own failed launch as a user profile lock and ping-pong the repair loop
  // (CLWX-73). Never orphan it.
  if (spawned && typeof spawned.kill === 'function') {
    try {
      spawned.kill();
      logger.warn(`[chrome-cdp] killed the Chrome we spawned (pid ${spawned.pid ?? 'unknown'}) after port-bind timeout`);
    } catch (error) {
      logger.warn(`[chrome-cdp] could not kill our spawned Chrome after timeout: ${error instanceof Error ? error.message : String(error)}`);
    }
    spawnOwnedPortPids.delete(cfg.debugPort);
  }

  const processes = await listChromeProcesses(runtime, cfg.platform);
  return buildStatus(
    cfg,
    'port_bind_timeout',
    processes,
    'ClawX opened Google Chrome but could not connect to it for automation. Open Google Chrome and sign in to Outlook, then retry from ClawX.',
    'retry',
    { error: lastError },
  );
}

/**
 * Attach-boundary gate (CLWX-130 review finding 3): the Outlook and Forms
 * drivers call `chromium.connectOverCDP` FIRST and only fall back to
 * `ensureChromeCdpReady` when the connect fails — so a REACHABLE endpoint owned
 * by another Windows session bypassed the diagnosis-time ownership check
 * entirely. Callers must consult this gate BEFORE attaching to a loopback
 * endpoint on Windows.
 *
 * `allowed: true` means "no confirmed objection": non-Windows platforms,
 * non-loopback endpoints and a port with no attributable listener that ALSO
 * does not answer /json/version (the connect itself will then fail honestly
 * and route into repair) all proceed. A confirmed foreign session, a profile
 * conflict, an unverifiable owner, or an unattributable listener that is
 * nevertheless answering refuses the attach — fail closed, with the same typed
 * status the diagnose path reports.
 */
export type ChromeCdpAttachDecision =
  | { allowed: true }
  | { allowed: false; status: ChromeCdpStatus };

export async function verifyCdpEndpointOwnershipForAttach(
  opts: ChromeCdpOptions = {},
  runtime: ChromeCdpRuntime = {},
): Promise<ChromeCdpAttachDecision> {
  const cfg = resolveConfig(opts, runtime);
  if (cfg.platform !== 'win32' || !isLoopbackEndpoint(cfg.cdpEndpoint)) {
    return { allowed: true };
  }
  const ownership = await verifyEndpointOwnership(cfg, runtime);
  if (
    ownership.verdict !== 'foreign_session'
    && ownership.verdict !== 'profile_conflict'
    && ownership.verdict !== 'unverified'
  ) {
    return { allowed: true };
  }
  if (ownership.owner.status === 'no_listener') {
    // "No attributable listener" is only believable when nothing answers on
    // the port. If /json/version responds, SOMETHING we cannot attribute is
    // listening — the same evidence diagnoseChromeCdp reports as
    // endpoint_owner_unverified — and the gate must refuse rather than let a
    // reachable foreign-session Chrome be driven. When nothing answers, allow:
    // the CDP connect that follows fails honestly and routes into repair.
    // Any HTTP reply counts as answering (a non-2xx status is still a
    // listener); only a connection failure or timeout proves the port is free.
    if (!(await endpointAnswersHttp(cfg, runtime))) {
      return { allowed: true };
    }
  }
  logger.warn(`[chrome-cdp] attach refused — endpoint ownership ${ownership.verdict}: ${ownership.reason}`);
  return { allowed: false, status: ownershipRefusalStatus(cfg, ownership) };
}

export async function ensureChromeCdpReady(
  opts: ChromeCdpOptions = {},
  runtime: ChromeCdpRuntime = {},
): Promise<ChromeCdpStatus> {
  const cfg = resolveConfig(opts, runtime);
  const initial = await diagnoseChromeCdp(opts, runtime);
  if (initial.state === 'cdp_ready') return initial;

  // Tenant hard rule (CLWX-73): NEVER launch a MANAGED Chromium profile for
  // @moe.gov.tt / @fac.edu.tt flows — Microsoft Conditional Access blocks
  // managed sessions (AADSTS53003). We launch the user's SYSTEM Chrome against a
  // dedicated, NON-default user-owned profile dir (cfg.cdpProfileDir): still an
  // ordinary unmanaged profile, but not the OS-default dir that Chrome M136+
  // refuses remote debugging on (K1 / K2). We only launch when that automation
  // profile is not already locked; every other state degrades to a
  // principal-readable instruction (see buildStatus messages) surfaced verbatim.
  if (initial.state !== 'cdp_down_chrome_closed') return initial;

  return launchChromeForCdp(cfg, runtime, initial.error);
}
