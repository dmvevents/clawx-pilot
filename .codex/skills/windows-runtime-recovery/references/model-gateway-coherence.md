# Model And Gateway Coherence

Use this reference when Windows chat is stuck on "thinking", Gateway appears down, the model call fails, or the app seems to be using a different model than the UI shows.

## Failure Pattern

The app has several model/provider stores. Any one can drift:

- `%APPDATA%\Ministry of Education\settings.json`
- `%APPDATA%\Ministry of Education\clawx-providers.json`
- `%USERPROFILE%\.openclaw\openclaw.json`
- `%USERPROFILE%\.openclaw\agents\main\agent\models.json`
- latest `%USERPROFILE%\.openclaw\agents\main\sessions\*.jsonl`

Do not trust one surface. The UI can show Google/Gemini while a runtime snapshot still points to local Ollama.

## Read-Only Checks

```bash
ssh pilot 'echo ok'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
```

On Windows, check provider network reachability:

```powershell
Test-NetConnection generativelanguage.googleapis.com -Port 443
```

If network fails, do not edit model config first. Fix Wi-Fi/routing and retry.

## Expected Demo State

- preferred channel: `online`
- default provider: `google`
- model: `google/gemini-2.5-pro`
- latest transcript model snapshot provider: `google`
- no stale snapshot provider like `ollama-ollamalo`
- explicit Google runtime API, if present, is `google-generative-ai`

## Recovery Shape

1. Back up state if a write is needed.
2. Re-run the channel/provider preflight path rather than hand-editing only one file.
3. Restart app/Gateway.
4. Verify with Gateway health and transcript evidence.
5. Watch for stuck diagnostics for 30-60 seconds.

## Regression Test To Add

Create a Windows-like temp profile test:

1. Seed settings as online.
2. Seed provider store with Google default.
3. Seed OpenClaw config with stale Ollama/default or stale Google OpenAI-compatible override.
4. Run the real preflight/sync code.
5. Assert all stores converge to the same provider/model and no stale runtime provider remains.

This closes the failure class that caused "thinking" after the demo had previously worked.
