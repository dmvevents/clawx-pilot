/**
 * Microphone button for the chat composer.
 *
 * Captures audio via getUserMedia + Web Audio, ships a WAV blob to the
 * Electron main process via `asr:saveBlob`, and hands the file path to the
 * caller for transcription.
 *
 * Transcription itself is handled by main-process ASR providers. This component
 * is intentionally dumb about what happens after the file lands on disk - its
 * job is mic capture + handoff.
 *
 * Three error classes are surfaced inline; nothing throws past the boundary:
 *   - mic permission denied
 *   - Web Audio unsupported
 *   - IPC failure
 */
import { useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function extForMime(mime: string): string {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  return 'webm';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // Convert to base64 in chunks to avoid call-stack overflow for large clips.
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

type AudioContextCtor = typeof AudioContext;
type WindowWithWebkitAudio = Window & typeof globalThis & {
  webkitAudioContext?: AudioContextCtor;
};

function createAudioContext(): AudioContext | null {
  const win = window as WindowWithWebkitAudio;
  const Ctor = win.AudioContext ?? win.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ sampleRate: 16000 });
  } catch {
    return new Ctor();
  }
}

function mergeSamples(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

interface SaveBlobEnvelope {
  ok: boolean;
  data?: { path: string; bytes: number; transcoded: boolean; transcodeSkippedReason?: string };
  error?: { code: string; message: string };
}

export interface MicButtonProps {
  /** Called with the temp-file path of the saved (and possibly transcoded) clip. */
  onAudioReady?: (info: {
    path: string;
    bytes: number;
    transcoded: boolean;
    transcodeSkippedReason?: string;
  }) => void;
  /** Called when an error occurs at any stage; component clears state. */
  onError?: (message: string) => void;
  disabled?: boolean;
  className?: string;
  /** Tooltip; defaults to "Record voice note". */
  title?: string;
}

export function MicButton({
  onAudioReady,
  onError,
  disabled = false,
  className,
  title = 'Record voice note',
}: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedGainRef = useRef<GainNode | null>(null);
  const sampleChunksRef = useRef<Float32Array[]>([]);

  const fail = (msg: string) => {
    setBusy(false);
    setRecording(false);
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mutedGainRef.current?.disconnect();
    void audioContextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current = null;
    sourceRef.current = null;
    processorRef.current = null;
    mutedGainRef.current = null;
    sampleChunksRef.current = [];
    onError?.(msg);
  };

  const start = async () => {
    if (recording || busy) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      fail('Microphone not available in this context');
      return;
    }
    try {
      const audioContext = createAudioContext();
      if (!audioContext) {
        fail('Web Audio recording is not supported in this Electron build');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const mutedGain = audioContext.createGain();
      mutedGain.gain.value = 0;
      sampleChunksRef.current = [];
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        sampleChunksRef.current.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(mutedGain);
      mutedGain.connect(audioContext.destination);
      sourceRef.current = source;
      processorRef.current = processor;
      mutedGainRef.current = mutedGain;
      await audioContext.resume();
      setRecording(true);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const stop = async () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) {
      fail('No active recording');
      return;
    }
    setBusy(true);
    setRecording(false);
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mutedGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const samples = mergeSamples(sampleChunksRef.current);
    sampleChunksRef.current = [];
    if (samples.length === 0) {
      await audioContext.close().catch(() => undefined);
      audioContextRef.current = null;
      sourceRef.current = null;
      processorRef.current = null;
      mutedGainRef.current = null;
      fail('Recording was empty');
      return;
    }
    const sampleRate = audioContext.sampleRate;
    await audioContext.close().catch(() => undefined);
    audioContextRef.current = null;
    sourceRef.current = null;
    processorRef.current = null;
    mutedGainRef.current = null;
    const blob = encodeWav(samples, sampleRate);
    if (blob.size === 0) {
      fail('Recording was empty');
      return;
    }
    try {
      const base64 = await blobToBase64(blob);
      const ext = extForMime(blob.type || 'audio/webm');
      const renderer = (window as { electron?: { ipcRenderer?: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } } })
        .electron?.ipcRenderer;
      if (!renderer) {
        fail('Electron IPC bridge not available');
        return;
      }
      const env = (await renderer.invoke('asr:saveBlob', {
        mime: blob.type,
        base64,
        suggestedExt: ext,
      })) as SaveBlobEnvelope;
      if (!env.ok || !env.data) {
        fail(env.error?.message ?? 'asr:saveBlob failed');
        return;
      }
      onAudioReady?.(env.data);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Saving recording failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-testid="chat-composer-mic"
      className={cn(
        'shrink-0 h-8 w-8 rounded-lg transition-colors',
        recording
          ? 'bg-red-500/10 text-red-600 hover:bg-red-500/15 hover:text-red-700'
          : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground',
        className,
      )}
      onClick={recording ? stop : start}
      disabled={disabled || busy}
      title={recording ? 'Stop recording' : title}
      aria-pressed={recording}
    >
      {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
    </Button>
  );
}
