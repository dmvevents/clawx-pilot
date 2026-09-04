# Integration Proposal: External Plugin/Graph Tooling (2026-09-03)

Research + integration design only. No code was modified and nothing was installed to
produce this memo. Recommendations below are proposals for the owner to accept, pilot,
or decline.

## Verification method

All three repositories were checked two ways: WebFetch against the GitHub repo page/README,
and the authoritative GitHub REST API (`gh api repos/<owner>/<repo>`) for language, license,
star/fork counts, and last-push timestamps. Where the two disagreed, the API value wins and
the discrepancy is flagged. The web was reachable; no fetch failed and no URL 404'd.

**Not verified:** none of the three tools was cloned or run, so every install/invoke step and
feature list is as the project documents it, not as executed here. Slash-command and tool lists
for codex-plugin-cc came from the rendered repo page, not a line-by-line read of source.

| Repo | Language | License (API) | Stars | Forks | Last push | Notes |
|---|---|---|---|---|---|---|
| openai/codex-plugin-cc | JavaScript | Apache-2.0 | 32,741 | 2,272 | 2026-07-08 | Official OpenAI; ~2 months stale |
| Graphify-Labs/graphify | Python | Apache-2.0 | 114,502 | 11,123 | 2026-08-30 | README claims dual MIT+Apache — MIT unconfirmed; very active |
| tirth8205/code-review-graph | Python | MIT | 31,165 | 2,838 | 2026-08-27 | Active; homepage code-review-graph.com |

---

## 0. Framing: what "integrate" can and cannot mean here

ClawX ships to non-technical primary-school principals as a locked-down Electron app. Two
hard facts bound every option below:

1. **The shipped runtime has no MCP host.** A grep across `electron/`, `extensions/`, and
   `resources/` for any MCP server/client wiring returns nothing; the OpenClaw gateway exposes
   its own `registerTool()` plugin interface (`extensions/moe-principal-assistant/index.mjs`),
   not Model Context Protocol. None of these three tools can become a principal-facing feature
   without first building an MCP host into the gateway — a large, out-of-scope lift.
   **All three are therefore developer/agent tooling, not product features.**
2. **The pilot repo `dmvevents/clawx-pilot` is public (CLWX-18).** Nothing committed may embed
   a key or phone home by default. Any cloud-model backend in these tools must be pinned off or
   pointed at a local model in committed config.

"Make it universal" is therefore read as: *make the dev-time tooling work identically across all
the agent surfaces we already maintain* — `.agents/skills` + `.codex/agents`/`.codex/skills`
(Codex), `.claude/skills` + `.claude/agents` (Claude Code), and `windows-pilot/` — not as
shipping anything to principals. That is exactly the philosophy `docs/AGENT_SKILL_INTEROPERABILITY.md`
already encodes.

---

## 1. openai/codex-plugin-cc

**(a) What it is (verified).** JavaScript, Apache-2.0, 32,741 stars, created 2026-03-30,
last push 2026-07-08 (~2 months stale as of today). API description, verbatim:
*"Use Codex from Claude Code to review code or delegate tasks."* It is a **Claude Code plugin**
(installed via `/plugin marketplace add openai/codex-plugin-cc` then
`/plugin install codex@openai-codex`) that wraps the developer's **locally installed `codex` CLI /
Codex app server** and exposes slash commands: `/codex:review`, `/codex:adversarial-review`,
`/codex:rescue` (delegation subagent), `/codex:transfer` (converts a Claude session into a
resumable Codex thread), plus `/codex:status|result|cancel|setup`. It reuses Codex's own local
install, auth, and repo checkout — no separate runtime. Requires Node 18.18+ and a ChatGPT
subscription or OpenAI API key held locally by the developer.

**(b) Fit / value.** High, but strictly at dev time. It is a one-directional bridge
(Claude Code -> Codex) and it plugs a real gap: our operating rules require authoring and review
to be *separate passes* and that we *never self-approve in the same context*. A
`/codex:adversarial-review` from a different vendor's model is the most literal implementation of
that rule. It complements our existing dual-surface mirroring — we already define Codex agents in
`.codex/agents/`; this closes the Claude->Codex delegation leg from the Claude side.

**(c) Integration path (respects conventions).** Not a repo artifact — it installs at the Claude
Code plugin layer per developer, using each developer's own local Codex auth. Integration =
documentation, not committed code:
- Add an "Optional dev-time cross-agent tooling" subsection to `docs/AGENT_SKILL_INTEROPERABILITY.md`
  plus a routing note ("for an independent second-opinion review, delegate to Codex via
  `/codex:adversarial-review`").
- Optionally add a mirrored, keyless SKILL stub in `.claude/skills/` and `.agents/skills/` pointing
  at the plugin. No secrets, no config with tokens.

**(d) Risks.** License clean (Apache-2.0). It **phones home to OpenAI** by design (Codex runs
against OpenAI) — acceptable only because auth is the developer's own local credential, never
committed. Public-repo safe as long as no keys are committed. Maintenance: official OpenAI and
high-star, but ~2 months since last push; treat as opt-in, pin nothing. Cannot be release
evidence (never touches the installed Electron path, per the interop doc's safety invariant).

**(e) Recommendation.** **Adopt now as opt-in dev tooling.** Document it; do not hard-wire it or
commit any credential. It cannot be made truly "universal" (Claude->Codex-specific) and does not
need to be — it fills the one missing delegation leg.

---

## 2. Graphify-Labs/graphify

**(a) What it is (verified).** Python 3.10+, license Apache-2.0 per API (README claims dual
MIT+Apache — MIT unconfirmed), 114,502 stars, homepage graphify.com, created 2026-04-03,
last push 2026-08-30 (very active). API description, verbatim: *"Turn any codebase, with its docs,
SQL schemas, configs, and PDFs, into a queryable knowledge graph. A /graphify skill for Claude
Code, Cursor, Codex, and Gemini CLI: local deterministic AST parsing, every edge explained, no
vector store."* PyPI package is `graphifyy` (double-y); CLI is `graphify`. Parses **code** locally
and deterministically via tree-sitter (no LLM); **docs/PDFs/images/video** use a model for semantic
extraction, with every edge tagged `EXTRACTED` or `INFERRED`. Interfaces: CLI
(`extract`/`query`/`path`/`explain`), a `/graphify` **AI-assistant skill across 20+ platforms**, an
**MCP server** (`python -m graphify.serve`, stdio or HTTP), and an importable Python library.
Optional backends: Ollama (local), OpenAI, Gemini, Anthropic, Bedrock, Azure. Heavy optional
footprint (37+ tree-sitter grammars, Leiden community detection, faster-whisper/yt-dlp for media).

**(b) Fit / value.** Genuine dev-time value. Our repo is large and doc-heavy (the finish-sprint
tree, `WINDOWS_PROBLEMS_ATLAS`, dozens of skills/agents); a queryable graph over code + docs would
help agents locate the right file/skill instead of re-reading the tree. Critically, **it is already
"universal" by construction** — one skill that installs across Claude Code, Codex, Cursor, and
Gemini CLI — which is precisely the owner's stated intent. `python3`, `uv`, and `pipx` are all
present on the dev Mac, so it installs in an isolated tool env without touching our pnpm/Electron
dependency graph.

**(c) Integration path (respects conventions).** Dev-time, isolated, local-config-only:
- Install via `uv tool install graphifyy` on developer machines (isolated; not a repo dependency —
  so `dependency-class-auditor` never sees it and it never enters the asar).
- Run `graphify install` to register the skill, then commit **thin, keyless** SKILL.md stubs mirrored
  into `.claude/skills/graphify/`, `.agents/skills/graphify/`, and (if the OMX layer needs it)
  `.codex/skills/graphify/`, following the interop doc's "Adding or updating a skill" checklist, and
  add a Canonical Skill Map row.
- **Committed config must pin extraction to code-only or a local Ollama backend**, and exclude
  sensitive pilot docs from ingestion. If its MCP server is wanted, register it at the *dev* MCP layer
  only (a git-committed, keyless local-command `.mcp.json`) — never in the shipped gateway.

**(d) Risks.** The real risk is **phone-home on non-code extraction**: docs/PDF/image ingestion uses
a model, so a cloud backend would send pilot doc contents off-box — unacceptable for a public repo
with pilot material (even though it holds no secrets). Mitigation: code-only mode or local Ollama,
enforced in committed config. Large dependency surface, but isolated via `uv`. Very high churn
(active `v8` branch). License Apache-2.0 is fine; README's MIT claim is unverified. Not release
evidence (dev path only).

**(e) Recommendation.** **Pilot as dev tooling, behind a local-only/code-only configuration.** Prove
it helps navigation on our own repo for a sprint before mirroring stubs into all four surfaces. If it
earns its place, it becomes the reference implementation of our "universal dev skill" pattern.

---

## 3. tirth8205/code-review-graph

**(a) What it is (verified).** Python 3.10+, MIT, 31,165 stars, homepage code-review-graph.com,
created 2026-02-26, last push 2026-08-27 (active). API description, verbatim: *"Local-first code
intelligence graph for MCP and CLI. Builds a persistent map of your codebase so AI coding tools read
only what matters, with benchmarked context reductions on reviews and large-repo workflows."* PyPI
`code-review-graph`; CLI `code-review-graph` (`install`/`build`/`update`/`watch`/`serve`/`visualize`/
`eval`). Interfaces: **MCP server** ("30 MCP tools" + 5 prompt workflow templates such as
`review_changes`, `architecture_map`), slash commands, a **GitHub Action** (composite, risk-scored PR
review comments in CI), and a `crg-daemon` for multi-repo watching. Storage is **tree-sitter + SQLite**,
fully local; embeddings and cloud providers are optional/opt-in. Computes change "blast radius."

**(b) Fit / value.** Dev-time only, and it **overlaps Graphify heavily** — both are tree-sitter
code-graph tools that reduce review context. Its differentiators are review/CI orientation:
blast-radius, PR risk scoring, and a GitHub Action. Its best trait for our constraints is posture:
MIT (most permissive of the three) and **fully local by default** (SQLite, embeddings opt-in), the
cleanest phone-home story of the graph tools. But we do not currently run automated PR review CI on
the pilot repo, and running two code-graph tools is redundant maintenance.

**(c) Integration path (if adopted).** Same shape as Graphify: `pip/uvx/pipx install
code-review-graph`, `code-review-graph install`, mirror keyless SKILL stubs across the four surfaces,
register its MCP server only at the dev layer. Its unique lever is the **GitHub Action** — a CI
workflow posting risk-scored review comments on PRs — which would live in `.github/workflows/` and run
keyless (local embeddings).

**(d) Risks.** License friendliest (MIT). Local-first means the smallest phone-home surface *if* cloud
embeddings stay off. Main risks are **redundancy with Graphify** (two overlapping tools to maintain and
align across four surfaces) and CI maintenance if the Action is wired. High churn (version `crg 2.3.x`).
Not release evidence.

**(e) Recommendation.** **Decline for now / defer.** Do not run two tree-sitter code-graph tools. If a
code-graph is wanted, choose exactly one: **Graphify** for broad code+docs comprehension and its
ready-made multi-surface skill, or **code-review-graph** *instead* if CI-side PR risk review (the
Action) is the actual goal and MIT + fully-local is the deciding factor.

---

## 4. Cross-cut: the single "universal adapter" design

We do not need a new abstraction — our four surfaces plus `docs/AGENT_SKILL_INTEROPERABILITY.md`
already *are* the universal layer. The universal pattern for any external cross-agent dev tool is three
tiers, chosen by what the tool exposes:

1. **Vendor-specific plugin (codex-plugin-cc):** cannot be made cross-agent; document it as optional in
   the interop doc, install per-developer via marketplace, add a routing note. No repo artifact, no keys.
2. **Self-installing multi-surface skill (graphify's `/graphify`):** run the tool's own installer once,
   then commit thin, keyless SKILL.md stubs mirrored into `.claude/skills/`, `.agents/skills/`, and
   `.codex/skills/` per the interop doc's checklist, and add a Canonical Skill Map row. Closest fit to
   "make it universal."
3. **MCP server (graphify and code-review-graph both offer one):** the truest universal path — one server,
   many agents — registered **only at the dev layer** in a single git-committed, **keyless, local-command**
   `.mcp.json` (Claude Code / project scope) and the equivalent `.codex/config.toml` entry for Codex.
   **Never in the shipped gateway**, which has no MCP host.

If any of these is adopted, capture it in **one place**: a new "Optional dev-time cross-agent tooling"
section in `docs/AGENT_SKILL_INTEROPERABILITY.md` (its Canonical Skill/Agent Maps are the existing source
of truth), backed by a keyless dev `.mcp.json` for the MCP-capable tools. That is the whole adapter: MCP
for the graph tools, a documented marketplace-plugin note for Codex, all governed by the interop doc's
shared safety invariants.

**Cross-cutting risks:** (i) public repo — every committed config must be keyless and every model-using
tool pinned local/off; (ii) none of these may enter the Electron asar (no MCP host, would bloat the bundle,
and `dependency-class-auditor` treats Python deps as foreign) — they live entirely outside the shipped
artifact; (iii) none can serve as GA release evidence, since the interop doc requires feature proof through
the installed Electron path; (iv) three external tools is three upgrade surfaces — codex-plugin-cc is
official but ~2 months stale, the two graph tools are high-churn.

**Net recommendation:** adopt codex-plugin-cc now (documented, opt-in); pilot Graphify as the one
code-graph tool (local/code-only); decline code-review-graph as redundant unless CI PR-risk review is
specifically wanted, in which case it replaces Graphify rather than joining it.
