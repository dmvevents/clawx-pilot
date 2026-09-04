# TOOL Plane board — snapshot

Exported 2026-09-04 from `http://localhost:8090` (workspace `issues-agent`, project `Dev Tooling and Plugins — CC/Codex/MCP`).
Restore-grade JSON: [`TOOL-board-export.json`](./TOOL-board-export.json). This markdown is the human-readable mirror; the JSON is authoritative.

> The live board is source of truth for *what to work on*. This file is a
> persisted backup so the plan survives on clone and history is versioned.

## Backlog

### TOOL-4 — [decision] code-review-graph — DECLINED (revisit only on CI PR-risk trigger)

- **State:** Backlog  |  **Priority:** none

Same tree-sitter code-graph category as graphify; running both is redundant. No integration work now.

Single revisit condition: if CI-side PR-risk / blast-radius review becomes a goal, evaluate its GitHub Action instead of graphify — they are alternatives, not additions. Recorded here so the decision is not silently re-litigated.

## Unstarted

### TOOL-5 — [test] Exercise the tooling stack on the ClawX codebase

- **State:** Todo  |  **Priority:** none

Owner-explicit: "create a card for testing them on this particular code base."

Scope:

- graphify: build a code-only graph over electron/ + src/ (NEVER docs/ or secret files); run the 3 nav queries from the [pilot] card; record whether it beats ripgrep+LSP for real navigation on our tree.

- codex: run codex review / the /codex:adversarial-review slash command on a real code diff (ideally the chrome-cdp fix); capture the verdict.

- Measure value honestly: what each tool caught that our existing agents/grep did not, and what it missed. Evidence lands in docs/evidence/.

Guardrails: code paths only; nothing pointed at gitignored secrets; graphify-out/ stays gitignored; Codex diffs contain no secrets (public source only).

Acceptance: an evidence file in docs/evidence/ with the graph queries + Codex verdict + a keep/drop recommendation per tool.

**Comments (1):**

- Precondition carried from the codex smoke (see TOOL-2): the codex leg of this card MUST run on a build-free checkout — Codex crawls the full working tree ignoring .gitignore and will otherwise read build/openclaw/dist/ where the baked key lives. graphify leg: code paths only (electron/, src/), never docs/ or secret files; graphify-out/ stays gitignored.

### TOOL-7 — [docs] Dev-tooling layer section in interop doc + keyless surface stubs

- **State:** Todo  |  **Priority:** none

Make the "universal" part real without shipping anything.

- Add a "Dev-tooling layer (never shipped)" section to docs/AGENT_SKILL_INTEROPERABILITY.md stating the OKR invariants + the 3-tier adapter table (vendor plugin / multi-surface skill / dev MCP server).

- Mirror keyless /graphify skill STUBS (thin pointers, not vendored code) across surfaces: .claude/skills, .codex/skills, .agents/skills — each says "requires local graphify install; see the plan doc."

- If we ever wire a dev-only .mcp.json for graphify-mcp, it must be a keyless local-command entry with empty env; commit only because it no-ops for anyone who hasn't installed graphify.

Acceptance: interop doc updated; stubs present on all surfaces; zero committed keys; graphify-out/ gitignored (already done).

### TOOL-8 — [inventory] Catalog all plugins/tools/agents/skills/MCP we already have

- **State:** Todo  |  **Priority:** none

Owner said "a board for all the plugins and tools we have" — this card captures the EXISTING inventory (not just the 3 new repos) so "all we have" is real, not aspirational.

Enumerate + one-line purpose for each:

- .claude/agents/*.md (project subagents: clawx-config-doctor, config-coherence-auditor, dependency-class-auditor, dom-selector-regression-tester, state-idempotency-auditor, gateway-recovery, production-readiness, ga-e2e-regression-verifier, skill-audit, windows-smoke, moe-product-manager, principal-proxy, ministry-liaison-monitor, test-lane-prober, ...)

- .claude/skills/* and .claude/commands/* (ga-sprint-driver, windows-demo-resume, windows-runtime-recovery, session-log-miner, ...)

- .codex/{agents,skills} and .agents/skills (the mirrored surfaces)

- resources/skills/* (bundled principal toolkit: pdf, xlsx, docx, pptx, whisper, ...) + resources/skills/bundles.json

- Any MCP servers actually wired (note: shipped gateway has NO MCP host — dev-time only).

- The 3 external tools on this board: codex-plugin-cc, graphify, code-review-graph (declined).

Acceptance: a single catalog doc (surface, name, purpose, shipped-or-dev-only) linked from this card; flags any drift between advertised (bundles.json) and installed.

## Started

### TOOL-1 — [OKR] Dev-tooling layer — keyless, cross-surface, never shipped

- **State:** In Progress  |  **Priority:** none

Objective: a keyless, dev-layer, cross-surface tooling stack (Codex review lane + graphify code-graph + our four agent surfaces) that strengthens review and codebase navigation WITHOUT ever touching the shipped product.

Invariants (non-negotiable):

- Dev-layer only — shipped gateway has no MCP host; none of these tools enter the asar, none are principal-facing, none count as GA release evidence.

- Public repo (CLWX-18) — no committed keys, nothing that phones home, no generated artifact that embeds source/secrets. graphify-out/ is gitignored before first run.

- Opt-in per developer — Codex auth + Python env live on the dev's machine, never in the tree.

- No vendoring — reference tools by install instruction; do not copy their source in.

- Review stays a separate lane — Codex is a second/cross-vendor reviewer, not self-approval.

Key results:

- KR1 — codex-plugin-cc adopted; one real adversarial review captured as evidence (target: the chrome-cdp fix diff).

- KR2 — graphify pilot verdict (keep/drop) with an egress check + 3 real navigation queries on THIS codebase.

- KR3 — code-review-graph decision recorded (declined + revisit trigger).

- KR4 — interop doc gains a "Dev-tooling layer (never shipped)" section; keyless /graphify surface stubs mirrored; zero committed keys; graphify-out/ gitignored.

- KR5 — the tooling stack exercised on the ClawX codebase with captured evidence (card [test]).

- KR6 — a consolidated problem to root-cause to fix map produced with the tooling (card [research]).

Plan: docs/PLUGIN_INTEGRATION_PLAN_2026-09-03.md; evaluation: docs/INTEGRATION_PROPOSAL_PLUGINS_2026-09-03.md.

### TOOL-2 — [adopt] codex-plugin-cc — second-vendor adversarial review lane

- **State:** In Progress  |  **Priority:** none

What it buys us: a genuinely independent, second-vendor reviewer. A Claude Code session delegates to the local Codex CLI for review / adversarial-review / rescue / transfer, operationalizing our standing rule "author and review are separate passes; never self-approve in the same context" — now with a different model family.

Installed (evidence, 2026-09-04): marketplace openai-codex added; plugin codex@openai-codex installed at user scope; Codex CLI 0.147.0 present at /opt/homebrew/bin/codex and authed (OpenAI API key in the dev's ~/.codex, NOT the repo). Native subcommands confirmed: codex review (non-interactive, supports --uncommitted / --base / --commit) and codex exec.

Smoke in flight: codex review --commit bde78d94 (the +1064-line channel-degrade change) as a real second-vendor read of hard-rule-adjacent code; output to be captured under docs/evidence/.

Data-flow note: Codex review sends the reviewed diff to OpenAI. Acceptable ONLY on already-public source; NEVER point it at gitignored secret files (baked key CLWX-18, cloud-gateway.key, [REDACTED]).

When to invoke: before any merge to a release branch, and on any change touching a hard-rule path (send gates, channel coherence, chrome-cdp, config writers). The session that wrote the change must not be the one that approves it.

Acceptance (adopt is done when): one real adversarial review through the plugin on the chrome-cdp RCA fix, verdict captured as evidence. Slash commands (/codex:review, /codex:adversarial-review) load next CC session (installed at user scope).

**Comments (1):**

- Smoke result (2026-09-04) — ABORTED for secret safety, and that is the finding: ran codex review --commit bde78d94. Codex's review agent explores the repo itself and does NOT honor .gitignore — it began grep-crawling the whole working tree including build/openclaw/dist/*.js (the minified gateway bundle). build/ is gitignored (absent on a clean clone) but present on any dev box that built the app. Local grep confirmed the baked-key pattern matches files under build/openclaw/dist/ (e.g. provider-auth-token-*.js). Feeding that to OpenAI would breach "no secrets to third parties" (CLWX-18). Run was killed before completion. Precondition for a valid codex smoke: run codex review only where build/ is absent (clean checkout / git worktree, or rm -rf build/ first) OR configure a codex ignore for build/. Never on a dev box with a built bundle present. Evidence: docs/evidence/2026-09-04-tooling-install-smoke.md. Adopt acceptance (a captured verdict on the chrome-cdp fix) remains pending, deliberately.

### TOOL-3 — [pilot] graphify — codebase knowledge-graph skill (keyless, code-only)

- **State:** In Progress  |  **Priority:** none

What it buys us: navigation of our oversized code/doc/skill tree as a knowledge graph (god nodes, community detection, path/explain/diagnose queries), packaged as a cross-surface skill.

Installed (evidence, 2026-09-04): PyPI package graphifyy 0.9.53 via pipx pinned to Python 3.11.16 (binaries: graphify, graphify-mcp); skill installed to ~/.claude/skills/graphify/SKILL.md (user surface, not the repo); graphify-out/ + *.graphify.json added to .gitignore BEFORE any run.

Key correction vs first research: graphify is NOT a deterministic no-model tool. The graph BUILD runs via the /graphify skill inside a Claude Code session and uses THAT session's model to extract concepts (multimodal — Claude vision for docs/images). The CLI itself only does post-processing (path/explain/diagnose/merge). Upside: no separate API key and no egress beyond what CC already does. Constraint: since the model ingests whatever you point it at, the pilot runs it ONLY over code paths (electron/, src/) and NEVER over docs/ or any file that could contain a secret.

Acceptance (keep/drop when): (1) egress check — confirm no outbound beyond the CC session; (2) build a code-only graph on electron/services + src/stores, then run 3 real nav queries ("every caller of writeOpenClawConfig", "what imports chrome-cdp.ts", "where is preferredChannel read") and compare against ripgrep+LSP; (3) verify graphify-out/ never gets committed. Keep if it beats grep+LSP on our tree; drop and say so if not.

### TOOL-6 — [research] Deep-dive — isolate ALL open problems + root-cause + fix path

- **State:** In Progress  |  **Priority:** none

Owner-explicit: "create a card for researching and diving deep and really isolating all the problems we have and how to fix it."

Method (proven exemplar): the same root-cause discipline used for the Chrome-attach RCA — evidence-first, competing hypotheses, adversarial verify, no premature conclusions, "could it be our error?" as a first-class lens. Exemplar: docs/RCA_CHROME_ATTACH_2026-09-03.md.

Scope (broaden beyond chrome-attach to the full defect surface):

- docs/DEFECT_REGISTER_2026-09-02.md (register + deltas)

- docs/KARUNESH_ERROR_LEDGER.md (external tester K1-K14)

- docs/BLOCKER_BUG_COLLECTION_2026-09-03.md (144 mined findings)

- Open CLWX cards: CLWX-73 (chrome attach / profile=user), CLWX-74 (VLM creds email send), CLWX-75 (badge), CLWX-52/53 (trust UI), plus the moe.17 hardening findings (CLWX-94/95/96).

Accelerate with the new tooling: use the graphify code-graph to find blast radius + all callers of a suspect function; use Codex as a second-vendor opinion on each proposed root cause before it's trusted.

Deliverable: a consolidated problem to root-cause to fix map (one row per open problem: symptom, evidence IDs, root cause, is-it-our-error, simplest fix, verification). NO code changes under this card — analysis only, mirrored to a docs artifact.

**Comments (1):**

- Deliverable landed (2026-09-04): docs/PROBLEM_ROOT_CAUSE_FIX_MAP_2026-09-04.md (committed e5431ca7). Analysis only — no source changed, no build//dist/ read, Codex deliberately not used (secret-safety, see TOOL-2). Method: 5-phase RCA workflow — enumerate (parallel readers over the blocker collection, Karunesh ledger, defect register, Plane board) → cluster/dedup → root-cause per cluster → adversarial verify (Claude skeptics prompted to REFUTE) → synthesize. 9 clusters, 51 root-caused problem rows. Headline: the open fleet is overwhelmingly our own code, not the vendor or the environment — 36 ours / 11 mixed / 4 undetermined. Two cards refuted (CLWX-19 "code side clean" is false: we bake AND persist the key; CLWX-91), two attributions corrected (CLWX-79 mixed→ours; K9). Eight fixes judged NOT simple and flagged. Five sharpest findings: - Chrome ≥136 default-user-data-dir CDP refusal (CLWX-73 / K1 / K2) — live GA-blocker for email; Chrome silently refuses --remote-debugging-port on the default profile dir, which is what our launcher uses. Fix keeps profile=user via a user-owned NON-default dir; one open Conditional-Access probe for Raj/VM. - NEW — K8 packaged doc-parser load-path — latent GA-blocker (macOS/relocated Windows installs); doc reads resolve parsers relative to the wrong root. One-line fix: set CLAWX_APP_RESOURCES=process.resourcesPath in forkEnv when packaged. - CLWX-79 demo-mode statutory-field fabrication — data-integrity, live; the plugin reads args.demo and can auto-fill suspension-form fields. Corrected mixed→ours. - CLWX-95 / CLWX-94 / CLWX-96 degrade orphan/replay — resilience GA-blocker; naive null-in-error-handler defeats auto-resend; needs run-ownership token + clear lastSentPayload only after degrade consumes it. - CLWX-19 baked-key refutation — the sk-clawx key is a gitignored resource baked into the installer and persisted plaintext on first boot; rotation alone re-bakes an exposable key, and with auto-update OFF a server-side rotation is a fleet-wide outage requiring per-machine re-key. Ranked fix backlog (section 5) leads: CLWX-51 (2-line blank-New-Chat) → K8 (1-line) → CLWX-79 → Chrome CDP (demo-critical) → CLWX-81(1) → CLWX-70 → CLWX-74 → CLWX-78 residual → CLWX-94 → CLWX-95/96. Residual live-probe unknowns are section 6; excluded process/feature items named in section 7. Coverage caveat (recorded in-doc): the enumerate reader covering DEFECT_REGISTER + BLOCKER_BUG_COLLECTION stalled (6/6 attempts). Those two are covered transitively via the CLWX cards mined from them plus direct source reads during root-cause, but were not independently re-enumerated. A cheap completeness-critic pass (diff the 144 blocker-collection findings against the 51 rows) can close it if certainty is wanted. Status: card moved to In Progress (ceiling — deliverable produced, awaiting human close). Follow-through needing owner go: file the Chrome-CDP fix card + the moe-tenant CA question to Raj; file K8 as a new CLWX card; augment/reopen CLWX-79 with the residual demo-fabrication finding.

