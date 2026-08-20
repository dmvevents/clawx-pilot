# Raj prompt-suite replay — native `document.*` tools vs the 2026-07-21 result

Run date: 2026-08-20. Source of truth for the prompts:
`incoming-tests/ClawX Agent Tests/Prompt Tests.docx` (received from Raj, authored 2026-07-21)
plus 7 screenshots `CHAT-001*.png`.

## What the Ministry actually gave us

| Item | Detail |
|---|---|
| `Prompt Tests.docx` | 5 prompts, each with the agent's verbatim failure response. **Score 0/5.** |
| `CHAT-001.png` … `-8.png` | Screen captures of the same session, including the full tool-call trace |
| Tester environment | Windows, `C:\Users\camer\OneDrive\Desktop\MoE Agent Testing Folder` |
| Fixture files themselves | **NOT supplied.** Only filenames are recoverable, from the prompts + screenshots. |

Fixture filenames recoverable from the document/screenshots:
`Staff Meeting Memo Draft.docx`, `01_Ministry_Circular_ICT_Equipment_Audit.pdf`,
`02_Classroom_Device_Use_Policy_Excerpt.pdf`, `Student Marks Gradebook.xlsx`,
`Student Support Referral Form` (image), plus an `Output_Files` folder and a
`moe_agent_pdf_test_files` subfolder.

## The five prompts, verbatim

1. Open the Staff Meeting Memo Draft document and summarize its main points in bullet form.
2. Rewrite the Staff Meeting Memo Draft into a professional internal memo. Save the edited copy as `Staff_Memo_Final.docx` in the Output_Files folder. Do not overwrite the original.
3. Summarize the ICT Equipment Audit circular for a teacher who has only five minutes to understand it.
4. Open the Student Marks Gradebook workbook. Calculate each student's average and assign a grade using the scale in the workbook or instructions. Save the updated copy as `Marks_Updated.xlsx`. Do not overwrite the original.
5. Open the Student Support Referral Form image and list each visible field and value. Mark any blank, missing, or unclear fields.

There is also an unnumbered discovery prompt in `CHAT-001.png`:
"Search the MoE Agent Testing Folder and list all Word, PDF, Excel and image files you can find."

## Result of this replay

Fixtures were **reconstructed** to match the recovered filenames and plausible Ministry content
(`fixtures/` in this directory), then all five prompts were exercised against the shipping
handlers in `extensions/moe-principal-assistant/doc-tools.mjs`.

| Check | 2026-07-21 (Raj) | 2026-08-20 (this replay) |
|---|---|---|
| P1 read .docx | FAIL "tools to read Word documents are not available" | **PASS** — 902 chars, agenda + action items + 30 Jul deadline |
| P2 write `Staff_Memo_Final.docx` | FAIL "`pandoc` and `python` are not installed" | **PASS** — written, re-read, verified |
| P2b original not overwritten | not reached | **PASS** — original intact |
| P3 read .pdf | FAIL "`pdfplumber` / `pdftotext` not installed" | **PASS** — all 3 deadlines + Form ICT-1 extracted |
| P4 read .xlsx | FAIL "`pandas` is not installed" | **PASS** — marks + grade-scale sheet |
| P4b write `Marks_Updated.xlsx` | not reached | **PASS** — 6 averages + grades, roundtrip OK |
| P5 read image | FAIL "`pytesseract` and `Pillow` are required" | **PASS** — base64 payload for VLM, no OCR binary |

**7/7 PASS.** Every capability Raj's suite exercised is implemented and works.

Fix provenance: `98e805d8` (2026-07-25) `feat(principal-assistant): native document.* tools (Lane A)`
— **4 days after** Raj's test. Raj tested a build that predates the fix.

## The finding that matters more than the score

`CHAT-001-6.png` shows the failing trace step by step, and it is **not** a missing-capability
failure — it is a **tool-selection** failure:

```
read  { "path": "~/.openclaw/skills/pdf/SKILL.md" }
exec  { "command": "uv run python -c \"import pdfplumber; import pandas as pd; ..." }
write { "content": "import pdfplumber\nimport pandas as pd..." }   -> extract_pdf_info.py
exec  { "command": "uv run python extract_pdf_info.py" }
exec  { "command": "uv pip install pdfplumber pandas" }
exec  { "command": "uv pip install --system pdfplumber pandas" }
exec  { "command": "pdftotext \"C:\\Users\\camer\\...\\01_Ministry_Circular_ICT_..." }
```

The agent consulted `~/.openclaw/skills/pdf/SKILL.md` and that skill instructed it to use
`pypdf` / `pdfplumber`. It then burned 7 tool calls and wrote a scratch Python file before
giving up. Verified today, unchanged:

- `~/.openclaw/skills/{pdf,docx,xlsx,pptx}/SKILL.md` — **none of the four mention the native
  `document.*` tools at all.** The `pdf` skill's `description:` claims "Use this skill whenever
  the user wants to do anything with PDF files."
- `resources/skills/preinstalled-manifest.json` — all four remain `autoEnable: true`.
- `extensions/moe-principal-assistant/persona.mjs` — no document-tool routing guidance. It has
  an exemplary hard routing rule for `outlook.*` ("Always use the outlook.* deterministic
  path… Do not use generic Chrome/browser MCP tools"). There is **no equivalent for
  `document.*`.**
- Only **1 of 6** `document.*` tool descriptions carries "Prefer this over the pdf skill":

  | tool | prefer-over-skill | mentions no-Python |
  |---|---|---|
  | `document.read_pdf` | **YES** | yes |
  | `document.read_docx` | no | yes |
  | `document.write_docx` | no | no |
  | `document.read_xlsx` | no | yes |
  | `document.write_xlsx` | no | no |
  | `document.read_image` | no | yes |

So the capability gap is closed but the **steering gap is open**. On a fresh install the model
is still told, by an auto-enabled skill, to reach for Python. A re-test could reproduce Raj's
exact transcript despite 7/7 handler pass — this is a live risk, not a hypothetical.

## Second, independent failure in the document: file discovery

First discovery attempt returned "I couldn't find any files in that folder. Is there another
location I should check?" It only succeeded after the tester pasted the absolute path
`C:\Users\camer\OneDrive\Desktop\MoE Agent Testing Folder`.

`resolveReadablePath` (doc-tools.mjs:117) searches `~/.openclaw/media/outbound`, `~/Downloads`,
`~/Documents`, `~/Desktop` — but **not the OneDrive-redirected Desktop**. Under Windows
OneDrive Known Folder Move the real path is `%USERPROFILE%\OneDrive\Desktop`, so `~/Desktop`
misses. Every Ministry laptop with OneDrive folder redirection has this shape. Untested on
Windows; inferred from the code and the screenshot path.

## Bug found by this replay (macOS-only, low severity)

The first replay attempt ran fixtures from `/tmp` and every call was refused:

```
refused to read /tmp/moe-agent-test/.../Staff Meeting Memo Draft.docx:
only files under the user's home or tmp directory are allowed.
```

The error text says tmp *is* allowed. On macOS `/tmp` is a symlink to `/private/tmp`;
`insideSandbox` (doc-tools.mjs:50) compares the realpath-resolved candidate against unresolved
sandbox roots, so `/private/tmp/...` fails the `startsWith` check. Only affects macOS `/tmp`
staging, not the principal Windows path. Re-running the identical suite under `~` gave 7/7.

## Method notes

- Fixtures are **reconstructed, not authentic.** They match the recovered filenames and
  realistic Ministry content, so they exercise the same code paths, but they are not the
  Ministry's bytes. Ask Raj for the real `MoE Agent Testing Folder` to close this.
- `02_Classroom_Device_Use_Policy_Excerpt.pdf` was not reconstructed (no prompt targets it).
- The PDF fixture is a hand-built minimal PDF-1.4 (no external tool required), which is
  a *thin* test of `pdf-parse` — a real Ministry circular with tables and possibly scanned
  pages is a harder input. P3's PASS should be read as "the path works", not "handles any
  Ministry PDF".
- This replay calls the handlers **directly**. Like `harness/run.ts`, it therefore cannot catch
  a tool-selection failure — which is precisely the failure mode Raj hit. **An in-app,
  LLM-driven run is still outstanding and is the only test that closes this out.**

## Status

| Question | Answer |
|---|---|
| Do we have Raj's prompts? | Yes — all 5 verbatim, plus a 6th discovery prompt from the screenshots |
| Do we have Raj's files? | No — reconstructed here |
| Can we test right now? | Yes — done, 7/7 |
| Is the reported failure fixed? | Capability yes; **tool-selection no** |
| Is it verified end-to-end in-app? | **No** — outstanding |
