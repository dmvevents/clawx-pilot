# ClawX / Ministry of Education

@docs/PROJECT_CONTRACT.md

## Start here

1. Read [the completion plan](docs/COMPLETION_PLAN.md) for the current outcome, evidence and next workstream.
2. Inspect `git status --short --branch` and the selected CLWX card in `docs/plane-board/CLWX-board-export.json`.
3. Load only the skill and source files needed for that workstream. Continue it through verification; do not substitute a different small card merely because it is available.

The shared contract governs both Claude and Codex. Current status is maintained in the completion plan, candidate pointer and evidence manifest; historical sprint notes and auto memory are supporting evidence. Do not load the full state vector at startup or revive old model defaults, dates or owner holds from memory without checking current evidence.

Repository layout, module ownership and evidence locations: [docs/REPOSITORY_GUIDE.md](docs/REPOSITORY_GUIDE.md).

## Claude CLI execution model

Claude CLI drives execution from the canonical coordination root; source edits happen in an isolated per-workstream git worktree with one named owner. A worktree isolates branches and files, not the VM, services or shared runtime state. Operational details: [docs/CLAUDE_CODE_OPERATIONS.md](docs/CLAUDE_CODE_OPERATIONS.md).

- Every lane records a run receipt: card, source SHA/worktree, command, outcome, evidence path, exact next step. No credentials in receipts.
- Bounded bare CLI lanes (`--bare`) skip automatic hooks, LSP and CLAUDE.md discovery; they must explicitly read `docs/PROJECT_CONTRACT.md` and the selected skill file before acting.
- Distinguish the observed model from the requested model; a saved preference or config file is not proof the running model consumed it. If a model refuses a request, report the refusal and route it to the user — never reword, downgrade gates or switch identity to evade it.
- Runtime status (process up, port reachable, spend within cap) is not acceptance evidence. Acceptance follows the shared contract's PASS/FAIL/BLOCKED/NOT_RUN records.
- Review lanes stay as assigned: 2–3 separate Claude reviews for nontrivial code, Codex additive when available. Do not add extra rounds once findings are resolved and the diff is unchanged.

## Claude tools and workflows

- Sprint continuation: `.claude/skills/ga-sprint-driver/SKILL.md` follows the completion plan. A scheduled invocation is a bounded checkpoint, not a reason to repeat unchanged tests, generate another backlog, or idle when an authorized next step exists.
- Autonomous continuation uses native `/goal`; plugins and permission mode alone do not create a running controller. Use the [activation, resume and tool-routing procedure](docs/CLAUDE_CODE_OPERATIONS.md#activate-and-resume-the-controller). Prefer Claude/Bedrock author and review lanes; the installed Codex plugin is optional unless specifically assigned.
- Domain routing: `docs/AGENT_SKILL_INTEROPERABILITY.md` maps release, Windows, Outlook/Forms, Office and runtime skills/agents.
- Build process: `.claude/skills/windows-build-pipeline/SKILL.md` and `.claude/agents/windows-build-engineer.md` cover CI stages, caching and build-failure prevention. Use the shared [build procedure](docs/build/windows-build-pipeline.md); preserve the source identity of any candidate already undergoing acceptance.
- Release verification: `.claude/skills/ga-e2e-regression/SKILL.md` covers known failures; `.claude/skills/windows-vm-smoke/SKILL.md` covers installed Windows evidence.
- Stakeholder intake: `.claude/skills/ministry-liaison-monitor/SKILL.md`. Classify messages by project content; **Karunesh also tests ClawX**. Resolve the current WhatsApp thread and preserve dated, redacted source references.
- MCP availability is session-local. Inspect configured tool names before relying on WhatsApp, browser or review tools; do not copy credentials from `.claude.json` into the repo. Developer MCP availability is not proof of a capability in the installed app.
- `.claude/settings.json` currently attaches the WhatsApp command guard to **Bash only**. It is neither a native-MCP send gate nor proof of delivery. Outbound authorization and redaction rules apply to every transport.
- Use bounded native subagents when useful, with explicit ownership and acceptance criteria. Authors do not approve their own code; retain the assigned separate review lanes without repeating unchanged reviews.

## Verification

Every discovered bug requires an existing-or-deduplicated Plane card and a reproducible report under [docs/bugs](docs/bugs/README.md), using the [template](docs/bugs/TEMPLATE.md). Record evidence, hypotheses, fixes, failed attempts, tests and the next exact action before leaving the workstream; incomplete fixes and defects in tests/tooling need the same handoff.

Use `pnpm typecheck`, `pnpm lint:check`, focused Vitest and applicable harness/E2E checks from the shared contract. Development gate green is not installed-build or release acceptance. Do not run live email/forms commands without first checking their actual side effects and authorization.

Report what changed, the exact evidence, remaining gaps and the next outcome. Keep all product status in the linked maintained documents; keep this entrypoint small.
