/**
 * Microphone button for the chat composer.
 *
 * Captures audio via getUserMedia + MediaRecorder, ships the blob to the
 * Electron main process via `asr:saveBlob`, and hands the file path to the
 * caller for transcription.
 *
 * Transcription itself is done by the gateway-side `asr.transcribe` openclaw
 * tool (whisper.cpp). This component is intentionally dumb about what happens
 * after the file lands on disk — its job is mic capture + handoff.
 *
 * Three error classes are surfaced inline; nothing throws past the boundary:
 *   - mic permission denied
 *   - MediaRecorder unsupported
 *   - IPC failure
 */
import { useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DEFAULT_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function pickSupportedMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of DEFAULT_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}

function extForMime(mime: string): string {
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stoppedResolveRef = useRef<((blob: Blob) => void) | null>(null);

  const fail = (msg: string) => {
    setBusy(false);
    setRecording(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    onError?.(msg);
  };

  const start = async () => {
    if (recording || busy) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      fail('Microphone not available in this context');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      fail('MediaRecorder not supported in this Electron build');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickSupportedMime() ?? undefined;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onerror = (ev: Event) => {
        const err = (ev as ErrorEvent).error ?? new Error('MediaRecorder error');
        fail(err instanceof Error ? err.message : String(err));
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mime || 'audio/webm',
        });
        const r = stoppedResolveRef.current;
        stoppedResolveRef.current = null;
        if (r) r(blob);
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Failed to start recording');
    }
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      fail('No active recording');
      return;
    }
    setBusy(true);
    setRecording(false);
    const blob = await new Promise<Blob>((resolve) => {
      stoppedResolveRef.current = resolve;
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
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
