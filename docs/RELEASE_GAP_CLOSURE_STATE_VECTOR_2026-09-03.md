# Release gap-closure state vector — moe.18 all-green candidate (2026-09-03)

**Objective (owner, verbatim intent):** get Karunesh a release that *works* and
*patches all the previous tests we failed at, all green* — email send + read,
document reader, and the rest. Not a partial send.

**Decision this session:** moe.17's VM verify agent **died mid-run** (all six
checks left PENDING, no evidence writes for 20+ min, task no longer exists), so
its PDF/degrade fixes were never VM-proven. moe.17 is therefore **obsolete as a
candidate**. Target is **moe.18**, built with every open Karunesh-matrix gap
closed, then verified in ONE full-matrix VM pass. The VM is free.

---

## 1. The truth table — Karunesh's failed tests → gap → status → lane

| His test (K#) | Defect | Fixed in tree? | VM-proven? | Lane |
|---|---|---|---|---|
| K10 PDF read | CLWX-92 (pdfjs workerSrc under Electron UtilityProcess) | ✅ yes | ❌ **FAILED live moe.16**; re-verify | Verify |
| K13 cloud turn silently dies | CLWX-78 (silent-death degrade from history poll → on-device) | ✅ yes | ❌ **FAILED live ×2 on moe.16**; re-verify | Verify |
| K13 **on-device dead / no failover** (the real report) | prompt-to-switch: dead local model surfaces an actionable "switch to Online" notice instead of raw errors (`shouldPromptSwitchToOnline`) | ✅ **yes** (0925528e) | ❌ pending | **A2 ✅ landed** |
| K11 **email send** chain | CLWX-74 (VLM-creds dead-end) | ❌ **OPEN** | — | **A** |
| K11 email litter / recovery | CLWX-70 (litter sweep) + CLWX-58 (compose recovery) | ✅ yes | partial | Verify |
| K1 chrome attach on fresh box | CLWX-73 (managed-profile fallback = profile=user violation) | ❌ **OPEN** | — | **A** |
| K12 red "Disconnected" badge | CLWX-75 (badge disagrees with gateway/turn state) | ❌ **OPEN** | — | **B** |
| trust: raw model id in composer | CLWX-52 (anonymise → Online/On-device) | ❌ **OPEN** | — | **B** |
| trust: raw HTTP 400 wording | CLWX-53 (plain-language error) | ❌ **OPEN** | — | **B** |
| K14 5-prompt matrix (c = PDF) | covered by CLWX-92 | ✅ via K10 | ❌ not yet | Verify |

**The critical finding:** moe.17 greens only K10 + K13-cloud-path, and even those
**failed live on moe.16** (PDF drag failed; degrade stayed Online, no on-device
attempt, ×2) — so they are fix-pending-verification, not proven. Sending moe.17
as-is means Karunesh re-hits **email send (K11 / CLWX-74)**, the **badge (K12 /
CLWX-75)**, and the trust-UI defects — tests he already reported. Hence moe.18.

**Newly confirmed by the retest audit, then closed (this is the sharp one):**
Karunesh's K13 report was *on-device* (ollama) dying with 6× raw "Connection
error." and **no failover**. The only degrade path in code was cloud→on-device
(`maybeDegradeChannel`; `shouldDegradeToOnDevice` cannot fire when already
on-device), so his actual failure had **no recovery path in tree**. Lane A2
(commit 0925528e) closes it — but *not* as a mirror of the cloud path. An
on-device→cloud move sends device data off-box, so it must never be a silent
send. Design decision made during the fix: the `activeChannel` derivation only
resolves to `on-device` when `preferredChannel === 'on-device'`, which made the
originally-sketched "auto-degrade when Online was preferred" branch **unreachable
from the store** — and auto-crossing the boundary would violate the trust line
regardless. So A2 ships the single reachable, privacy-correct behavior:
`shouldPromptSwitchToOnline` (pure, unit-tested) — a dead local model on a
network-class failure surfaces an actionable, anonymised notice ("The model on
this device isn't responding. Switch to Online to continue…"). It **never** POSTs
`degradeChannel`, **never** resends off-box, and **never** rewrites
`preferredChannel` in this direction (store-wiring test asserts all three). A real
error (auth / content-filter) still surfaces unchanged. K13 stops looking broken
and stops leaking a raw error, with the switch left to the principal.

**Launch-channel fix — the release must default to the CLOUD GATEWAY, not the
on-device model (owner directive, 2026-09-03):** the shipped pilot build launched
on ollama even though it seeds a working cloud gateway and makes it the default
*provider*. Root cause was a **dead guard, not a missing feature**:
`cloud-gateway-provider-seed.ts` already had "set `preferredChannel='online'` when
no choice exists yet", keyed on `getSetting('preferredChannel') === undefined` —
but `createDefaultSettings()` defaulted the key to `'on-device'`, and
electron-store returns its `defaults` from `.get()` even for never-written keys,
so `getSetting` was *always* `'on-device'` and the guard never fired. The existing
seed unit test masked it (mocked `getSetting` to return `undefined`, a value
production never reached). Fix (commit 715eab73): stop defaulting
`preferredChannel` (optional field). An ABSENT value now means "no choice yet" →
the seed sets Online on a fresh gateway build; an explicit toggle still persists a
concrete value (moe.13 overwrite regression stays fixed); non-gateway builds keep
on-device via the preflight's `?? 'on-device'` fallback. Existing pilot boxes
where the principal never explicitly toggled **self-heal to Online** on next
launch — which is also why Karunesh's box was on-device (dead-model K13) in the
first place: the launch default, not just a model outage. Regression pinned by
`tests/unit/settings-store-defaults.test.ts`. Full gate green; under review
(code-reviewer + config-coherence-auditor, 2026-09-03).

---

## 2. Parallelization — controlled multi-agent, disjoint code lanes

Two lanes run concurrently (workflow `close-karunesh-gaps-parallel`), each
executor fixes + self-tests, each hands to a strict reviewer. Lanes touch
disjoint file trees so parallel edits cannot collide:

- **Lane A — Email/Chrome (`electron/`):**
  - CLWX-74 — VLM grounding must NEVER hard-crash the email flow: route through
    the app's managed provider chain, or degrade/refuse readably on a no-AWS-creds
    box. New-mail locator survives a littered mailbox.
  - CLWX-73 — remove the managed-profile fallback for tenant flows; readable
    "sign in to Chrome and retry" instruction instead. `profile=user` always.
- **Lane B — Trust UI (`src/`):**
  - CLWX-52 — anonymise model id → "Online" / "On this device".
  - CLWX-53 — plain-language error banner (keep WHEN it shows; fix wording).
  - CLWX-75 — header badge state agrees with real gateway/turn state.
- **Lane A2 — on-device outage prompt (`src/lib/channel-degrade.ts` +
  `src/stores/chat.ts` + `src/stores/chat/types.ts` + `src/pages/Chat/index.tsx`
  + `chat.json`), landed AFTER A+B** (commit 0925528e) to avoid a third
  concurrent editor of `chat.ts`:
  - K13-real — `shouldPromptSwitchToOnline`: a dead on-device model on a
    network-class failure surfaces an actionable, anonymised "switch to Online"
    notice. Deliberately NOT a mirror of the cloud path — no auto-send off-box,
    no `degradeChannel` POST, no `preferredChannel` write in this direction (the
    principal chooses). Pure policy unit-tested; store-wiring test asserts the
    three no-ops. No `electron/` change needed (`/api/settings/degradeChannel`
    already accepts `'online'` via `isProviderChannel`, but this direction never
    calls it).

Review gate per lane before anything is built (no self-approval). Lane A2 is
under review (code-reviewer, 2026-09-03).

---

## 3. Release path (sequenced after the lanes land)

1. Integrate both lanes → run the full gate: `pnpm typecheck && pnpm lint:check
   && pnpm test && pnpm ga:gate GA_GATE_STATIC=1` (all GREEN required).
2. Address any reviewer `changes-required` before proceeding.
3. Bump version to `0.4.3-moe.18`; `pnpm build:win` (NSIS x64); sha256 + upload
   to `gs://clawx-rc-artifacts-.../moe18/`.
4. **ONE full-matrix VM verify** on `clawx-win-rc-20260609` (CDP 9223): the
   Karunesh matrix K1 / K10 (PDF drag — failed live on moe.16, must now PASS) /
   K11 (send, on a no-creds + littered box) / K12 / **K13 both directions** —
   cloud→on-device auto-degrade (CLWX-78, failed ×2 on moe.16) AND the
   on-device-outage "switch to Online" prompt (Lane A2, the direction he actually
   hit: kill ollama, confirm the anonymised notice appears, NOT a raw error) —
   / K14 five prompts. Every leg PASS. No raw "Connection error." survives.
5. On all-green: fire the Karunesh handoff (staged, owner-authorized **contingent
   on tested-and-green** — "after we've tested it, let's kick all this off").
   Honest note; nothing sent before green.

---

## 4. Out of scope for this release (named, not silently dropped)

These are NOT Karunesh-matrix failures and do NOT gate the moe.18 send, but they
DO gate a formal GA declaration (owner/Ministry actions a verify can't green):

- **Security floor — CLWX-18 / CLWX-19 / baked-key:** live `sk-clawx` key baked
  plaintext into the shipped exe, un-rotated ~3 months, public repo. Owner
  rotation + provisioning. GA blocker, not a Karunesh-test blocker.
- **KR6 token-floor / scale ceiling (CLWX-29):** trim on HOLD; fleet 429 at ~20
  schools. Owner unhold.
- **KR7/KR8 Entra UserId + Ministry values (CLWX-30/31):** Ministry-paced.
- **CLWX-43 latency (~103s median cloud turn):** Raj's twice-raised complaint; no
  in-app slow-turn notice yet. Owner budget sign-off.
- **Windows ASR (gap C), cron reminder e2e (gap D):** built, unproven on Windows.

---

*Live: all moe.18-candidate code is in the tree. Lane A+B (8fac374f) integrated
for K11/CLWX-73/74/75/52/53; Lane A2 (0925528e) K13 on-device-outage prompt;
chat per-turn-flag polish (1a684217); and the **launch-channel fix** (715eab73)
that makes the build default to the cloud gateway instead of on-device — the
owner's explicit steer this session. Full gate GREEN: typecheck, lint (0 errors),
1334 unit pass, plus the new store-default regression guard. Launch-channel fix
under review (code-reviewer + config-coherence-auditor). Owner reconfirmed the
gated handoff ("once we close all the gaps, send a download to our counterpart to
test") — still contingent on the all-green VM verify. Remaining before that:
clear any reviewer changes-required, bump moe.18, `build:win`, then ONE
full-matrix VM pass on clawx-win-rc-20260609. `failing-acceptance-retest-audit`
DONE — PDF (CLWX-92) and cloud→on-device degrade (CLWX-78) FAILED live on moe.16,
fix-pending-verify (highest-risk VM legs, alongside K11 email-send on a no-creds
box). moe.17 verify agent dead. Nothing sent to Karunesh.*
