---
name: model-gateway-recovery
description: Diagnose Windows Ministry app model/Gateway failures, especially chat stuck on thinking, Gemini/Claude cloud routing drift, Wi-Fi/cloud reachability problems, stale Ollama snapshots, and provider store divergence.
metadata:
  os: windows
  primary-model: google/gemini-2.5-pro
  related-doc: docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md
---

# Model and Gateway recovery - Windows pilot

## When to use

Use this skill when:

- chat sits on "thinking";
- the app says "model call failed";
- Gateway was live and then went down;
- Excel/Word prompts stall after previously working;
- the UI shows Gemini/Claude but transcripts or config show Ollama/local;
- Wi-Fi or cloud provider reachability changed.

## First principle

The app has multiple provider/model stores. Never trust one file or one UI label. Prove the exact app-facing runtime path.

## Read-only probe sequence

```bash
ssh pilot 'echo ok'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-tail-gateway-log.ps1"'
```

On Windows:

```powershell
Test-NetConnection generativelanguage.googleapis.com -Port 443
```

If network is down, fix network first. Do not rewrite provider config to compensate for Wi-Fi.

## Expected demo state

- `%APPDATA%\Ministry of Education\settings.json`: preferred channel is `online`.
- `%APPDATA%\Ministry of Education\clawx-providers.json`: default provider/account is Google or the user-selected cloud provider.
- `%USERPROFILE%\.openclaw\openclaw.json`: default model is `google/gemini-2.5-pro` or the explicit cloud model.
- Latest session transcript: model snapshot provider is cloud, not `ollama-ollamalo`.
- Gateway health returns live/ok.

## Recovery shape

1. Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw`.
2. Re-run the app's provider/channel preflight path or apply a single coherent channel transaction.
3. Restart app/Gateway.
4. Verify Gateway health.
5. Send a small app-facing request.
6. Inspect transcript for provider/model evidence.
7. Watch for stuck `state=processing` diagnostics for 30-60 seconds.

## Do not

- Do not switch to local Ollama for the demo unless the user explicitly asks.
- Do not judge success from `127.0.0.1:18787/configs` alone.
- Do not paste API keys into logs or docs.
- Do not call the app ready while transcript model snapshots still show the wrong provider.
