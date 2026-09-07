# Decision log (ADR-style)

_Last updated: 2026-09-01._

The decisions that shaped the pilot, newest first. Each entry: **context →
decision → status**. This is the "why we do it this way" record; the "how" lives
in the runbooks and the hard-rules table in `CLAUDE.md`.

---

### ADR-013 — Wiki lives in the repo; agile structure lives on the board as labels
- **Context.** Plane's Pages/wiki API returns 404 (not exposed on v1), and project
  Modules/Cycles are disabled (a UI-only toggle; API create returns 400).
- **Decision.** Durable knowledge is versioned markdown under `docs/wiki/`; agile
  structure is expressed with Plane **labels** (`epic/KR1…KR8`, `type/*`,
  `blocked/B0…B4`) until Modules are enabled. Board stays source-of-truth for
  *what to work on*; wiki is source-of-truth for *what we know*.
- **Status.** Adopted 2026-09-01. Labels created and KR/security cards tagged.

### ADR-012 — Public repo distributes releases, not source
- **Context.** `dmvevents/clawx-pilot` is public so a tester can download the
  ~300 MB Windows installer from the Releases tab with no GitHub account — a
  legitimate need. But the repo currently also carries the full source tree and
  a plaintext test credential.
- **Decision (recommended, owner-gated).** Keep releases public; move source to a
  private repo; rotate the leaked test password. See `REPO_AND_RELEASE_MAP.md`.
- **Status.** Recommended, awaiting owner action on all three sub-decisions.

### ADR-011 — Ceiling is "Ready"; a human closes to Done
- **Context.** Agent-driven board updates risk marking work complete without human
  sign-off.
- **Decision.** No agent moves a card to Done. The highest state an agent sets is
  Ready; a human does the final close.
- **Status.** In force.

### ADR-010 — The Section-6 infra reply is owner-gated (B3), not auto-sent
- **Context.** `MINISTRY_REPLY_DRAFT_2026-08-20.md` is the single unlock for the
  Lane-C chain (KR8→KR7→KR6) but is an outward-facing message to a Ministry
  official.
- **Decision.** Hold for owner review; send only on explicit go.
- **Status.** Held. Draft complete (459 lines), resolves the 4 handoff conflicts.

### ADR-009 — Build KR6/KR7 behind a flag against placeholders
- **Context.** All 20 Ministry handoff values (APIM hostname, Entra IDs, redirect
  URI) are placeholders; nothing is probeable until the reply is sent.
- **Decision.** Build and unit-test the identity + per-user-cap logic now behind a
  flag; verify against production only when the real hostname lands.
- **Status.** In force. (memory: "Ministry endpoints unverifiable".)

### ADR-008 — Degrade to on-device when a cloud turn can't reach the provider
- **Context.** Principals on flaky school links lose the assistant entirely when a
  cloud turn fails.
- **Decision.** A cloud turn that cannot reach the provider silently degrades to
  the on-device model so the principal still gets an answer (KR4).
- **Status.** feat landed (commit bde78d94); needs a kill-egress-mid-turn
  acceptance test.

### ADR-007 — Probe before declaring a lane blocked
- **Context.** Two multi-week stalls were self-inflicted (artifact already on disk;
  IAM would have worked on a dry-run).
- **Decision.** Blocker taxonomy B0–B4; only B3 (owner) and B4 (external party)
  are real. Run `test-lane-prober` before reporting any stall.
- **Status.** In force (GA plan §3).

### ADR-006 — On-device default is Hermes 3 8B
- **Context.** 36-prompt bake-off across candidate local models.
- **Decision.** `hermes3:8b` is the on-device default; seed in
  `electron/main/local-provider-seed.ts`; a self-test cron watches for regressions.
- **Status.** In force. (memory: "Local LLM choice".)

### ADR-005 — Four-store channel coherence is non-negotiable
- **Context.** Silent-on-send hit 3+ times when config stores drifted.
- **Decision.** All four stores must agree; all writers delegate to the canonical
  atomic+idempotent writer; `config-coherence-auditor` guards it.
- **Status.** In force (a hard rule in `CLAUDE.md`).

### ADR-004 — Runtime imports must be `dependencies`, never `devDependencies`
- **Context.** moe.9 shipped broken because `playwright-core` was a devDep and
  electron-builder stripped it from the asar.
- **Decision.** Anything imported by `electron/` or `extensions/` is a runtime dep;
  `dependency-class-auditor` guards it.
- **Status.** In force.

### ADR-003 — Rotated-UI selectors need 3+ fallbacks
- **Context.** MS Forms editor automation died in <a week when `data-automation-id`
  values rotated.
- **Decision.** Classify every vendor selector stable vs rotated; rotated ones need
  3+ fallback strategies; prefer the more stable response-page surface.
- **Status.** In force; `dom-selector-regression-tester` guards it.

### ADR-002 — Ride the user's signed-in Chrome (`profile=user`), never managed Chromium
- **Context.** Conditional Access on `@moe.gov.tt` blocks managed sessions
  (`AADSTS53003`); Microsoft revokes cookies in minutes via CAE; basic auth is
  disabled tenant-wide.
- **Decision.** All Microsoft tenant flows ride the principal's already-signed-in
  tab over CDP. The browser session is the only auth carrier.
- **Status.** In force (a hard rule in `CLAUDE.md`).

### ADR-001 — Anonymise model identity; hide cost in the frontend
- **Context.** Principals shouldn't think about model selection or per-turn cost;
  it erodes trust ("why did the AI change?").
- **Decision.** UI shows only "Online" / "On this device"; cost is logged in the
  backend, never shown. English-only locales.
- **Status.** In force (hard rules in `CLAUDE.md`).
