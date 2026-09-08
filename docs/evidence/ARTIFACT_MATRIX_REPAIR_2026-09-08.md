# Artifact-harness matrix repair — jpg, typed XLSX, write-then-reopen (CLWX-77)

Source revision at authoring: `7e1f9417ae3f57096a7799d9a433ea9745604e5f` (branch
`lane/artifact-matrix-repair-20260908`, clean tree before this change).
Scope: `scripts/harness-artifact.mjs` + `tests/unit/harness-artifact.test.ts` only.
Closes audit gaps **G1 / G2 / G4** from the 2026-09-08 read-only
artifact-acceptance audit (advisory, candidate `488ebe29`). Nothing here is
installed-artifact, tenant or release acceptance.

## What changed

| Gap | New matrix row(s) | Bar it enforces |
|---|---|---|
| G1 (no jpg coverage despite "png/jpg" card scope) | `jpg.read_image`, `jpg-sharp-binding.read_image` | `image/jpeg` mime mapping on the content block AND `details`; metadata-only details (no `base64,` leak); sharp must decode `format=jpeg` 1×1 — a bundle whose sharp png path works but jpeg codec is broken now FAILs instead of staying green |
| G2 (xlsx asserted string membership only) | `xlsx-typed.read_xlsx` | numeric cell `87`; numeric-**looking string** `"087"` keeps its leading zero (any number coercion collapses it to `87`); formula cell `B2*2` surfaces its **cached** value `174` (readers never recalculate; a dropped cache reads empty) |
| G4 (write rows checked `bytes > 0 && existsSync`) | `docx-out-reopen.write_docx`, `xlsx-out-reopen.write_xlsx` (new `mode: 'write-reopen'`) | write in one fresh child, reopen the **same** file through the staged reader in a second fresh child; docx must return title + paragraph; xlsx must round-trip sheet name, numeric `412` and the numeric-looking string `"0412"` (writer-side typing) |

Supporting pure helpers (exported, unit-tested): `buildXlsxTypedFixture`,
`foldWriteReopen`, `unescapeMarkdown`.

Fixtures are self-contained: the 1×1 JPEG is embedded hex (no seeding
dependency on a native binding), the typed workbook is hand-rolled through the
existing `buildStoredZip` with inline strings, so it cannot inherit
workspace-`xlsx` writer behavior.

## Defects found and corrected while wiring this

1. **Stale registration contract (would have failed the package fast gate).**
   `OUTLOOK_TOOL_NAMES` was missing `outlook.readiness`, registered in
   `6ec32807` inside the same host-API + `skillAllowlist` gate as the rest of
   the family. The unit drift guard caught it (`unexpected: outlook.readiness`).
   Contract updated to 34 tools (outlook 12 + forms 5 + browser 2 + principal 8
   + document 7); comments and count assertions updated with it. Without this,
   `plugin-registration.full` / `gateway-transport.full` — both fast-lane rows
   in the `package` script — would FAIL on the next packaging attempt.
   Confidence: high (source read at `extensions/moe-principal-assistant/index.mjs:1561`
   plus the source-literal drift guard).
2. **Order-dependent killswitch guard.** The guard leaked only
   `OUTLOOK_TOOL_NAMES[0]`, so it broke when the list order changed. It now
   asserts every member of the suppressed family is named if it leaks.
3. **Markdown escaping would have made the docx reopen row falsely red.** The
   shipped mammoth markdown writer escapes punctuation (`tabled\.` — verified
   directly against the shipped `docx`+`mammoth` pair at this revision), so a
   literal sentence check grades escaping style rather than content survival.
   `unescapeMarkdown` normalizes escapes; the escaped form is pinned as a
   must-PASS case, and absent text still fails.

## Evidence

| Check | Command | Result |
|---|---|---|
| Focused unit lane (new guards written failing first: 12 failed / 70 passed before implementation) | `pnpm exec vitest run tests/unit/harness-artifact.test.ts` | **PASS** — 83 tests, 1 file (2026-09-08) |
| Adjacent suite importing `buildStoredZip` | `pnpm exec vitest run tests/unit/moe-principal-assistant-doc-tools.test.ts` | **PASS** — 39 tests |
| Repo typecheck | `pnpm typecheck` | **PASS** (clean) |
| Lint of the diff | `pnpm exec eslint scripts/harness-artifact.mjs tests/unit/harness-artifact.test.ts` | **PASS** (no findings) |
| Syntax / module load | `node --check scripts/harness-artifact.mjs`; import + count | **PASS** — 30 authored rows, 57 expanded |
| Fixture integrity (jpeg decodes 1×1 `format=jpeg`; workbook cells `B2 t=n v=87`, `C2 t=s v="087"`, `D2 f="B2*2" v=174`) | in-suite guards using workspace `sharp` / `xlsx` | **PASS** |
| Write-reopen expectations achievable against the shipped libraries (`xlsx` round-trip returns `[["metric","value"],["present","412"],["code","0412"]]`; docx→markdown returns `# Minutes\n\n…tabled\.`) | throwaway `node` probes at this revision | **PASS** (library-level only) |
| **Artifact execution of the new rows** | `pnpm harness:artifact --only jpg.read_image` etc. | **NOT_RUN** |

## Limitations (do not overstate)

- `build/openclaw` is **absent in this worktree** and bundle hydration /
  package builds are out of lane, so **no new row has executed against the
  staged 2026.9.2 runtime**. Row logic, fixtures and fold semantics are proven
  in the unit lane; the staged-runtime verdicts are `NOT_RUN`. The integration
  lane must run the full matrix after `bundle-openclaw.mjs` on the upgraded pin
  (audit gap G9 remains open, and it now covers these rows too).
- Fixture-integrity guards use the **workspace** `sharp`/`xlsx` (fixture
  generation, per the harness header). That proves the fixtures encode what
  they claim; it does **not** prove the packaged bundle's copies behave
  identically — that is exactly what the staged rows exist to test.
- Row scope is deliberately narrow: no new runtime features, no changes to
  `ga-gate`, `package.json`, the fast subset, the installed evidence producer,
  or any product source. The new rows are full-run rows only.
- **G3 unchanged and NOT accepted:** `pptx.read` stays `NO-TOOL`. That records
  an honest coverage gap; it is not proof of a clean refusal and must not be
  read as accepted behavior. A behavioral pptx bar needs an owner decision
  (support vs. refuse) and a real entrypoint or persona-level refusal check.
- Audit gaps G5–G8, G10 are other lanes' work and untouched here.

## Review instructions (author must not approve this)

1. Confirm the three fixtures assert **distinguishing** witnesses, not
   substring luck: `"087"`/`"0412"` leading zeros (typing), cached `174`
   (no recalculation), `format=jpeg` (codec), title **and** body (round-trip).
2. Try to make each new row pass with a broken producer: dep-less bundle,
   sharp without a jpeg codec, a writer that coerces strings to numbers, a
   truncated write. Each must FAIL with a step-named note (`write step:` /
   `reopen step:`).
3. Check `foldWriteReopen` cannot grade a reopen after a failed write and that
   its env echo reports the **weakest** child, so an `@electronlike` twin where
   either child ran as plain node still fails `checkEnvShapeApplied`.
4. Verify the `outlook.readiness` contract update against
   `extensions/moe-principal-assistant/index.mjs` — is 34 the true inventory at
   this revision, and does the fast lane now agree with the shipped plugin?
5. Confirm no fast-subset, gate, packaging or runtime file changed:
   `git show --stat`.
