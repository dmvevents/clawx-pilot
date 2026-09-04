# Dev-tooling install + smoke — evidence (2026-09-04)

Owner ask: "You're authorized to install the tools and test them... Create a
board for all the plugins and tools we have and cards and OKRs... a card for
testing them on this particular code base... a card for researching and diving
deep and really isolating all the problems we have and how to fix it. Update our
board and get everything rolling."

## What was installed (both tools, this box)

| Tool | Evidence | Scope |
|---|---|---|
| codex-plugin-cc | marketplace `openai-codex` added; plugin `codex@openai-codex` installed (user scope); Codex CLI 0.147.0 at /opt/homebrew/bin/codex, authed (OpenAI key in ~/.codex, NOT the repo). Native `codex review` (--uncommitted/--base/--commit) + `codex exec` confirmed. | dev-layer only; slash commands load next CC session |
| graphify | PyPI `graphifyy` 0.9.53 via pipx pinned to Python 3.11.16 (binaries `graphify`, `graphify-mcp`); skill installed to ~/.claude/skills/graphify/SKILL.md; appended a 3-line pointer to ~/.claude/CLAUDE.md (benign, reversible via `graphify uninstall`). | dev-layer only; skill loads via `/graphify` |

`graphify-out/` + `*.graphify.json` were added to `.gitignore` **before** any run
(public-repo secret guard).

## graphify — key correction vs the first research pass

graphify is **not** a deterministic, no-model tool. The graph BUILD runs via the
`/graphify` skill inside a Claude Code session and uses that session's model to
extract concepts (multimodal — Claude vision for docs/images). The CLI only does
post-processing (`path`/`explain`/`diagnose`/`merge`/`clone`). Consequences:
- Upside: no separate API key, no egress beyond what CC already does.
- Constraint: the model ingests whatever it's pointed at, so the pilot runs it
  **only over code paths** (electron/, src/) and never over docs/ or secret files.

## codex smoke — ABORTED for a secret-safety reason (this is the finding)

Target: `codex review --commit bde78d94` (the +1064-line channel-degrade change).
Codex's review agent does its own repository exploration and **does not honor
`.gitignore`**: it began grep-crawling the entire working tree, including
`build/openclaw/dist/*.js` — the minified gateway bundle. `build/` is gitignored
(absent on a clean clone) but present on any dev box that has built the app.
A local grep confirmed the baked-key pattern `sk-(clawx|ant|proj)` matches files
under `build/openclaw/dist/` (e.g. `provider-auth-token-*.js`). Feeding those to
OpenAI would violate our "no secrets to third parties" rule (CLWX-18: the baked
`sk-clawx` key is already public and un-rotated, but that is not a licence to fan
it out further). **The run was killed before completion.**

### Precondition for a valid codex smoke (goes on the [test] card)
Run `codex review` only where `build/` is absent — a clean checkout / git
worktree, or `rm -rf build/` first — OR configure a codex ignore for `build/`.
Never run it on a dev box with a built bundle present. The [adopt] acceptance
(a captured adversarial-review verdict, ideally on the chrome-cdp fix) is
therefore **still pending** — deliberately, not by failure.

## Board

Created Plane project **TOOL — "Dev Tooling and Plugins — CC/Codex/MCP"**
(id `28f8d593-6937-4880-b323-1ca91304fe55`), 8 cards:
TOOL-1 [OKR], TOOL-2 [adopt codex], TOOL-3 [pilot graphify],
TOOL-4 [decision code-review-graph declined], TOOL-5 [test on this codebase],
TOOL-6 [research: isolate all problems + fixes], TOOL-7 [docs interop layer],
TOOL-8 [inventory existing tools]. Mirrored to `docs/plane-board/TOOL-board.md`
(the export script now derives filenames from the project identifier, so CLWX
and TOOL mirrors coexist without clobbering).
