# Online Model Gateway RC Plan - 2026-06-05

## Decision

Use the existing ClawX `custom` provider path for the release candidate. It already supports a Base URL, broker API key, model id, and OpenAI-compatible protocol, then syncs the account into OpenClaw runtime config.

This avoids putting provider API keys on the Windows laptop. The laptop receives only a broker-issued client key.

## Current Evidence

- Windows RC harness fix is pushed at `d7d36e8`.
- Latest laptop run: `C:\Users\VYONIX\Downloads\clawx-chat-procedures-20260605-150906\final-report.md`.
- Local ignored audit copy: `artifacts/windows-rc/clawx-chat-procedures-20260605-150906/final-report.md`.
- Status from that report: `READY_SAFE_CHAT_PROCEDURES`.
- CDP ports from that report: Chrome `18792`, Electron `9223`.
- Required failures: `0`.
- Hard failures: `0`.

## Existing Integration Surface

- Renderer settings write through `hostApiFetch`, not direct localhost HTTP.
- Provider accounts are stored in `clawx-providers` under `providerAccounts`.
- Provider secrets are stored under `providerSecrets` and mirrored to legacy `apiKeys`.
- Host API routes under `/api/provider-accounts` create/update/default provider accounts.
- Runtime sync writes custom provider `baseUrl`, `api`, model id, and key into OpenClaw config/auth profiles.

## RC Architecture

```
ClawX desktop
  custom provider
  baseUrl=https://broker.example/v1
  apiKey=broker-issued client key
  model=moe-demo
        |
        v
ClawX model broker
  validates client key
  maps moe-demo -> upstream provider model
  stores upstream provider key server-side
        |
        v
Gemini / Claude / other OpenAI-compatible upstream
```

## Implementation Added

- `services/model-broker/server.mjs`
- `services/model-broker/README.md`
- `services/model-broker/.env.example`
- `tests/unit/model-broker.test.ts`

The broker exposes:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

## Required Environment

```bash
MODEL_BROKER_CLIENT_KEYS=client-key-for-demo
MODEL_BROKER_UPSTREAM_BASE_URL=https://example-upstream.test/v1
MODEL_BROKER_UPSTREAM_API_KEY=provider-key-stays-server-side
MODEL_BROKER_MODEL_MAP={"moe-demo":"gemini-2.5-pro"}
MODEL_BROKER_DEFAULT_MODEL=moe-demo
PORT=8787
```

## ClawX Custom Provider Values

- Provider: `Custom`
- Base URL: `https://<broker-host>/v1`
- Protocol: `OpenAI Completions` unless the broker/upstream is configured for Responses
- Model ID: `moe-demo`
- API key: broker-issued client key

## Stop Condition For RC

1. Broker `/healthz` returns `ok: true`.
2. Broker `/v1/models` returns only the public model ids.
3. ClawX custom-provider validation passes against the broker.
4. A one-prompt installed-app chat completes through the broker.
5. Windows chat procedures still report `READY_SAFE_CHAT_PROCEDURES`.
6. No real email send or Microsoft Forms submit is performed without explicit confirmation.

## Deferred After RC

- Replace static client-key allowlist with per-school/user key storage.
- Add quotas, audit logging, revocation, and rate limiting.
- Add a branded provider type only if the demo needs a non-technical setup UI.
- Add deployment IaC once the hosting target is chosen.
