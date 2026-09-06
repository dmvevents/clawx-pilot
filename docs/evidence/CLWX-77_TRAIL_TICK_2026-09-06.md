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
  isolation/security — verdicts and dispositions in the ADDENDUM below
  (delivered after the tick's first sync; all surviving MAJORs fixed in the
  follow-up commit).
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

## ADDENDUM — Claude lens verdicts (delivered post-sync) + same-tick fixes

All three deep lenses returned after the tick's first sync (their long
runtime was the CLWX-58/70 agent-stall class; the bounded respawns were
stood down as superseded). Verdicts on `96da61f1`: **FAIL / FAIL / FAIL** —
every MAJOR either already closed by `30a3d46f` (independently confirmed
non-vacuous by the lenses) or fixed in the follow-up commit:

- **Falsifiability lens MAJOR (open after 30a3d46f) — the electronlike fake
  was unverified plumbing:** a neutered `applyEnvShape` produced
  byte-identical PASS verdicts while the report claimed UtilityProcess
  coverage; the fast lane's ONLY electron row would silently lose the
  CLWX-92 class. FIXED: the child echoes the OBSERVED
  `process.versions.electron` + `process.type` in every verdict;
  `checkEnvShapeApplied` FAILs any `@electronlike` row whose echo does not
  show the fake (re-probed live: neutered child → row FAILs naming the
  observed shape; intact child → PASS with `type:'utility'` echoed).
  Node-shape rows observing electron markers warn about parity degeneracy
  (the `--node-bin`-electron case).
- **Isolation lens MAJOR — HOME leaked the real `~/.openclaw/workspace`**
  into the plugin-load context on every release build (the gateway resolves
  its workspace from HOME, ignoring OPENCLAW_STATE_DIR; no write today —
  526-entry snapshot clean — but not structurally guaranteed). FIXED:
  `HOME` → stage-local fake home (+ `USERPROFILE`/`APPDATA`/`LOCALAPPDATA`
  on win32); lens pre-verified identical row verdicts with workspaceDir
  in-stage.
- **Isolation lens MAJOR — symlink-sensitive entry guard:** on a symlinked
  invocation path `main()` silently never ran (exit 0, no output) while
  `--fast` sat in the package chain as a release gate — and
  `validateFastSelection` lives inside `main()`, so the Codex fix couldn't
  fire either. FIXED: realpath comparison in `isDirectInvocation()`;
  proven live (symlinked invocation now runs the row).
- **Correctness lens MAJOR:** the config/discovery bleed — CLOSED by
  `30a3d46f` before the lens returned; the lens independently confirmed the
  fix is non-vacuous (rootDir realpathing verified via a symlinked config
  route) and corroborated the Codex probe.
- **Correctness lens MAJOR-unverified (Windows):** the allowlist was
  Unix-only (no SystemRoot/TEMP/ComSpec…), risking spurious `build:win`
  aborts. FIXED by construction (win32-conditional passthrough of system
  vars + profile dirs pinned to the fake home); the Windows-lane trail run
  re-proves it live.
- **Minors fixed same tick:** register-spec spread order (a future
  `register.envShape` can no longer clobber the dispatched shape);
  `--stage-dir <repo-root>` equality guard (was an rm -rf hazard on tracked
  `resources/`); report note cells flatten newlines + escape pipes + redact
  the home dir (`sanitizeNoteCell`); `foldRepeatVerdicts` dangling-dash
  note on mixed non-FAIL statuses; `networkAttempts >= 1` asserted on the
  full registration row (the stub is now provably in the path); net-stub
  preload writes a load-sentinel the transport row REQUIRES (an
  Electron `--node-bin` lane FAILs instead of running un-stubbed);
  `cp -Rc` clonefile falls back to a byte copy on non-APFS/cross-volume
  stage dirs; `CLAWX77_TRANSPORT_TIMEOUT_MS` knob for slow build hosts;
  report prose scoped honestly (socket claim tied to the sentinel + probe
  assertions).
- **Accepted residuals (documented, not fixed):** `--only` with a missing
  value runs all rows; `--fast --report` would write a subset report
  (unreachable from the package chain); transport rows ignore `repeat`;
  `parseInspectJson` fails closed on trailing output after the JSON block
  (fail-red, not false-green); staging is now 1.4GB/~28s per package run
  (clonefile-free on APFS; accepted for coverage, timeout knob added);
  `foldRepeatVerdicts` compares status not wording across refusal
  iterations; evidence reports include stage paths (home dir now
  redacted). Lens-verified-clean list (don't re-litigate): infra-always-
  FAILs, framed-success-discard, refusal bars, iteration isolation
  (`writeDocx` returns live byte counts), staged dep-root invariant,
  matrix arithmetic 45 = 21×2+3, `plugins inspect` genuinely loads through
  the plugin-host (inventory responds to env), no symlinks in staged
  trees, `package` && chain propagates failures, send/download gates and
  production code untouched (`git show --stat` empty for electron/,
  extensions/, resources/), no secrets in payloads (canary-probed).
