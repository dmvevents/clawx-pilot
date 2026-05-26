# Native ASR helpers

Tiny per-platform binaries that wrap the OS-supplied speech recognition APIs so
the Electron main process can transcribe a single audio file in well under a
second. The bundled Python `whisper` CLI takes 30-60 s on a CPU-only laptop —
unacceptable for the principals' pilot — so we lean on Apple/Windows ML
instead.

## macOS — `whisper-cli` fast path

The current macOS fast path uses `whisper-cli` from whisper.cpp, not the Swift
Speech.framework helper. This keeps audio on device and avoids the unsigned
helper / app-bundle entitlement problem described below.

`electron/main/asr-native-mac.ts::transcribeMacNative` searches:

1. `$WHISPER_CPP_BIN` (explicit `whisper-cli` override)
2. `/opt/homebrew/bin/whisper-cli`
3. `/usr/local/bin/whisper-cli`

It also needs a whisper.cpp model. It searches `$WHISPER_CPP_MODEL`, then
common cache paths such as `~/.cache/whisper.cpp/ggml-base.en.bin`.

Install/check the fast path:

```bash
brew install whisper-cpp
whisper-cli --model base.en
```

If `whisper-cli` or the model is missing, `transcribeMacNative` throws
`MacAsrError` with `BINARY_MISSING` or `MODEL_MISSING`.
`electron/main/asr-ipc.ts` logs the native failure and falls through to the
legacy Python `whisper` CLI if it is available.

### Dormant Swift helper

Source: `macSpeechRecognize.swift`
Output: `resources/bin/darwin-arm64/macSpeechRecognize`

The Swift helper wraps `SFSpeechURLRecognitionRequest` from `Speech.framework`
and is kept for a future signed-bundle path. The current main-process ASR path
does not call it for transcription.

Build it only when revisiting the signed Speech.framework path:

```bash
swiftc -O -o resources/bin/darwin-arm64/macSpeechRecognize \
       electron/native/macSpeechRecognize.swift
```

Verify:

```bash
file resources/bin/darwin-arm64/macSpeechRecognize
# -> Mach-O 64-bit executable arm64
```

### TODO — code-signing

The Swift binary is currently `ad-hoc` signed by `swiftc`. For Gatekeeper-
clean distribution it must be signed and notarised alongside the rest of the
app before it can become the default ASR path. Add to the electron-builder
afterPack hook:

```js
// scripts/sign-mac-helpers.mjs (TODO)
await codesign(
  'resources/bin/darwin-arm64/macSpeechRecognize',
  { identity: process.env.APPLE_DEVELOPER_ID, options: ['--timestamp', '--options=runtime'] },
);
```

Without this, `spctl --assess` on the bundled binary will fail and macOS may
refuse to launch the helper on locked-down corporate Macs.

## Windows — `WinSpeechRecognize.exe`

Builds through `pnpm run win-asr:build:x64` and is included by
`pnpm run prep:win-binaries`. The helper targets .NET Framework 4.8 through
System.Speech so the Windows installer does not depend on a separately
installed .NET 8 runtime. See `electron/native/WinSpeechRecognize/README.md`
for diagnostics and tradeoffs.
