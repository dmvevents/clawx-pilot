# Agent And Skill Interoperability

Last reviewed: 2026-06-09.

## Purpose

This repo now has first-class operating surfaces for Codex, Claude Code, and the existing Windows pilot runbooks. The goal is not to create three competing sources of truth. The goal is to let either agent start cleanly, discover the same safety rules, and route to the same release-critical workflows.

Release evidence source of truth: `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`.
Current candidate pointer: `docs/CURRENT_WINDOWS_RC.md`.

## Official References Reviewed

- OpenAI Codex `AGENTS.md`: `https://developers.openai.com/codex/guides/agents-md`
- OpenAI Codex skills: `https://developers.openai.com/codex/skills`
- OpenAI Codex subagents: `https://developers.openai.com/codex/subagents`
- Anthropic Claude Code overview: `https://docs.anthropic.com/en/docs/claude-code/overview`
- Anthropic Claude Code memory: `https://docs.anthropic.com/en/docs/claude-code/memory`
- Anthropic Claude Code skills: `https://docs.anthropic.com/en/docs/claude-code/skills`
- Anthropic Claude Code subagents: `https://docs.anthropic.com/en/docs/claude-code/sub-agents`

## Official Surfaces We Support

| Tool | Entry guidance | Skills | Project agents | Notes |
|---|---|---|---|---|
| Codex | `AGENTS.md` | `.agents/skills/<skill>/SKILL.md` | `.codex/agents/*.toml` | Official Codex repo skills are under `.agents/skills`; custom project subagents are standalone TOML files under `.codex/agents`. |
| Codex OMX compatibility | `AGENTS.md` | `.codex/skills/<skill>/SKILL.md` | OMX/native role prompts | Kept for the current local OMX setup and existing project skills. |
| Claude Code | `CLAUDE.md` | `.claude/skills/<skill>/SKILL.md` | `.claude/agents/*.md` | `.claude/commands` still works, but project workflows should move toward skills. |
| Windows pilot | `windows-pilot/AGENTS.md` | `windows-pilot/skills/*.md` | `windows-pilot/agents/*.md` | Domain runbooks and specialist prompts for laptop operations. |

## Canonical Skill Map

| Capability | Codex official skill | Codex/OMX skill | Claude skill | Windows pilot reference |
|---|---|---|---|---|
| Resume/handoff | `.agents/skills/windows-demo-resume` | `.codex/skills/windows-outlook-demo` | `.claude/skills/windows-demo-resume` | `windows-pilot/README.md` |
| Runtime/Gateway/model repair | `.agents/skills/windows-runtime-recovery` | `.codex/skills/windows-runtime-recovery` | `.claude/skills/windows-runtime-recovery` | `windows-pilot/skills/model-gateway-recovery.md` |
| Outlook and Forms | `.agents/skills/windows-outlook-forms` | `.codex/skills/windows-outlook-demo` | `.claude/skills/windows-outlook-forms` | `windows-pilot/skills/outlook-email-windows.md`, `windows-pilot/skills/forms-suspension-fill.md` |
| Windows build/package | `.agents/skills/windows-build-package` | use `.agents/skills/windows-build-package` | `.claude/skills/windows-build-package` | `docs/WINDOWS_INSTALL_RUNBOOK.md` |
| Windows VM/laptop smoke | `.agents/skills/windows-vm-smoke` | `.codex/skills/windows-vm-smoke` | `.claude/skills/windows-vm-smoke` | `docs/WINDOWS_INSTALL_RUNBOOK.md`, `windows-pilot/scripts/` |
| SSH laptop operations | `.agents/skills/pilot-ssh-ops` | use `.agents/skills/pilot-ssh-ops` | `.claude/skills/pilot-ssh-ops` | `docs/PILOT_LAPTOP_ACCESS.md` |
| Form prefill | `.agents/skills/moe-form-prefill` | `.codex/skills/moe-form-prefill` | `.claude/skills/moe-form-prefill` | `docs/MOE_FORM_PREFILL_STRATEGY.md` |
| GA readiness | `.agents/skills/ga-release-readiness` | `.codex/skills/ga-release-readiness` | `.claude/skills/ga-release-readiness` | `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| GA E2E regression matrix | `.agents/skills/ga-e2e-regression` | `.codex/skills/ga-e2e-regression` | `.claude/skills/ga-e2e-regression` | `docs/GA_RELEASE_PLAN_2026-06-09.md`, `windows-pilot/scripts/` |

## Canonical Agent Map

| Capability | Codex project agent | Claude project agent | Purpose |
|---|---|---|---|
| GA release verdict | `.codex/agents/ga-release-conductor.toml` | `.claude/agents/ga-release-conductor.md` | Owns the release gate table and final GA/RC/demo-only verdict. |
| Runtime debugging | `.codex/agents/windows-runtime-debugger.toml` | `.claude/agents/clawx-config-doctor.md`, `.claude/agents/gateway-recovery.md` | Diagnoses model/Gateway/config drift and app-path proof. |
| Outlook/Forms/Office verification | `.codex/agents/office-automation-verifier.toml` | `.claude/agents/windows-smoke.md`, `.claude/agents/dom-selector-regression-tester.md` | Verifies Office, Outlook, Forms, and selector-safety evidence. |
| GA E2E regression verification | `.codex/agents/ga-e2e-regression-verifier.toml` | `.claude/agents/ga-e2e-regression-verifier.md` | Owns tests and evidence for known and adjacent demo failures before release verdict. |
| Installer/package | `.codex/agents/windows-release-packager.toml` | `.claude/agents/windows-smoke.md`, `.claude/agents/dependency-class-auditor.md` | Builds/checks Windows packaging and runtime dependencies. |
| Official docs research | `.codex/agents/ga-docs-researcher.toml` | use Claude research subagent or default | Confirms current external docs before changing agent surfaces. |

## Routing Rules

1. Start with `ga-release-readiness` for release, installer, documentation, or GA status work.
2. Use `ga-e2e-regression` when a demo/customer failure must become a test, when extending the end-to-end harness, or before claiming all known failures are green.
3. Use `windows-runtime-recovery` for chat stuck on thinking, model call failed, provider drift, Gateway down, Office prompt stalls, or ASR fallback failures.
4. Use `windows-outlook-forms` for email, Outlook, Microsoft Forms, Chrome CDP, and safe send/submit flows.
5. Use `moe-form-prefill` before filling Daily Report or Suspension Forms so the agent asks fewer questions without inventing PII.
6. Use `windows-build-package` for NSIS, desktop shortcuts, Windows helper binaries, and post-install smoke.
7. Use `windows-vm-smoke` for clean Windows VM/laptop install evidence after a package is built.
8. Use `pilot-ssh-ops` before touching the laptop over SSH.

## Shared Safety Invariants

- Never print provider keys, passwords, Host API tokens, private Forms URLs, email bodies, or full recipient lists.
- Never send email, download attachments, or submit Forms unless the user confirms that exact action in the same session.
- Microsoft tenant flows must use the already-signed-in user Chrome profile over CDP; managed Chromium is not final proof.
- App feature proof must go through the installed Electron app path, not a standalone CLI tool that lacks Electron-only environment.
- Cloud demo traffic should stay on the configured online provider or model broker unless the user explicitly changes the demo requirement.

## Adding Or Updating A Skill

For a workflow that both agents should know:

1. Add or update `.agents/skills/<slug>/SKILL.md` for official Codex.
2. Add or update `.claude/skills/<slug>/SKILL.md` for Claude Code.
3. Add `.codex/skills/<slug>/SKILL.md` only when the local OMX/Codex compatibility layer needs the same skill immediately.
4. Keep descriptions short and trigger-focused.
5. Put long reference material in `docs/` or a skill `references/` file and link it from `SKILL.md`.
6. Update the canonical skill map above.

## Adding Or Updating An Agent

For Codex, add a standalone TOML file in `.codex/agents/` with `name`, `description`, and `developer_instructions`. Default agents should be read-only unless their job is clearly implementation or packaging.

For Claude Code, add a markdown file in `.claude/agents/` with YAML frontmatter and a narrow body. Omit model pins unless a specific model is required.

Every agent must state:

- its ownership boundary;
- whether it may edit files;
- what evidence it returns;
- what actions it must never take.

## GA Session Start

For a fresh Codex or Claude session:

1. Read `AGENTS.md` or `CLAUDE.md`.
2. Invoke or load `ga-release-readiness`.
3. Invoke or load `ga-e2e-regression` before changing tests, installer smoke scripts, Outlook, Forms, Office, ASR, or Gateway runtime behavior.
4. Read `docs/CURRENT_WINDOWS_RC.md`, `docs/GA_RELEASE_EVIDENCE_MANIFEST.md`, and `docs/GA_RELEASE_PLAN_2026-06-09.md`.
5. Run `git status --short --branch`.
6. Produce a gate table and regression matrix before changing code.

Stop only when the release verdict is evidence-backed and the next action is clear.
