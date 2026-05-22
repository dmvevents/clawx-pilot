/**
 * Windows-native ASR provider.
 *
 * Wraps a small C# helper (`WinSpeechRecognize.exe`) that we ship at
 * `resources/bin/win32-x64/WinSpeechRecognize.exe`. The helper uses the WinRT
 * `Windows.Media.SpeechRecognition.SpeechRecognizer` API with a Dictation
 * topic constraint to transcribe a 16-kHz mono WAV file and prints a single
 * JSON object `{"text": "...", "language": "en-US"}` to stdout.
 *
 * The helper is built from C# sources at `electron/native/WinSpeechRecognize/`
 * (see that folder's README). Until the binary is compiled, this module
 * surfaces a `MIC_BINARY_MISSING` error so the IPC dispatcher can fall back
 * to the existing whisper CLI without disrupting users.
 *
 * Exit-code contract from the C# tool:
 *   0  → success, JSON on stdout
 *   1  → generic failure (human-readable message on stderr)
 *   2  → microphone / speech-permission denied
 *   3  → audio file not found / unreadable
 *
 * This file must remain compilable on macOS — we don't import any Windows-
 * only Node APIs. All platform gating lives at the call site in asr-ipc.ts.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from '../utils/logger';

export interface WindowsAsrOptions {
  /** BCP-47 locale tag, e.g. "en-US", "en-GB". Defaults to "en-US". */
  language?: string;
  /** Override the absolute path to WinSpeechRecognize.exe (mostly for tests). */
  binaryPath?: string;
  /** Override the timeout, in ms. Defaults to 30 000. */
  timeoutMs?: number;
}

export interface WindowsAsrResult {
  text: string;
  language: string;
}

/** Error code constants — mirrored by asr-ipc.ts for consistent IPC error mapping. */
export const WINDOWS_ASR_ERROR_CODES = {
  BINARY_MISSING: 'MIC_BINARY_MISSING',
  PERMISSION_DENIED: 'MIC_PERMISSION',
  AUDIO_NOT_FOUND: 'NO_AUDIO',
  TIMEOUT: 'ASR_TIMEOUT',
  FAILED: 'ASR_FAILED',
  WRONG_PLATFORM: 'WRONG_PLATFORM',
} as const;

export class WindowsAsrError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WindowsAsrError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const BINARY_NAME = 'WinSpeechRecognize.exe';

let cachedBinaryPath: string | null | undefined;

/**
 * Resolve the path to the bundled WinSpeechRecognize.exe.
 *
 * Mirrors uv-setup.ts: in packaged mode we look in `process.resourcesPath/bin/`,
 * in dev mode we look at `<repo>/resources/bin/win32-x64/`.
 */
export function resolveWindowsAsrBinary(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;

  const fromEnv = process.env.WIN_SPEECH_RECOGNIZE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedBinaryPath = fromEnv;
    return cachedBinaryPath;
  }

  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'bin', BINARY_NAME));
  } else {
    candidates.push(
      path.join(process.cwd(), 'resources', 'bin', 'win32-x64', BINARY_NAME),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedBinaryPath = candidate;
      return cachedBinaryPath;
    }
  }
  cachedBinaryPath = null;
  return null;
}

/** Reset the cached binary lookup. Test-only. */
export function _resetWindowsAsrBinaryCache(): void {
  cachedBinaryPath = undefined;
}

/**
 * Transcribe an audio file via the Windows-native helper.
 *
 * @throws {WindowsAsrError} with one of `WINDOWS_ASR_ERROR_CODES` on failure.
 */
export async function transcribeWindowsNative(
  audioPath: string,
  options: WindowsAsrOptions = {},
): Promise<WindowsAsrResult> {
  if (process.platform !== 'win32') {
    throw new WindowsAsrError(
      WINDOWS_ASR_ERROR_CODES.WRONG_PLATFORM,
      `transcribeWindowsNative called on platform=${process.platform}`,
    );
  }
  if (!audioPath || !existsSync(audioPath)) {
    throw new WindowsAsrError(
      WINDOWS_ASR_ERROR_CODES.AUDIO_NOT_FOUND,
      `Audio file not found: ${audioPath}`,
    );
  }

  const binary = options.binaryPath ?? resolveWindowsAsrBinary();
  if (!binary) {
    throw new WindowsAsrError(
      WINDOWS_ASR_ERROR_CODES.BINARY_MISSING,
      `Windows speech-recognition helper not found. Expected at resources/bin/win32-x64/${BINARY_NAME}. ` +
        `See electron/native/WinSpeechRecognize/README.md to build it.`,
    );
  }

  const language = sanitiseLocale(options.language) ?? 'en-US';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise<WindowsAsrResult>((resolve, reject) => {
    const child = execFile(
      binary,
      [audioPath, language],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // execFile sets `killed` and an ETIMEDOUT-ish message on timeout.
          const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
          if (e.killed) {
            reject(
              new WindowsAsrError(
                WINDOWS_ASR_ERROR_CODES.TIMEOUT,
                `Windows ASR helper timed out after ${timeoutMs}ms`,
              ),
            );
            return;
          }
          // execFile's `code` is the exit code as a number when the process exited normally.
          const exitCode = typeof e.code === 'number' ? e.code : null;
          if (exitCode === 2) {
            reject(
              new WindowsAsrError(
                WINDOWS_ASR_ERROR_CODES.PERMISSION_DENIED,
                stderr?.toString().trim() ||
                  'Microphone / speech-recognition permission denied. ' +
                    'Enable it in Settings → Privacy → Speech.',
              ),
            );
            return;
          }
          if (exitCode === 3) {
            reject(
              new WindowsAsrError(
                WINDOWS_ASR_ERROR_CODES.AUDIO_NOT_FOUND,
                stderr?.toString().trim() || `Helper could not read audio: ${audioPath}`,
              ),
            );
            return;
          }
          reject(
            new WindowsAsrError(
              WINDOWS_ASR_ERROR_CODES.FAILED,
              stderr?.toString().trim() || err.message,
            ),
          );
          return;
        }

        const out = stdout?.toString().trim() ?? '';
        if (!out) {
          reject(
            new WindowsAsrError(
              WINDOWS_ASR_ERROR_CODES.FAILED,
              'Windows ASR helper produced no output',
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(out) as { text?: unknown; language?: unknown };
          const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
          const lang =
            typeof parsed.language === 'string' && parsed.language.length > 0
              ? parsed.language
              : language;
          resolve({ text, language: lang });
        } catch (parseErr) {
          logger.warn(
            `[asr-native-windows] Failed to parse helper stdout as JSON: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }; raw=${out.slice(0, 200)}`,
          );
          reject(
            new WindowsAsrError(
              WINDOWS_ASR_ERROR_CODES.FAILED,
              'Windows ASR helper returned malformed JSON',
            ),
          );
        }
      },
    );

    child.on('error', (err) => {
      reject(new WindowsAsrError(WINDOWS_ASR_ERROR_CODES.FAILED, err.message));
    });
  });
}

/**
 * Restrict the locale tag to a conservative BCP-47 shape so we never pass user
 * input straight to argv. Returns null if the input is empty/garbage.
 */
function sanitiseLocale(raw: string | undefined): string | null {
  if (!raw) return null;
  // BCP-47: language[-region], 2-3 letter language, optional 2-letter region.
  const m = /^([a-z]{2,3})(?:[-_]([a-z]{2}))?$/i.exec(raw.trim());
  if (!m) return null;
  const lang = m[1].toLowerCase();
  const region = m[2]?.toUpperCase();
  return region ? `${lang}-${region}` : lang;
}
