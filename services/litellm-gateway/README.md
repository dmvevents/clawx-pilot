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

## Desktop Configuration

In Settings > AI Providers, add a custom provider:

- Base URL: `https://<clawx-litellm-gateway-url>/v1`
- Protocol: OpenAI-compatible chat completions/responses
- Model ID: `moe-demo` for the standard demo path, `moe-demo-pro` for heavier reasoning
- API key: LiteLLM key from Secret Manager, not a provider key

## Production Hardening

Add Cloud SQL Postgres before issuing separate per-school virtual keys, budgets, and spend controls. LiteLLM supports virtual keys and spend tracking with `DATABASE_URL`; keep the RC key as a temporary single-client key only.
