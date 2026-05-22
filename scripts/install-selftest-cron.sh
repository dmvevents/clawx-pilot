#!/usr/bin/env bash
#
# Install ClawX self-test as a recurring background job.
#
#   macOS:    via launchd (~/Library/LaunchAgents/com.moe.clawx.selftest.plist)
#   Linux:    via crontab
#   Windows:  print Task Scheduler instructions (this script does not run on Win)
#
# Runs every 30 minutes by default. Override frequency with $CLAWX_SELFTEST_MIN.
# Logs go to ~/.openclaw/selftest/launchd.log + ~/.openclaw/selftest/history.csv.
#
# Re-running this script is idempotent: it overwrites the existing job.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SELFTEST="$REPO/scripts/clawx-selftest.mjs"
NODE_BIN="${CLAWX_NODE_BIN:-$(command -v node)}"
SELFTEST_HOME="$HOME/.openclaw/selftest"
LOG="$SELFTEST_HOME/launchd.log"
INTERVAL_MIN="${CLAWX_SELFTEST_MIN:-30}"

mkdir -p "$SELFTEST_HOME"

if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH. Install Node 20+ or set CLAWX_NODE_BIN." >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/com.moe.clawx.selftest.plist"
    SECONDS=$((INTERVAL_MIN * 60))
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>           <string>com.moe.clawx.selftest</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SELFTEST</string>
  </array>
  <key>StartInterval</key>   <integer>$SECONDS</integer>
  <key>RunAtLoad</key>       <true/>
  <key>StandardOutPath</key> <string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "[selftest] installed launchd agent at $PLIST"
    echo "[selftest] runs every $INTERVAL_MIN min; logs at $LOG"
    echo "[selftest] view history: cat $SELFTEST_HOME/history.csv"
    echo "[selftest] disable: launchctl unload $PLIST"
    ;;
  Linux)
    LINE="*/$INTERVAL_MIN * * * * $NODE_BIN $SELFTEST >> $LOG 2>&1"
    (crontab -l 2>/dev/null | grep -v 'clawx-selftest' || true; echo "# clawx-selftest"; echo "$LINE") | crontab -
    echo "[selftest] installed crontab entry: $LINE"
    echo "[selftest] disable: crontab -e and remove the clawx-selftest lines"
    ;;
  *)
    cat <<WIN
[selftest] Windows install (run in PowerShell as admin):
   schtasks /Create /SC MINUTE /MO $INTERVAL_MIN /TN "ClawX Self-Test" \\
     /TR "\\"$NODE_BIN\\" \\"$SELFTEST\\"" /F /RL LIMITED
   schtasks /Run /TN "ClawX Self-Test"
WIN
    ;;
esac
