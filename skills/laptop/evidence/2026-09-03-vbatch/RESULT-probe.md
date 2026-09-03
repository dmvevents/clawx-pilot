# STAGE 1 — tunnel + moe.15 install-tree verification (vbatch)

**Date:** 2026-09-02 (UTC session for the 2026-09-03 vbatch)
**Host:** GCP VM `clawx-win-rc-20260609` (us-central1-a, project `gen-lang-client-0649986230`), guest user `clawxtest`, over IAP TCP forwarding (sshd 22 -> localhost:12222).
**Raw logs in this dir:** `vbatch-probe-out.log` (full install-tree probe incl. 446-entry node_modules listing), `vbatch-repro-out.log` (live require repro), `vbatch-canvas-out.log` (@napi-rs/canvas state).

## 1. Tunnel

| Leg | Result |
|---|---|
| VM state | RUNNING, internal 10.128.0.17, external 35.188.6.218 |
| IAP tunnel 22 -> localhost:12222 (nohup, background) | **PASS** (`nc -z` succeeded) |
| Control leg: guest :9999 (closed) -> localhost:19999 | **REFUSED as expected** — the 12222 PASS is meaningful |
| ssh `clawxtest@localhost -p 12222` | **PASS** (default shell is PowerShell; `&` is a parse error there — scripts scp'd and run with `-ExecutionPolicy Bypass -File` per atlas rule) |

Tunnel left OPEN for subsequent stages (local pid noted in session; log `/tmp/vbatch-iap22.log`). VM left RUNNING deliberately — later vbatch stages need it. Stop it when the batch ends.

## 2. Install tree (moe.15)

- **Install scope: per-user.** Root = `C:\Users\clawxtest\AppData\Local\Programs\Ministry of Education`. Uninstall key in **HKCU** (`Ministry of Education | 0.4.3-moe.15`). No `C:\Program Files` install. Same layout class as the live tester's install.
- **Exe FileVersion: `0.4.3-moe.15`** (ProductVersion 0.4.3.0). Packaged node `v22.16.0`. `app.asar` 242,388,374 B present; `resources\bin\node.exe` present.

### Dep presence map — `resources\openclaw\node_modules` (gateway bundle, 446 top-level entries)

| Dep | Present | Version |
|---|---|---|
| **pdf-parse** | **YES** (dir + package.json) | **2.4.5** |
| mammoth | YES | 1.12.0 |
| docx | YES | 9.7.1 |
| xlsx | YES | 0.18.5 |
| playwright-core | YES | 1.59.1 |

Other pdf-parse locations:

| Location | Result |
|---|---|
| `resources\app.asar.unpacked\node_modules\pdf-parse` | MISSING (parent dir exists) |
| `resources\node_modules` | dir does not exist |
| Deep search under `resources\` | hits only in `openclaw\node_modules` and `openclaw-plugins\dingtalk\node_modules` |

## 3. pdf-parse verdict — package PRESENT, module NON-LOADABLE; "not found" message is a masking bug

The conductor's hypothesis ("bundler drops pdf-parse silently") is **NOT confirmed on this install**: pdf-parse 2.4.5 is on disk in the gateway bundle. The tester's error reproduces anyway, and the live repro pins the real chain:

Repro (packaged `node.exe`, `createRequire` from the installed extension file `resources\extensions\moe-principal-assistant\doc-tools.mjs`, mirroring `loadDep()` exactly — see `vbatch-repro-out.log`):

```
bare:      FAIL code=MODULE_NOT_FOUND msg=Cannot find module 'pdf-parse'
  Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find native binding..."
  Warning: Cannot polyfill `DOMMatrix`, rendering may be broken.
augmented: FAIL code=undefined msg=DOMMatrix is not defined
```

Chain:

1. Bare require from the extension dir fails MODULE_NOT_FOUND (no node_modules chain there) — expected; `augmentModulePathsForPackagedApp()` then adds the gateway bundle to NODE_PATH and the module directory IS found.
2. But module evaluation **throws `DOMMatrix is not defined`**: pdf-parse 2.4.5 pulls pdfjs-dist 5.7.284, which needs `@napi-rs/canvas` for the Node DOMMatrix polyfill. The `@napi-rs/canvas` **JS wrapper is bundled (0.1.100) but its platform native binding `@napi-rs/canvas-win32-x64-msvc` (an optionalDependency) is NOT** — zero `.node` files anywhere under the canvas dir (`vbatch-canvas-out.log`). The bundler drops platform-specific optional native deps.
3. `loadDep()` in `extensions/moe-principal-assistant/doc-tools.mjs` (lines 118–129) catches ALL throws and returns null, so `read_pdf` reports the doc-tools.mjs:393 string "pdf-parse module not found — the packaged Windows runtime is missing this dep" — **misleading**: the dep is present; its transitive native binding is what's missing, and the error class is load-failure, not resolution-failure.

So the packaging defect is real but is `@napi-rs/canvas-win32-x64-msvc` missing from the bundle (plus the loadDep catch-all masking load errors as not-found). Installed doc-tools.mjs has the augment code (`hasAugment=True`, 23,806 B), so it is not stale-code drift.

## 4. App + gateway state

| Check | Result |
|---|---|
| GUI session (`quser`) | **`clawxtest console 1 Active`** — real console session (autologon recipe from `2026-09-03-win-recorded-usecase` is in effect). GUI legs are NOT blocked. |
| App processes | 5x `Ministry of Education` running (pids 5228/6492/6524/7648/7708) — launched visible in the console session; nothing launched by this stage |
| Gateway :18789 | **LISTENING (live now)** |
| Host-API :13210 | **LISTENING (live now)** |
| Gateway bootable | YES — proven live this session (ports up from the running app) and previously by `pilot-run-installed-gateway-smoke.ps1` `GATEWAY_READY=True` on this same moe.15 install (`2026-09-02-moe15-install-verify/RESULT.md`) |

## Not done / notes

- No sends, no submits, no launches, no `~/.openclaw` mutation. All guest actions read-only (3 scp'd probe scripts left under `C:\Users\clawxtest\`).
- Installer sha for this install: `d10de5809b6888a9dbd4a82fea41d8dc20d8bd81193b306c68a163dfc6ce18df` (per 2026-09-02 install evidence; not re-hashed — install tree untouched since).
- Whether the live tester's installer is byte-identical to this one is unverified, but the failure reproduces on THIS build, so build divergence is not needed to explain his report.
- Fix direction (for the conductor, not applied): bundle `@napi-rs/canvas-win32-x64-msvc` (and darwin equivalents) with the gateway node_modules, and make `loadDep()` distinguish `MODULE_NOT_FOUND` from load-time throws so the surfaced error is truthful.
