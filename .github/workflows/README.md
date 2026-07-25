# `.github/workflows/`

Index of the GitHub Actions workflows in this repo, with a one-line hook
for each. Update this file whenever a workflow is added, removed, or
renamed.

## Continuous checks (auto-triggered on push / PR)

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Checks | `check.yml` | push, PR | Typecheck + unit tests + lint |
| Comms regression | `comms-regression.yml` | push, PR | Chat/composer regression suite |
| Electron E2E | `electron-e2e.yml` | push, PR | Playwright against the packaged Electron app |
| Harness | `harness.yml` | push, PR | `pnpm harness:ci` gate |

## On-demand / manual

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| Package Windows (manual) | `package-win-manual.yml` | `workflow_dispatch` | Build a Windows .exe by hand |
| Release | `release.yml` | tag push, `workflow_dispatch` | Publish a release |
| Windows build test | `win-build-test.yml` | `workflow_dispatch` | Smoke a fresh Windows build |
| Windows Installer Smoke | `windows-installer-smoke.yml` | `workflow_dispatch` | Install a candidate `.exe` on a clean runner and capture logs |
| **Windows Installer E2E** | `windows-installer-e2e.yml` | `workflow_dispatch` | Install a candidate `.exe`, run the **5-prompt doc-tooling harness**, upload `harness-junit.xml`, and summarise `failure_category` counts (from PR #16's classifier) into the job summary |
| Windows smoke | `windows-smoke.yml` | `workflow_dispatch` | Post-install happy-path smoke |

## Testing notes

- `windows-installer-e2e.yml` **never hardcodes an installer URL**. Both
  `installer_url` and `harness_prompts_ref` are `workflow_dispatch` inputs
  — the workflow can only fire against an artifact the operator explicitly
  supplies at dispatch time.
- The failure-category summary is produced by a small `awk` one-liner
  against the JUnit XML that PR #16 emits. Categories are the closed set
  from `harness/failure_classifier.ts`:
  `timeout | assertion | missing_output | schema_violation | unknown`.
- Harness exits 2 (fatal) or 3 (schema-gate violation) fail the job hard;
  routine test failures do not — the JUnit + summary carry the signal.

## Style rules

- Use `workflow_dispatch` (not `repository_dispatch`) for anything that
  needs an operator-supplied URL.
- Use `shell: pwsh` on Windows runners; `shell: bash` only when the step
  is intentionally cross-platform or on `ubuntu-latest`.
- Always pin action major versions (`@v4`, not `@main`).
- Never write a real release URL into a workflow file — pass it as an
  input at dispatch.
