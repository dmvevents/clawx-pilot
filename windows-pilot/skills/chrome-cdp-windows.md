---
name: chrome-cdp-windows
description: Attach the principal's existing Chrome session to CDP on port 18792 so Playwright (Outlook + Forms drivers) can drive it. Idempotent — safe to call when Chrome is already CDP-enabled.
metadata:
  os: windows
  port: 18792
  hard-rule: never managed Chromium; always profile=user
---

# Chrome CDP attach — Windows pilot

## When to use this skill

Call when **any** of these are true:
- `outlook-browser-v2` reports `connectOverCDP` failure
- `curl http://127.0.0.1:18792/json` returns nothing or refuses connection
- The agent needs to read Outlook / fill Forms but no `--remote-debugging-port=18792` is on any Chrome cmdline
- A fresh Chrome was opened by the principal without the flag

## Why this is the load-bearing step on Windows

The whole automation stack — Outlook v2, Forms v2, the openclaw `browser` plugin — attaches to Chrome via CDP. **No CDP, no automation.** This is the #1 thing to verify before touching anything Outlook- or Forms-related.

The pilot's current Chrome procs can include a gateway-launched browser-app shell with a redacted `#token=<redacted>` fragment. That shell is NOT the principal's signed-in browser. The signed-in browser must have `--remote-debugging-port=18792`.

## Hard rules

- **NEVER** start Chrome from the bundled Chromium (`playwright install` path). Microsoft Conditional Access blocks managed Chromium with `AADSTS53003`.
- Always use the principal's Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) with the principal's profile (`%LOCALAPPDATA%\Google\Chrome\User Data`).
- The principal must already be signed into Outlook in that profile. We do not initiate sign-in via automation against `*@moe.gov.tt` accounts. For `test.fac@fac.edu.tt`, automation may use `PILOT_TEST_PASSWORD` when that variable is set locally by the operator.

## Decision tree

```
1. Probe: curl http://127.0.0.1:18792/json/version
   ├─ HTTP 200 → CDP up → DONE (skip steps 2-4)
   └─ Connection refused → continue

2. Survey existing Chrome procs:
   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select CommandLine
   ├─ Any proc has --remote-debugging-port=18792 in its cmdline →
   │    Chrome was started with the flag, but the port is not bound.
   │    → Cause: another Chrome instance grabbed the user-data-dir lock first.
   │    → Fix: kill that crashpad-handler, retry start.
   └─ No proc has the flag → continue (need to relaunch Chrome with the flag)

3. Decide: launch new instance or restart existing?
   ├─ Principal has work in flight (open tabs, unsaved drafts) →
   │    Use --remote-debugging-pipe alternative (no, doesn't work for our use case).
   │    → Best-effort: launch a NEW Chrome instance pointing at the SAME
   │      user-data-dir. Chromium will refuse if the dir is locked.
   │    → If refused: ask principal to close Chrome OR open a separate
   │      profile-based Chrome (--profile-directory="Profile 1").
   └─ Principal is OK closing Chrome → kill all Chrome procs cleanly, relaunch with the flag.

4. Launch:
   "C:\Program Files\Google\Chrome\Application\chrome.exe" `
       --remote-debugging-port=18792 `
       --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\User Data" `
       --no-first-run `
       --no-default-browser-check
```

## Idempotency contract

`pilot-attach-chrome-cdp.ps1` MUST satisfy:
- Running it once when CDP is already up → no-op, exits 0, prints `CDP_ALREADY_UP`.
- Running it once when CDP is down + Chrome is closed → starts Chrome with the flag, waits for port 18792 to bind, exits 0.
- Running it when CDP is down + Chrome is open with the user's profile → tries to launch a second instance pointed at the SAME profile dir. If Chromium refuses with "profile locked", the script exits with `EXIT_PROFILE_LOCKED` and prompts the human to close Chrome.
- Running it twice in a row → exits 0 both times (the second run is the no-op path).

Never `Stop-Process -Force` Chrome without an explicit `--allow-kill` arg the human passes in; principals lose work that way.

## Verification (after attach succeeds)

```powershell
$json = (Invoke-WebRequest -Uri "http://127.0.0.1:18792/json" -UseBasicParsing).Content | ConvertFrom-Json
$pages = $json | Where-Object { $_.type -eq "page" }
"Page count: $($pages.Count)"
$pages | Select-Object url, title | Format-Table -Wrap

# Look for an outlook tab:
$outlook = $pages | Where-Object { $_.url -match "outlook\.(office|cloud\.microsoft|office365|live)\.com" }
if ($outlook) { "OUTLOOK TAB: $($outlook[0].url)" } else { "NO OUTLOOK TAB - principal must sign in" }
```

## Fallbacks

| Failure | Fallback |
|---|---|
| CDP up but no Outlook tab | Open https://outlook.office.com manually in the same Chrome; sign in as `test.fac@fac.edu.tt`. |
| Chrome refuses second instance ("Browser already running") | Close all Chrome windows; relaunch with the flag. Backup the profile dir first if work is in flight. |
| `AADSTS53003` after sign-in | We're on the wrong profile (managed). Switch to the personal `test.fac` profile or open a fresh user-data-dir for the demo only. |
| Port 18792 stays unbound 10s after launch | Check `netstat -ano | findstr 18792`; might be a stale Chrome holding the user-data lock. |

## Cross-references

- Execution: `windows-pilot/scripts/pilot-attach-chrome-cdp.ps1`
- Live verification: `windows-pilot/scripts/pilot-verify-outlook-tab.ps1`
- Source of the `--remote-debugging-port` requirement: `electron/services/outlook-browser-v2/playwright-driver.ts:14-23` (CDP attach explanation)
- Demo prerequisite: `docs/DEMO_RUNBOOK_2026-05-26.md` line 25
