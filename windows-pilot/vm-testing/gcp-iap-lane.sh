#!/usr/bin/env bash
#
# GCP Windows test lane over IAP TCP forwarding.
#
# Replaces the EC2 lane (ec2-launch.sh), which is unusable: the local
# `claude-code-local` IAM user has no EC2 permissions at all — ec2:DescribeInstances,
# ec2:DescribeAddresses, ec2:AllocateAddress and ssm:DescribeInstanceInformation all
# return UnauthorizedOperation/AccessDenied. Verified 2026-08-19.
#
# Why IAP instead of a whitelisted public IP:
#   Connections are proxied by Google from 35.235.240.0/20, a fixed Google-owned range.
#   The operator's own IP never appears in a firewall rule, so a residential dynamic IP
#   (which changed carrier prefix mid-session on 2026-08-19) is irrelevant. The VM needs
#   no inbound public exposure at all.
#
# Firewall rules this depends on already exist in the project:
#   clawx-allow-rdp-iap    3389 from 35.235.240.0/20
#   clawx-allow-winrm-iap  5986 from 35.235.240.0/20
#
# Read-only by default. Every mutating action is behind an explicit subcommand.
#
# Usage:
#   ./gcp-iap-lane.sh probe      # read-only: VM state, firewall, protocol reachability
#   ./gcp-iap-lane.sh start      # start the VM (billable while RUNNING)
#   ./gcp-iap-lane.sh tunnel     # open RDP + SSH tunnels in the foreground
#   ./gcp-iap-lane.sh stop       # stop the VM (billing -> ~$0, disk retained)
#
set -uo pipefail

VM="${CLAWX_WINVM:-clawx-win-rc-20260609}"
ZONE="${CLAWX_WINVM_ZONE:-us-central1-a}"
PROJECT="${CLAWX_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}"
RDP_LOCAL_PORT="${CLAWX_RDP_PORT:-13389}"
SSH_LOCAL_PORT="${CLAWX_SSH_PORT:-12222}"
CONTROL_LOCAL_PORT="${CLAWX_CONTROL_PORT:-19999}"
IAP_READY_TIMEOUT_SECONDS="${CLAWX_IAP_READY_TIMEOUT_SECONDS:-45}"
IAP_READY_POLL_SECONDS="${CLAWX_IAP_READY_POLL_SECONDS:-0.25}"
IAP_RANGE="35.235.240.0/20"
TUNNEL_PIDS=()
LAST_TUNNEL_LOG=""

log() { printf '%s %s\n' "[$(date -u +%H:%M:%SZ)]" "$*"; }

cleanup_tunnels() {
  local pid
  for pid in "${TUNNEL_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup_tunnels EXIT INT TERM

resolve_project() {
  if [ -z "$PROJECT" ]; then
    PROJECT="$(gcloud config get-value project 2>/dev/null | tail -n 1 || true)"
  fi
  if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
    log "FAIL  GCP project is not set. Export CLAWX_GCP_PROJECT or configure gcloud's project."
    return 1
  fi
  log "Project: ${PROJECT}"
}

gcloud_project() {
  gcloud "--project=${PROJECT}" "$@"
}

is_local_port_occupied() {
  local port="$1"
  nc -z -w 1 localhost "$port" >/dev/null 2>&1
}

require_local_port_free() {
  local port
  for port in "$@"; do
    if is_local_port_occupied "$port"; then
      log "FAIL  local port ${port} is already occupied; refusing to trust a stale listener"
      return 1
    fi
  done
}

wait_for_iap_listener() {
  local pid="$1" logf="$2" local_port="$3"
  local deadline=$((SECONDS + IAP_READY_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if is_local_port_occupied "$local_port"; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      log "FAIL  IAP tunnel process exited before binding localhost:${local_port} — see ${logf}"
      sed 's/^/    /' "$logf" 2>/dev/null || true
      return 1
    fi
    sleep "$IAP_READY_POLL_SECONDS"
  done
  log "FAIL  timed out waiting for owned IAP tunnel to bind localhost:${local_port} — see ${logf}"
  sed 's/^/    /' "$logf" 2>/dev/null || true
  return 1
}

start_iap_tunnel() {
  local remote_port="$1" local_port="$2" label="$3"
  LAST_TUNNEL_LOG="/tmp/clawx-iap-${remote_port}-${local_port}-$$.log"
  : >"$LAST_TUNNEL_LOG"
  gcloud "--project=${PROJECT}" compute start-iap-tunnel "$VM" "$remote_port" \
    --local-host-port="localhost:${local_port}" --zone="$ZONE" >"$LAST_TUNNEL_LOG" 2>&1 &
  local pid=$!
  TUNNEL_PIDS+=("$pid")
  if ! wait_for_iap_listener "$pid" "$LAST_TUNNEL_LOG" "$local_port"; then
    return 1
  fi
  log "  tunnel ready for ${label} (guest :${remote_port} via localhost:${local_port}; log ${LAST_TUNNEL_LOG})"
  return 0
}

probe_ssh_banner() {
  local local_port="$1"
  python3 - "$local_port" ssh-banner <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.create_connection(('127.0.0.1', port), timeout=6) as sock:
    sock.settimeout(6)
    banner = sock.recv(128)
if not banner.startswith(b'SSH-'):
    raise SystemExit(f'expected SSH banner, got {banner!r}')
print(banner.decode('utf-8', 'replace').strip())
PY
}

probe_rdp_protocol() {
  local local_port="$1"
  python3 - "$local_port" rdp <<'PY'
import socket
import sys

port = int(sys.argv[1])
rdp_negotiation_request = bytes.fromhex('030000130ee000000000000100080003000000')
with socket.create_connection(('127.0.0.1', port), timeout=6) as sock:
    sock.settimeout(6)
    sock.sendall(rdp_negotiation_request)
    data = sock.recv(8)
if len(data) < 6 or not data.startswith(b'\x03\x00') or data[5] != 0xd0:
    raise SystemExit(f'expected RDP X.224 connection confirm, got {data!r}')
print(data.hex())
PY
}

is_iap_backend_connectivity_rejection() {
  local logf="$1"
  grep -Eiq '4003' "$logf" && grep -Eiq 'failed to connect to backend' "$logf" && grep -Eiq 'port[[:space:]]+9999|port[[:space:]]*:9999|:9999' "$logf"
}

probe_closed_control() {
  local remote_port="9999" local_port="$1" label="control"
  local logf="/tmp/clawx-iap-${remote_port}-${local_port}-$$.log"
  : >"$logf"
  gcloud "--project=${PROJECT}" compute start-iap-tunnel "$VM" "$remote_port" \
    --local-host-port="localhost:${local_port}" --zone="$ZONE" >"$logf" 2>&1 &
  local pid=$!
  TUNNEL_PIDS+=("$pid")
  local deadline=$((SECONDS + IAP_READY_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if is_local_port_occupied "$local_port"; then
      log "  FAIL  ${label} tunnel opened localhost:${local_port}; expected provider backend rejection for closed guest :9999"
      return 1
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null
      local tunnel_status=$?
      if [ "$tunnel_status" -ne 0 ] && is_iap_backend_connectivity_rejection "$logf"; then
        log "  OK    control guest :9999 rejected by IAP backend connectivity check (log ${logf})"
        return 0
      fi
      log "  FAIL  ${label} tunnel exited without the expected backend/port 9999 rejection — see ${logf}"
      sed 's/^/    /' "$logf" 2>/dev/null || true
      return 1
    fi
    sleep "$IAP_READY_POLL_SECONDS"
  done
  log "  FAIL  ${label} tunnel did not reject closed guest :9999 within ${IAP_READY_TIMEOUT_SECONDS}s — see ${logf}"
  sed 's/^/    /' "$logf" 2>/dev/null || true
  return 1
}

cmd_probe() {
  resolve_project || return 1

  log "VM state"
  local vm_line status
  vm_line="$(gcloud_project compute instances describe "$VM" --zone="$ZONE" \
    --format="value(status,networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP)" 2>&1)"
  local describe_status=$?
  printf '%s\n' "$vm_line" | sed 's/^/  /'
  if [ "$describe_status" -ne 0 ]; then
    log "FAIL  unable to describe VM ${VM}; probe cannot prove guest reachability"
    return 1
  fi

  status="$(printf '%s\n' "$vm_line" | awk 'NR == 1 { print $1 }')"
  if [ "$status" != "RUNNING" ]; then
    log "FAIL  VM is ${status:-unknown}; tunnel probes are not representative until the VM is RUNNING. Run: $0 start"
    return 1
  fi

  log "IAP firewall rules (expect 3389/22 plus closed control over ${IAP_RANGE})"
  gcloud_project compute firewall-rules list \
    --format="value(name,sourceRanges.list(),allowed[].ports.list())" 2>&1 \
    | grep -F "$IAP_RANGE" | sed 's/^/  /' || log "  WARN  no matching IAP firewall rules listed"

  require_local_port_free "$RDP_LOCAL_PORT" "$SSH_LOCAL_PORT" "$CONTROL_LOCAL_PORT" || return 1

  local failures=0
  log "Tunnel reachability (protocol checks plus closed guest control)"

  if start_iap_tunnel 3389 "$RDP_LOCAL_PORT" "RDP" && probe_rdp_protocol "$RDP_LOCAL_PORT" >/dev/null; then
    log "  PASS  RDP protocol response (guest :3389 via localhost:${RDP_LOCAL_PORT})"
  else
    log "  FAIL  RDP protocol response (guest :3389)"
    failures=$((failures + 1))
  fi

  if start_iap_tunnel 22 "$SSH_LOCAL_PORT" "sshd" && probe_ssh_banner "$SSH_LOCAL_PORT" >/dev/null; then
    log "  PASS  SSH banner verified (not authenticated) (guest :22 via localhost:${SSH_LOCAL_PORT})"
  else
    log "  FAIL  SSH banner verification (guest :22)"
    failures=$((failures + 1))
  fi

  if probe_closed_control "$CONTROL_LOCAL_PORT"; then
    :
  else
    log "  FAIL  control guest :9999 did not produce the expected IAP backend rejection; reachability results are not trustworthy"
    failures=$((failures + 1))
  fi

  if [ "$failures" -ne 0 ]; then
    log "FAIL  IAP lane probe failed closed (${failures} failed check(s))"
    return 1
  fi
  log "PASS  IAP lane probe proved RDP, SSH banner, and closed guest control"
}

cmd_start() {
  resolve_project || return 1
  log "Starting ${VM} (billable while RUNNING; ~\$0.13/hr for e2e-standard-4)"
  gcloud_project compute instances start "$VM" --zone="$ZONE" 2>&1 | tail -4

  # NOTE: do NOT strip the VM's external IP. There is no Cloud NAT in
  # us-central1 (the only router/NAT in this project is tt-eduplatform-nat in
  # us-east1). Removing the external IP leaves the guest with no egress, so it
  # cannot fetch Chrome, OpenSSH, or any installer dependency — which is exactly
  # what the installer bug under test needs to exercise. Verified 2026-08-19.
  log "External IP retained deliberately (no Cloud NAT in us-central1 = no egress without it)"
}

cmd_tunnel() {
  resolve_project || return 1
  require_local_port_free "$RDP_LOCAL_PORT" "$SSH_LOCAL_PORT" || return 1
  log "RDP  -> localhost:${RDP_LOCAL_PORT}"
  log "sshd -> localhost:${SSH_LOCAL_PORT}"
  log "Ctrl-C to close both."
  gcloud "--project=${PROJECT}" compute start-iap-tunnel "$VM" 3389 \
    --local-host-port="localhost:${RDP_LOCAL_PORT}" --zone="$ZONE" &
  TUNNEL_PIDS+=("$!")
  gcloud "--project=${PROJECT}" compute start-iap-tunnel "$VM" 22 \
    --local-host-port="localhost:${SSH_LOCAL_PORT}" --zone="$ZONE" &
  TUNNEL_PIDS+=("$!")
  wait
}

cmd_stop() {
  resolve_project || return 1
  log "Stopping ${VM} (disk retained, billing -> ~\$0)"
  gcloud_project compute instances stop "$VM" --zone="$ZONE" 2>&1 | tail -3
}

case "${1:-probe}" in
  probe)  cmd_probe  ;;
  start)  cmd_start  ;;
  tunnel) cmd_tunnel ;;
  stop)   cmd_stop   ;;
  *) echo "usage: $0 {probe|start|tunnel|stop}" >&2; exit 2 ;;
esac
