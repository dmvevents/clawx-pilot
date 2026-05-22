# WinSpeechRecognize

Windows-native ASR helper for ClawX. A small .NET 8 console app that wraps
the WinRT `Windows.Media.SpeechRecognition.SpeechRecognizer` API so the
Electron main process can transcribe a single audio clip without paying the
multi-second CPU cost of the bundled Python `whisper` CLI.

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

## Build (Windows host)

You need the **.NET 8 SDK** (`winget install Microsoft.DotNet.SDK.8`).

From the repo root:

```powershell
cd electron\native\WinSpeechRecognize
dotnet publish -c Release -r win-x64 --self-contained false -o ..\..\..\resources\bin\win32-x64
```

The build emits `WinSpeechRecognize.exe` (plus a `.pdb`) at
`resources\bin\win32-x64\`, which is the location
`asr-native-windows.ts::resolveWindowsAsrBinary()` probes and which
`electron-builder.yml`'s `extraResources` block copies into the installed
app under `<install-dir>\resources\bin\WinSpeechRecognize.exe`.

### Self-contained vs framework-dependent

The default published build is **framework-dependent** (`--self-contained false`).
This produces an EXE around 200 KB but requires the user to have the
**.NET 8 Desktop Runtime** installed.

| Mode | Pros | Cons |
|------|------|------|
| `--self-contained false` (default) | ~200 KB binary, fast install | User must have .NET 8 runtime — not on stock Windows 10/11 |
| `--self-contained true` | No runtime dependency | ~30 MB binary added to installer |

**Tradeoff for the principals' pilot:** stock Windows 11 ships with neither
.NET 8 nor a public auto-installer the NSIS script can rely on without admin
rights. If we cannot guarantee the runtime is present (which is the case for
schools where IT pushes images and locks down package managers), prefer:

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -o ..\..\..\resources\bin\win32-x64
```

The decision belongs to the deploy/packaging owner; this README documents
the tradeoff but does not pick.

## Speech-recognition permission

The first time the binary runs, Windows prompts the user to enable online
speech recognition (Settings → Privacy & security → Speech). The recognizer
itself does not require microphone access (we feed it a file), but the
underlying Speech Platform stack does check the privacy gate. If denied the
helper exits with code 2 and the TS layer surfaces a `MIC_PERMISSION` error
that the renderer translates into a one-time settings prompt.

## Why not embed the recognizer via a Node native module?

Two reasons:

1. The CsWinRT projections require a hosted CLR or NativeAOT — there is no
   stable C ABI to expose to N-API without a multi-megabyte interop shim.
2. Shelling out keeps the recognizer crash-isolated from the Electron main
   process. If the Speech Platform regresses on a Patch Tuesday update, the
   worst case is a non-zero exit code and a fallback to the whisper CLI.

## Versioning notes

- Targets `net8.0-windows10.0.19041.0` (Windows 10 May 2020 / 2004). All
  supported school-deployed Windows 10 21H2 and Windows 11 22H2/23H2/24H2
  builds are above this floor.
- The recognizer's one-shot mode caps at ~30 seconds of audio. The TS-side
  timeout is 30 000 ms; the C# watchdog cancels at 28 s to leave headroom.
  For longer clips we'd switch to `ContinuousRecognitionSession` and emit
  incremental results — out of scope for the current ClawX 5-second push-to-
  talk UX.
