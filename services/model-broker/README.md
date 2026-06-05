# ClawX Model Broker

Dependency-free OpenAI-compatible relay for the release-candidate online model path.

The desktop app should not ship provider keys. It stores only a broker-issued client key and points a `custom` provider at this broker. The broker keeps upstream provider keys server-side, maps public model ids to upstream model ids, and proxies only the enabled OpenAI-compatible routes.

## Endpoints

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

## Environment

```bash
export MODEL_BROKER_CLIENT_KEYS='client-key-for-school-a,client-key-for-demo'
export MODEL_BROKER_UPSTREAM_BASE_URL='https://example-upstream.test/v1'
export MODEL_BROKER_UPSTREAM_API_KEY='provider-key-stays-on-server'
export MODEL_BROKER_MODEL_MAP='{"moe-demo":"gemini-2.5-pro","moe-claude":"claude-opus-4-6"}'
export MODEL_BROKER_DEFAULT_MODEL='moe-demo'
export PORT=8787
node services/model-broker/server.mjs
```

Optional:

```bash
export MODEL_BROKER_UPSTREAM_HEADERS='{"HTTP-Referer":"https://example.org","X-Title":"ClawX"}'
export MODEL_BROKER_TIMEOUT_MS=120000
```

## ClawX Configuration

In Settings > AI Providers, add a `Custom` provider:

- Base URL: `https://<broker-host>/v1`
- Protocol: `OpenAI Completions` or `OpenAI Responses`
- Model ID: one public key from `MODEL_BROKER_MODEL_MAP`, for example `moe-demo`
- API key: the broker-issued client key, not the provider key

Then set that account as the default online provider. The existing runtime sync writes the custom provider into `~/.openclaw/openclaw.json` and updates OpenClaw auth profiles.

## RC Acceptance

1. `GET /healthz` returns `ok: true`.
2. `GET /v1/models` with the client key returns only public model ids.
3. A one-message chat through ClawX reaches the broker and gets a model response.
4. The broker logs do not print provider keys, client keys, prompts, or full response bodies.
5. The Windows chat-procedure harness still reports `READY_SAFE_CHAT_PROCEDURES`.
