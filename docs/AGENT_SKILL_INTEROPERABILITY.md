# Agent And Skill Interoperability

Last reconciled: 2026-09-07.

## Purpose

This repo now has first-class operating surfaces for Codex, Claude Code, and the existing Windows pilot runbooks. The goal is not to create three competing sources of truth. The goal is to let either agent start cleanly, discover the same safety rules, and route to the same release-critical workflows.

Read the same two project documents from either agent: [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md) for stable instructions and [COMPLETION_PLAN.md](COMPLETION_PLAN.md) for current priorities/evidence. `CLAUDE.md` imports the contract; `AGENTS.md` directs Codex to it. They do not maintain separate capability/status tables.

Current candidate: [CURRENT_WINDOWS_RC.md](CURRENT_WINDOWS_RC.md). Release evidence: [GA_RELEASE_EVIDENCE_MANIFEST.md](GA_RELEASE_EVIDENCE_MANIFEST.md). Historical May/June packets are searchable reference, not startup routing. Read the candidate pointer for the recorded installer and installed proof; build-process documentation does not maintain a second current-version table.

Claude's existing `ga-sprint-driver` skill implements the shared continuation policy: follow one outcome across checkpoints, keep source and installed/live evidence distinct, and stop unchanged/blocked ticks. Codex follows the same policy through the shared contract and native domain agents; no additional workflow engine is required.

## Claude guidance and hook scope verified September 7

Keep root guidance concise and move domain procedures behind explicit references. Claude supports shared-file imports; its documentation recommends avoiding conflicting instructions. [Claude memory documentation](https://code.claude.com/docs/en/memory).

The checked-in hook matcher is `Bash`; native MCP tools have their own names and are not covered by that matcher. The current hook scans shell command text, not payload files or actual delivery. It is not a transport-wide authorization or secret-inspection boundary. [Claude hook documentation](https://code.claude.com/docs/en/hooks). This reconciliation preserves the hook behavior and documents its actual limit; any enforcement repair needs tests for each real send surface.

No user-global memory, MCP credentials or tool installation was changed. The existing local sprint-task prompt was aligned, preserving schedule/ownership/firing metadata; runtime reload is unverified. Project history cannot confer authority to send a message in a new session.

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

### Dev-tooling layer (per-developer, not committed)

| Tool | Install | Role | Notes |
|---|---|---|---|
| codex-plugin-cc (`codex@openai-codex`) | Claude Code plugin mechanism, user scope; requires local Codex CLI authed with the developer's own credentials (never committed) | Cross-vendor review lane: `/codex:review` and `/codex:adversarial-review` delegate to the local Codex CLI (GPT-5.5) as a second-model adversary for the separate-lane review protocol | Additive only — a Codex verdict never replaces the Claude-lens review or loosens a gate. Protocol: `.claude/skills/ga-sprint-driver/SKILL.md` §3b; adoption record: `docs/PLUGIN_INTEGRATION_PLAN_2026-09-03.md` §1. |

## Canonical Skill Map

| Capability | Codex official skill | Codex/OMX skill | Claude skill | Windows pilot reference |
|---|---|---|---|---|
| Resume/handoff | `.agents/skills/windows-demo-resume` | `.codex/skills/windows-outlook-demo` | `.claude/skills/windows-demo-resume` | `windows-pilot/README.md` |
| Runtime/Gateway/model repair | `.agents/skills/windows-runtime-recovery` | `.codex/skills/windows-runtime-recovery` | `.claude/skills/windows-runtime-recovery` | `windows-pilot/skills/model-gateway-recovery.md` |
| Outlook and Forms | `.agents/skills/windows-outlook-forms` | `.codex/skills/windows-outlook-demo` | `.claude/skills/windows-outlook-forms` | `windows-pilot/skills/outlook-email-windows.md`, `windows-pilot/skills/forms-suspension-fill.md` |
| Build process and CI reliability | `.agents/skills/windows-build-pipeline` | `.codex/skills/windows-build-pipeline` | `.claude/skills/windows-build-pipeline` | `docs/build/windows-build-pipeline.md` |
| Windows build/package | `.agents/skills/windows-build-package` | use `.agents/skills/windows-build-package` | `.claude/skills/windows-build-package` | `docs/WINDOWS_INSTALL_RUNBOOK.md` |
| Windows VM/laptop smoke | `.agents/skills/windows-vm-smoke` | `.codex/skills/windows-vm-smoke` | `.claude/skills/windows-vm-smoke` | `docs/WINDOWS_INSTALL_RUNBOOK.md`, `windows-pilot/scripts/` |
| Windows VM iteration from stakeholder failure | `.agents/skills/windows-vm-iteration` | `.codex/skills/windows-vm-iteration` | use `.claude/skills/windows-vm-smoke` + `.claude/skills/gcp-iap-windows-lane` until mirrored | `windows-pilot/vm-testing/README.md` |
| SSH laptop operations | `.agents/skills/pilot-ssh-ops` | use `.agents/skills/pilot-ssh-ops` | `.claude/skills/pilot-ssh-ops` | `docs/PILOT_LAPTOP_ACCESS.md` |
| Form prefill | `.agents/skills/moe-form-prefill` | `.codex/skills/moe-form-prefill` | `.claude/skills/moe-form-prefill` | `docs/MOE_FORM_PREFILL_STRATEGY.md` |
| GA readiness | `.agents/skills/ga-release-readiness` | `.codex/skills/ga-release-readiness` | `.claude/skills/ga-release-readiness` | `docs/COMPLETION_PLAN.md` |
| GA E2E regression matrix | `.agents/skills/ga-e2e-regression` | `.codex/skills/ga-e2e-regression` | `.claude/skills/ga-e2e-regression` | `docs/COMPLETION_PLAN.md`, `windows-pilot/scripts/` |

## Canonical Agent Map

| Capability | Codex project agent | Claude project agent | Purpose |
|---|---|---|---|
| GA release verdict | `.codex/agents/ga-release-conductor.toml` | `.claude/agents/ga-release-conductor.md` | Owns the release gate table and final GA/RC/demo-only verdict. |
| Runtime debugging | `.codex/agents/windows-runtime-debugger.toml` | `.claude/agents/clawx-config-doctor.md`, `.claude/agents/gateway-recovery.md` | Diagnoses model/Gateway/config drift and app-path proof. |
| Outlook/Forms/Office verification | `.codex/agents/office-automation-verifier.toml` | `.claude/agents/windows-smoke.md`, `.claude/agents/dom-selector-regression-tester.md` | Verifies Office, Outlook, Forms, and selector-safety evidence. |
| GA E2E regression verification | `.codex/agents/ga-e2e-regression-verifier.toml` | `.claude/agents/ga-e2e-regression-verifier.md` | Owns tests and evidence for known and adjacent demo failures before release verdict. |
| Build process engineering | `.codex/agents/windows-build-engineer.toml` | `.claude/agents/windows-build-engineer.md` | Owns CI stages, dependency caching, reproducible build inputs and failure diagnosis; returns verification and handoff evidence. |
| Installer/package | `.codex/agents/windows-release-packager.toml` | `.claude/agents/windows-smoke.md`, `.claude/agents/dependency-class-auditor.md` | Builds/checks Windows packaging and runtime dependencies. |
| Official docs research | `.codex/agents/ga-docs-researcher.toml` | use Claude research subagent or default | Confirms current external docs before changing agent surfaces. |

## Routing Rules

1. Start with the shared contract and completion plan. Load `ga-release-readiness` for release/candidate verdicts; ordinary guidance edits do not require a live release run.
2. Use `ga-e2e-regression` when a demo/customer failure must become a test, when extending the end-to-end harness, or before claiming all known failures are green.
3. Use `windows-runtime-recovery` for chat stuck on thinking, model call failed, provider drift, Gateway down, Office prompt stalls, or ASR fallback failures.
4. Use `windows-outlook-forms` for email, Outlook, Microsoft Forms, Chrome CDP, and safe send/submit flows.
5. Use `moe-form-prefill` before filling Daily Report or Suspension Forms so the agent asks fewer questions without inventing PII.
6. Use `windows-build-pipeline` for CI organization, caching and recurring build failures; `windows-build-package` owns NSIS, desktop shortcuts and Windows helper binaries. Read `docs/build/windows-build-pipeline.md` for the shared source-to-artifact procedure.
7. Use `windows-vm-smoke` for clean Windows VM/laptop install evidence after a package is built.
8. Use `pilot-ssh-ops` before touching the laptop over SSH.
9. Use `windows-vm-iteration` when stakeholder feedback, VM access, fresh standard-user setup, model provisioning and exact-artifact retesting must be coordinated before another handoff.

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

1. Read the entrypoint (`AGENTS.md` or `CLAUDE.md`), shared contract and completion plan.
2. Inspect git status and the selected card. Load the matching domain skill; use release-readiness for a release verdict, regression/Windows skills for their actual test lanes.
3. Read candidate/evidence pointers if the task depends on installed or release claims.
4. State the selected outcome, source/evidence gap and next falsifiable validation, then execute authorized work.

Stop when the assigned outcome is verified or the next dependency is concretely blocked. A guidance audit does not require launching live account tests. A release verdict does require the actual release evidence.
