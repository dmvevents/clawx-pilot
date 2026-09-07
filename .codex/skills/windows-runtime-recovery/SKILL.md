---
name: windows-runtime-recovery
description: Diagnose and repair ClawX/Ministry Windows runtime failures where chat gets stuck thinking, the model provider flips or diverges, Gateway goes down, Excel/Word prompts stall, ASR falls back incorrectly, or a Mac/VM Windows-emulation harness is needed. Use for Windows provider/Gateway coherence, Gemini/Claude cloud routing, config drift, packaged-runtime smoke tests, and next-agent demo handoff work.
---

# Windows Runtime Recovery

## Core Rule

Prove the app-facing runtime path. Config files and UI labels are hints, not proof. A healthy result needs a live Gateway request or transcript evidence showing the intended cloud provider/model.

## First Reads

Load only what you need:

- `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md` for the full handoff and current state.
- `docs/WINDOWS_PROBLEMS_ATLAS.md` for known failure signatures.
- `references/model-gateway-coherence.md` when chat is stuck, Gateway is down, or the model/provider is wrong.
- `references/windows-test-harness.md` when building Mac/VM tests for Windows behavior.
- `.codex/skills/windows-outlook-demo/SKILL.md` when the failure involves Outlook, Forms, Chrome CDP, or send/submit gates.

## Operating Rules

- Do not print provider keys, Host API tokens, passwords, Forms URLs, email bodies, or full recipient lists.
- Do not send email, download attachments, or submit Forms unless the user explicitly confirms that exact action in the same session.
- Do not use standalone `openclaw agent` as final proof for app features. It is diagnostic only.
- Do not switch demo traffic to local Ollama unless the user explicitly changes the demo requirement.
- Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` before mutating Windows state.

## Triage Order

1. Capture read-only state with `windows-pilot/scripts/pilot-probe-state.ps1`.
2. If model calls fail, check network to the cloud provider before editing config.
3. Compare provider/channel state across settings, provider store, OpenClaw config, agent model config, and latest session transcript.
4. If Office prompts stall, run `scripts/demo-office-analysis-e2e.mjs` against the same file to isolate parser vs model.
5. If Outlook/Forms fail, verify Chrome CDP and signed-in page context before changing code.
6. If the same failure can recur, add a regression test before or with the fix.

## Validation

Minimum recovery evidence:

- Gateway health is live.
- Latest request uses the intended cloud provider/model.
- No recent stuck `state=processing` diagnostics after 30-60 seconds.
- The failing feature has an app-path proof, not only a unit-level proof.
- New docs/tests capture the failure class if it was new.
