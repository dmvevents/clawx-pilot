#!/usr/bin/env bash
#
# Install the macOS LaunchAgent that waits for the Windows pilot laptop over SSH
# and runs the safe Electron-path demo harness once SSH is reachable.
#
# Re-running is idempotent: the existing LaunchAgent is replaced.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCHER="$REPO/windows-pilot/scripts/pilot-mac-wait-run-demo.sh"
LABEL="${PILOT_WATCHER_LABEL:-com.clawx.pilot.wait-run-demo}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_ROOT="${PILOT_LOG_ROOT:-$HOME/Library/Logs/clawx}"
ACTIVE_LOG="${PILOT_LOG_FILE:-$LOG_ROOT/pilot-mac-wait-run-demo-active.log}"
STDOUT_LOG="$LOG_ROOT/pilot-mac-wait-run-demo-launchd.out.log"
STDERR_LOG="$LOG_ROOT/pilot-mac-wait-run-demo-launchd.err.log"

SSH_HOSTS_VALUE="${SSH_HOSTS:-pilot VYONIX.local 169.254.46.90}"
SSH_USER_VALUE="${SSH_USER:-vyonix}"
EXPECTED_HOSTNAME_VALUE="${EXPECTED_HOSTNAME:-VYONIX}"
DISCOVER_CIDRS_VALUE="${DISCOVER_CIDRS:-169.254.46.0/24}"
DISCOVER_ARP_VALUE="${DISCOVER_ARP:-1}"
AUTO_DISCOVER_CIDRS_VALUE="${AUTO_DISCOVER_CIDRS:-1}"
AUTO_DISCOVER_MIN_PREFIX_VALUE="${AUTO_DISCOVER_MIN_PREFIX:-24}"
ARP_SCAN_LIMIT_VALUE="${ARP_SCAN_LIMIT:-256}"
DISCOVER_INTERVAL_SECONDS_VALUE="${DISCOVER_INTERVAL_SECONDS:-180}"
DEADLINE_SECONDS_VALUE="${DEADLINE_SECONDS:-28800}"
SLEEP_SECONDS_VALUE="${SLEEP_SECONDS:-45}"
REPO_WIN_VALUE="${REPO_WIN:-C:\\Users\\VYONIX\\Github\\ClawX-release-moe10}"
EVIDENCE_ROOT_WIN_VALUE="${EVIDENCE_ROOT_WIN:-C:\\Users\\VYONIX\\Downloads}"
TRUNCATE_LOG_ON_START_VALUE="${TRUNCATE_LOG_ON_START:-1}"

xml_escape() {
  printf '%s' "$1" |
    sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

require_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "ERROR: launchd watcher installation is macOS-only." >&2
    exit 1
  fi
}

require_macos

if [[ ! -x "$WATCHER" ]]; then
  echo "ERROR: watcher script is not executable: $WATCHER" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_ROOT"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$WATCHER")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$REPO")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>StandardOutPath</key><string>$(xml_escape "$STDOUT_LOG")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$STDERR_LOG")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>SSH_HOSTS</key><string>$(xml_escape "$SSH_HOSTS_VALUE")</string>
    <key>SSH_USER</key><string>$(xml_escape "$SSH_USER_VALUE")</string>
    <key>EXPECTED_HOSTNAME</key><string>$(xml_escape "$EXPECTED_HOSTNAME_VALUE")</string>
    <key>DISCOVER_CIDRS</key><string>$(xml_escape "$DISCOVER_CIDRS_VALUE")</string>
    <key>DISCOVER_ARP</key><string>$(xml_escape "$DISCOVER_ARP_VALUE")</string>
    <key>AUTO_DISCOVER_CIDRS</key><string>$(xml_escape "$AUTO_DISCOVER_CIDRS_VALUE")</string>
    <key>AUTO_DISCOVER_MIN_PREFIX</key><string>$(xml_escape "$AUTO_DISCOVER_MIN_PREFIX_VALUE")</string>
    <key>ARP_SCAN_LIMIT</key><string>$(xml_escape "$ARP_SCAN_LIMIT_VALUE")</string>
    <key>DISCOVER_INTERVAL_SECONDS</key><string>$(xml_escape "$DISCOVER_INTERVAL_SECONDS_VALUE")</string>
    <key>DEADLINE_SECONDS</key><string>$(xml_escape "$DEADLINE_SECONDS_VALUE")</string>
    <key>SLEEP_SECONDS</key><string>$(xml_escape "$SLEEP_SECONDS_VALUE")</string>
    <key>REPO_WIN</key><string>$(xml_escape "$REPO_WIN_VALUE")</string>
    <key>EVIDENCE_ROOT_WIN</key><string>$(xml_escape "$EVIDENCE_ROOT_WIN_VALUE")</string>
    <key>LOG_ROOT</key><string>$(xml_escape "$LOG_ROOT")</string>
    <key>LOG_FILE</key><string>$(xml_escape "$ACTIVE_LOG")</string>
    <key>TRUNCATE_LOG_ON_START</key><string>$(xml_escape "$TRUNCATE_LOG_ON_START_VALUE")</string>
  </dict>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "[pilot-watcher] installed launchd agent at $PLIST"
echo "[pilot-watcher] active log: $ACTIVE_LOG"
echo "[pilot-watcher] launchd stdout: $STDOUT_LOG"
echo "[pilot-watcher] launchd stderr: $STDERR_LOG"
echo "[pilot-watcher] disable: launchctl unload $PLIST"
