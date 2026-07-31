# 2026-07-31 laptop config-write cascade incident

**Summary:** While attempting to add `hermes3:8b` as an on-device provider account (fix for BUG-007 per HOLISTIC-PLAN.md), a PowerShell write path introduced UTF-8 BOM into `~/.openclaw/openclaw.json` and `%APPDATA%\Ministry of Education\clawx-providers.json`. This triggered a cascade that left the app unable to boot Gateway cleanly.

**Sequence:**

| Step | Action | Result |
|---|---|---|
| 1 | step-22-add-hermes3.ps1: added hermes3 to both configs | ✅ patched — but with UTF-8 BOM prepended (`0xEF 0xBB 0xBF`) |
| 2 | Restart app | ❌ `electron-store` JSON.parse rejected the BOM: `Unexpected token '﻿', "﻿{ "s"... is not valid JSON` |
| 3 | step-24-fix-bom.ps1: rewrote both configs via `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` | ✅ BOM removed, files parse clean |
| 4 | Restart app | ⚠️ Boots — Host API 7.4s, Gateway 30s green initially |
| 5 | App crashes within ~2 min | ❌ Log shows: `EPERM: operation not permitted, rename 'openclaw.json.tmp.11168.*' -> 'openclaw.json'` (atlas §11) |
| 6 | step-27-restore-good.ps1: restored from oldest `.bak.*` (app-native atlas §12 backup from 2026-05-22) | ⚠️ Restored but wrong backup |
| 7 | step-28-restore-session-backup.ps1: restored from MY step-22 dated backups | ✅ Files parse, both stores internally consistent |
| 8 | Restart app | ⚠️ Boots green momentarily, then Gateway dies |
| 9 | Wait 90s | ❌ Zero procs — app not running |

**Root causes identified:**

1. **BOM-write regression (Windows-specific atlas-worthy):** PowerShell 5.1's `Set-Content -Encoding UTF8` emits BOM. Any Node.js-based JSON.parse (`electron-store` uses `conf`) will reject BOM at position 0. Fix: use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)`.

2. **Atlas §11 EPERM cascade:** app tries to rename tmp→dest, Windows filesystem cache still holds a reference to the destination (possibly from Windows Defender or my earlier writes), rename returns EPERM. The `state-idempotency-auditor` sub-agent was designed to prevent this class of bug. On the running system, the cascade continues until Gateway just gives up.

**Current laptop state (as of 2026-07-31 15:37 EDT):**
- Config files are internally valid, no BOM
- Gateway will not stay bound
- Host API sporadically comes up
- Ollama is still running (separate task)
- The moe.10 pre-Lane-A install from 2026-06-07 has ALSO been overwritten (Lane A install happened earlier in the session)

**Recommended recovery path for the next session:**

1. **Do NOT panic-restart repeatedly.** Wait 5 minutes for any filesystem locks to release.
2. Move `~/.openclaw` and `%APPDATA%\Ministry of Education` aside (rename to `.disabled-$TIMESTAMP`).
3. Relaunch the app — it will treat this as a fresh install and use `gateway-plugin-config-seed.ts` to write clean defaults.
4. If Gateway comes up: verify it's on cloud path with `moe-demo-pro`, then re-attempt the hermes3 addition using the corrected `[System.IO.File]::WriteAllText` write path (step-24 script pattern, NOT step-22).
5. If Gateway still doesn't come up: uninstall + reinstall the app via NSIS `/S`.

**Lessons captured (should be added to atlas as §16b):**

Any script that writes to `~/.openclaw/openclaw.json` or `%APPDATA%\Ministry of Education\clawx-providers.json` must:
- Use `[System.IO.File]::WriteAllText` with `New-Object System.Text.UTF8Encoding($false)` (NOT `Set-Content -Encoding UTF8`)
- Verify the first 3 bytes are NOT `239,187,191` after write
- Write to temp file + atomic rename (`Move-Item -Force`)
- Take backup FIRST via raw byte copy (`[System.IO.File]::ReadAllBytes` + `WriteAllBytes`)
- Never run more than one such patch per app-uptime window (let the app fully sync between patches)

**What was NOT reverted (still an open issue):**

The Lane A install itself is still on the laptop (`resources/app.asar` LastWriteTime 2026-07-31 14:35). This is fine — the install is not the problem; the persistent-state files are. Once user-state recovers, the Lane A install remains valid.

**Autopilot exit:** stopping this cycle to prevent further damage. Config-write pattern documented for the next attempt.
