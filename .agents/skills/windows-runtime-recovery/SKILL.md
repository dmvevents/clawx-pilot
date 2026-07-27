---
name: windows-runtime-recovery
description: Diagnose and repair ClawX/Ministry Windows runtime failures where chat is stuck thinking, model provider routing drifts, Gateway goes down, Excel/Word prompts stall, ASR fallback breaks, or Mac/VM/physical Windows validation is needed.
---

# Windows Runtime Recovery

## Core Rule

Prove the app-facing runtime path. Config files and UI labels are clues; the proof is a live Gateway request, Host API result, transcript entry, or installed-app smoke artifact showing the intended provider/model and tool path.

## First Reads

- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `.codex/skills/windows-runtime-recovery/references/model-gateway-coherence.md`
- `.codex/skills/windows-runtime-recovery/references/windows-test-harness.md`
- `windows-pilot/skills/model-gateway-recovery.md`

## Triage Order

1. Capture read-only state with `windows-pilot/scripts/pilot-probe-state.ps1`.
2. If model calls fail, check network reachability before editing config.
3. Compare the four runtime stores: app settings/provider store, `~/.openclaw/openclaw.json`, agent `models.json`, and latest session transcript.
4. For Excel/Word stalls, run `scripts/demo-office-analysis-e2e.mjs` against the same file to isolate parser vs model.
5. For Outlook/Forms failures, verify signed-in user Chrome CDP before changing browser automation code.
6. Add or update a regression test when the failure class can recur.

## Minimum Evidence

- Gateway live.
- Latest request uses the intended cloud provider/model or a documented fallback.
- No stuck `state=processing` diagnostic after 30-60 seconds.
- The failing feature has app-path evidence, not only unit-level evidence.
