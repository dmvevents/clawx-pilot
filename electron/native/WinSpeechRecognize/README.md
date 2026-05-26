# WinSpeechRecognize

Windows-native ASR helper for ClawX. A small .NET Framework console app that
wraps the desktop `System.Speech.Recognition` API so the Electron main process
can transcribe a WAV clip without paying the multi-second CPU cost of the
bundled Python `whisper` CLI.

The TS-side wrapper is `electron/main/asr-native-windows.ts`. The IPC
dispatcher in `electron/main/asr-ipc.ts` calls the wrapper first on win32 and
falls back to the existing `whisper` CLI when the helper is missing or fails.

## What it does

```
WinSpeechRecognize.exe <audio-path> [locale]
```

- `audio-path` (required) — absolute path to a WAV file. 16 kHz mono is
  preferred; the Windows speech stack also accepts other PCM rates and will
  resample internally.
- `locale` (optional, default `en-US`) — BCP-47 tag, e.g. `en-GB`, `fr-FR`.

On success, prints a single JSON object to stdout and exits 0:

```json
{"text": "hello world", "language": "en-US"}
```

On failure, writes a human-readable message to stderr and exits with one of:

| Code | Meaning |
|------|---------|
| 1 | Generic recognition failure |
| 2 | Microphone / speech-recognition permission denied |
| 3 | Audio file not found / unreadable |

The TS wrapper maps these to `ASR_FAILED`, `MIC_PERMISSION`, `NO_AUDIO`
respectively.

## Build

You need a .NET SDK on the build host. The output targets .NET Framework 4.8,
which is present on stock Windows 11 images; the target laptop does not need a
.NET 8 runtime.

From the repo root:

```powershell
pnpm run win-asr:build:x64
```

The build emits `WinSpeechRecognize.exe` and `WinSpeechRecognize.exe.config` at
`resources\bin\win32-x64\`, which is the location
`asr-native-windows.ts::resolveWindowsAsrBinary()` probes and which
`electron-builder.yml`'s `extraResources` block copies into the installed
app under `<install-dir>\resources\bin\WinSpeechRecognize.exe`.

`pnpm run prep:win-binaries` now treats a missing helper as a packaging failure
unless `SKIP_WIN_ASR_HELPER=1` is set for a deliberate diagnostic build.

## Audio input

The helper reads WAV files through `SpeechRecognitionEngine.SetInputToWaveFile`.
The renderer records PCM WAV directly for current builds. Older installed
builds that still record WebM must have `FFMPEG_PATH` set so `asr:saveBlob`
can transcode to WAV before invoking this helper.

## Why not embed the recognizer via a Node native module?

Two reasons:

1. The speech engine is process-global and Windows-specific; a separate helper
   keeps it isolated from Electron main-process crashes.
2. Shelling out keeps the recognizer crash-isolated from the Electron main
   process. If the Speech Platform regresses on a Patch Tuesday update, the
   worst case is a non-zero exit code and a fallback to the whisper CLI.

## Versioning notes

- Targets `net48`, backed by .NET Framework 4.8 on supported Windows 10/11
  images.
- The recognizer's one-shot mode caps at 28 seconds in the helper. Longer clips
  are out of scope for the current ClawX push-to-talk UX.
