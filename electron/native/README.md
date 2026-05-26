# Native ASR helpers

Tiny per-platform binaries that wrap the OS-supplied speech recognition APIs so
the Electron main process can transcribe a single audio file in well under a
second. The bundled Python `whisper` CLI takes 30-60 s on a CPU-only laptop —
unacceptable for the principals' pilot — so we lean on Apple/Windows ML
instead.

## macOS — `macSpeechRecognize`

Source: `macSpeechRecognize.swift`
Output: `resources/bin/darwin-arm64/macSpeechRecognize`

Wraps `SFSpeechURLRecognitionRequest` from `Speech.framework`. Requests
on-device recognition when the host CPU supports it (true on every Apple
Silicon Mac) which keeps audio off Apple's servers.

### Build

```bash
swiftc -O -o resources/bin/darwin-arm64/macSpeechRecognize \
       electron/native/macSpeechRecognize.swift
```

Verify:

```bash
file resources/bin/darwin-arm64/macSpeechRecognize
# → Mach-O 64-bit executable arm64
```

### What fails when it's missing

`electron/main/asr-native-mac.ts::resolveMacSpeechBinary` searches:

1. `$MAC_SPEECH_BIN` (explicit override; useful in CI/dev)
2. `<resourcesPath>/bin/macSpeechRecognize` (electron-builder packaged layout)
3. `<resourcesPath>/bin/darwin-arm64/macSpeechRecognize` (verbatim layout)
4. `<cwd>/resources/bin/darwin-arm64/macSpeechRecognize` (dev mode)

If none exist, `transcribeMacNative` throws `MacAsrError` with code
`BINARY_MISSING`. `electron/main/asr-ipc.ts` catches that and falls through
to the Python whisper CLI, so the app keeps working but loses the speed
boost. Logs (`logger.warn`) make the fallback visible so you can spot it in
the field.

### Permissions

First run triggers the macOS *Speech Recognition* permission prompt. The
prompt copy comes from the host process's `Info.plist` —
`NSSpeechRecognitionUsageDescription` should already be set in the Electron
app bundle. If it isn't, the prompt still appears but with a generic
"requested by app" message.

If the user clicks **Don't Allow**, every subsequent invocation returns
`{ ok: false, code: "MIC_PERMISSION" }`. The IPC handler propagates that to
the renderer unchanged so we can surface a *Privacy & Security → Speech
Recognition* deep-link.

To force the prompt again during testing:

```bash
tccutil reset SpeechRecognition com.clawx.app
```

(Substitute the bundle id you ship under.)

### TODO — code-signing

The Swift binary is currently `ad-hoc` signed by `swiftc`. For Gatekeeper-
clean distribution it must be signed and notarised alongside the rest of the
app. Add to the electron-builder afterPack hook:

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
