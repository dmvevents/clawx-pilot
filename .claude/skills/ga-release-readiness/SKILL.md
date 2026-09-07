---
name: ga-release-readiness
description: Plan, audit, and execute the ClawX/Ministry GA release path across Codex and Claude Code, covering release gates, Windows installer, model broker, Outlook/Forms, Office files, ASR, docs, security, and validation evidence.
---

# GA Release Readiness

## Objective

Move the project from Windows RC to GA with evidence-backed gates. Do not call something GA until every release-critical row has fresh validation evidence or an explicitly accepted deferral.

## First Reads

- `docs/PROJECT_CONTRACT.md`
- `docs/COMPLETION_PLAN.md`
- `docs/CURRENT_WINDOWS_RC.md`
- `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`
- `docs/AGENT_SKILL_INTEROPERABILITY.md`
- `docs/PRODUCTION_CHECKLIST.md` (inspect the relevant gate)
- `package.json`

Dated June plans are historical evidence, not the current work queue or candidate. Development/static green is not a release verdict. Required missing, skipped, blocked or informational lanes prevent release acceptance; record source revision, artifact hash and installed/live evidence separately.

## Workstream Routing

- Installer/package: `/windows-build-package`.
- Clean Windows install/VM smoke: `/windows-vm-smoke`.
- Known-failure E2E regression and evidence matrix: `/ga-e2e-regression`.
- Runtime/model/Gateway: `/windows-runtime-recovery`.
- Outlook/Forms: `/windows-outlook-forms`.
- Form defaults: `/moe-form-prefill`.
- SSH/live laptop: `/pilot-ssh-ops`.
- Docs and handoff: update `docs/COMPLETION_PLAN.md`, `docs/CURRENT_WINDOWS_RC.md`, `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`, and relevant release notes.

## Required Evidence

Collect or update:

- local typecheck and targeted unit tests;
- packaged Windows build with SHA256;
- fresh-install smoke on a clean Windows profile or laptop;
- installed-app chat smoke through the intended online Gateway/model path;
- Outlook open/read/draft safety proof with no send unless explicitly confirmed;
- Forms preview/dry-run proof with no submit unless explicitly confirmed;
- Office file analysis proof for sample Excel and Word inputs;
- ASR smoke or explicit GA deferral;
- no committed secrets and no user-visible raw model/vendor identity.
- updated `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` before the verdict.

## Output

Report:

1. GA verdict: `GREEN`, `YELLOW`, or `RED`.
2. Evidence table with command/artifact path per gate.
3. Blockers and owner.
4. Next release action.
