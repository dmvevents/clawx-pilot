# CLWX-77 trail tick — 2026-09-06 (spawn parity + gateway transport + fast lane + K-ledger rows)

Commits: `96da61f1` (four trail legs) + review-hardening commit (see git log).
Full matrix: **45 rows — 30 PASS / 14 REFUSED-READABLY / 0 FAIL / 1 NO-TOOL**
(`docs/evidence/HARNESS_ARTIFACT_2026-09-06.md`, regenerated; matrix 22 → 45).

## What landed

1. **Electron-env spawn parity** — every doc/register row now also runs as an
   `@electronlike` twin: the child fakes `process.versions.electron` +
   `process.type='utility'` BEFORE importing the system under test — the
   packaged gateway's real env shape (`utilityProcess.fork`,
   `electron/gateway/process-launcher.ts:160`) and the exact CLWX-92/moe.16
   failure shape, generalized from the single-fixture
   `clwx92-workerenv-check.mjs` to the whole matrix. `--node-bin` override
   wired for true packaged-node runs (Windows lane). Transport rows are
   deliberately NOT shape-faked: real gateway dist + faked electron shape
   without real electron modules would grade an untruthful combination; the
   genuine utility-env gateway run is the Windows/VM lane.
2. **Gateway-process transport** — the stage now carries the FULL
   `build/openclaw` (openclaw.mjs + dist + node_modules; same
   `resources/openclaw` layout as the shipped app, node_modules seam
   unchanged). Two rows boot the STAGED gateway CLI
   (`plugins inspect moe-principal-assistant --json`) with a hermetic
   `OPENCLAW_STATE_DIR` whose config points `plugins.load.paths` at the
   staged plugin — the plugin loads through the REAL gateway plugin-host
   (register() actually runs in the gateway's loader, not the harness mock)
   and the reported `toolNames` must match the contract inventory exactly:
   13 (doc+principal) without host-API env, 31 with. fetch is stubbed via a
   `NODE_OPTIONS --require` preload (records + rejects; no socket), so the
   CLWX-86 capability probe deterministically fails open.
3. **Package preflight wiring (fast subset)** — `--fast` runs the pinned
   `FAST_ROW_IDS` (8 rows, one per regression family incl. the electronlike
   pdf row [CLWX-92 class], the sharp-binding row [moe.15 canvas class], the
   full registration inventory, and a transport row), wired into the
   `package` script immediately after `verify-openclaw-bundle` — so
   `package:mac` / `package:win` / `build:win` / `package:linux` / `release`
   all inherit it and cannot ship a bundle that fails the fast lane.
   Measured: 8/8 PASS in ~43s incl. staging.
4. **K-ledger rows** — K8 ("SOMETIMES reads well, other times errors"):
   the five doc read/write rows (`readPdf`/`readDocx`/`writeDocx`/
   `readXlsx`/`writeXlsx`) run **3× per env shape in FRESH children**; any
   iteration disagreement FAILs the row as `INTERMITTENT (K8 class)` — it
   can never average out to a pass (`foldRepeatVerdicts`, unit-pinned).
   K10 tags mark the pdf variants (scanned/password/large) where they live.
   Honest mapping in the report: K1/K2/K11/K12/K13 live in the Outlook/VM
   lanes, K4 in the ASR lane (CLWX-87), K9/K14 are in-app fixtures — this
   harness does not grade those.

## Falsifiability (all proven live, repo untouched)

- **Env-shape plumbing:** child probe module returned
  `{electron:null,type:null}` plain vs `{electron:'35.0.0',type:'utility'}`
  under `envShape:'electronlike'`.
- **CLWX-92 class discrimination:** `PDFParse.setWorker(...)` neutered in a
  STAGED doc-tools copy → plain-node read still `ok:true`, electronlike read
  `ok:false` → the `@electronlike` expected-ok row grades FAIL (the moe.16
  signature reproduced and graded). Residual noted below.
- **Transport mutation:** `outlook.forward` renamed in the STAGED plugin →
  transport check fails: `missing: outlook.forward; unexpected:
  outlook.forward_MUTATED`.
- **NODE_OPTIONS quoting:** double-quoted spaced path preloads fine;
  unquoted crashes the child LOUDLY (exit ≠ 0 → infra FAIL) — no silent
  stub-absence path.

## Separate-lane review (§3b: Claude lenses + Codex + graph + graphify)

- **Codex (gpt-6-astra) adversarial review** — verdict `needs-attention`,
  3 findings, all CONFIRMED and FIXED same tick
  (`docs/evidence/CODEX_ADVERSARIAL_REVIEW_2026-09-06_CLWX-77-trail.md`):
  1. **HIGH — config/discovery bleed:** inherited `OPENCLAW_CONFIG_PATH`
     overrides `OPENCLAW_STATE_DIR` in the bundled gateway; with the old
     `...process.env` spread a transport row could grade the DEVELOPER's
     unstaged plugin (Codex probed both the precedence and the acceptance).
     FIX: transport env is now an explicit ALLOWLIST (PATH/HOME/TMPDIR/LANG
     + the pinned OPENCLAW_/CLAWX_ vars only) AND a stage-integrity gate
     (`checkTransportSource`, realpath-resolved) fails the row if
     `plugin.rootDir` is not the staged copy.
  2. **MED — fast-subset shrink:** the empty-only selection check let a
     renamed row shrink the gate to 6/8 with exit 0. FIX:
     `validateFastSelection` requires every pinned id to resolve exactly
     once BEFORE any child spawns (missing/duplicated ids named); unit
     guard replays Codex's exact rename probe.
  3. **MED — respawn survives SIGKILL:** the gateway CLI wrapper respawns
     itself; timeout SIGKILL reaped only the wrapper. FIX:
     `OPENCLAW_NO_RESPAWN='1'` in the transport env (mirrors the production
     launcher), so the kill target is the real process.
- **Claude lenses (3, separate contexts):** correctness, falsifiability,
  isolation/security — verdicts and dispositions recorded below in the
  addendum after their runs completed.
- **code-review-graph blast radius:** risk 0.50, **0 affected flows**,
  5 files/34 functions, 7 test gaps — all on the harness-runner functions
  themselves (covered by the live harness runs by design; pure grading
  logic is unit-covered). Test-infra only; no production flow touched.
- **graphify (scripts/ scope, AST):** 898 nodes / 1168 edges /
  116 communities; the harness's 48 nodes (incl. the new
  `checkTransportSource`, `expandMatrix`, `foldRepeatVerdicts`,
  `parseInspectJson`) are self-contained — no surprising cross-file
  connections, no import cycles. Corroborates the blast-radius verdict.

## Gates at tick close

- Unit guards (harness file): 57/57 (55 pre-hardening + 2 Codex-replay).
- Full suite: 1565 passed / 6 skipped (179 files).
- typecheck + eslint: clean (exit 0).
- Live re-verify after fixes: `gateway-transport.full` PASS,
  `--fast` 8/8 PASS.

## Residuals (recorded, not blocking)

- With the CLWX-92 fix broken, readPdf's catch-all maps the worker error to
  the "damaged file" wording — a misdiagnosis for the principal, but only
  reachable on a build the fast gate now fails pre-ship. Candidate wording
  tier if it ever matters.
- `JSON.stringify` in NODE_OPTIONS escapes backslashes — Windows-path
  nuance to re-verify on the Windows-lane run (trail item).
- Transport rows exercise the gateway loader + inventory, not doc-dep
  resolution at call time (doc deps load lazily; the doc rows cover that).
- Remaining CLWX-77 trail: Windows-lane run (true packaged node.exe + real
  utility-env gateway), in-app K10 drag-gesture cell.
