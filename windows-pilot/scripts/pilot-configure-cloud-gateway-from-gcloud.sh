#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-gen-lang-client-0649986230}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-clawx-litellm-gateway}"
SECRET_NAME="${SECRET_NAME:-clawx-litellm-master-key}"
SSH_TARGET="${SSH_TARGET:-pilot}"
WINDOWS_USER="${WINDOWS_USER:-ClawXFreshTest}"
REMOTE_SCRIPT="${REMOTE_SCRIPT:-C:/Users/Public/Downloads/pilot-configure-cloud-gateway.ps1}"
REMOTE_KEY_FILE="${REMOTE_KEY_FILE:-C:/Users/Public/Downloads/.clawx-litellm-key.tmp}"
MODEL="${MODEL:-moe-demo-pro}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
local_script="$repo_root/windows-pilot/scripts/pilot-configure-cloud-gateway.ps1"

if [[ ! -f "$local_script" ]]; then
  echo "ERROR: missing $local_script" >&2
  exit 1
fi

service_url="$(
  gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.url)'
)"

if [[ -z "$service_url" ]]; then
  echo "ERROR: Cloud Run service URL is empty for $SERVICE_NAME" >&2
  exit 1
fi

litellm_key="$(
  gcloud secrets versions access latest \
    --project "$PROJECT_ID" \
    --secret "$SECRET_NAME"
)"

if [[ -z "$litellm_key" ]]; then
  echo "ERROR: LiteLLM key is empty for secret $SECRET_NAME" >&2
  exit 1
fi

scp "$local_script" "$SSH_TARGET:$REMOTE_SCRIPT" >/dev/null

printf '%s' "$litellm_key" | ssh "$SSH_TARGET" "powershell -NoProfile -Command \"\$ErrorActionPreference='Stop'; \$key=[Console]::In.ReadToEnd(); \$utf8=New-Object System.Text.UTF8Encoding(\$false); [System.IO.File]::WriteAllText('$REMOTE_KEY_FILE', \$key.Trim(), \$utf8)\""

cleanup_remote_key() {
  ssh "$SSH_TARGET" "powershell -NoProfile -Command \"Remove-Item -LiteralPath '$REMOTE_KEY_FILE' -Force -ErrorAction SilentlyContinue\"" >/dev/null 2>&1 || true
}
trap cleanup_remote_key EXIT

ssh "$SSH_TARGET" "powershell -NoProfile -ExecutionPolicy Bypass -File '$REMOTE_SCRIPT' -WindowsUser '$WINDOWS_USER' -BaseUrl '$service_url/v1' -ApiKeyFile '$REMOTE_KEY_FILE' -Model '$MODEL'"

echo "STATE: configured_gateway_from_gcloud service=$SERVICE_NAME region=$REGION windowsUser=$WINDOWS_USER model=$MODEL"
