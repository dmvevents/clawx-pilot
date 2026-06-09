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
  | 'port_bind_timeout';

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
  action: 'none' | 'launch_chrome' | 'close_chrome_then_retry' | 'install_chrome' | 'retry';
  error?: string;
}

export interface ChromeCdpOptions {
  cdpEndpoint?: string;
  debugPort?: number;
  userDataDir?: string;
  fallbackUserDataDir?: string;
  chromeExecutable?: string;
  waitMs?: number;
  allowManagedProfileFallback?: boolean;
}

export interface ChromeCdpRuntime {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  existsSync?: (path: string) => boolean;
  fetchJson?: (url: string, timeoutMs: number) => Promise<{ ok: boolean; status: number; json?: unknown; text?: string }>;
  listChromeProcesses?: () => Promise<ChromeProcessInfo[]>;
  spawnDetached?: (file: string, args: string[]) => void;
  sleep?: (ms: number) => Promise<void>;
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
  const debugPort = opts.debugPort ?? debugPortFromEndpoint(cdpEndpoint) ?? (Number.isFinite(envDebugPort) ? envDebugPort : CHROME_CDP_PORT);
  const envWaitMs = Number.parseInt(String(env.CLAWX_CHROME_CDP_WAIT_MS ?? ''), 10);
  return {
    cdpEndpoint: cdpEndpoint ?? `http://127.0.0.1:${debugPort}`,
    debugPort,
    userDataDir: opts.userDataDir ?? env.CLAWX_CHROME_USER_DATA_DIR ?? defaultChromeUserDataDir(platform, env, home),
    fallbackUserDataDir: opts.fallbackUserDataDir
      ?? env.CLAWX_CHROME_FALLBACK_USER_DATA_DIR
      ?? defaultManagedChromeUserDataDir(platform, env, home),
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

function normalizedPathForCompare(pathValue: string, platform: NodeJS.Platform): string {
  const normalized = pathValue.replace(/\//g, '\\').toLowerCase();
  return platform === 'win32' ? normalized : pathValue;
}

function commandUsesTargetProfile(commandLine: string, cfg: ChromeCdpConfig): boolean {
  const lower = commandLine.toLowerCase();
  if (lower.includes('--type=')) return false;
  if (lower.includes('user-data-dir')) {
    return normalizedPathForCompare(commandLine, cfg.platform).includes(normalizedPathForCompare(cfg.userDataDir, cfg.platform));
  }
  return normalizedPathForCompare(cfg.userDataDir, cfg.platform) === normalizedPathForCompare(
    defaultChromeUserDataDir(cfg.platform, cfg.env, cfg.homedir),
    cfg.platform,
  );
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
  const targetProfileProcessCount = processes.filter((proc) => commandUsesTargetProfile(proc.commandLine, cfg)).length;
  const remoteDebugProcessCount = processes.filter((proc) => commandUsesRemoteDebugPort(proc.commandLine, cfg.debugPort)).length;
  return {
    state,
    cdpEndpoint: cfg.cdpEndpoint,
    debugPort: cfg.debugPort,
    userDataDir: cfg.userDataDir,
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
    return buildStatus(cfg, 'cdp_ready', [], 'Chrome browser automation is reachable.', 'none', {
      browser: ready.version.Browser,
      userAgent: ready.version['User-Agent'],
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
  const targetProfileProcessCount = processes.filter((proc) => commandUsesTargetProfile(proc.commandLine, cfg)).length;
  if (targetProfileProcessCount > 0) {
    return buildStatus(
      cfg,
      'profile_locked_close_chrome',
      processes,
      'Chrome is already open with the target profile, but ClawX cannot attach to it yet. Close all Chrome windows, then retry from ClawX so it can reopen Chrome in automation mode.',
      'close_chrome_then_retry',
      { error: ready.error },
    );
  }

  return buildStatus(
    cfg,
    'cdp_down_chrome_closed',
    processes,
    'Chrome browser automation is not ready and the target Chrome profile is not currently locked. ClawX can safely launch system Chrome in automation mode.',
    'launch_chrome',
    { error: ready.error },
  );
}

function defaultSpawnDetached(file: string, args: string[]): void {
  const child = spawnProcess(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchChromeForCdp(
  cfg: ChromeCdpConfig,
  runtime: ChromeCdpRuntime,
  initialError?: string,
): Promise<ChromeCdpStatus> {
  const args = [
    `--remote-debugging-port=${cfg.debugPort}`,
    `--user-data-dir=${cfg.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session',
  ];

  try {
    logger.info(`[chrome-cdp] launching Chrome for CDP at ${cfg.cdpEndpoint}`);
    (runtime.spawnDetached ?? defaultSpawnDetached)(cfg.chromeExecutable, args);
  } catch (error) {
    return buildStatus(cfg, 'launch_failed', [], 'Chrome launch failed.', 'retry', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const sleep = runtime.sleep ?? defaultSleep;
  const deadline = Date.now() + cfg.waitMs;
  let lastError = initialError;
  while (Date.now() < deadline) {
    const ready = await probeVersion(cfg, runtime);
    if (ready.ok) {
      return buildStatus(cfg, 'cdp_ready', [], 'Chrome browser automation is reachable after launch.', 'none', {
        browser: ready.version.Browser,
        userAgent: ready.version['User-Agent'],
      });
    }
    lastError = ready.error;
    await sleep(500);
  }

  const processes = await listChromeProcesses(runtime, cfg.platform);
  return buildStatus(
    cfg,
    'port_bind_timeout',
    processes,
    `Chrome was launched but ${cfg.cdpEndpoint} did not become reachable before timeout.`,
    'retry',
    { error: lastError },
  );
}

export async function ensureChromeCdpReady(
  opts: ChromeCdpOptions = {},
  runtime: ChromeCdpRuntime = {},
): Promise<ChromeCdpStatus> {
  const cfg = resolveConfig(opts, runtime);
  const initial = await diagnoseChromeCdp(opts, runtime);
  if (initial.state === 'cdp_ready') return initial;

  if (initial.state === 'profile_locked_close_chrome' && cfg.allowManagedProfileFallback) {
    const fallbackOpts: ChromeCdpOptions = {
      ...opts,
      userDataDir: cfg.fallbackUserDataDir,
      fallbackUserDataDir: cfg.fallbackUserDataDir,
      allowManagedProfileFallback: false,
    };
    const fallbackCfg = resolveConfig(fallbackOpts, runtime);
    const fallback = await diagnoseChromeCdp(fallbackOpts, runtime);

    if (fallback.state === 'cdp_ready') {
      return {
        ...fallback,
        message:
          'Chrome browser automation is reachable on the ClawX-managed browser profile because the default Chrome profile is already open.',
      };
    }

    if (fallback.state === 'cdp_down_chrome_closed') {
      logger.info(
        `[chrome-cdp] default Chrome profile is locked; launching managed profile at ${fallbackCfg.userDataDir}`,
      );
      const launched = await launchChromeForCdp(fallbackCfg, runtime, fallback.error ?? initial.error);
      if (launched.state === 'cdp_ready') {
        return {
          ...launched,
          message:
            'Chrome browser automation is reachable on a ClawX-managed browser profile. Sign in to Microsoft there once if Outlook or Forms asks.',
        };
      }
      return launched;
    }

    return fallback;
  }

  if (initial.state !== 'cdp_down_chrome_closed') return initial;

  return launchChromeForCdp(cfg, runtime, initial.error);
}
