# CLWX-87 — Whisper.cpp accepts cancellation during a window where it has no effect

## Identity and scope

Independent source review on September 8, 2026, commit `ec97e27b952df0252a11346057b5a2b480ecc376`, branch `lane/whisper-cpp-backlog-20260908`, worktree `/private/tmp/clawx-whisper-cpp-20260908`.

This is the separately authorized development adapter, **excluded from the current GA release**. It is gated behind explicit development environment configuration. No real Windows Whisper binary/model or microphone run is claimed.

## Reproduction and confirmed mechanism

The independent reviewer used a delayed pre-spawn validation probe, started transcription, and called `cancelActiveWhisperCppJob()` before spawning the helper. Observed result: `accepted=true`, but the transcription promise subsequently resolved successfully.

Expected: when cancellation reports accepted, the current job must settle as cancelled without launching/returning a successful transcript. Otherwise cancellation should truthfully report that it could not be accepted.

At the reviewed revision, `electron/main/asr-whisper-cpp.ts` installs a no-op cancellation function during initial validation (around line 261), then replaces it when the process is created. The public cancellation contract (around line 137) therefore differs from behavior during that window. This is a source-reproduced race, not a hypothesis about Windows mic performance.

## Review evidence and remaining work

- Independent reviewer: `artifacts/ga-fable-20260908/whisper-review/result.md`.
- 38 focused ASR tests and Electron typecheck passed. Additional probes verified the default adapter stays inert and transcript size limits hold.
- Verdict: APPROVE scoped source with this non-blocking development-only finding. That approval does not close CLWX-87's product acceptance.
- A separate bounded stderr detail was observed: cap checks use UTF-16 character length against a byte-named budget. The reviewer found memory still bounded within approximately twice that budget; record the units accurately when next editing this code.

Next author: add a deterministic barrier before spawn, assert cancellation accepted there produces `CANCELLED` and zero spawns, then preserve timeout/process-exit/cleanup and ordinary-success tests. Keep this work on the backlog branch. Real binary/model hashes, packaging/notices, Windows RAM/mic/latency, WER and installed acceptance remain NOT_RUN. Do not merge this branch into moe.26 as part of the browser/Graph release repair.
