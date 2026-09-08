# Repository Guide

Last updated: 2026-09-08.

This guide is a navigation map for agents and reviewers working in the ClawX / Ministry of Education repo. It is not a release-status document. Current candidate, validation and board truth stay in [COMPLETION_PLAN.md](COMPLETION_PLAN.md), [CURRENT_WINDOWS_RC.md](CURRENT_WINDOWS_RC.md), [GA_RELEASE_EVIDENCE_MANIFEST.md](GA_RELEASE_EVIDENCE_MANIFEST.md), and [plane-board/CLWX-board-export.json](plane-board/CLWX-board-export.json).

## Startup path

1. Read [PROJECT_CONTRACT.md](PROJECT_CONTRACT.md) for product, safety and ownership rules.
2. Read [COMPLETION_PLAN.md](COMPLETION_PLAN.md) for the current outcome and evidence before project work.
3. Inspect `git status --short --branch` before editing. This repo commonly has concurrent root-owned documentation and release evidence edits.
4. Load the smallest matching skill from `.agents/skills`, `.codex/skills`, or `.claude/skills`; [AGENT_SKILL_INTEROPERABILITY.md](AGENT_SKILL_INTEROPERABILITY.md) maps those surfaces.
5. For source work, use the assigned clean worktree or branch. The root repo is where current docs, board snapshots and handoff evidence live; release candidates may be prepared from isolated worktrees under `/private/tmp/`.

## Main source areas

| Area | Purpose | Primary contracts / tests |
|---|---|---|
| `src/pages`, `src/components`, `src/stores`, `src/lib` | Renderer UI, chat state, Host API/client entrypoints and user-visible flows. | Renderer-to-main calls go through `src/lib/host-api.ts` and `src/lib/api-client.ts`; UI behavior belongs in unit/Electron E2E tests under `tests/`. |
| `electron/api`, `electron/gateway`, `electron/main`, `electron/utils` | Main-process API, Gateway transport, provider/runtime configuration, state writers and run lifecycle. | Backend communication changes start with a `harness/specs/tasks/` spec referencing `gateway-backend-communication`; use focused unit tests plus harness validation. |
| `electron/services/outlook-browser-v2`, `electron/services/forms-browser-v2` | Microsoft browser automation over the signed-in user Chrome profile. | Tenant proof must use `profile=user`; no managed Chromium final proof. Send/submit/download gates require explicit authorization. |
| `extensions/moe-principal-assistant` | Ministry domain plugin, document/form/email/reminder tools, policy and schemas. | Read `extensions/moe-principal-assistant/AGENTS.md` before edits. Verify with focused extension tests and relevant harness tasks. |
| `extensions/microsoft-graph` | Microsoft Graph extension surface and auth-adjacent integration. | Keep credentials out of source/logs. Missing tenant registration should surface as a graceful blocked state, not a crash. |
| `resources`, `scripts`, `windows-pilot` | Shipped runtime assets, build helpers, installer probes, Windows pilot scripts and laptop/VM operational helpers. | Package all runtime imports; Windows proof must use installed artifacts, not dev-tree substitutes. Read `windows-pilot/AGENTS.md` before pilot script work. |
| `services/model-broker`, `services/litellm-gateway` | Optional external broker/gateway services used by diagnostic deployment lanes. | Keep service credentials server-side. Verify package closure, auth, streaming, timeout and route boundaries with focused service tests. |
| `harness`, `eval`, `tests` | Task specs, evaluation fixtures, unit/E2E/integration checks and release-regression evidence. | Tests must assert observable behavior, typed failures and action gates; avoid tests that only mirror wording. |

## Documentation and evidence areas

End-user instructions: [Connect your email and forms](USER_GUIDE.md). This guide uses each person's own Microsoft account; test-account setup belongs in the operator runbooks.

| Area | Purpose | Notes |
|---|---|---|
| `docs/PROJECT_CONTRACT.md` | Stable cross-agent product and safety contract. | Update only for durable rules that should survive sessions. |
| `docs/COMPLETION_PLAN.md`, `docs/CURRENT_WINDOWS_RC.md`, `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` | Current outcome, candidate pointer and release evidence. | Root owns these during release execution. Do not create competing current-status docs. |
| `docs/plane-board` | Local snapshots of Plane board state. | Board **Ready** requires evidence; humans close **Done**. Do not edit for private scratch notes. |
| `docs/bugs` | Reproducible defect reports and the shared handoff template. | Every discovered bug needs a deduplicated Plane card, evidence, cause confidence, verification status and next action. |
| `docs/build`, `docs/testing`, `docs/evidence`, `docs/research`, `docs/release-manifests` | Maintained runbooks, local/VM testing docs, receipts, research ledgers and release manifests. | Add dated, source-backed evidence. Keep private data redacted. |
| `docs/project-history`, `docs/wiki`, legacy dated plans | Searchable history and decision context. | Historical notes are evidence, not current authority. Check current candidate docs before using them. |
| `artifacts/`, `.tmp/`, `.omx/`, `.omc/`, `playwright-report/` | Local/generated diagnostic output. | Treat as private/local unless a task explicitly stages a redacted artifact. Do not commit raw private logs, credentials, full emails or form URLs. |

## Agent and skill surfaces

| Surface | Location | Role |
|---|---|---|
| Codex entrypoint | [../AGENTS.md](../AGENTS.md) | Shared contract pointer and Codex routing. |
| Claude entrypoint | [../CLAUDE.md](../CLAUDE.md) | Shared contract import and Claude routing. |
| Codex official project skills | `../.agents/skills/<skill>/SKILL.md` | Primary project skills exposed to Codex. |
| Codex/OMX compatibility skills | `../.codex/skills/<skill>/SKILL.md` | Local compatibility mirror for skills needed by the current OMX setup. |
| Claude skills | `../.claude/skills/<skill>/SKILL.md` | Claude Code project skills. |
| Codex project agents | `../.codex/agents/*.toml` plus the legacy mirrored `test-lane-prober.md` | Seven native Codex TOML definitions. The legacy Markdown prober is a reference mirror, not a registered native definition. |
| Claude project agents | `../.claude/agents/*.md` | Claude Code project subagents. |

Use [AGENT_SKILL_INTEROPERABILITY.md](AGENT_SKILL_INTEROPERABILITY.md) to choose the matching skill or agent. When a workflow must exist in more than one agent surface, keep the mirror linked there rather than adding another status document.

## Working tree and branch discipline

- Source files stay frozen unless the assigned task explicitly owns them.
- Keep root documentation changes separate from clean release-candidate worktrees. When root gives a candidate SHA or `/private/tmp/...` checkout, bind all source claims to that checkout and SHA.
- Preserve unrelated dirty files. If `git status` shows preexisting edits outside your scope, name them in the report and leave them untouched.
- Commit messages follow the Lore protocol in `AGENTS.md` when committing is authorized.

## Evidence language

Use explicit evidence classes:

- `source/static`: code inspection, typecheck, lint or unit tests in a source checkout.
- `packaged`: installer/archive/provenance/ASAR/EXE verification.
- `installed`: installed app behavior on a Windows account and exact artifact hash.
- `live-account`: authenticated Microsoft tenant flows through user Chrome profile.
- `external-tester`: stakeholder-run evidence, screenshots or logs with dated redacted locator.

A pass in one class does not prove another. If a result comes from the GCP Windows VM, local Mac harness, local UTM guest, physical pilot laptop or stakeholder machine, say which environment produced it.
