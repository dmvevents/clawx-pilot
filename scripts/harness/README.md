# 5-prompt Windows E2E harness

Deterministic harness that proves the Lane A `document.*` native tools
(from `extensions/moe-principal-assistant/doc-tools.mjs`) resolve their
JS deps and produce the expected output on the target OS — including
the packaged Windows runtime once the installer lands.

## What it does

Iterates the five prompts in `prompts.json` (verbatim from
`incoming-tests/ClawX Agent Tests/Prompt Tests.docx`), seeds a
per-prompt fixture (docx / pdf / xlsx / png), invokes the matching
`document.*` handler, and asserts against `expected_stdout_regex`.
Emits JUnit XML for CI ingestion.

## Modes

| Mode | What runs | When to use |
|------|-----------|-------------|
| `direct` (default) | Imports `doc-tools.mjs` directly, calls handler with `tool_args`. | CI, local dev, unattended smoke on the Windows VM. |
| `binary` | Reserved. Skeleton in place; skips cleanly (exit 0) with SKIP per test. | Enabled in a follow-up PR once the installer URL + gateway CLI harness land. Maker != checker per Anton. |

## Run locally

```bash
pnpm harness:windows-e2e
pnpm harness:windows-e2e --junit ./harness-junit.xml
pnpm harness:windows-e2e --only P3-pdf-summarize
pnpm harness:windows-e2e --mode=binary        # will SKIP with exit 0
```

## CI wiring

`.github/workflows/windows-installer-smoke.yml` runs this harness in
`direct` mode on the fresh Windows runner immediately after the silent
installer step. The step is gated on `inputs.installer_url` being set
(it's a `required: true` input, so this is defensive — it means the
harness won't red-fail a workflow that could not download an installer).

Environment set by the workflow before invocation:

- `CLAWX_APP_RESOURCES=%LOCALAPPDATA%\Programs\Ministry of Education\resources`
  — hints the doc-tools module resolver at the packaged
  `app.asar.unpacked/node_modules` and `openclaw/node_modules` roots.

## Adding a prompt

Append an object to `prompts.json` with this shape:

```json
{
  "id":  "P6-my-new-case",
  "prompt": "<verbatim principal-facing prompt>",
  "expect_calls_tool": "document.read_docx",
  "fixture": { "kind": "docx", "name": "Fixture.docx", "seed_paragraphs": ["..."] },
  "tool_args": { "format": "markdown" },
  "expected_stdout_regex": "some anchor",
  "timeout_ms": 30000
}
```

Supported `fixture.kind` values: `docx`, `xlsx`, `pdf`, `png`.
Supported `expect_calls_tool` values: `document.read_pdf`,
`document.read_docx`, `document.write_docx`, `document.read_xlsx`,
`document.write_xlsx`, `document.read_image`.

## Deliberate limitations

- **No LLM roundtrip.** The runner exercises tool implementations, not
  tool-picking. That's covered by `scripts/v2-chatbot-e2e.ts` on the
  Mac dev box.
- **No installer coupling in this scaffold.** The workflow step waits
  for the installer artifact but this scaffold's `direct` mode only
  needs the repo-checked JS deps; that's why the harness is safe to
  land before the installer zip is uploaded.
- **Maker != checker.** This scaffold does not self-merge. Anton (or a
  named checker) reviews before merge; binary mode is enabled in a
  follow-up.
