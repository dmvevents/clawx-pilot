# STAGE 2a — Gap C: ASR smoke on Windows (vbatch)

**Verdict: PASS — `STATE: ASR_SMOKE_OK`** (first-ever execution of the desk-checked script; no edits needed).

- **Date:** 2026-09-02 (VM local clock 2026-09-03 03:48)
- **Host:** GCP VM `clawx-win-rc-20260609` (us-central1-a), guest `clawxtest`, over IAP (sshd 22 -> localhost:12222)
- **Build:** installed `Ministry of Education` 0.4.3-moe.15 (per-user, `%LOCALAPPDATA%\Programs\Ministry of Education`)
- **Script:** `windows-pilot/pilot-asr-smoke.ps1` (authored 2026-09-03, desk-checked only until this run), scp'd to `C:\Users\clawxtest\`, run with `-ExecutionPolicy Bypass -File ... -KeepArtifacts`
- **Raw log:** `vbatch2-asr-out.log` in this directory (ssh exit 0)

## FACTS (from the run)

| Step | Result |
|---|---|
| Helper binary | `resources\bin\WinSpeechRecognize.exe` present (12,288 B, 2026-09-02 08:49), `.exe.config` present |
| Installed recognizers | 1 — `en-US Microsoft Speech Recognizer 8.0 for Windows` (Server 2022 DC image DOES have the desktop recognizer; the script's BLOCKED_NO_RECOGNIZER contingency was not needed) |
| Synthesized WAV | System.Speech TTS -> `clip-input.wav` 140,366 B, 16 kHz 16-bit mono PCM |
| Transcode (app two-file flow) | bundled `resources\bin\ffmpeg.exe` -> `clip.wav`, exit 0 |
| Recognize | `WinSpeechRecognize.exe clip.wav en-US` exit **0**, JSON contract parsed |
| **Transcript** | **"The attendance report for the school is ready for review"** — verbatim match of the synthesized phrase |
| Keyword assertion | `attendance` FOUND |
| Artifacts retained on guest | `C:\Users\clawxtest\AppData\Local\Temp\clawx-asr-smoke-20260903-034815\` (`-KeepArtifacts`) |

## What this proves

The full packaged Windows ASR chain — bundled helper + bundled ffmpeg transcode + System.Speech recognition + single-line JSON stdout contract — works end-to-end on the installed moe.15 build with no mic, exactly mirroring `electron/main/asr-ipc.ts` / `asr-native-windows.ts`. Gap C in `docs/APP_WORKFLOWS_TEST_MATRIX.md` (W8 Windows leg) is closed with a transcript assertion.

## Notes

- The desk-check assumption "Server SKUs may lack the desktop recognizer" turned out not to apply to this image.
- Recognition of a TTS voice was verbatim, stronger than the single-keyword bar the script sets.
- No secrets printed; no app/user state mutated (temp dir only).
