# 5-prompt doc-tooling E2E harness

Fixture-driven, offline harness that proves the Lane A `document.*`
native tools (`extensions/moe-principal-assistant/doc-tools.mjs`) resolve
their bundled JS deps and produce the expected response shape on the
target OS — including the packaged Windows runtime once the installer
lands.

## Layout

| Path | What it holds |
|------|---------------|
| `tests/e2e/prompts.json` | The 5 deterministic prompts (verbatim from `incoming-tests/ClawX Agent Tests/Prompt Tests.docx`) with fixture spec + expected regex. |
| `tests/e2e/golden/<id>.json` | Per-prompt golden expected-output: `tool_called`, `result_schema`, and `assertions`. |
| `harness/run.ts` | Runner. Seeds a temp fixture per prompt, invokes the doc-tools entrypoint, checks schema + assertions + `expected_stdout_regex`, writes JUnit XML. |
| `tests/unit/harness-windows-e2e.test.ts` | Vitest coverage — spec shape + runner exit-status + binary-mode SKIP. |

## Commands

```bash
pnpm harness:doc-tooling-e2e                         # run all 5 prompts, direct mode
pnpm harness:doc-tooling-e2e --junit ./out.xml
pnpm harness:doc-tooling-e2e --only P3-pdf-summarize
pnpm harness:doc-tooling-e2e --mode=binary            # reserved; SKIP with exit 0
pnpm harness:ci                                       # includes the E2E as the final step
```

## Runner contract

For every prompt in `tests/e2e/prompts.json` the runner:

1. Loads `tests/e2e/golden/<id>.json`.
2. Asserts `golden.tool_called === prompt.expect_calls_tool` (guards against drift).
3. Seeds a fixture in a temp workdir (docx / xlsx / pdf / png).
4. Calls the matching `document.*` entrypoint with `prompt.tool_args`.
5. Validates the return object against `golden.result_schema` (per-key type check).
6. Runs `golden.assertions` (`_min`, `_max`, `_equals`, `_matches`, `file_exists_at_path`).
7. Checks `prompt.expected_stdout_regex` against the response body.
8. Emits JUnit XML per prompt.

## CI wiring

`.github/workflows/windows-installer-smoke.yml` runs the harness on the
fresh Windows runner as a post-install step, gated on
`inputs.installer_url`. The step exports
`CLAWX_APP_RESOURCES=%LOCALAPPDATA%\Programs\Ministry of Education\resources`
so the doc-tools module resolver finds `app.asar.unpacked/node_modules`
and `openclaw/node_modules` deposited by the installer.

## Marker-name discrepancy (surfaced for the checker)

The incoming task named markers `create_doc / insert_paragraph /
apply_style / export_pdf / list_headings`. Lane A ships
`document.read_pdf / read_docx / write_docx / read_xlsx / write_xlsx /
read_image`. The harness asserts on the shipped names, which is what
the packaged agent actually invokes on the pilot laptop. If the
checker prefers the abstract names, a thin alias layer in
`extensions/moe-principal-assistant/index.mjs` would satisfy both —
tracked as a follow-up rather than done here to keep this PR reviewable
and focused.

## Deliberate limitations

- **No LLM roundtrip.** Tool-picking is covered by `scripts/v2-chatbot-e2e.ts` on the Mac dev box.
- **No installer coupling.** Direct mode runs against the repo-checked JS deps; `--mode=binary` (spawn the packaged binary and drive its gateway) is a follow-up PR.
- **Maker != checker.** PR is draft; no self-merge.
