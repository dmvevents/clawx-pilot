---
name: windows-runtime-recovery
description: Diagnose and repair ClawX/Ministry Windows runtime failures where chat gets stuck thinking, the model provider flips or diverges, Gateway goes down, Excel/Word prompts stall, ASR falls back incorrectly, or Mac/VM Windows-emulation testing is needed.
---

# Windows Runtime Recovery

## Core Rule

Prove the app-facing runtime path. Config files and UI labels are hints, not proof. A healthy result needs a live Gateway request or transcript evidence showing the intended cloud provider/model.

## First Reads

- `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md`
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `.codex/skills/windows-runtime-recovery/references/model-gateway-coherence.md`
- `.codex/skills/windows-runtime-recovery/references/windows-test-harness.md`

## Operating Rules

- Do not print provider keys, Host API tokens, passwords, Forms URLs, email bodies, or full recipient lists.
- Do not send email, download attachments, or submit Forms unless explicitly confirmed in the same session.
- Do not switch demo traffic to local Ollama unless the user explicitly changes the demo requirement.
- Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` before mutating Windows state.

## Triage Order

1. Capture read-only state with `windows-pilot/scripts/pilot-probe-state.ps1`.
2. If model calls fail, check network to the cloud provider before editing config.
3. Compare provider/channel state across settings, provider store, OpenClaw config, agent model config, and latest session transcript.
4. If Office prompts stall, run `scripts/demo-office-analysis-e2e.mjs` against the same file to isolate parser vs model.
5. If Outlook/Forms fail, verify Chrome CDP and signed-in page context before changing code.
6. If the same failure can recur, add a regression test before or with the fix.

## Useful Commands

```bash
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
pnpm run demo:office-analysis -- --excel "<xlsx>" --word "<docx>" --json-out /tmp/office-analysis.json
```

## Validation

Minimum recovery evidence:

- Gateway health is live.
- Latest request uses the intended cloud provider/model.
- No recent stuck `state=processing` diagnostics after 30-60 seconds.
- The failing feature has app-path proof, not only unit-level proof.
- New docs/tests capture the failure class if it was new.
