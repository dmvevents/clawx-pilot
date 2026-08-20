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
#   ./gcp-iap-lane.sh probe      # read-only: VM state, firewall, tunnel reachability
#   ./gcp-iap-lane.sh start      # start the VM (billable while RUNNING)
#   ./gcp-iap-lane.sh tunnel     # open RDP + SSH tunnels in the foreground
#   ./gcp-iap-lane.sh stop       # stop the VM (billing -> ~$0, disk retained)
#
set -uo pipefail

VM="${CLAWX_WINVM:-clawx-win-rc-20260609}"
ZONE="${CLAWX_WINVM_ZONE:-us-central1-a}"
RDP_LOCAL_PORT="${CLAWX_RDP_PORT:-13389}"
SSH_LOCAL_PORT="${CLAWX_SSH_PORT:-12222}"
IAP_RANGE="35.235.240.0/20"

log() { printf '%s %s\n' "[$(date -u +%H:%M:%SZ)]" "$*"; }

# --- Reachability check -------------------------------------------------------
# `nc -z` through an IAP tunnel is meaningful, but ONLY when validated against a
# control port. gcloud opens the local listener before it knows whether the backend
# port is live, so a bare success on one port proves little. Validated 2026-08-19:
# port 9999 (closed on the guest) was REFUSED while 22 and 3389 SUCCEEDED. Always
# run the control leg — a lane that reports PASS for everything is worthless.
probe_port() {
  local remote_port="$1" local_port="$2" label="$3"
  local logf="/tmp/clawx-iap-${remote_port}.log"

  gcloud compute start-iap-tunnel "$VM" "$remote_port" \
    --local-host-port="localhost:${local_port}" --zone="$ZONE" >"$logf" 2>&1 &
  local pid=$!
  sleep 20

  if nc -z -w 8 localhost "$local_port" 2>/dev/null; then
    log "  PASS  ${label} (guest :${remote_port} via localhost:${local_port})"
    kill "$pid" 2>/dev/null
    return 0
  fi
  log "  FAIL  ${label} (guest :${remote_port}) — see ${logf}"
  kill "$pid" 2>/dev/null
  return 1
}

cmd_probe() {
  log "VM state"
  gcloud compute instances describe "$VM" --zone="$ZONE" \
    --format="value(status,networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP)" \
    2>&1 | sed 's/^/  /'

  log "IAP firewall rules (expect 3389 + 5986 from ${IAP_RANGE})"
  gcloud compute firewall-rules list \
    --format="value(name,sourceRanges.list(),allowed[].ports.list())" 2>&1 \
    | grep -F "$IAP_RANGE" | sed 's/^/  /'

  local status
  status="$(gcloud compute instances describe "$VM" --zone="$ZONE" --format='value(status)' 2>/dev/null)"
  if [ "$status" != "RUNNING" ]; then
    log "VM is ${status:-unknown} — skipping tunnel probes. Run: $0 start"
    return 0
  fi

  log "Tunnel reachability (with control leg)"
  probe_port 3389 "$RDP_LOCAL_PORT" "RDP"
  probe_port 22   "$SSH_LOCAL_PORT" "sshd"
  # Control: MUST fail. If this passes, nc -z is a false positive and the
  # two results above cannot be trusted.
  if probe_port 9999 19999 "control (expected FAIL)"; then
    log "  WARN  control port PASSED — reachability results are NOT trustworthy"
  else
    log "  OK    control port refused — PASS results above are meaningful"
  fi
}

cmd_start() {
  log "Starting ${VM} (billable while RUNNING; ~\$0.13/hr for e2e-standard-4)"
  gcloud compute instances start "$VM" --zone="$ZONE" 2>&1 | tail -4

  # NOTE: do NOT strip the VM's external IP. There is no Cloud NAT in
  # us-central1 (the only router/NAT in this project is tt-eduplatform-nat in
  # us-east1). Removing the external IP leaves the guest with no egress, so it
  # cannot fetch Chrome, OpenSSH, or any installer dependency — which is exactly
  # what the installer bug under test needs to exercise. Verified 2026-08-19.
  log "External IP retained deliberately (no Cloud NAT in us-central1 = no egress without it)"
}

cmd_tunnel() {
  log "RDP  -> localhost:${RDP_LOCAL_PORT}"
  log "sshd -> localhost:${SSH_LOCAL_PORT}"
  log "Ctrl-C to close both."
  gcloud compute start-iap-tunnel "$VM" 3389 \
    --local-host-port="localhost:${RDP_LOCAL_PORT}" --zone="$ZONE" &
  gcloud compute start-iap-tunnel "$VM" 22 \
    --local-host-port="localhost:${SSH_LOCAL_PORT}" --zone="$ZONE" &
  wait
}

cmd_stop() {
  log "Stopping ${VM} (disk retained, billing -> ~\$0)"
  gcloud compute instances stop "$VM" --zone="$ZONE" 2>&1 | tail -3
}

case "${1:-probe}" in
  probe)  cmd_probe  ;;
  start)  cmd_start  ;;
  tunnel) cmd_tunnel ;;
  stop)   cmd_stop   ;;
  *) echo "usage: $0 {probe|start|tunnel|stop}" >&2; exit 2 ;;
esac
