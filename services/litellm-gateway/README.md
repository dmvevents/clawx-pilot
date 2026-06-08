# ClawX LiteLLM Gateway

Production-shaped AI gateway for the online model path. The desktop app should point a custom OpenAI-compatible provider at this service and store only the LiteLLM-issued client key. Provider credentials stay on Google Cloud.

## Current RC Shape

- Runtime: LiteLLM Proxy pinned to `v1.87.1`.
- Provider: Vertex AI Gemini through the Cloud Run service account.
- Public model IDs:
  - `moe-demo` -> `vertex_ai/gemini-2.5-flash`
  - `moe-demo-pro` -> `vertex_ai/gemini-2.5-pro`
- Testing scale: `min-instances=0`, `max-instances=2`, `concurrency=20`.
- Memory: `2Gi`. LiteLLM exceeded `1Gi` during Cloud Run startup in RC testing.
- Demo scale: raise to `min-instances=1`, `max-instances=10`, `concurrency=40` after smoke testing.
- Observability: Phoenix/OpenTelemetry callback is wired in config but remains
  inert until the Phoenix/OTLP env vars below are set. Message body capture is
  off by default.

## Deploy

Create secrets once:

```bash
openssl rand -hex 32 | sed 's/^/sk-clawx-/' | gcloud secrets create clawx-litellm-master-key --data-file=-
openssl rand -hex 32 | sed 's/^/sk-clawx-salt-/' | gcloud secrets create clawx-litellm-salt-key --data-file=-
```

Deploy the testing profile:

```bash
gcloud run deploy clawx-litellm-gateway \
  --source services/litellm-gateway \
  --region us-central1 \
  --no-invoker-iam-check \
  --service-account clawx-litellm-runtime@gen-lang-client-0649986230.iam.gserviceaccount.com \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 20 \
  --cpu 1 \
  --memory 2Gi \
  --timeout 120 \
  --set-env-vars VERTEXAI_PROJECT=gen-lang-client-0649986230,VERTEXAI_LOCATION=us-central1 \
  --set-secrets LITELLM_MASTER_KEY=clawx-litellm-master-key:latest,LITELLM_SALT_KEY=clawx-litellm-salt-key:latest
```

`--allow-unauthenticated` can fail under domain-restricted IAM org policies. Use `--no-invoker-iam-check` so Cloud Run is reachable publicly while LiteLLM still enforces the bearer key.

Smoke test without printing the key:

```bash
LITELLM_KEY="$(gcloud secrets versions access latest --secret=clawx-litellm-master-key)"
SERVICE_URL="$(gcloud run services describe clawx-litellm-gateway --region us-central1 --format='value(status.url)')"
curl -fsS "$SERVICE_URL/v1/models" -H "Authorization: Bearer $LITELLM_KEY"
```

## Phoenix Tracing

LiteLLM is configured with the `arize_phoenix` callback and should be enabled
through the Phoenix collector env vars on the Cloud Run service. Keep the
default `turn_off_message_logging: true` for real users; only enable content
capture for a controlled internal demo account.

Self-hosted Phoenix example:

```bash
gcloud run services update clawx-litellm-gateway \
  --region us-central1 \
  --set-env-vars PHOENIX_COLLECTOR_HTTP_ENDPOINT=https://<phoenix-host>/v1/traces,PHOENIX_PROJECT_NAME=clawx-litellm
```

Phoenix Cloud example:

```bash
gcloud secrets create clawx-phoenix-api-key --data-file=-
gcloud run services update clawx-litellm-gateway \
  --region us-central1 \
  --set-env-vars PHOENIX_COLLECTOR_HTTP_ENDPOINT=https://app.phoenix.arize.com/v1/traces,PHOENIX_PROJECT_NAME=clawx-litellm \
  --set-secrets PHOENIX_API_KEY=clawx-phoenix-api-key:latest
```

LiteLLM also has an opt-in OpenTelemetry v2 path for full-request proxy traces
(`LITELLM_OTEL_V2=true`), but this RC keeps the simpler Phoenix callback path
first because the config already uses `arize_phoenix`.

Controlled demo content capture only:

```bash
gcloud run services update clawx-litellm-gateway \
  --region us-central1 \
  --set-env-vars OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=span_only
```

Turn content capture back off after the demo:

```bash
gcloud run services update clawx-litellm-gateway \
  --region us-central1 \
  --remove-env-vars OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
```

## Desktop Configuration

The app now supports first-launch seeding for this gateway. Put
`cloud-gateway.json` in the packaged resources directory
(`resources/cloud-gateway.json` before packaging, which lands at
`process.resourcesPath/resources/cloud-gateway.json`) or in the user's app data
directory, or pass equivalent `CLAWX_CLOUD_GATEWAY_*` environment variables.

Recommended config shape:

```json
{
  "enabled": true,
  "providerId": "moe-cloud-gateway",
  "label": "MOE Cloud Gateway",
  "baseUrl": "https://<clawx-litellm-gateway-url>/v1",
  "apiKeyFile": "cloud-gateway.key",
  "model": "moe-demo-pro",
  "models": ["moe-demo-pro", "moe-demo"],
  "setDefault": true,
  "setPreferredChannel": true
}
```

Use `apiKeyFile` for packaged/fresh-install tests so the key is not committed to
Git. `apiKey` and env var `CLAWX_CLOUD_GATEWAY_API_KEY` are supported for local
smoke tests only. On successful seed, ClawX writes the custom account, sets the
Online channel, and syncs OpenClaw with `authHeader: true` so LiteLLM receives
`Authorization: Bearer <client-key>`.

Manual fallback in Settings > AI Providers:

- Base URL: `https://<clawx-litellm-gateway-url>/v1`
- Protocol: OpenAI-compatible chat completions/responses
- Model ID: `moe-demo` for the standard demo path, `moe-demo-pro` for heavier reasoning
- API key: LiteLLM key from Secret Manager, not a provider key

## Production Hardening

Add Cloud SQL Postgres before issuing separate per-school virtual keys, budgets, and spend controls. LiteLLM supports virtual keys and spend tracking with `DATABASE_URL`; keep the RC key as a temporary single-client key only.
