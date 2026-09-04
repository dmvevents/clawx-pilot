# Dev-tooling integration plan — codex-plugin-cc + graphify (2026-09-03)

Companion to `docs/INTEGRATION_PROPOSAL_PLUGINS_2026-09-03.md` (the evaluation).
This doc is the **how**: phased, with exact file drops, commands to confirm, and
acceptance gates. Owner decision on record: **adopt** `openai/codex-plugin-cc`,
**pilot** `Graphify-Labs/graphify`, **decline** `tirth8205/code-review-graph`.

---

## 0. Non-negotiable invariants (apply to all three)

These come straight from the constraints that already govern this repo. Every
step below is designed to stay inside them.

1. **Dev-layer only.** None of these tools ship. Verified: the packaged gateway
   has **no MCP host** (empty grep across `electron/`, `extensions/`,
   `resources/`), so nothing here can be a principal-facing feature, enter the
   asar, or count as GA release evidence. They accelerate *our* work; they are
   invisible to the principal.
2. **Public repo (CLWX-18).** `dmvevents/clawx-pilot` is public. No committed
   keys, nothing that phones home, and no generated artifact that could embed
   source or doc content (graphify's graph DB especially — see §2.4).
3. **Opt-in per developer.** Local prerequisites (Codex CLI auth, a Python env)
   live on the developer's machine, never in the tree.
4. **No vendoring.** We reference upstream tools by install instruction; we do
   not copy their source into this repo (license hygiene + maintenance).
5. **Review stays a separate lane.** codex-plugin-cc is *for* enforcing this
   rule, not for letting a session approve its own work.

Ground truth on this machine (probed 2026-09-03):
`codex` = `/opt/homebrew/bin/codex` (installed) · `pipx` present · `graphify`
NOT installed · Python 3.14.7 · surfaces `.claude/{agents,skills,commands}`,
`.codex/{agents,skills}`, `.agents/skills` all exist · `docs/AGENT_SKILL_INTEROPERABILITY.md`
exists · **no `.mcp.json` yet** · `.claude/settings.json` + `settings.local.json` exist.

---

## 1. codex-plugin-cc — ADOPT NOW (opt-in dev tooling)

**What it buys us:** a genuinely independent, second-vendor reviewer. It lets a
Claude Code session delegate to the local Codex CLI for review / adversarial
review / task-rescue / session-transfer. That operationalizes our standing rule
*"keep authoring and review as separate passes; never self-approve in the same
active context."* Today that rule is honored by hand; this makes the second lane
a different model family, which is strictly stronger.

**Prerequisite (already met on this box):** Codex CLI installed and authed with
the developer's OWN Codex credentials. Never commit that auth; it lives in the
developer's Codex config, not the repo.

### 1.1 Install (per developer, not committed)
- Add the plugin through Claude Code's plugin mechanism, pointing at the upstream
  repo. **Confirm the exact command against the upstream README** (the research
  pass read the rendered repo page, not a source clone) — it is one of:
  - `claude plugin marketplace add openai/codex-plugin-cc` then
    `claude plugin install <name>`, or
  - a `/plugin` in-session flow.
- Do **not** add the plugin to a committed `.claude/settings.json` if that would
  force it on every clone. If we want it discoverable, record the install command
  in the interop doc (§4) and leave activation to each developer's
  `settings.local.json` (already gitignored-style local file).

### 1.2 Where it lives in our surface model
- It is a **Claude Code plugin** → the `.claude` surface. The `.codex` surface
  already *is* Codex, so "universal" here means documenting the bidirectional
  bridge (CC delegates to Codex; Codex work is reviewable from CC), not creating
  a new artifact on every surface.
- Add one row to the interop doc's surface table (§4) under a new
  **"Dev-tooling layer"** heading.

### 1.3 When to invoke (the workflow rule)
- Before any merge to a release branch, and on any change touching a hard-rule
  path (send gates, channel coherence, chrome-cdp, config writers): run an
  **adversarial Codex review** as the second lane. The Claude session that wrote
  the change must not be the one that approves it.
- Map it explicitly onto the existing reviewer agents (`code-reviewer`,
  `verifier`): Codex becomes a third, cross-vendor opinion for HIGH-severity or
  security-floor changes.

### 1.4 Acceptance gate (adopt is "done" when)
- Run one real adversarial review through the plugin on a live diff — the
  **chrome-cdp fix** that comes out of the RCA (`docs/RCA_CHROME_ATTACH_2026-09-03.md`)
  is the ideal first target. Capture the Codex verdict as evidence under
  `docs/evidence/`. If it catches or corroborates a real issue, adoption is
  proven; document and move on.

---

## 2. graphify — PILOT (dev tooling, pinned local/code-only)

**What it buys us:** deterministic (tree-sitter, no vector store) navigation of
our oversized doc/skill tree. It already ships as one `/graphify` skill across
Claude Code, Codex, Cursor, and Gemini CLI plus an MCP server — it is *already*
the cross-agent "universal" shape, which is why it fits our four-surface model
with the least glue.

**Hard caveat:** its doc/PDF ingestion uses a model. Because the repo is public,
the pilot must be **pinned to local/code-only extraction** — no cloud model, no
ingesting doc content that could leak. Treat license as **Apache-2.0** (the
GitHub API reports Apache only; the README's MIT claim is unconfirmed).

### 2.1 Prerequisite + a real risk to check first
- Install via `pipx` into an isolated env. **Python-version risk:** this box runs
  Python 3.14.7, which tree-sitter / native-wheel packages may not yet support.
  First action of the pilot is to confirm graphify installs and runs on 3.14; if
  not, `pipx install --python python3.12 graphify` (or 3.11) in a pinned env.
  **Confirm the exact package name and CLI from the upstream README** before
  running (not clone-verified yet).

### 2.2 Install (per developer, not committed)
- `pipx install graphify` (name to confirm) → gives the `graphify` CLI + its MCP
  server entrypoint. Nothing about this lands in the repo.

### 2.3 MCP wiring — dev-only, keyless, local command
- Create a **committed** `.mcp.json` at repo root (or `.claude/.mcp.json`) with a
  single **keyless local-command** entry that launches graphify's MCP server
  against this repo. It is safe to commit *only because* it is a local command
  with no secret and it no-ops for anyone who hasn't installed graphify:
  ```jsonc
  {
    "mcpServers": {
      "graphify": {
        "command": "graphify",            // confirm exact subcommand: e.g. "mcp"
        "args": ["mcp", "--code-only"],   // confirm flag name for code-only mode
        "env": {}                          // MUST stay empty — no keys, ever
      }
    }
  }
  ```
- The `--code-only` (or equivalent) flag is **mandatory** — it is what keeps
  model-based doc ingestion off and satisfies the public-repo constraint. If
  graphify cannot disable model ingestion via a flag, the pilot runs it only over
  `electron/` + `src/` code paths and never points it at `docs/`.

### 2.4 Gitignore the graph artifact (public-repo leak guard)
- graphify persists a local graph DB (SQLite/store). Add its output dir to
  `.gitignore` **before first run** so it can never be committed:
  ```
  # graphify dev tooling (never commit the graph store — public repo)
  .graphify/
  *.graphify.db
  ```
  Confirm the actual artifact path from the README and pin the real glob.

### 2.5 Surface mirroring (the "universal" part)
- Add keyless `/graphify` **skill stubs** mirrored across our surfaces, each a
  thin pointer that says "requires local graphify install; see the plan doc":
  `.claude/skills/graphify/SKILL.md`, `.codex/skills/graphify/SKILL.md`,
  `.agents/skills/graphify/SKILL.md`. These are documentation stubs, not vendored
  code — they keep the four surfaces behaviorally aligned per the interop doc.

### 2.6 Acceptance gate (pilot is "keep / drop" when)
- **Egress test (blocking):** run graphify in code-only mode with a network
  monitor; confirm **zero outbound connections**. If it phones home in local
  mode, the pilot stops there.
- **Value test:** index code-only, then run 3 real navigation queries we actually
  need (e.g. "every caller of `writeOpenClawConfig`", "what imports
  `chrome-cdp.ts`", "where is `preferredChannel` read"). If it beats ripgrep +
  LSP on our tree for those, keep it; if not, drop it and say so.

---

## 3. code-review-graph — DECLINED (with a revisit trigger)

Same tree-sitter code-graph category as graphify; running both is redundant. No
integration work now. **Single revisit condition:** if CI-side PR-risk / blast-
radius review becomes a goal, evaluate its GitHub Action *instead of* graphify —
they are alternatives, not additions. Recorded so the decision isn't silently
re-litigated.

---

## 4. The universal adapter (answering "make it universal")

Our four surfaces + `docs/AGENT_SKILL_INTEROPERABILITY.md` **already are** the
universal layer. The adapter is three tiers keyed to what each tool exposes:

| Tier | Tool | Lives on | Committed artifact | Keys? |
|---|---|---|---|---|
| Vendor plugin | codex-plugin-cc | `.claude` (CC), bridges to `.codex` | none — install doc only | dev's own Codex auth, never in repo |
| Multi-surface skill | graphify | all four surfaces | keyless `/graphify` SKILL stubs | none |
| MCP server (dev) | graphify (and code-review-graph if ever adopted) | dev-only `.mcp.json` | keyless local-command entry | none |

**Interop-doc change (docs only):** add a **"Dev-tooling layer (never shipped)"**
section to `AGENT_SKILL_INTEROPERABILITY.md` stating the §0 invariants and the
table above, so any future agent on any surface discovers the same rule: these
are dev accelerators, keyless, out of the asar, never GA evidence.

---

## 5. Sequencing + gates

1. **Docs first (zero risk):** add the Dev-tooling-layer section to the interop
   doc + this plan. No behavior change. Can land immediately.
2. **codex-plugin-cc:** install locally → run one adversarial review on the
   chrome-cdp RCA fix → capture evidence → document. (Prereq already met.)
3. **graphify:** confirm 3.14/3.12 install → egress test (blocking) → code-only
   index → 3 nav queries → keep/drop verdict. Gitignore the store *before* first
   run.
4. **code-review-graph:** no action; revisit only on the CI-PR-risk trigger.

Each step is independently reversible and touches only dev-layer files. Nothing
here gates or blocks the moe.18 / Monday-demo release path.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Public-repo leak via graph store or committed key | Gitignore the store before first run; keyless `.mcp.json` with empty `env`; code-only mode |
| graphify model ingestion on public repo | `--code-only` flag mandatory; if unavailable, restrict to code paths, never `docs/` |
| Python 3.14 incompatibility | Pin graphify to a 3.12/3.11 pipx env |
| License (graphify MIT unconfirmed) | Treat as Apache-2.0 until a source read confirms otherwise |
| Forcing a tool on every clone | Activation via `settings.local.json` per dev; committed files stay keyless no-op stubs |
| Exact commands unverified (no clone/run) | Every command above marked "confirm from upstream README"; verify on first install, correct the doc |
| Codex auth leakage | Codex CLI auth stays in the dev's Codex config; never referenced from the repo |

---

*Status: PLAN drafted, uncommitted, on `fix/doc-tooling-steering`. No tool
installed or configured yet — this is the plan only. Owner: say the word to
execute Phase 1 (docs), Phase 2 (codex-plugin-cc), or the graphify pilot.*
