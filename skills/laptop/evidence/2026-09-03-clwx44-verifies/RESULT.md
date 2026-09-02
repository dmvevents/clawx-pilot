# CLWX-44 — verify-or-refute: EXEC-NOISE-LEAK, IDLE-TIMEOUT-RAW, PLAUD-ZERO-MIN

Investigation date: 2026-09-02/03. Branch `fix/doc-tooling-steering`, clean tree.
Evidence-only pass: no source files were modified. All file:line references are
against the current working tree.

## Verdict summary

| Register row | Verdict | One-line basis |
|---|---|---|
| EXEC-NOISE-LEAK | **FIXED-AT-c29ff4dd** (layered: fcba8b86 + 816a0e24 + ef3cf644 + c29ff4dd) | Current renderer structurally cannot put tool frames into assistant bubble text; toolresult messages are never rendered; the exec-completion injection is explicitly filtered and unit-tested. |
| IDLE-TIMEOUT-RAW | **CONFIRMED-STILL-OPEN** | The bde78d94 degrade classifier does NOT cover the idle-timeout error class; the gateway's exact string classifies `other`, so no degrade fires and the raw string still renders verbatim in the error banner. |
| PLAUD-ZERO-MIN | **CANNOT-REPRO-NEED-INPUT** | The ingestion path that produced "0.0 minutes" does not exist in this repo; no fix commit ever landed; the path was superseded by in-app ASR, whose duration reporting is proven non-zero. |

---

## 1. EXEC-NOISE-LEAK — raw `Exec:`/run-python frames in assistant bubbles (Raj, 2026-05-08)

### FACTS

Question asked: does the CURRENT renderer still leak tool frames into assistant bubbles?

Answer: no. Four independent layers block it, each verified in the current tree:

1. **Bubble text extraction only reads `text` blocks.**
   `src/pages/Chat/message-utils.ts:172-210` (`extractText`) and `:212-245`
   (`extractTextSegments`) iterate content blocks and push ONLY
   `block.type === 'text'` (`message-utils.ts:184-190`). `tool_use`,
   `toolCall`, `tool_result`, `toolResult` blocks can never become bubble text.
   Tool calls are extracted separately by `extractToolUse`
   (`message-utils.ts:393-438`) and rendered as structured collapsed cards, not
   text: `src/pages/Chat/ChatMessage.tsx:333-334` (`<ToolCard name= input= />`,
   definition at `ChatMessage.tsx:816-837` — name pill, input only on
   click-expand).

2. **Tool-result-role messages are never rendered.**
   `src/pages/Chat/ChatMessage.tsx:299-300`:
   `// Never render tool result messages in chat UI` / `if (isToolResult) return null;`
   (role check at `ChatMessage.tsx:211`).

3. **History load filters tool frames and internal plumbing before state.**
   `src/stores/chat/history-actions.ts:106`:
   `filteredMessages = messagesWithToolImages.filter((msg) => !isToolResultRole(msg.role) && !isInternalMessage(msg))`.
   `isToolResultRole` at `src/stores/chat.ts:1346-1350`; `isInternalMessage`
   at `src/stores/chat.ts:1352+` (mirrored in `src/stores/chat/helpers.ts`);
   tool-only assistant messages classified by `isToolOnlyMessage`
   (`src/stores/chat.ts:1300-1344`).

4. **The streaming/SSE path filters the same classes.**
   `src/stores/chat/runtime-event-handlers.ts:51` (toolresult roles do not
   replace the streaming message), `:101` (`isInternalMessage` on the final
   message), `:115` (toolresult final messages diverted to artifact
   enrichment, never rendered), `:170` (`isToolOnlyMessage`).

**The exec-specific filter is unit-tested.**
`tests/unit/chat-internal-message-filter.test.ts:5-13` asserts that a runtime
injection bundle containing `"... Exec completed (nimbler, code 0) ..."` plus
the async-completion boilerplate is classified internal
(`isInternalMessage(...) === true`). Vitest run 2026-09-02:

```
pnpm exec vitest run tests/unit/chat-internal-message-filter.test.ts tests/unit/chat-message.test.tsx
Test Files  2 passed (2)
Tests       22 passed (22)
```

**Commits that added the filters** (via `git log -S`, author dates):

| Layer | Commit | Date | Subject |
|---|---|---|---|
| Never-render toolresult messages | `fcba8b86` | 2026-02-11 | fix(chat): improve message handling ... (#50) |
| `isToolOnlyMessage` (tool-only assistant frames hidden) | `816a0e24` | 2026-02-10 | misc: chat stop button and tool typing indicator ... (#37) |
| `isInternalMessage` (hide internal system messages) | `ef3cf644` | 2026-03-30 | fix(chat): hide internal system messages from webchat (#710) |
| Tightened runtime filtering + the Exec-completion test | `c29ff4dd` | 2026-04-22 | fix(chat): tighten runtime internal-message filtering and add targeted tests (#891) |
| NO_REPLY filter in SSE final handler | `ceb537f7` | 2026-04-25 | fix(chat): filter internal messages (NO_REPLY) in SSE final handler (#904) (#915) |

### ANALYSIS

- The register criterion ("no tool-frame markup in any assistant bubble") is
  met by construction in the current tree: bubble text and tool frames travel
  through disjoint extraction paths.
- The single most on-point commit for the "Exec:" complaint is `c29ff4dd`
  (it added the exec-async-completion injection filter and its test), so the
  verdict is recorded as FIXED-AT-c29ff4dd, with the other four commits as the
  supporting layers.
- Residual, intentional surface: the collapsed ToolCard still shows the raw
  tool NAME (e.g. `exec`) in a mono pill (`ChatMessage.tsx:816-837`), and
  expanding it shows raw JSON input. This is designed tool-activity UI, not a
  bubble leak; whether stakeholder demos should suppress even the cards is a
  product call (a `suppressToolCards` mechanism already exists —
  `src/pages/Chat/index.tsx:744,757` — used when an ExecutionGraphCard absorbs
  the run).

### OPEN QUESTIONS

- The complaint date (2026-05-08) POSTDATES the upstream filter commits'
  author dates (Feb–Apr 2026). The fork synced upstream in batches (the #1014-#1016
  batch is dated 2026-05-14, openclaw 5.19 came in `d15e2330` on 2026-05-25),
  so the build Raj used on 05-08 plausibly predated the filters landing in a
  pilot build. Exact build provenance for the 05-08 session is not recoverable
  from this repo alone.

---

## 2. IDLE-TIMEOUT-RAW — raw "model idle timeout" surfaced to the user (2026-05-08)

### FACTS

**The error string's real producer.** The bundled gateway runtime constructs
it at `node_modules/openclaw/dist/selection-D8_ELZa7.js:5719` (source region
marker `src/agents/pi-embedded-runner/run/llm-idle-timeout.ts` at `:5671`):

```js
new Error(`LLM idle timeout (${Math.floor(timeoutMs / 1e3)}s): no response from model`)
```

**The degrade classifier does not recognise it.** `src/lib/channel-degrade.ts`
(added by `bde78d94`) classifies via three pattern lists:
`UNREACHABLE_PATTERNS` (`:78-96`), `RATE_LIMIT_PATTERNS` (`:106-115`),
`NEVER_DEGRADE_PATTERNS` (`:126-141`). Direct evaluation of the exact
gateway string against all three lists (node, patterns copied verbatim):

```
input: "LLM idle timeout (60s): no response from model"
NEVER match: false | RATE match: false | UNREACHABLE match: []
classification: other
```

The only timeout-shaped recognisers are `/\bETIMEDOUT\b/i` (`:81`) and
`/(?:socket|connection) (?:hang up|closed|timeout)/i` (`:90`); neither matches
"idle timeout". Variants tested and all `other`: "model idle timeout",
"idle timeout waiting for model", "LLM idle timeout: no output for 60s".

**Consequence in the store.** `src/stores/chat.ts:1689`
(`maybeDegradeChannel`): `if (classifyFailure(errorMsg) === 'other') return;`
— early return, no degrade, no resend. Call site `chat.ts:3154`.

**The raw string still renders verbatim.** `src/stores/chat.ts:3096-3100`
takes the gateway error string as-is; `:3124-3125` stores it into
`error`/`runError`; `src/pages/Chat/index.tsx:889-897` renders
`{t('runError.title')}` ("Model call failed" — `src/i18n/locales/en/chat.json:2-4`)
followed by the raw `{runError}` string.

**No test covers the class.** `grep -i "timeout\|idle"` over
`tests/unit/channel-degrade.test.ts` and `tests/unit/chat-channel-degrade.test.ts`
returns zero rows. Vitest run 2026-09-02:

```
pnpm exec vitest run tests/unit/channel-degrade.test.ts tests/unit/chat-channel-degrade.test.ts
Test Files  2 passed (2)
Tests       25 passed (25)
```

(green — but green because the class is absent from the suite, not because it
is handled).

**Adjacent commit checked and distinguished:** `e79a4f92` (2026-05-25,
upstream #1064) "hydrate truncated chat history and unstick thinking on LLM
idle timeout" fixed the STUCK-UI aspect (thinking spinner never resolving),
not the raw-error-surface aspect and not degrade.

### ANALYSIS

- Against the register criterion ("stalled provider yields a visible
  on-device answer, never the raw error") the current tree FAILS on both
  halves: no on-device degrade fires, and the raw provider string is shown.
- The miss is arguably within the letter of bde78d94's fail-closed design
  ("unrecognised errors do not degrade"), but an idle timeout on a cloud turn
  is squarely the network/stall class that commit exists for — a dropped link
  mid-stream frequently manifests as exactly this error rather than
  ECONNRESET. Adding an idle-timeout recogniser to `UNREACHABLE_PATTERNS`
  (e.g. `/\bidle timeout\b/i` or `/no response from model/i`) plus one test
  row per direction is the shape of the fix; note the caveat that an idle
  timeout can also mean a live-but-slow provider (LATENCY-UX territory), so
  the resend-vs-surface copy choice deserves an owner look.
- Not fixed here: this pass is evidence-only per the CLWX-44 task scope.

### OPEN QUESTIONS

- Whether the 2026-05-08 sighting used the exact "LLM idle timeout" string or
  older copy: the current runtime's producer is the only one found in the
  bundled gateway; the 05-08 build ran an older openclaw (pre-5.19), so the
  historical wording may differ. Does not change the verdict for the current tree.
- Should idle-timeout degrade also apply when the ON-DEVICE model stalls
  (VM-CPU-STARVE showed on-device stalls are real)? Current design degrades
  only `online -> on-device` (`channel-degrade.ts:194`), so an on-device stall
  will surface raw as well — same class, no destination to degrade to.

---

## 3. PLAUD-ZERO-MIN — recordings indexed at 0.0 minutes (2026-05-19, reported 3x)

### FACTS

**No plaud-adjacent code exists in this repo.** Case-insensitive grep for
`plaud` across `*.ts, *.tsx, *.mjs, *.json, *.md` (node_modules excluded)
matches only documentation and evidence files
(`docs/DEFECT_REGISTER_2026-09-02.md`, `docs/STAKEHOLDER_REPORT_2026-09-02.md`,
`docs/GA_EVIDENCE_PACKET.md`, `docs/plane-board/*`,
`skills/laptop/evidence/2026-09-03-whisper-mac-smoke/RESULT.md`,
`.claude/settings.local.json`) — zero source files.

**No duration computation exists anywhere in the ASR/notes ingestion path.**
`grep -i "duration|minute"` over the full ASR pipeline —
`electron/main/asr-ipc.ts`, `asr-azure.ts`, `asr-azure-ipc.ts`,
`asr-native-mac.ts`, `asr-native-windows.ts`,
`src/components/chat/MicButton.tsx` — yields a single hit, a comment about a
5-minute recording cap (`asr-ipc.ts:441`). Nothing in the tree indexes
recordings with a minutes figure, so nothing in the tree can print
"0.0 minutes".

**No fix commit ever landed.** `git log --all -i --grep=plaud` returns only
`b593399d` (2026-09-02, docs). Pickaxe `git log --all -S "0.0 min"` returns
only the 2026-09-02 docs commits. No ASR-related commit between 2026-05-19
and 2026-06-15 (`f955c293`, `0854d81f`, `b120532b`, `673d439a`, `befeb43f`,
`24863357`) touches recording duration or indexing.

**Where the path actually lived.** The Plaud workflow rides an EXTERNAL
`plaud` MCP server (user-level skill `~/.claude/skills/mcp-plaud/SKILL.md`:
"List, read transcripts of, and search Plaud voice recordings via the plaud
MCP server", fleet MCP infrastructure) — its source is not in this repository
and cannot be audited from here.

**The in-repo capability that superseded it reports non-zero durations.**
`skills/laptop/evidence/2026-09-03-whisper-mac-smoke/RESULT.md` (lines 9-11,
96): whisper reported 2.28 s speech vs 2.39 s WAV — "non-zero, NOT a
PLAUD-ZERO-MIN case".

**The project's own current position matches.** The staged honest-close draft
`~/openclaw-agent/outbound-drafts/closeout-pack-2026-09-02/04-plaud-recordings-status.md`
states: "that ingestion path was never fixed as-was; the capability moved into
the assistant itself, which now does on-device transcription on Windows
(tested live)".

### ANALYSIS

- A 0-duration bug is NOT plausible in the current tree, because the current
  tree contains no code that computes or displays a recording duration during
  ingestion — the failure surface no longer exists here. The defect was in
  (or via) the external plaud MCP pipeline used in Apr-May 2026.
- The register's disposition should move from "OPEN — UNKNOWN ingestion path"
  to "path superseded, promised fix never shipped, external pipeline
  unaudited": product-side there is nothing left to fix in this repo;
  stakeholder-side the dropped-ball closure (CLWX-45 draft 04) is the correct
  vehicle, and it is already staged HOLD.
- Verdict is CANNOT-REPRO-NEED-INPUT rather than FIXED because (a) no commit
  fixed the reported behavior, and (b) confirming or refuting the original
  0.0-minute output requires the external plaud MCP server source or the
  original 05-19 thread artifact, neither of which is in this repo.

### OPEN QUESTIONS

- Where does the plaud MCP server source live (fleet repo?), and does its
  duration field still zero out? Needed only if anyone intends to revive that
  pipeline; the honest-close draft implies no one does.
- Are the Apr 27 - May 7 recordings referenced in the closeout draft still
  retrievable, and is re-ingesting them through the in-app ASR path wanted as
  a demonstration of the superseding capability?

---

## Method / commands log (reproducibility)

- `git show --stat bde78d94`; `git show e79a4f92 -- src | grep -n "idle|timeout"`
- Pattern evaluation: node one-liner with the three `channel-degrade.ts` lists
  copied verbatim, inputs incl. the exact gateway string from
  `node_modules/openclaw/dist/selection-D8_ELZa7.js:5719`.
- `pnpm exec vitest run tests/unit/channel-degrade.test.ts tests/unit/chat-channel-degrade.test.ts` -> 25/25 pass.
- `pnpm exec vitest run tests/unit/chat-internal-message-filter.test.ts tests/unit/chat-message.test.tsx` -> 22/22 pass.
- `git log -S isToolResultRole|isInternalMessage|isToolOnlyMessage --reverse`;
  `git log --follow -- tests/unit/chat-internal-message-filter.test.ts`.
- `grep -ri plaud` (repo, node_modules excluded); `grep -i "duration|minute"`
  over the six ASR-path files; `git log --all -i --grep=plaud`;
  `git log --all -S "0.0 min"`.
