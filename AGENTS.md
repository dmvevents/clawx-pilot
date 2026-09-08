# ClawX / Ministry of Education

## Shared operating contract

Read [docs/PROJECT_CONTRACT.md](docs/PROJECT_CONTRACT.md) before project work. It contains the product scope, architecture boundaries, action gates, development caveats and verification rules shared with Claude Code. Follow the user's current instructions and applicable workspace orchestration guidance.

## Start here

1. Read [docs/COMPLETION_PLAN.md](docs/COMPLETION_PLAN.md) for the current outcome, evidence and next workstream.
2. Inspect `git status --short --branch` and the selected CLWX card in `docs/plane-board/CLWX-board-export.json`.
3. Load the relevant domain skill and scoped `AGENTS.md`; execute the workstream through verification. Historical plans and the large state vector are searchable evidence, not startup reading.

Repository layout, module ownership and evidence locations: [docs/REPOSITORY_GUIDE.md](docs/REPOSITORY_GUIDE.md).

## Codex routing

- [docs/AGENT_SKILL_INTEROPERABILITY.md](docs/AGENT_SKILL_INTEROPERABILITY.md) maps Codex, OMX and Claude project surfaces.
- Use `windows-build-pipeline` and the `windows_build_engineer` agent for CI stages, caching and build-failure prevention. The canonical procedure is [docs/build/windows-build-pipeline.md](docs/build/windows-build-pipeline.md); installer execution and VM acceptance remain separate domain workflows.
- Use `ga-e2e-regression` for known-failure coverage and `windows-vm-smoke` for installed Windows proof; both are available under `.agents/skills/` and `.codex/skills/`.
- Project skills are available in `.agents/skills/` and OMX compatibility `.codex/skills/`; native project agents are in `.codex/agents/`. Skills are loaded from `SKILL.md`, not agent TOMLs. Keep equivalent critical workflows aligned.
- Use bounded native subagents for independent work when useful; assign ownership and acceptance criteria. Authors do not approve their own code.
- WhatsApp/browser MCPs configured for Claude are not automatically available here. Inspect actual capabilities, use authorized read-only local evidence when available, and state the access/freshness limitation.
- For runtime/backend changes, start with a `harness/specs/tasks/` spec referencing `gateway-backend-communication`. Main owns transport; renderer uses `src/lib/host-api.ts` and `src/lib/api-client.ts`.

## Verification and reporting

Use focused tests, then applicable typecheck/lint/harness/E2E gates. `pnpm lint:check` does not autofix. A source/static pass does not prove an installed artifact, tenant flow or release. Record the exact tested revision, artifact/environment where relevant, result and remaining gaps.

Keep current product state in the completion plan, candidate pointer and evidence manifest. Do not add another competing “current” plan. Report the completed outcome and the next evidence needed, not the number of agent iterations.
