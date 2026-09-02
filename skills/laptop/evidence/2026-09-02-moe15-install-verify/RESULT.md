# moe.15 GA candidate — install + smoke on the Windows VM

**Date:** 2026-09-02
**Host:** GCP Windows VM `clawx-win-rc-20260609` (us-central1-a), over IAP TCP
forwarding (sshd 22 → localhost:12222), guest `clawxtest`.
**Build:** `Ministry of Education-0.4.3-moe.15-win-x64.exe`
**SHA256 (verified on the VM after upload):** `d10de5809b6888a9dbd4a82fea41d8dc20d8bd81193b306c68a163dfc6ce18df`
**Size:** 390,104,940 bytes (matches the built artifact byte-for-byte).

## What ran

Silent install path (`/S`). The assisted GUI path was unavailable: `quser`
reported **no active console/interactive session** on the VM, so the Electron
GUI cannot render over headless SSH. Silent `/S` is the diagnostic install path;
the supported end-user path remains the assisted GUI install (owner-driven on a
real desktop).

## Results

| Check | Result |
|---|---|
| Installer completed (`INSTALLER_EXITED`) | **True** |
| Installed exe FileVersion | **`0.4.3-moe.15`** |
| Packaged node runtime | `v22.16.0` |
| Tree: `Ministry of Education.exe`, `resources\app.asar`, `resources\bin\node.exe` | present |
| Doc deps `docx` / `xlsx` / `mammoth` | present (`resources\openclaw\node_modules`) |
| `playwright-core` (moe.10 regression class) | present |
| **Gateway boot** (`pilot-run-installed-gateway-smoke.ps1`) | **`RESULT=COMPLETE`, `GATEWAY_READY=True`** on 18789, `GATEWAY_EXITED=False`, stdout 2344 B / stderr 177 B |
| **Office write** (`pilot-office-write-smoke.ps1`) | **`STATE: OFFICE_WRITE_OK`** — wrote valid .docx (8582 B) + .xlsx (16077 B) to `media\outbound` and read both back |

## Interpretation

- **Gap A (install + smoke moe.15) — DONE** on the GA build via the VM lane.
- **W6 / W7 (Word/Excel write) — GREEN on the GA build**, re-proven against
  moe.15 specifically (not just moe.14).
- Gateway/host-API boot path is healthy on the GA build; the playwright-core
  runtime-dependency regression class stays clean.

## Still open (GUI-session-dependent — owner's assisted-GUI validation)

- **b2** — live in-app write turn asserting `document.write_docx` / `write_xlsx`
  fired in the gateway log (needs the Electron app + a model turn, i.e. a
  desktop session).
- **managed-CDP visual smoke** (`pilot-managed-cdp-visual-smoke.ps1`).
- **Gap C** (ASR smoke), **Gap D** (cron live fire on Windows).

## Notes

- VM was **stopped** (`TERMINATED`) immediately after this run to end billing.
- `better-sqlite3` is not present under `resources` — expected; this app's store
  is electron-store JSON (see the openclaw.json BOM regression), not sqlite.
