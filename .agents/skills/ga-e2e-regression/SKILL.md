---
name: ga-e2e-regression
description: Run and extend the Ministry of Education GA end-to-end regression process after demo failures, before RC/GA tagging, installer upload, customer bug bash, or Windows fresh-install validation. Covers Outlook inbox/read/draft/reply/send gates, Forms preview/submit gates, Office CSV/Excel/Word/PowerPoint workflows, ASR quality and ffmpeg packaging, Chrome CDP profile attach, Gateway/model coherence, installer artifacts, VM/laptop smoke evidence, and subagent-expanded tests for known and adjacent failures.
---

# GA E2E Regression

## Objective

Turn customer/demo failures into repeatable tests and installed-app evidence. This skill owns the regression matrix and proof collection; `ga-release-readiness` owns the final GA/RC verdict.

## First Reads

- `docs/GA_RELEASE_PLAN_2026-06-09.md`
- `docs/AGENT_SKILL_INTEROPERABILITY.md`
- `docs/WINDOWS_INSTALL_RUNBOOK.md`
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `.agents/skills/windows-outlook-forms/SKILL.md`
- `.agents/skills/windows-build-package/SKILL.md`
- `.agents/skills/windows-runtime-recovery/SKILL.md`
- `windows-pilot/scripts/`

## Safety

- Do not send email, reply, forward, download attachments, or submit Forms unless the user explicitly confirms that exact action in the same session.
- Do not print provider keys, passwords, Host API tokens, private Forms URLs, email bodies, full recipient lists, or key-file hashes.
- Use signed-in user Chrome/CDP for Microsoft tenant proof. Managed Chromium is diagnostic only.
- App proof must go through the installed Electron app path, not a standalone CLI that lacks Electron runtime state.

## Subagent Lanes

Use subagents for bounded, independent lanes while the lead keeps the critical path moving:

- `test-engineer`: expand unit/e2e coverage for known and adjacent failure classes.
- `office_automation_verifier`: read-only Outlook, Forms, Office, and no-send/no-submit evidence.
- `windows_release_packager`: installer/package artifact evidence.
- `windows_runtime_debugger`: Gateway/model/ASR/Office stall diagnosis.
- `ga_release_conductor`: release gate audit after the regression matrix is green.

Each subagent report must include commands run, files changed if any, pass/fail evidence, remaining blocker, and a statement that no email was sent and no form was submitted unless that was explicitly assigned.

## Regression Matrix

Lock these classes with tests before claiming green:

| Failure class | Required regression |
|---|---|
| Outlook summarized Sent Items instead of Inbox | `read_inbox`, `search_inbox`, `read_email`, reply/forward/attachment actions must force Inbox or explicitly report folder scope. |
| Outlook month/list missed early emails | Windowing tests must cover larger `top` values, date-month wording, capped reads, and "check again" retries. |
| Reply archived the source message | Reply/forward tests must prove only toolbar Reply/Forward controls are clicked, never broad VLM/generic toolbar buttons. |
| Reviewed draft send asked for recipient or refused changed subject | Send tests must cover `{ confirm: true }` on exactly one reviewed draft, optional assertions, changed subject after review, multiple-draft refusal, and no empty body assertions. |
| Draft body landed in `To:` | Body-fill tests must reject generic textbox fallback and target body-specific labels/probes only. |
| User was told to enable Chrome debugging manually | Plugin/persona tests must prefer `outlook.*`, `browser.diagnose`, and `browser.repair_chrome_cdp`; forbid Chrome flags/manual remote-debugging guidance. |
| Forms missed required fields but reported success | Forms preview/submit tests must require field coverage summaries, missing-field diagnostics, and submit refusal without same-session `confirm:true`. |
| Office CSV produced headers only or PPT failed | Office tests must use real CSV rows and assert generated Excel/PowerPoint artifacts contain data rows/slides, not only headers/files. |
| ASR reported `ffmpeg-not-found` or low quality | ASR tests must cover packaged `resources/bin/ffmpeg.exe`, `WinSpeechRecognize.exe`, Azure Speech seed resolution, and fallback status. |
| Fresh install missed runtime deps | Package inspection must cover `playwright-core`, `ffmpeg.exe`, `WinSpeechRecognize.exe`, cloud gateway seed, Azure Speech seed/example, shortcuts, and no secret content/hash disclosure. |
| Gateway/model drift or stuck thinking | Runtime smoke must prove Gateway health and intended online provider/model through app-facing request or transcript evidence. |

## Execution Order

1. Capture baseline: `git status --short --branch`, changed files, current installer hash if present.
2. Add or update focused tests for every new failure class before changing behavior when practical.
3. Run targeted tests for the touched surfaces.
4. Run full local gates when the matrix changes:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
git diff --check
```

5. Rebuild Windows package when runtime/package behavior changed:

```bash
PATH="$HOME/.dotnet:$PATH" pnpm run package
PATH="$HOME/.dotnet:$PATH" node scripts/run-electron-builder.mjs --win nsis --x64 --publish never
```

6. Inspect/package smoke:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File windows-pilot/scripts/pilot-check-install-artifacts.ps1
```

7. Run a clean Windows VM or laptop smoke using `windows-pilot/scripts/` and collect redacted artifact paths. Prefer no-send/no-submit probes unless the user confirms a real send/submit.
8. Update release docs with the exact commands, pass counts, installer SHA256, and remaining yellow/red gates.

## Stop Condition

Stop only when the regression matrix has fresh passing evidence or a named blocker with the next command/owner. Do not call the build GA unless `ga-release-readiness` has a complete gate table.
