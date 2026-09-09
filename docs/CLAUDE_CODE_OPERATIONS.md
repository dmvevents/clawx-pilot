# Claude Code operation and configuration

Configuration audit: 2026-09-09. Current product state remains in [COMPLETION_PLAN.md](COMPLETION_PLAN.md). This runbook connects the Claude CLI to the existing project contracts, worktrees, Plane and evidence; it is not another release plan.

## Instruction layout

| Surface | What belongs here | This repository |
|---|---|---|
| Root `CLAUDE.md` | Short startup path, durable constraints, command/routing pointers | Imports `docs/PROJECT_CONTRACT.md`; avoids importing the Codex-specific OMX control surface wholesale |
| Scoped `CLAUDE.md` | Directory-specific contract | `windows-pilot/CLAUDE.md` and `extensions/moe-principal-assistant/CLAUDE.md` import their existing `AGENTS.md` |
| `.claude/rules/*.md` | File-path-specific working rules | TypeScript/React, Windows scripts, CLI/CI tooling, documentation/evidence |
| `.claude/skills/*/SKILL.md` | On-demand repeatable workflow | Existing domain skills and `ga-sprint-driver`; load the selected skill, not the whole catalog |
| `.claude/agents/*.md` | Bounded specialist role, tool scope, output contract | Existing build/recovery/acceptance specialists; author and reviewer are separate contexts |
| `.claude/settings.json` | Shared hook and plugin configuration | Quoted WhatsApp Bash guard with a timeout; worktree base `head`; three official plugins |
| Local/user configuration | Machine tools, provider authentication, personal plugins/MCP | Keep secrets and private endpoints out of git; inspect metadata without copying raw configuration |

Claude reads `CLAUDE.md`, not `AGENTS.md` automatically. Path-scoped rules load when matching files are read; workflow skills provide on-demand context. Keep root instructions concise and use imports for shared contracts. These are instruction mechanisms, not hard permission enforcement. [Official memory guidance](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills), [subagents](https://code.claude.com/docs/en/sub-agents).

## Match tools to the actual files

Audit baseline, tracked files before these edits: 550 `.ts`, 81 `.tsx`, 102 `.ps1`, 70 `.mjs`, 15 `.sh`, 11 `.py`, 423 `.md` and 105 `.json`. `src/` owns renderer flows, `electron/` owns Main/runtime, `extensions/` owns domain tools, and `windows-pilot/` owns Windows operations. [Repository map](REPOSITORY_GUIDE.md).

| Files | Selected practice/tool | Required proof |
|---|---|---|
| TypeScript/React | Official `typescript-lsp` for definitions/references/symbols; existing TypeScript, Vitest and ESLint commands | Focused behavior tests, `pnpm typecheck`, `pnpm lint:check`; applicable harness/E2E |
| PowerShell | Existing SSH/IAP skill and copied parameterized scripts; honor Windows PowerShell 5.1 requirements | Parse checks plus actual Windows execution and typed receipt; Mac execution is a different environment |
| Python, shell, Node scripts | Argument arrays, explicit cwd/deadlines, preserved exit status, redacted receipts | Targeted script tests or syntax checks; required runtime behavior separately |
| Markdown, YAML, JSON | Instruction-management plugin, scoped rules, schema/frontmatter/link checks | Parse and consistency checks; evidence claims checked against receipts |
| Product PDF/Office skills/assets | Keep existing shipped OpenClaw skill/package inventory | Installed application acceptance; installing a developer CLI plugin does not upgrade the product |

LSP diagnostics complement the compiler and tests. TypeScript's `noEmit` supports checking without generating output. PowerShell modules can differ across platforms and runtimes. [TypeScript](https://www.typescriptlang.org/tsconfig/noEmit.html), [Microsoft portability guidance](https://learn.microsoft.com/en-us/powershell/scripting/dev-cross-plat/writing-portable-modules), [language-server source](https://github.com/typescript-language-server/typescript-language-server).

## Installed plugin selection

The host inventory contained 149 installed plugins with three enabled: OMC, Claude Mem and the Codex review plugin. This audit adds the following at **project scope**, preserving the existing user configuration:

| Plugin | Purpose | Operation |
|---|---|---|
| `typescript-lsp@claude-plugins-official` | Navigation and diagnostics for the dominant source language | Requires `typescript-language-server` on PATH; verify an actual LSP response |
| `claude-md-management@claude-plugins-official` | Review instruction quality and maintain useful project memory | Invoke for an instruction-maintenance task, not on every turn |
| `claude-code-setup@claude-plugins-official` | Reassess automation against the repository | Invoke when tooling or project needs change |

The official TypeScript plugin carries its LSP configuration in the marketplace entry (`strict: false`); absence of a standalone `.lsp.json` in its cache is not itself a defect. The executable prerequisite was missing. Installed `typescript-language-server@6.0.0` and `typescript@5.9.3` under the operator's `~/.local` prefix; the project compiler dependency was not changed. Node 26.7.0 meets the server's declared Node requirement.

Reproduce on a developer host after checking its runtime versions:

```sh
npm install --global --prefix "$HOME/.local" typescript-language-server@6.0.0 typescript@5.9.3
claude plugin install typescript-lsp@claude-plugins-official --scope project
claude plugin install claude-md-management@claude-plugins-official --scope project
claude plugin install claude-code-setup@claude-plugins-official --scope project
claude plugin list --json
```

Ensure the developer CLI's PATH includes the prefix's `bin` directory. At a safe command boundary, `/reload-plugins` reloads plugin skills, agents, hooks, MCP and LSP components. Verify the actual components after reload. A plugin listing is configuration evidence, not proof that its executable started. [Official plugin guide](https://code.claude.com/docs/en/plugins), [plugin reference](https://code.claude.com/docs/en/plugins-reference).

Keep one orchestration owner: existing OMC plus project workflows. Codex review stays additive as assigned; do not silently multiply review rounds. Existing Claude Mem is supplementary history; it does not supersede current plans or receipts. No memory-plugin upgrade or provider change was made by this audit.

## CLI lanes, direct messaging and supervision

Use normal interactive Claude for the lead and for native cross-session messaging/LSP. Use `scripts/claude-runner.py` for bounded independent author/reviewer jobs with explicit source ownership and deadlines. Its bare lane must explicitly read the project contract and selected skill; `--bare` skips automatic hooks, LSP and CLAUDE.md discovery. The audited bare messaging probe exposed neither native messaging tool; a normal project-scoped CLI exposed both. Do not assume an allowlist creates an unavailable tool. [Programmatic usage](https://code.claude.com/docs/en/headless).

```sh
claude agents --json --cwd "$PWD"
python3 scripts/claude-runner.py run --help
```

The normal lead uses `ListAgents` to resolve the exact named session and `SendMessage` to deliver a concise card/ownership/evidence/next-action message. Require the send receipt and distinguish it from recipient acknowledgement. Keep the normal coordinator session alive when replies or idle notices are required: a one-shot `-p` sender exits and its reply socket disappears. This audit verified delivery and a terminal acknowledgement; the reply to the exited relay failed, as recorded in the receipt. `notify_when_idle` provides one-shot completion notices without repeated polling. Bedrock supports same-machine messaging on the audited CLI; cross-machine Remote Control requires a different authentication path. Do not write inbox socket files or impersonate a peer. [Official cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging).

Native worktrees now default to the current checkout's `HEAD`, preserving in-progress source history. For an exact candidate SHA, use `git worktree add` explicitly. Record SHA, branch, worktree, owner and acceptance criterion. Worktrees separate file edits; VM sessions, ports, credentials and external services still require a single operator. Project plugins are shared across linked worktrees. [Official worktree behavior](https://code.claude.com/docs/en/worktrees).

Monitor process liveness and actual progress separately: heartbeat, last output, deadline, observed model/provider, result event, evidence delta and exact remaining criterion. `CLI_SUCCEEDED` only establishes a successful CLI completion. The active lead's requested Fable model automatically fell back to Opus after a recorded refusal; preserve the event and report the observed model. Never use another agent or model to evade a refusal.

## Continuation and hook policy

`ga-sprint-driver` now continues an authorized outcome through checkpoints. A long operation needs a suitable timeout, durable progress and one owner; it does not need to wait for the next scheduler tick. After an interrupted write, inspect the resulting state before retrying. End only at a verified exit, user hold or concrete blocker after useful independent work is exhausted.

Use `/loop` for polling/watchdog work, not as the sole completion controller. Scheduled work has lifecycle limits and jitter, and runs in the session; record those limits before relying on it for unattended coverage. A goal-driven workflow is a distinct mechanism. This audit does not replace the live lead's scheduler or start another VM controller. [Official scheduling](https://code.claude.com/docs/en/scheduled-tasks), [verification practices](https://code.claude.com/docs/en/best-practices).

The existing project Bash guard now quotes the repository path and has a ten-second timeout. Its tested scope is recognized Bash WhatsApp-send patterns; it is not a universal native-MCP authorization gate. Existing outward-action rules still apply. User hooks were inspected: the SessionStart/Stop gates primarily target another project; they were not disabled. No automatic GUI, build, full-suite or paid-review hook was added.

Use hook stdin `cwd` for active-worktree facts: `CLAUDE_PROJECT_DIR` stays at the launch root. Settings hooks are normally refreshed by the file watcher; use `/hooks` to inspect the effective source. Test hooks with synthetic input and a private temporary ledger. [Hook reference](https://code.claude.com/docs/en/hooks).

## Research and version checkpoint

Official changelog checked September 9: installed CLI moved to 2.1.266 while the existing lead still ran its already-launched 2.1.265 process. The 2.1.266 entry fixes a gateway/proxy authentication regression; 2.1.265 includes resumed-subagent prompt-cache, interrupted-resume and background-session fixes. Record running and installed versions separately; do not restart an active installer operation to chase a patch. [Official changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).

Popular repository sample, GitHub API metadata and primary READMEs checked September 9; stars are a dated discovery signal, not a quality verdict:

| Repository | Stars at audit | Decision for this project |
|---|---:|---|
| [Superpowers](https://github.com/obra/superpowers) | 283,474 | Useful bounded planning, debugging and independent-review patterns; avoid adding a second whole workflow framework |
| [ECC](https://github.com/affaan-m/ECC) | 254,479 | Study modular rules and harness practices; no wholesale configuration import |
| [Anthropic skills](https://github.com/anthropics/skills) | 175,282 | Primary skill examples; select by task and per-skill license |
| [gstack](https://github.com/garrytan/gstack) | 132,172 | Review/QA role separation is relevant; browser ownership and deployment conventions need project-specific adaptation |
| [Claude Mem](https://github.com/thedotmack/claude-mem) | 93,523 | Existing install retained; upstream installation/provider behavior has changed, so no blind upgrade |
| [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code) | 53,724 | Discovery index; verify selected components at their primary source |
| [OMC](https://github.com/Yeachan-Heo/oh-my-claudecode) | 39,062 | Existing orchestration kept; bind work to our Plane acceptance and single VM owner |
| [Official plugins](https://github.com/anthropics/claude-plugins-official) | 36,065 | Selected instruction-maintenance, setup and TypeScript plugins |

## Verify and hand off

Run JSON/frontmatter/link checks, the hook synthetic pass/block cases, and an actual normal-CLI LSP/messaging probe. Check the number of objects each validator inspected: the audited `claude plugin validate .claude` discovered commands but did not enumerate project skills/agents, so that result alone cannot certify their frontmatter. Validate those files explicitly with a YAML parser and check runtime discovery.

Post the meaningful delta on CLWX-128 through the verified Plane writer, verify readback and export the board. Keep runtime/installed GA gaps on the release owner's existing cards. Private audit receipts are under `artifacts/ga-autonomy-audit-20260909/`; the transferable defect record is [CLWX-128 configuration findings](bugs/CLWX-128-claude-session-configuration.md).

Verified audit result: independent Claude review APPROVE; all 49 frontmatter files parse, hook positive/negative controls pass, normal CLI LSP and messaging pass, and the live lead acknowledged plugin reload. [Sanitized validation receipt](evidence/claude-configuration-20260909.json).
