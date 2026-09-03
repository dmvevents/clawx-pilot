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
| K13 **on-device dead / no failover** (the real report) | **NONE** — `maybeDegradeChannel` only does cloud→on-device; no on-device→cloud path exists | ❌ **OPEN (new)** | — | **A2 (follow-on)** |
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

**Newly confirmed by the retest audit (this is the sharp one):** Karunesh's K13
report was *on-device* (ollama) dying with 6× raw "Connection error." and **no
failover**. But the only degrade path in code is cloud→on-device
(`maybeDegradeChannel`, `src/stores/chat.ts:1720` hardcodes `channel:
'on-device'`; `shouldDegradeToOnDevice` cannot fire when already on-device). So
**his actual failure has no recovery path in tree** — moe.17/moe.18 do not fix it.
The reverse direction (on-device→cloud) was never built and never tested. It is
privacy-sensitive: on-device→cloud sends device data off-box, so it must NOT be a
silent send. The trust-preserving rule (Lane A2 below): if `preferredChannel ===
'online'` but the runtime is on-device via boot preflight → auto-degrade to Online
+ replay (restores their real preference, safe); if `preferredChannel ===
'on-device'` (explicit choice) → do NOT silently send to cloud, show an actionable
notice ("On-device model isn't responding — Switch to Online, or start the local
model"). Either way K13 stops looking broken and stops leaking a raw error.

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
- **Lane A2 — on-device→cloud failover (`src/lib/channel-degrade.ts` +
  `src/stores/chat.ts` + `electron/api/routes/settings.ts`), sequenced AFTER
  A+B land** to avoid a third concurrent editor of `chat.ts`:
  - K13-real — generalise the degrade policy to a target channel + auto-resend
    gate keyed on `preferredChannel` (preference-restore auto-degrade when the
    principal really wanted Online; actionable non-silent notice when they chose
    On-device). Pure policy stays unit-tested; plumbing mirrors the existing
    cloud→on-device path. `/api/settings/degradeChannel` must accept `'online'`.

Review gate per lane before anything is built (no self-approval).

---

## 3. Release path (sequenced after the lanes land)

1. Integrate both lanes → run the full gate: `pnpm typecheck && pnpm lint:check
   && pnpm test && pnpm ga:gate GA_GATE_STATIC=1` (all GREEN required).
2. Address any reviewer `changes-required` before proceeding.
3. Bump version to `0.4.3-moe.18`; `pnpm build:win` (NSIS x64); sha256 + upload
   to `gs://clawx-rc-artifacts-.../moe18/`.
4. **ONE full-matrix VM verify** on `clawx-win-rc-20260609` (CDP 9223): the
   Karunesh matrix K1 / K10 (PDF drag — failed live on moe.16, must now PASS) /
   K11 (send, on a no-creds + littered box) / K12 / **K13 both degrade
   directions** — cloud→on-device (CLWX-78, failed ×2 on moe.16) AND
   on-device→cloud (Lane A2, the direction he actually hit) — / K14 five prompts.
   Every leg PASS. No raw "Connection error." survives on any leg.
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

*Live: workflow `close-karunesh-gaps-parallel` (Lane A email/chrome + Lane B
trust-UI) still running. `failing-acceptance-retest-audit` DONE — verdict: not all
failing tests re-proven; PDF (CLWX-92) and cloud→on-device degrade (CLWX-78) FAILED
live on moe.16 and are fix-pending-verify; K13's real on-device→cloud direction is
unbuilt (Lane A2). moe.17 verify agent dead. Nothing sent to Karunesh.*
