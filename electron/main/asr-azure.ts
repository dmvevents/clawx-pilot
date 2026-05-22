/**
 * Azure Speech-to-Text — cloud fallback ASR provider for ClawX.
 *
 * This is the *fallback* path: the macOS-native (Speech.framework) and
 * Windows-native (Windows.Media.SpeechRecognition) recognisers are the
 * primary providers. Azure is offered for tenants who already have a
 * Microsoft 365 / Azure relationship (the Ministry of Education Trinidad &
 * Tobago in particular) and want streaming-quality multi-locale ASR without
 * shipping a heavy local model.
 *
 * Two entry points:
 *   - transcribeAzureShort(audioPath, opts)
 *       Single REST call to the conversation endpoint. 30-second timeout.
 *       Best for short clips already on disk.
 *
 *   - transcribeAzureStream(audioPath, opts, callbacks)
 *       Opens a websocket to Azure's streaming conversation endpoint, pumps
 *       the audio through, and emits partial transcripts via callbacks.
 *       60-second overall budget, 10-second no-speech sub-timeout.
 *
 * Defaults:
 *   - Locale: en-TT (Trinidad & Tobago English; Azure Speech supports this
 *     since 2022).
 *   - Format: detailed (gives us a final NBest list with confidence; we still
 *     return the top hypothesis as { text, language }).
 *
 * Dependencies: globalThis.fetch + Node 20+ built-in WebSocket only. Do NOT
 * add npm packages — we deliberately avoid microsoft-cognitiveservices-speech-sdk
 * because (a) it bundles a Web Audio shim that does not work in main, (b) it
 * pulls in ~5MB of native bindings, and (c) the REST + WS protocols are stable
 * and tiny.
 *
 * Azure pricing (cite as of May 2026): Standard tier is roughly USD $1 per
 * audio-hour for batch transcription and ~$1/hour for real-time/streaming. See
 * https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
 * for the authoritative numbers — the figure above is informational only.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger';
import {
  getAzureSpeechConfig,
  isAzureSpeechConfigured,
  type AzureSpeechConfig,
} from '../services/azure-speech/store';

export interface AzureTranscribeOptions {
  /** Override the persisted locale for this call. */
  language?: string;
  /** Override the persisted region (used by `azure-speech:test`). */
  region?: string;
  /** Override the persisted apiKey (used by `azure-speech:test`). */
  apiKey?: string;
  /** Override the per-call timeout (non-streaming). Defaults to 30000ms. */
  timeoutMs?: number;
}

export interface AzureTranscribeResult {
  text: string;
  language: string;
}

export interface AzureStreamingCallbacks {
  /** Fired on each interim ("Speech.Hypothesis") frame. */
  onPartial?: (text: string) => void;
  /** Fired on each finalised utterance ("Speech.Phrase"). */
  onFinal?: (text: string) => void;
}

export class AzureSpeechNotConfigured extends Error {
  readonly code = 'AZURE_NOT_CONFIGURED';
  constructor(message = 'Azure Speech is not configured (region + apiKey required)') {
    super(message);
    this.name = 'AzureSpeechNotConfigured';
  }
}

export class AzureSpeechAuthError extends Error {
  readonly code = 'AZURE_AUTH';
  constructor(message: string) {
    super(message);
    this.name = 'AzureSpeechAuthError';
  }
}

export class AzureSpeechTimeoutError extends Error {
  readonly code = 'AZURE_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'AzureSpeechTimeoutError';
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function resolveConfig(opts: AzureTranscribeOptions): Promise<AzureSpeechConfig> {
  const persisted = await getAzureSpeechConfig();
  const merged: AzureSpeechConfig = {
    region: (opts.region ?? persisted.region ?? '').trim(),
    apiKey: (opts.apiKey ?? persisted.apiKey ?? '').trim(),
    locale: (opts.language ?? persisted.locale ?? 'en-TT').trim() || 'en-TT',
  };
  if (!isAzureSpeechConfigured(merged)) {
    throw new AzureSpeechNotConfigured();
  }
  return merged;
}

function buildShortEndpoint(region: string, locale: string): string {
  return `https://${encodeURIComponent(region)}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed`;
}

function buildStreamingEndpoint(region: string, locale: string, requestId: string): string {
  // Azure requires a connection-id query param (UUID, no dashes per spec but
  // dashes are accepted in practice; we pass the raw UUID for simplicity).
  return `wss://${encodeURIComponent(region)}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed&X-ConnectionId=${encodeURIComponent(requestId)}`;
}

/**
 * Detect the Content-Type to send to Azure's REST endpoint based on the
 * filename extension. Azure accepts:
 *   - audio/wav; codecs=audio/pcm; samplerate=16000   (preferred, what asr-ipc
 *     normalises to via ffmpeg)
 *   - audio/ogg; codecs=opus
 * If we can't classify, default to WAV+PCM and let Azure reject if wrong.
 */
function contentTypeForPath(audioPath: string): string {
  const lower = audioPath.toLowerCase();
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) {
    return 'audio/ogg; codecs=opus';
  }
  return 'audio/wav; codecs=audio/pcm; samplerate=16000';
}

interface AzureDetailedResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{ Display?: string; Lexical?: string; Confidence?: number }>;
}

function pickText(payload: AzureDetailedResponse): string {
  if (payload.DisplayText && payload.DisplayText.trim()) return payload.DisplayText.trim();
  const top = payload.NBest?.[0];
  return (top?.Display ?? top?.Lexical ?? '').trim();
}

// ------------------------------------------------------------
// Short-clip / non-streaming path
// ------------------------------------------------------------

export async function transcribeAzureShort(
  audioPath: string,
  opts: AzureTranscribeOptions = {},
): Promise<AzureTranscribeResult> {
  if (!audioPath || !existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }
  const config = await resolveConfig(opts);
  const url = buildShortEndpoint(config.region, config.locale);
  const body = await readFile(audioPath);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.apiKey,
        'Content-Type': contentTypeForPath(audioPath),
        'Accept': 'application/json',
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new AzureSpeechTimeoutError(`Azure Speech timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '');
    throw new AzureSpeechAuthError(`Azure auth failed (${response.status}): ${text || 'invalid key or region'}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Azure Speech HTTP ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as AzureDetailedResponse;
  if (payload.RecognitionStatus && payload.RecognitionStatus !== 'Success') {
    // NoMatch / InitialSilenceTimeout / BabbleTimeout / Error etc.
    return { text: '', language: config.locale };
  }
  return { text: pickText(payload), language: config.locale };
}

// ------------------------------------------------------------
// Streaming path
// ------------------------------------------------------------

interface AzureWsFrame {
  type: 'text' | 'binary';
  headers: Record<string, string>;
  body: string | ArrayBufferLike;
}

function parseWsTextFrame(raw: string): AzureWsFrame {
  // Azure framed-text format: `Header: Value\r\nHeader: Value\r\n\r\nbody...`
  const sep = raw.indexOf('\r\n\r\n');
  if (sep < 0) return { type: 'text', headers: {}, body: raw };
  const headerBlob = raw.slice(0, sep);
  const body = raw.slice(sep + 4);
  const headers: Record<string, string> = {};
  for (const line of headerBlob.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      headers[k] = v;
    }
  }
  return { type: 'text', headers, body };
}

function buildSpeechConfigFrame(requestId: string): string {
  const headers = [
    `Path: speech.config`,
    `X-RequestId: ${requestId}`,
    `X-Timestamp: ${new Date().toISOString()}`,
    `Content-Type: application/json; charset=utf-8`,
  ].join('\r\n');
  const body = JSON.stringify({
    context: {
      system: { name: 'ClawX', version: '1.0' },
      os: { platform: process.platform, name: 'Electron', version: process.versions.electron ?? '' },
    },
  });
  return `${headers}\r\n\r\n${body}`;
}

function buildAudioHeaderPrefix(requestId: string): Buffer {
  // Azure binary-frame layout:
  //   2-byte big-endian header length | ASCII headers | audio bytes
  const headers = [
    `Path: audio`,
    `X-RequestId: ${requestId}`,
    `X-Timestamp: ${new Date().toISOString()}`,
    `Content-Type: audio/x-wav`,
  ].join('\r\n');
  const headerBuf = Buffer.from(headers, 'ascii');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(headerBuf.length, 0);
  return Buffer.concat([lenBuf, headerBuf]);
}

/**
 * Stream a clip on disk through Azure's WebSocket recogniser.
 *
 * Note this still reads the audio from a *file* — it doesn't capture from the
 * microphone. The caller (the renderer composer / asr-ipc.saveBlob path) is
 * responsible for writing the captured clip to disk first. True live mic
 * streaming would need a different IPC contract; that's a future change.
 */
export async function transcribeAzureStream(
  audioPath: string,
  opts: AzureTranscribeOptions = {},
  callbacks: AzureStreamingCallbacks = {},
): Promise<AzureTranscribeResult> {
  if (!audioPath || !existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }
  const config = await resolveConfig(opts);
  const requestId = randomUUID();
  const url = buildStreamingEndpoint(config.region, config.locale, requestId);
  const audio = await readFile(audioPath);

  // Node 20+ exposes a WHATWG-flavoured WebSocket on globalThis. Cast to a
  // narrow interface to keep this file free of dom-lib / undici types.
  const Ws = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!Ws) {
    throw new Error('Built-in WebSocket not available — Node 20+ required');
  }
  // Azure auth is via the Ocp-Apim-Subscription-Key header. WHATWG WebSocket
  // does not let us set headers, so we use the alternate `?Ocp-Apim-...=` is
  // NOT supported either; we fall back to the issuetoken auth dance.
  const tokenUrl = `https://${config.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
  const tokenResp = await globalThis.fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'Content-Length': '0',
    },
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text().catch(() => '');
    throw new AzureSpeechAuthError(`Azure issueToken failed (${tokenResp.status}): ${text}`);
  }
  const bearer = await tokenResp.text();

  // The WHATWG WebSocket constructor accepts `protocols` as the second arg —
  // we pass the bearer through the URL query string; Azure docs explicitly
  // support `?authorization=...` (URL-encoded bearer) for browser clients.
  const wsUrl = `${url}&authorization=${encodeURIComponent(`Bearer ${bearer}`)}`;
  const ws = new Ws(wsUrl);
  // We need binary frames as ArrayBuffer for our reader; the default works in
  // Node so this is informational only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ws as any).binaryType = 'arraybuffer';

  let finalText = '';
  let lastPartialAt = Date.now();
  let resolved = false;

  return await new Promise<AzureTranscribeResult>((resolve, reject) => {
    const overallTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { /* noop */ }
      reject(new AzureSpeechTimeoutError('Azure streaming timed out after 60s'));
    }, 60_000);

    const noSpeechTimer = setInterval(() => {
      if (Date.now() - lastPartialAt > 10_000 && finalText === '') {
        clearInterval(noSpeechTimer);
        if (resolved) return;
        resolved = true;
        try { ws.close(); } catch { /* noop */ }
        reject(new AzureSpeechTimeoutError('Azure streaming: no speech detected within 10s'));
      }
    }, 1_000);

    const finish = (text: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      clearInterval(noSpeechTimer);
      try { ws.close(); } catch { /* noop */ }
      resolve({ text, language: config.locale });
    };

    const fail = (err: unknown) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      clearInterval(noSpeechTimer);
      try { ws.close(); } catch { /* noop */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    ws.onopen = () => {
      try {
        ws.send(buildSpeechConfigFrame(requestId));
        // Send audio in 8KB chunks to mimic real-time pacing.
        const prefix = buildAudioHeaderPrefix(requestId);
        const chunkSize = 8 * 1024;
        for (let off = 0; off < audio.length; off += chunkSize) {
          const slice = audio.subarray(off, Math.min(off + chunkSize, audio.length));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ws.send(Buffer.concat([prefix, slice]) as any);
        }
        // Empty audio frame signals end of stream.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ws.send(prefix as any);
      } catch (err) {
        fail(err);
      }
    };

    ws.onmessage = (event: { data: unknown }) => {
      const data = event.data;
      if (typeof data !== 'string') return; // ignore binary control frames
      const frame = parseWsTextFrame(data);
      const path = frame.headers['path'] ?? '';
      try {
        if (path === 'speech.hypothesis') {
          const body = JSON.parse(String(frame.body)) as { Text?: string };
          if (body.Text) {
            lastPartialAt = Date.now();
            callbacks.onPartial?.(body.Text);
          }
        } else if (path === 'speech.phrase') {
          const body = JSON.parse(String(frame.body)) as AzureDetailedResponse;
          if (body.RecognitionStatus === 'Success') {
            const text = pickText(body);
            if (text) {
              finalText = finalText ? `${finalText} ${text}` : text;
              callbacks.onFinal?.(text);
            }
          } else if (body.RecognitionStatus === 'EndOfDictation') {
            finish(finalText);
          }
        } else if (path === 'turn.end') {
          finish(finalText);
        }
      } catch (err) {
        logger.warn(`[asr-azure] failed to parse frame: ${(err as Error).message}`);
      }
    };

    ws.onerror = (event: unknown) => {
      const message =
        (event as { message?: string })?.message ??
        (event as { error?: { message?: string } })?.error?.message ??
        'Azure WebSocket error';
      fail(new Error(message));
    };

    ws.onclose = () => {
      // If the server closed cleanly without a turn.end, resolve with whatever
      // we have so far rather than hanging.
      if (!resolved) finish(finalText);
    };
  });
}

/**
 * Single-shot helper used by the IPC layer. Picks streaming or short based on
 * whether the caller wants partials.
 */
export async function transcribeAzure(
  audioPath: string,
  opts: AzureTranscribeOptions & { stream?: boolean } = {},
  callbacks: AzureStreamingCallbacks = {},
): Promise<AzureTranscribeResult> {
  if (opts.stream) {
    return transcribeAzureStream(audioPath, opts, callbacks);
  }
  return transcribeAzureShort(audioPath, opts);
}
