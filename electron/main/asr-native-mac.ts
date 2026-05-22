/**
 * macOS-native ASR.
 *
 * **Implementation note (May 2026 pivot):**
 * We started with Apple's Speech.framework via a Swift CLI helper, but the
 * standalone unsigned binary path silently fails on Apple Silicon —
 * SFSpeechRecognizer's task callback never fires, even with partials
 * enabled, because the helper has no app bundle / Info.plist / entitlements
 * the modern privacy gate expects. Bundling the helper as a `.app` would fix
 * it but adds a code-signing prerequisite we don't have time for.
 *
 * Instead, we ship the same fast-path UX via `whisper-cli` (whisper.cpp) —
 * Metal-accelerated, pure on-device, sub-second on Apple Silicon for short
 * dictation clips. Concrete benchmark: 1.1 s wall-clock for "Hello, this is
 * a test of speech recognition." with `ggml-base.en.bin` on M1.
 *
 * The Swift source at `electron/native/macSpeechRecognize.swift` and the
 * compiled binary at `resources/bin/darwin-arm64/macSpeechRecognize` are
 * kept around — when we revisit code-signing they become the cleaner path,
 * since they avoid model files entirely.
 *
 * Failure modes the caller cares about (unchanged):
 *   - MIC_PERMISSION    → user must grant Speech Recognition (Speech.framework branch only)
 *   - FILE_NOT_FOUND    → audio path missing
 *   - BINARY_MISSING    → whisper-cli not installed
 *   - MODEL_MISSING     → ggml-*.bin not found and could not be downloaded
 *   - TIMEOUT           → recognition exceeded the wall clock
 *   - RECOGNITION_FAILED → whisper-cli returned a non-zero exit
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { logger } from '../utils/logger';

export interface MacAsrOptions {
  /** BCP-47 locale (e.g. "en-US", "es-ES"). Defaults to "en-US". */
  locale?: string;
  /** Wall-clock cap in ms. Default 30 000. */
  timeoutMs?: number;
}

export interface MacAsrResult {
  text: string;
  language: string;
}

export class MacAsrError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MacAsrError';
  }
}

let cachedWhisperCli: string | null | undefined;
let cachedModelPath: string | null | undefined;

const MODEL_CANDIDATES = [
  // Highest-priority cache: user already downloaded base.en (small, fast).
  path.join(homedir(), '.cache', 'whisper.cpp', 'ggml-base.en.bin'),
  path.join(homedir(), '.cache', 'whisper.cpp', 'ggml-small.en.bin'),
  path.join(homedir(), '.cache', 'whisper.cpp', 'ggml-medium.en.bin'),
  path.join(homedir(), '.local', 'share', 'whisper-cpp', 'ggml-base.en.bin'),
  path.join(homedir(), '.local', 'share', 'whisper-cpp', 'ggml-small.en.bin'),
  path.join(homedir(), '.local', 'share', 'whisper-cpp', 'ggml-medium.en.bin'),
];

const WHISPER_CLI_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
];

function resolveWhisperCli(): string | null {
  if (cachedWhisperCli !== undefined) return cachedWhisperCli;
  const fromEnv = process.env.WHISPER_CPP_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedWhisperCli = fromEnv;
    return cachedWhisperCli;
  }
  for (const candidate of WHISPER_CLI_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedWhisperCli = candidate;
      return cachedWhisperCli;
    }
  }
  cachedWhisperCli = null;
  return null;
}

function resolveModel(): string | null {
  if (cachedModelPath !== undefined) return cachedModelPath;
  const fromEnv = process.env.WHISPER_CPP_MODEL?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    cachedModelPath = fromEnv;
    return cachedModelPath;
  }
  for (const candidate of MODEL_CANDIDATES) {
    if (existsSync(candidate)) {
      cachedModelPath = candidate;
      return cachedModelPath;
    }
  }
  cachedModelPath = null;
  return null;
}

/**
 * Resolve the (currently unused) Swift Speech.framework helper. Kept exported
 * so the future code-signed bundle path can re-light without touching call
 * sites. Returns null when missing.
 */
export function resolveMacSpeechBinary(): string | null {
  const fromEnv = process.env.MAC_SPEECH_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packagedFlat = path.join(resourcesPath, 'bin', 'macSpeechRecognize');
    if (existsSync(packagedFlat)) return packagedFlat;
    const packagedArch = path.join(resourcesPath, 'bin', 'darwin-arm64', 'macSpeechRecognize');
    if (existsSync(packagedArch)) return packagedArch;
  }
  const devPath = path.join(process.cwd(), 'resources', 'bin', 'darwin-arm64', 'macSpeechRecognize');
  if (existsSync(devPath)) return devPath;
  return null;
}

function languageToLocale(language: string | undefined): string {
  if (!language) return 'en-US';
  const trimmed = language.trim();
  if (!trimmed) return 'en-US';
  if (/^[a-z]{2,3}-[A-Za-z0-9]{2,8}$/i.test(trimmed)) return trimmed;
  const bare = trimmed.toLowerCase().slice(0, 3);
  const map: Record<string, string> = {
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-BR',
  };
  return map[bare] ?? 'en-US';
}

interface WhisperCppJson {
  transcription?: Array<{ text?: string; offsets?: { from?: number; to?: number } }>;
  result?: { language?: string };
}

/**
 * Transcribe a single audio file via whisper.cpp's `whisper-cli`.
 *
 * Output JSON path is derived from `--output-file <prefix>` — whisper.cpp
 * appends `.json`. We read it back, extract the joined transcript, and clean
 * up the file. The temp prefix sits next to the input to avoid permissions
 * surprises.
 */
export async function transcribeMacNative(
  audioPath: string,
  options: MacAsrOptions = {},
): Promise<MacAsrResult> {
  if (process.platform !== 'darwin') {
    throw new MacAsrError('UNSUPPORTED_PLATFORM', 'transcribeMacNative is darwin-only');
  }
  if (!audioPath || !existsSync(audioPath)) {
    throw new MacAsrError('FILE_NOT_FOUND', `Audio file not found: ${audioPath}`);
  }

  const bin = resolveWhisperCli();
  if (!bin) {
    throw new MacAsrError(
      'BINARY_MISSING',
      'whisper-cli (whisper.cpp) not found. Install with: brew install whisper-cpp',
    );
  }
  const model = resolveModel();
  if (!model) {
    throw new MacAsrError(
      'MODEL_MISSING',
      'whisper.cpp model not found. Download once with: whisper-cli --model base.en or place ggml-base.en.bin under ~/.cache/whisper.cpp/',
    );
  }

  const locale = languageToLocale(options.locale);
  const language = locale.split('-')[0]?.toLowerCase() ?? 'en';
  const timeoutMs = options.timeoutMs ?? 30_000;

  // Use a sibling output prefix so whisper.cpp writes <prefix>.json next to
  // the audio. We'll delete it after parsing.
  const outDir = path.dirname(audioPath);
  const outPrefix = path.join(outDir, `whispercpp-${Date.now()}`);
  const expectedJson = `${outPrefix}.json`;

  // Make sure the dir exists (it should — caller writes there).
  try {
    await mkdir(outDir, { recursive: true });
  } catch {
    /* non-fatal */
  }

  let stdout: string;
  let stderr: string;
  try {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        bin,
        [
          '-m', model,
          '-f', audioPath,
          '--language', language,
          '--output-json',
          '--output-file', outPrefix,
          '--no-prints',
        ],
        { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
        (err, out, errOut) => {
          if (err && !existsSync(expectedJson)) {
            reject(err);
            return;
          }
          resolve({ stdout: out ?? '', stderr: errOut ?? '' });
        },
      );
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/killed/i.test(message) || /SIGKILL/.test(message) || /ETIMEDOUT/.test(message)) {
      throw new MacAsrError('TIMEOUT', `whisper-cli timed out after ${timeoutMs}ms`);
    }
    throw new MacAsrError('RECOGNITION_FAILED', message);
  }

  if (!existsSync(expectedJson)) {
    // Some whisper.cpp builds dump JSON only into a .json beside the input.
    // Look for any matching file in outDir as a fallback.
    let fallbackJson: string | null = null;
    try {
      const dirEntries = await readdir(outDir);
      const match = dirEntries.find((f) => f.startsWith(path.basename(outPrefix)) && f.endsWith('.json'));
      if (match) fallbackJson = path.join(outDir, match);
    } catch {
      /* ignore */
    }
    if (!fallbackJson) {
      logger.warn(`[asr-native-mac] no JSON produced; stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`);
      throw new MacAsrError('RECOGNITION_FAILED', 'whisper-cli did not produce a JSON output');
    }
  }

  let parsed: WhisperCppJson;
  try {
    const raw = await readFile(expectedJson, 'utf8');
    parsed = JSON.parse(raw) as WhisperCppJson;
  } catch (err) {
    throw new MacAsrError(
      'RECOGNITION_FAILED',
      `Failed to parse whisper-cli JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    try { await unlink(expectedJson); } catch { /* non-fatal */ }
  }

  const segments = parsed.transcription ?? [];
  const text = segments
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .join('')
    .trim();

  return {
    text,
    language: parsed.result?.language ?? locale,
  };
}
