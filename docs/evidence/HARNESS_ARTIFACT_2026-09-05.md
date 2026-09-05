# Artifact harness matrix — slice 1 (CLWX-77)

Staged plugin + gateway bundle outside the repo tree; each row ran in a
child process resolving deps ONLY from the staged bundle (CLAWX_APP_RESOURCES seam).

| Row | Status | Note | ms |
|---|---|---|---|
| pdf-text.read_pdf | PASS |  | 1561 |
| pdf-scanned-notext.read_pdf | PASS |  | 134 |
| pdf-corrupt.read_pdf | REFUSED-READABLY | Invalid PDF structure. | 130 |
| docx.read_docx | PASS |  | 112 |
| doc-legacy.read_docx | REFUSED-READABLY | Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html | 55 |
| rtf.read_docx | REFUSED-READABLY | Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html | 56 |
| odt.read_docx | REFUSED-READABLY | Could not find main document part. Are you sure this is a valid .docx file? | 60 |
| docx-out.write_docx | PASS |  | 55 |
| xlsx.read_xlsx | PASS |  | 125 |
| csv.read_xlsx | PASS |  | 69 |
| xlsx-out.write_xlsx | PASS |  | 71 |
| png.read_image | PASS |  | 1074 |
| png-sharp-binding.read_image | PASS |  | 50 |
| pptx.read | NO-TOOL | no document.* entrypoint for this type (persona carve-out, CLWX-80) | 0 |

Summary: 14 rows: 9 PASS, 4 REFUSED-READABLY, 0 FAIL, 1 NO-TOOL
## Negative control (isolation falsifiability)

Hid `mammoth` in the STAGED bundle only (repo node_modules untouched), reran
`--only docx.read_docx` → **FAIL** ("mammoth module not found — the packaged
runtime is missing this dep"). Restored → PASS. This proves the child
resolves deps exclusively from the staged artifact: a workspace-run test
would have masked the gap — the exact moe.9/moe.15/CLWX-72 class.
(Reproduce with `--stage-dir <dir> --reuse-bundle` after mutating the stage;
without `--reuse-bundle` the bundle copy is refreshed every run.)

## Separate-lane adversarial review (2026-09-05)

Verdict: isolation claim **SOUND** — the reviewer independently re-proved it
two ways (empty staged bundle, and child cwd inside repo/scripts with a
repo-visible mammoth one level up: both stayed isolated) and verified zero
symlinks in the bundle + the electron-builder extraResources mapping matches
the staged layout. Three MAJORs found and **fixed same tick**:

1. Infra failures (timeout / spawn error / missing verdict / child crash)
   graded as REFUSED-READABLY on refusal rows — a hanging parser would have
   shown GREEN. Fix: `infra: true` tagging end-to-end; classifyRow forces
   FAIL; verdicts sentinel-framed (`CLAWX77_VERDICT:`) so chatty deps cannot
   corrupt the protocol. Guard rows pin all four infra shapes.
2. `--stage-dir` reuse silently tested a STALE bundle after a rebuild. Fix:
   bundle copy refreshed every run; `--reuse-bundle` is an explicit, loud
   opt-out for negative-control probes only.
3. `png.read_image` could never fail (sharp is a soft dep; raw bytes fall
   through). Fix: new `png-sharp-binding.read_image` row asserts
   width/height decode — non-null ONLY when the shipped sharp native binding
   actually loads (the moe.15 canvas class, image edition). PASSes live.

MINORs: readability heuristic now rejects `node_modules\` (backslash) leaks
too; scope caveat recorded — run on darwin this harness functionally proves
darwin bindings; Windows-native bindings remain presence-checked by
`verify-openclaw-bundle.mjs` until the harness runs on the Windows lane; and
moe.9's playwright-core lived on the Electron/asar side, which this slice
does not cover (the dependency-class-auditor does).

## Findings from run 1 (gaps per acceptance 4)

1. **CLWX-101 filed:** `readDocx` refusals for legacy `.doc` / `.rtf` surface
   jszip internals ("Can't find end of central directory … see
   https://stuk.github.io/jszip/…") — passes the v1 no-stack bar but is not
   principal-grade language for "this is not a Word .docx".
2. Scanned/image-only pdf returns ok with `totalChars=0` and no explicit
   "no extractable text" signal — persona-layer wording question, recorded.

## Slice-1 boundaries (resumable trail for CLWX-77)

Not yet covered: packaged-node / Electron utility-env spawn parity (CLWX-92
check covers the pdfjs class meanwhile), password-protected + >10MB pdf rows,
outlook/forms tool-registration smoke, gateway-process transport (CLWX-71 MCP
adapter candidate), package:mac/win preflight wiring (fast subset), K-ledger
rows (K8 3x-repeat rule, K10 drag-PDF variants, K14 fixture), Windows-lane
run for win-native binding proof.
