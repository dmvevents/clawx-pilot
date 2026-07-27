/**
 * IPC bridge for the whisper-asr extension.
 *
 * Channels:
 *   asr:saveBlob({ mime, base64, suggestedExt }) → { path, bytes, transcoded }
 *
 * Workflow:
 *   1. Decode base64 → Buffer.
 *   2. Write to a fresh tempdir under app.getPath('temp') with mode 0600.
 *   3. Try to transcode to 16-kHz mono WAV via ffmpeg if a binary is reachable.
 *      If not, return the raw clip path (recent whisper.cpp builds can decode
 *      webm/opus directly when built with --with-ffmpeg, so this isn't always
 *      fatal — surfaces the fact in `transcoded: false` so callers can warn).
 *   4. Delete the original after a successful transcode.
 *
 * Why no hard dep on `@ffmpeg-installer/ffmpeg`?
 *   Windows pilot builds now bundle ffmpeg.exe under resources/bin so fresh
 *   installs can normalize mic recordings without PATH setup. The resolver
 *   still supports an explicit env override, optional npm package, and PATH
 *   fallback for local developer builds.
 */
import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdtemp, writeFile, stat, unlink, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '../utils/logger';
import { PREFER_NATIVE_ASR, PREFER_AZURE_SPEECH } from '../../shared/feature-flags';
import { transcribeMacNative, MacAsrError } from './asr-native-mac';
import {
  transcribeWindowsNative,
  WindowsAsrError,
  WINDOWS_ASR_ERROR_CODES,
} from './asr-native-windows';
import {
  transcribeAzureShort,
  AzureSpeechNotConfigured,
} from './asr-azure';
import { runAzureStreamingForRenderer } from './asr-azure-ipc';
import { getAzureSpeechConfig, isAzureSpeechConfigured } from '../services/azure-speech/store';

const execFileP = promisify(execFile);

interface SaveBlobArgs {
  mime?: string;
  base64?: string;
  suggestedExt?: string;
  /** When false, skip ffmpeg transcoding and hand the raw clip back. */
  transcode?: boolean;
}

interface SaveBlobResult {
  path: string;
  bytes: number;
  /** True iff ffmpeg actually produced a 16-kHz mono WAV. */
  transcoded: boolean;
  /** When transcoded=false, the reason — surface in the renderer if useful. */
  transcodeSkippedReason?: string;
}

let cachedFfmpegPath: string | null | undefined;
let cachedWhisperPath: string | null | undefined;

type AsrBackend = 'azure-speech' | 'mac-whisper-cpp' | 'windows-native' | 'whisper-cli';

/** Reset binary resolver caches. Test-only. */
export function _resetAsrIpcCaches(): void {
  cachedFfmpegPath = undefined;
  cachedWhisperPath = undefined;
}

export function parsePathLookupOutput(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const found = line.trim();
    if (found.length > 0) return found;
  }
  return null;
}

export function getPathLookupCommand(
  binaryName: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  return platform === 'win32'
    ? { command: 'where.exe', args: [binaryName] }
    : { command: '/usr/bin/which', args: [binaryName] };
}

function cleanCandidatePaths(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function safeAppPath(): string | undefined {
  try {
    return app.getAppPath();
  } catch {
    return undefined;
  }
}

export function getFfmpegBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

export function getFfmpegCandidatePaths(options: {
  platform?: NodeJS.Platform;
  arch?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
  cwd?: string;
  appPath?: string;
  envPath?: string;
} = {}): string[] {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const binaryName = getFfmpegBinaryName(platform);
  const resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const cwd = options.cwd ?? process.cwd();
  const appPath = options.appPath ?? safeAppPath();

  const packagedCandidates = resourcesPath
    ? [
        path.join(resourcesPath, 'bin', binaryName),
        path.join(resourcesPath, 'bin', `${platform}-${arch}`, binaryName),
      ]
    : [];

  const appRelativeCandidates = appPath && (options.isPackaged || appPath.endsWith('.asar'))
    ? [
        path.join(path.dirname(appPath), 'bin', binaryName),
        path.join(path.dirname(appPath), 'bin', `${platform}-${arch}`, binaryName),
      ]
    : [];

  const devCandidates = options.isPackaged
    ? []
    : [
        path.join(cwd, 'resources', 'bin', `${platform}-${arch}`, binaryName),
        path.join(cwd, 'resources', 'bin', binaryName),
      ];

  const systemCandidates =
    platform === 'win32'
      ? []
      : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];

  return cleanCandidatePaths([
    options.envPath,
    ...packagedCandidates,
    ...appRelativeCandidates,
    ...devCandidates,
    ...systemCandidates,
  ]);
}

async function transcribeAzureIfPreferred(
  audioPath: string,
  language?: string,
): Promise<{ text: string; language: string; backend: AsrBackend } | null> {
  if (!PREFER_AZURE_SPEECH) return null;
  let config;
  try {
    config = await getAzureSpeechConfig();
  } catch (err) {
    logger.warn(
      `[asr] Azure Speech config unavailable; using local ASR fallback: ${(err as Error).message}`,
    );
    return null;
  }
  if (!isAzureSpeechConfigured(config)) {
    logger.info('[asr] Azure Speech preferred but not configured; using local ASR fallback');
    return null;
  }
  try {
    const azure = await transcribeAzureShort(audioPath, { language });
    const text = azure.text.trim();
    if (!text) {
      logger.info('[asr] Azure ASR returned no text; using local ASR fallback');
      return null;
    }
    return { text, language: azure.language, backend: 'azure-speech' };
  } catch (err) {
    logger.warn(
      `[asr] Azure ASR failed; falling back to native/whisper: ${(err as Error).message}`,
    );
    return null;
  }
}

async function resolveBinaryFromPath(binaryName: string): Promise<string | null> {
  const lookup = getPathLookupCommand(binaryName);
  try {
    const { stdout } = await execFileP(lookup.command, lookup.args, { windowsHide: true });
    const found = parsePathLookupOutput(stdout);
    if (found && existsSync(found)) return found;
  } catch {
    /* not on PATH */
  }
  return null;
}

async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  const fromEnv = (process.env.CLAWX_FFMPEG_PATH ?? process.env.FFMPEG_PATH)?.trim();
  for (const candidate of getFfmpegCandidatePaths({
    envPath: fromEnv,
    isPackaged: app.isPackaged,
  })) {
    if (existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }
  // Optional npm dep, only loaded if installed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require('@ffmpeg-installer/ffmpeg') as { path?: string };
    if (installer?.path && existsSync(installer.path)) {
      cachedFfmpegPath = installer.path;
      return cachedFfmpegPath;
    }
  } catch {
    /* not installed — fine */
  }
  const pathBinary = await resolveBinaryFromPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (pathBinary) {
    cachedFfmpegPath = pathBinary;
    return cachedFfmpegPath;
  }
  cachedFfmpegPath = null;
  return null;
}

function sanitiseExt(ext: string | undefined): string {
  if (!ext) return 'webm';
  // Strip leading dot, restrict to safe alphanumerics, limit length.
  const cleaned = ext.replace(/^\./, '').replace(/[^a-z0-9]/gi, '').slice(0, 6);
  return cleaned || 'webm';
}

export function registerAsrIpcHandlers(): void {
  ipcMain.handle('asr:saveBlob', async (_event, args: SaveBlobArgs): Promise<{
    ok: true; data: SaveBlobResult;
  } | { ok: false; error: { code: string; message: string } }> => {
    try {
      if (!args || typeof args.base64 !== 'string' || args.base64.length === 0) {
        return {
          ok: false,
          error: { code: 'BAD_ARGS', message: 'asr:saveBlob requires { base64 }' },
        };
      }
      const buf = Buffer.from(args.base64, 'base64');
      if (buf.length === 0) {
        return {
          ok: false,
          error: { code: 'EMPTY_BLOB', message: 'Decoded blob is empty' },
        };
      }

      const tmpRoot = path.join(app.getPath('temp'), 'clawx-asr-');
      const dir = await mkdtemp(tmpRoot);
      const ext = sanitiseExt(args.suggestedExt);
      const rawPath = path.join(dir, ext === 'wav' ? 'clip-input.wav' : `clip.${ext}`);
      await writeFile(rawPath, buf, { mode: 0o600 });

      if (args.transcode === false) {
        const stats = await stat(rawPath);
        return {
          ok: true,
          data: {
            path: rawPath,
            bytes: stats.size,
            transcoded: false,
            transcodeSkippedReason: 'caller-disabled',
          },
        };
      }

      const ffmpeg = await resolveFfmpegBinary();
      if (!ffmpeg) {
        const stats = await stat(rawPath);
        return {
          ok: true,
          data: {
            path: rawPath,
            bytes: stats.size,
            transcoded: false,
            transcodeSkippedReason: 'ffmpeg-not-found',
          },
        };
      }

      const wavPath = path.join(dir, 'clip.wav');
      try {
        await execFileP(
          ffmpeg,
          ['-y', '-i', rawPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath],
          { timeout: 60_000 },
        );
      } catch (err) {
        logger.warn(
          `[asr] ffmpeg transcode failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        const stats = await stat(rawPath);
        return {
          ok: true,
          data: {
            path: rawPath,
            bytes: stats.size,
            transcoded: false,
            transcodeSkippedReason: 'ffmpeg-failed',
          },
        };
      }
      const stats = await stat(wavPath);
      try {
        await unlink(rawPath);
      } catch {
        /* non-fatal */
      }
      return {
        ok: true,
        data: { path: wavPath, bytes: stats.size, transcoded: true },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });

  // Direct transcription from the chat composer. Pilot builds try configured
  // Azure Speech first for quality, then fall back to native platform speech
  // and finally the local whisper CLI when available. Calling from main keeps
  // the round-trip out of the agent loop so the composer can replace its own
  // placeholder with the transcribed text directly.
  ipcMain.handle('asr:transcribe', async (_event, args: { audioPath?: string; language?: string }) => {
    try {
      const audioPath = (args?.audioPath ?? '').trim();
      if (!audioPath || !existsSync(audioPath)) {
        return {
          ok: false,
          error: { code: 'NO_AUDIO', message: `Audio file not found: ${audioPath}` },
        };
      }

      const azure = await transcribeAzureIfPreferred(audioPath, args?.language);
      if (azure) {
        return { ok: true, data: azure };
      }

      // Prefer the macOS whisper.cpp fast path when the feature flag is on
      // (default true). This is much faster than the Python whisper CLI on
      // Apple Silicon and keeps audio fully on-device. We only fall back to
      // legacy Python whisper if the fast path errors and that CLI is available.
      let nativeFailedFallback = false;
      if (process.platform === 'darwin' && PREFER_NATIVE_ASR) {
        try {
          const native = await transcribeMacNative(audioPath, {
            locale: args?.language,
            timeoutMs: 30_000,
          });
          return {
            ok: true,
            data: { text: native.text, language: native.language, backend: 'mac-whisper-cpp' },
          };
        } catch (err) {
          const code = err instanceof MacAsrError ? err.code : 'RECOGNITION_FAILED';
          const message = err instanceof Error ? err.message : String(err);
          // MIC_PERMISSION needs user action; don't mask it with whisper.
          if (code === 'MIC_PERMISSION') {
            return { ok: false, error: { code, message } };
          }
          logger.warn(`[asr] native ASR failed (${code}); falling back to whisper: ${message}`);
          nativeFailedFallback = true;
          // fall through to whisper CLI path
        }
      }

      // Windows analogue of the darwin branch above. Uses the desktop
      // System.Speech recognition engine via a small C# helper at
      // resources/bin/WinSpeechRecognize.exe in packaged builds. Same fallback
      // semantics as macOS: MIC_PERMISSION propagates so the user can flip
      // the privacy gate; everything else falls through to the whisper CLI.
      if (process.platform === 'win32' && PREFER_NATIVE_ASR) {
        try {
          const native = await transcribeWindowsNative(audioPath, {
            language: args?.language,
            timeoutMs: 30_000,
          });
          return {
            ok: true,
            data: { text: native.text, language: native.language, backend: 'windows-native' },
          };
        } catch (err) {
          const code = err instanceof WindowsAsrError ? err.code : WINDOWS_ASR_ERROR_CODES.FAILED;
          const message = err instanceof Error ? err.message : String(err);
          if (code === WINDOWS_ASR_ERROR_CODES.PERMISSION_DENIED) {
            return { ok: false, error: { code: 'MIC_PERMISSION', message } };
          }
          if (code === WINDOWS_ASR_ERROR_CODES.BINARY_MISSING) {
            logger.warn(`[asr] Windows native helper missing; using whisper fallback: ${message}`);
          } else {
            logger.warn(
              `[asr] Windows native ASR failed (${code}); falling back to whisper: ${message}`,
            );
          }
          nativeFailedFallback = true;
          // fall through to whisper CLI path
        }
      }

      const whisperBin = await resolveWhisperBinary();
      if (!whisperBin) {
        return {
          ok: false,
          error: {
            code: 'NO_WHISPER',
            message: process.platform === 'win32'
              ? 'No Windows speech recognizer or Whisper fallback is available. Rebuild with pnpm run prep:win-binaries so WinSpeechRecognize.exe is packaged, or install whisper.exe and ffmpeg.exe on PATH.'
              : 'Whisper CLI not found. Install with: brew install openai-whisper',
          },
        };
      }
      const outDir = await mkdtemp(path.join(app.getPath('temp'), 'clawx-transcribe-'));
      const language = (args?.language ?? 'en').replace(/[^a-z]/gi, '').slice(0, 16) || 'en';
      // When whisper is the *primary* backend (Linux dev boxes, or a Mac/Win
      // build with the native helper missing) we keep the historical 5-minute
      // ceiling so a slow CPU run can still complete. When we landed here as
      // a *fallback* after the native path errored, drop the cap to 10s —
      // at that point we're already in degraded mode and a stuck whisper
      // process would freeze the chat composer for the principal.
      const whisperTimeoutMs = nativeFailedFallback ? 10_000 : 5 * 60_000;
      try {
        await execFileP(
          whisperBin,
          [
            audioPath,
            '--model', 'small.en',
            '--language', language,
            '--output_format', 'json',
            '--output_dir', outDir,
            '--verbose', 'False',
            '--fp16', 'False',
          ],
          { timeout: whisperTimeoutMs },
        );
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'TRANSCRIBE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      const files = await readdir(outDir);
      const jsonFile = files.find((f) => f.endsWith('.json'));
      if (!jsonFile) {
        return { ok: false, error: { code: 'NO_OUTPUT', message: 'whisper produced no JSON output' } };
      }
      const raw = await readFile(path.join(outDir, jsonFile), 'utf8');
      const parsed = JSON.parse(raw) as { text?: string; language?: string };
      const text = (parsed.text ?? '').trim();
      // Clean up temp output (keep the source audio in case caller reuses).
      try {
        for (const f of files) await unlink(path.join(outDir, f));
      } catch {
        /* non-fatal */
      }
      return {
        ok: true,
        data: { text, language: parsed.language ?? language, backend: 'whisper-cli' },
      };
    } catch (err) {
      return {
        ok: false,
        error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) },
      };
    }
  });

  // Streaming transcription. Same input shape as `asr:transcribe` but emits
  // interim partials over the `asr:transcribe-partial` event channel before
  // resolving with the final text. Currently Azure-only — the native
  // recognisers don't expose a partial-results stream through their helpers
  // yet. Caller is expected to have configured Azure (otherwise the handler
  // returns NOT_CONFIGURED so the renderer can prompt the user).
  ipcMain.handle(
    'asr:transcribe-stream',
    async (_event, args: { audioPath?: string; language?: string }) => {
      try {
        const audioPath = (args?.audioPath ?? '').trim();
        if (!audioPath || !existsSync(audioPath)) {
          return {
            ok: false,
            error: { code: 'NO_AUDIO', message: `Audio file not found: ${audioPath}` },
          };
        }
        const result = await runAzureStreamingForRenderer(audioPath, args?.language);
        return { ok: true, data: { text: result.text, language: result.language } };
      } catch (err) {
        if (err instanceof AzureSpeechNotConfigured) {
          return {
            ok: false,
            error: {
              code: 'NOT_CONFIGURED',
              message: 'Azure Speech is not configured for streaming transcription',
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'STREAM_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  );
}

async function resolveWhisperBinary(): Promise<string | null> {
  if (cachedWhisperPath !== undefined) return cachedWhisperPath;
  const fromEnv = process.env.WHISPER_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedWhisperPath = fromEnv;
    return cachedWhisperPath;
  }
  const candidates = process.platform === 'win32'
    ? []
    : ['/opt/homebrew/bin/whisper', '/usr/local/bin/whisper', '/usr/bin/whisper'];
  for (const c of candidates) {
    if (path.isAbsolute(c) && existsSync(c)) {
      cachedWhisperPath = c;
      return cachedWhisperPath;
    }
  }
  const pathBinary = await resolveBinaryFromPath(process.platform === 'win32' ? 'whisper.exe' : 'whisper');
  if (pathBinary) {
    cachedWhisperPath = pathBinary;
    return cachedWhisperPath;
  }
  cachedWhisperPath = null;
  return null;
}
