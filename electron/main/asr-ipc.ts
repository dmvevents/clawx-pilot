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
 *   We don't want to bloat the bundle for users on systems where ffmpeg is
 *   already installed (every macOS/Windows dev box with brew/winget). The
 *   resolveFfmpegBinary() chain favours an explicit env override, then the
 *   optional npm package, then a PATH lookup. README documents the install
 *   options.
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

async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedFfmpegPath = fromEnv;
    return cachedFfmpegPath;
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
  // Fall back to PATH probe.
  const candidates =
    process.platform === 'win32'
      ? ['ffmpeg.exe']
      : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg'];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }
  // Try `which` (POSIX) as a last resort.
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileP('/usr/bin/which', ['ffmpeg']);
      const found = stdout.trim();
      if (found && existsSync(found)) {
        cachedFfmpegPath = found;
        return cachedFfmpegPath;
      }
    } catch {
      /* not on PATH — fine */
    }
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
      const rawPath = path.join(dir, `clip.${ext}`);
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

  // Direct transcription via local whisper CLI. The bundled openai-whisper
  // skill ultimately wraps the same binary; calling it from main keeps the
  // round-trip out of the agent loop so the chat composer can replace its
  // own placeholder with the transcribed text directly.
  ipcMain.handle('asr:transcribe', async (_event, args: { audioPath?: string; language?: string }) => {
    try {
      const audioPath = (args?.audioPath ?? '').trim();
      if (!audioPath || !existsSync(audioPath)) {
        return {
          ok: false,
          error: { code: 'NO_AUDIO', message: `Audio file not found: ${audioPath}` },
        };
      }

      // Cloud fallback: try Azure first when PREFER_AZURE_SPEECH is set AND
      // Azure has been configured (region+apiKey present). Native is still
      // attempted on Azure failure so a flaky network doesn't break dictation.
      // When PREFER_AZURE_SPEECH is false (the default), Azure is skipped here
      // and only reachable via `azure-speech:test` or `asr:transcribe-stream`.
      if (PREFER_AZURE_SPEECH) {
        try {
          const azure = await transcribeAzureShort(audioPath, { language: args?.language });
          return { ok: true, data: { text: azure.text, language: azure.language } };
        } catch (err) {
          if (err instanceof AzureSpeechNotConfigured) {
            // No credentials yet — silently fall through to native/whisper.
          } else {
            logger.warn(
              `[asr] Azure ASR failed; falling back to native/whisper: ${(err as Error).message}`,
            );
          }
        }
      }

      // Prefer Apple Speech.framework on darwin when the feature flag is on
      // (default true). This is ~100x faster than the Python whisper CLI on
      // CPU-only laptops and keeps audio fully on-device. We only fall back
      // to whisper if the Swift helper itself errors *and* the legacy CLI is
      // available — a MIC_PERMISSION error must propagate to the renderer
      // unchanged so the user can grant access in System Settings.
      let nativeFailedFallback = false;
      if (process.platform === 'darwin' && PREFER_NATIVE_ASR) {
        try {
          const native = await transcribeMacNative(audioPath, {
            locale: args?.language,
            timeoutMs: 30_000,
          });
          return { ok: true, data: { text: native.text, language: native.language } };
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

      // Windows analogue of the darwin branch above. Uses the WinRT
      // Windows.Media.SpeechRecognition API via a small C# helper at
      // resources/bin/win32-x64/WinSpeechRecognize.exe. Same fallback
      // semantics as macOS: MIC_PERMISSION propagates so the user can flip
      // the privacy gate; everything else falls through to the whisper CLI.
      // Until the helper binary is compiled (see
      // electron/native/WinSpeechRecognize/README.md), MIC_BINARY_MISSING
      // is treated as a soft failure and we fall back silently — the
      // whisper CLI keeps working on the macOS-first prototype.
      if (process.platform === 'win32' && PREFER_NATIVE_ASR) {
        try {
          const native = await transcribeWindowsNative(audioPath, {
            language: args?.language,
            timeoutMs: 30_000,
          });
          return { ok: true, data: { text: native.text, language: native.language } };
        } catch (err) {
          const code = err instanceof WindowsAsrError ? err.code : WINDOWS_ASR_ERROR_CODES.FAILED;
          const message = err instanceof Error ? err.message : String(err);
          if (code === WINDOWS_ASR_ERROR_CODES.PERMISSION_DENIED) {
            return { ok: false, error: { code: 'MIC_PERMISSION', message } };
          }
          if (code === WINDOWS_ASR_ERROR_CODES.BINARY_MISSING) {
            // Expected during the macOS-first prototype: the .exe hasn't
            // shipped yet. Log at info, not warn.
            logger.info(
              `[asr] Windows native helper not built yet; using whisper fallback: ${message}`,
            );
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
            message: 'Whisper CLI not found. Install with: brew install openai-whisper',
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
        data: { text, language: parsed.language ?? language },
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

let cachedWhisperPath: string | null | undefined;
async function resolveWhisperBinary(): Promise<string | null> {
  if (cachedWhisperPath !== undefined) return cachedWhisperPath;
  const fromEnv = process.env.WHISPER_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedWhisperPath = fromEnv;
    return cachedWhisperPath;
  }
  const candidates = process.platform === 'win32'
    ? ['whisper.exe']
    : ['/opt/homebrew/bin/whisper', '/usr/local/bin/whisper', '/usr/bin/whisper'];
  for (const c of candidates) {
    if (path.isAbsolute(c) && existsSync(c)) {
      cachedWhisperPath = c;
      return cachedWhisperPath;
    }
  }
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileP('/usr/bin/which', ['whisper']);
      const found = stdout.trim();
      if (found && existsSync(found)) {
        cachedWhisperPath = found;
        return cachedWhisperPath;
      }
    } catch {
      /* not on PATH */
    }
  }
  cachedWhisperPath = null;
  return null;
}
