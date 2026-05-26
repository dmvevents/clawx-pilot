# OMX + agentmemory integration plan for Windows Outlook/Forms demo

**Purpose:** give the Windows pilot demo agents a shared, local memory and handoff protocol without changing the ClawX app, OpenClaw runtime, pilot secrets, or source code.

**Scope:** documentation/config/script guidance only. Do not edit `src/`, `electron/`, `extensions/`, packaged releases, or app config for this plan. Do not install global packages. Do not store passwords, email bodies, full recipients, bearer tokens, cookies, or Microsoft session data in memory.

**Demo target:** Outlook + Forms Windows pilot flow described in `windows-pilot/plans/EXECUTION_PLAN_OUTLOOK_FORMS.md`.

---

## Target result

For the principal demo, the leader agent can coordinate native subagents for:

1. Outlook readiness and smoke verification.
2. Forms fill/submit readiness and smoke verification.
3. Gateway/log observation.
4. Final go/no-go synthesis.

Each subagent writes a short, structured handoff note to agentmemory when available, plus a local markdown fallback note when memory is unavailable. OMX team or ultragoal can orchestrate the same lanes if the OMX runtime is available; otherwise the same protocol works with Codex native subagents.

---

## Integration boundaries

Use agentmemory as a coordination and recall layer, not as a secret store or source of truth.

Allowed memory content:

- Current phase, owner, and stop condition.
- Tool names called, pass/fail status, timestamps, and sanitized error summaries.
- File paths for scripts/plans used.
- Redacted command outcomes such as `STATE: OUTLOOK_READY`, `STATE: CDP_UP`, or `forms.preview_suspension filled 31 fields`.
- Decisions and rejected paths that future agents should not rediscover.

Forbidden memory content:

- Any password.
- Email body text, full recipient addresses, cookies, bearer tokens, Graph tokens, browser profile data, or session URLs.
- Raw gateway logs that may contain private content.
- Any live `.openclaw`, Windows credential, Chrome profile, or app config payload.

Local fallback artifacts should follow the same redaction rules.

---

## Start agentmemory locally

Run agentmemory on the Mac development host, not on the Windows pilot laptop, unless a later operator explicitly decides otherwise. Keep the Windows pilot focused on app + Chrome + Outlook/Forms.

From the repo root:

```bash
cd /Users/antonalexander/Github/moe-tt/ClawX

# Start the local REST/MCP memory runtime without installing globally.
# If npx asks to install the package globally, decline for this demo.
npx --yes @agentmemory/agentmemory --tools core
```

Expected local surfaces:

- REST server: `http://localhost:3111`
- Viewer: `http://localhost:3113`
- Optional engine console: `http://localhost:3114` when enabled by the runtime

Keep this terminal open for the demo window. Use a separate terminal for verification and agent work.

### Verify agentmemory health

```bash
# CLI health, memory counts, flags, and viewer URL.
npx --yes @agentmemory/agentmemory status

# Dry-run diagnostics only; do not accept fix prompts during the demo.
npx --yes @agentmemory/agentmemory doctor --dry-run

# Optional port-level proof on macOS.
lsof -nP -iTCP:3111 -sTCP:LISTEN
lsof -nP -iTCP:3113 -sTCP:LISTEN
```

Healthy minimum:

- `status` reports connected to `http://localhost:3111`.
- Health is `healthy`.
- Viewer URL is printed as `http://localhost:3113`.
- No command asks for or prints secrets.

Stop after the demo:

```bash
npx --yes @agentmemory/agentmemory stop
```

### Agent wiring policy

Do not mutate Codex, OpenClaw, Claude, Cursor, or shell config during the principal demo. Use dry-run first:

```bash
npx --yes @agentmemory/agentmemory connect codex --dry-run
npx --yes @agentmemory/agentmemory connect openclaw --dry-run
```

Only run non-dry-run `connect` outside the demo window after reviewing the config diff it would apply.

If the local `npx` cache serves an older package, use the `@latest` form for the next command only, then return to the plain package name for repeatable demo commands.

If a client needs a standalone MCP process instead of the native hooks:

```bash
AGENTMEMORY_URL=http://localhost:3111 npx --yes @agentmemory/agentmemory mcp
```

Use that command as an MCP server entry only after dry-running or reviewing the target client config. For this demo, prefer direct native subagent instructions plus manual memory writes over changing client configuration.

---

## Native subagent handoff protocol

Every subagent receives a bounded task, runs only its lane, then emits one handoff note. The leader owns synthesis and final go/no-go.

### Required handoff fields

Use this exact structure for agentmemory notes and markdown fallback notes:

```markdown
# Handoff: <lane> — <PASS|WARN|FAIL|BLOCKED>

- Project: ClawX Windows pilot Outlook/Forms demo
- Lane: <outlook|forms|gateway-logs|go-no-go|config-audit>
- Actor: <subagent name>
- Timestamp AST: <YYYY-MM-DD HH:mm>
- Scope: <one sentence>
- Inputs read: <sanitized file paths only>
- Commands run: <sanitized commands or script names only>
- Evidence: <short pass/fail facts, no private content>
- Decision: <what this means for the demo>
- Blockers: <none or specific blocker>
- Next owner: <leader|human|dev session|named lane>
- Next action: <single concrete action>
- Safety notes: <redactions applied; secrets not stored>
```

### Preferred memory write

If agentmemory MCP tools are available to the subagent, write one memory with:

- Type/category: `handoff`
- Project/scope: `ClawX/windows-pilot/outlook-forms-demo`
- Tags: `windows-pilot`, `outlook`, `forms`, plus the lane name
- Content: the required handoff fields above

If the MCP tool exposes a confidence or importance field, use:

- `confidence: high` for observed command output.
- `confidence: medium` for inference.
- `importance: high` only for go/no-go decisions, blockers, and safety constraints.

### Local fallback note

If agentmemory is down or unavailable, create a markdown handoff under:

```text
windows-pilot/plans/handoffs/
```

Filename format:

```text
YYYYMMDD-HHMM-<lane>-<status>.md
```

Example:

```text
windows-pilot/plans/handoffs/20260526-1515-outlook-pass.md
```

The fallback directory is documentation-only and can be committed if useful. It must still exclude secrets and raw private content.

---

## Subagent lane assignments

### Leader: windows-demo-conductor

Inputs:

- `windows-pilot/agents/windows-demo-conductor.md`
- `windows-pilot/plans/EXECUTION_PLAN_OUTLOOK_FORMS.md`
- Latest subagent handoff notes

Responsibilities:

- Start by recalling recent `windows-pilot` handoffs from agentmemory.
- Delegate Outlook lane first.
- Delegate Forms lane second unless Outlook reports a demo-critical blocker.
- Request one gateway-log observer only during smoke/demo execution.
- Produce final `GO`, `GO-WITH-FALLBACK`, or `NO-GO`.

### Outlook lane

Subagent spec:

- `windows-pilot/agents/outlook-verify.md`

Write one handoff after:

- CDP state is verified.
- Outlook login readiness is verified.
- Smoke result is known or blocked.

Evidence should use states/tool names only, for example:

- `pilot-verify-outlook-tab.ps1 -> STATE: OUTLOOK_READY`
- `outlook.read_inbox PASS`
- `outlook.send_email gate PASS`

Do not store message bodies, full subjects if sensitive, recipient addresses, or screenshots containing private content.

### Forms lane

Subagent spec:

- `windows-pilot/agents/forms-fill-verify.md`

Write one handoff after:

- Form page is open.
- Preview fill result is known.
- Submit result is known or intentionally not run.

Evidence should be numeric/sanitized:

- `forms.preview_suspension PASS, 31/32 fields populated`
- `forms.submit_suspension PASS, Thanks page reached`

Do not store student names, parent names, phone numbers, email text, or raw extracted suspension details.

### Gateway/log observer lane

Use only during smoke and demo execution.

Allowed output:

- Tool name.
- Timestamp.
- PASS/WARN/FAIL.
- Redacted error class.

Forbidden output:

- Raw prompt text.
- Raw tool arguments if they include email or student data.
- Raw response content.

---

## OMX team usage if available

Use OMX team mode only when the runtime is available and the coordination overhead is worth it. The demo has three clean lanes, so team mode is useful for T-45 readiness checks but unnecessary for a single smoke.

Suggested team composition:

- Leader: `windows-demo-conductor`
- Worker 1: Outlook verification
- Worker 2: Forms verification
- Worker 3: Gateway/log observer
- Optional verifier: go/no-go evidence review

Team flow:

1. `team-plan`: confirm lanes, stop conditions, redaction policy, and source freeze.
2. `team-exec`: run Outlook and Forms checks in bounded lanes; gateway observer tails sanitized status.
3. `team-verify`: compare handoff notes to decision rules in `windows-demo-conductor.md`.
4. `team-fix`: only documentation/script adjustments; no app source changes.
5. Finish with a single leader go/no-go note saved to agentmemory and, if needed, `windows-pilot/plans/handoffs/`.

Do not use team mode to restart app processes, change Windows app config, alter provider keys, or patch app code during the demo window.

---

## OMX ultragoal usage if available

Use ultragoal when the work spans multiple durable objectives across sessions, not for a one-off smoke. Good ultragoal scope:

```text
Goal: Make Windows pilot demo coordination reproducible with agentmemory-backed handoffs.
```

Suggested milestones:

1. Memory runtime boots locally and passes `status`.
2. Native subagent handoff template is accepted and used by Outlook lane.
3. Forms lane writes a sanitized handoff.
4. Leader produces a go/no-go artifact from retrieved handoffs.
5. Post-demo notes are consolidated into a durable plan update.

Ultragoal stop condition:

- A future agent can start from this plan, run agentmemory locally, retrieve recent handoffs, and produce the same go/no-go decision without reading raw private demo data.

Do not let ultragoal broaden into source fixes, provider setup, global installs, or Windows credential work.

---

## Validation checklist

Before declaring this integration ready:

```bash
# Documentation artifact exists.
test -f windows-pilot/plans/OMX_AGENTMEMORY_INTEGRATION_PLAN_2026-05-26.md

# No app source files changed by this plan.
git diff -- src electron extensions package.json pnpm-lock.yaml

# Local agentmemory CLI metadata and health.
npm view @agentmemory/agentmemory name version bin --json
npx --yes @agentmemory/agentmemory --help
npx --yes @agentmemory/agentmemory status
```

Expected result:

- Only this markdown plan changes.
- `agentmemory` CLI resolves without global install.
- `status` reports a healthy local server at `http://localhost:3111`.
- Any existing unrelated working-tree changes remain untouched.

---

## Open decisions after the demo

- Whether to permanently wire Codex with `agentmemory connect codex` after reviewing the dry-run diff.
- Whether OpenClaw should use agentmemory directly for agent runtime continuity, or whether memory should remain a Codex/OMX coordination layer only.
- Whether sanitized handoff markdown files should be committed, ignored, or treated as local run artifacts.
