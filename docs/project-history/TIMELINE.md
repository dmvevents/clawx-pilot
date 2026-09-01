# ClawX — chronological build history

Compiled 2026-09-01 from git, repo docs, evidence dirs, and Codex sessions.
**FACTS** are in git/docs/sessions. **INFERENCE** is reasoning not directly
evidenced. Sources are cited inline; anything unsupported is `UNVERIFIED`.

---

## Timeline

| Date | What happened | Evidence |
|---|---|---|
| **2026-02-05** | Repo initialized as a fork of ValueCell-ai/ClawX — Electron + React + TypeScript skeleton with OpenClaw gateway integration. | commits `821ae2aa`, `9442e5f7`, `b8ab0208`…`284861a0` |
| **2026-02-06** | OpenClaw added as a submodule; gateway WebSocket protocol, provider management, auto-update scaffolding. | `29ee2175`, `af76b282`, `4431d2ba` |
| **2026-03-04** | Gateway moved from `child_process.spawn` to `utilityProcess.fork` for Electron. | `59334913` |
| **2026-05-07** | **INFERENCE:** early Trinidad & Tobago education-platform exploration (Codex `tt-eduplatform` cwd; not yet in this repo). | codex `~/.codex/sessions/2026/05/07/rollout-2026-05-07T11-03-11-*.jsonl` |
| **2026-05-22** | **MoE T&T pilot fork begins.** First pilot commit ("accumulated work"); four-store channel-coherence fix; **qwen2.5:3b-instruct replaces hermes3:8b** as local model; Ministry branding. | `d2a3a31f`, `aafd3843`, `5a7bc724`, `588ab723`, `f43ebf2b`, `fd5c365b` |
| **2026-05-23** | **Outlook v2** built: Playwright + VLM (Bedrock Sonnet 4.5) browser automation; 11 Outlook tools incl. send with hard-confirm gates; host-API `:13210`; moe-principal-assistant plugin. Packaging bugs fixed (playwright-core → runtime deps, NSIS rebrand, config-clobber race). | `0e54a816`…`0c67586a`, `d5624778`, `6f555ff7` |
| **2026-05-24** | Live smoke tests: LLM tool-pick + live Outlook (`v2-chatbot-e2e.ts`), 14-row eval (`v2-eval.ts`), send-gate proof (`v2-send-test.ts`); Windows CI smoke. | `a18e1fa0`, `b6f4f367`, `08e7d01b` |
| **2026-05-25** | **MS Forms automation** built (reverse-engineered `/formapi/`; Suspensions 32/32 fields, Daily Report 57 fields; API submit hits 401 → later Power-Automate/browser pivot). Regression-class auditor sub-agents created. moe.10 validation: 8 PASS / 2 WARN / 0 FAIL. | `b5dcf26a`…`6fe1f7c5`; `docs/PRODUCT_PRINCIPAL_ASSISTANT.md`, `docs/moe.10-validation.md` |
| **2026-05-26** | **Principal demo day.** Email summarise + draft reply; document → 32-field extract → Suspensions prefill; 3:45pm cron reminder. Items 1+2 live; item 3 pre-recorded. Windows pilot install blocked on Cat-5 link. | `CLAUDE.md` §demo; codex `~/.codex/sessions/2026/05/26/*.jsonl` (29 sessions) |
| **2026-05-26→27** | Post-demo hardening: Forms/ASR stabilised, Outlook compose recovery, Azure Speech preferred for pilot ASR, Windows output safety gates. | `f955c293`…`ba84cd98`; codex 05/27 (12 sessions) |
| **2026-05-29** | Release handoff: Windows release playbook, runtime-readiness split from repo setup, skill bundling made Windows-buildable. | `6ddd723a`…`a8ba9ca8`; `docs/NEXT_AGENT_WINDOWS_DEMO_HANDOFF_2026-05-29.md` |
| **2026-06-02→04** | Windows chat procedures automated: safe-chat probes, doc acceptance, launchd pilot watcher, deterministic Office fixtures, Outlook send fail-closed on ambiguous drafts (31 unit tests pass on Windows). | `b117b895`…`fc088ae1` |
| **2026-06-05→09** | Windows RC packaging: cloud gateway seed for builds, provider keys server-side, RC harness around Electron CDP; M365 programmatic bootstrap (`resources/microsoft-graph.json`, `package-win-manual.yml`). | `69de3722`…`881b5b68`; `docs/GA_RELEASE_PLAN_2026-06-09.md` |
| **2026-06-10** | **Windows RC prerelease published** (`…moe.10-win-x64.exe`, sha256 `4663ad8a…`). External tester **Karunesh Ramdass** confirmed install / online default / file scan / Outlook check+compose+send GREEN. Gateway startup ~2 min (UX flag). | GitHub release `moe10-windows-rc-20260610-bbc4eb1` |
| **2026-06-22→23** | Outlook draft/reply hardening: body-text lands in compose body not recipient fields; marker-scoped cleanup; no-send matrix passed. Installer sha256 `e35ee6cd…`. | `b3678449`…`42461abb` |
| **2026-07-27→28** | Harness E2E scaffold: 5-prompt doc-tooling fixture harness wired into `harness:ci`; Windows installer E2E workflow; preinstalled-skills bundler unblocked on Windows CI. | `bf6c0d26`, `2d4e318a`, `e4eccf57`, `1fea016a` (PRs #13/#14) |
| **2026-07-31** | **Home pilot Lane A smoke** (Windows laptop, home Wi-Fi 192.168.1.212): on-device gate proven; tool-cascade hang reproduced; PowerShell BOM regression caught. Windows knowledge pack created in `skills/laptop/`. | `afff7f15`, `13456b10`, `3272080f`, `9311f107`; `skills/laptop/evidence/2026-07-31-home-pilot-lane-a-smoke/` |
| **2026-08-01** | **BUG-012 fixed** (fresh-install missing agents block). Root cause: `runChannelPreflight` no-accounts early return. Fix: `ensureBootableAgentsConfig` boot-path safety net. | `fc435c6b` |
| **2026-08-03** | On-device tool-cascade blocker: branch **`fix/tool-catalog-trim`** (`7add864b`) trims the 31-tool catalog (~7,550-tok floor). Resolves the hang but **on HOLD pending review**. | `7add864b`, `18383948`; `skills/laptop/evidence/2026-08-03-windows-install-ui-flows/` |
| **2026-08-18** | **Ministry infrastructure handoff received** (`MOE Email AI Assistant Handoff`, Ansari Khan). APIM (100M tok/mo) + PostgreSQL + Entra app provisioned. Four conflicts vs desktop design: read-only Graph scopes, client secret vs PKCE, redirect URI owed, app-server/Docker vs pure desktop. Credentials via a moevault secure-send link (5 accesses, expiry ~2026-08-26). | `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` (UNSENT) |
| **2026-08-19→20** | **GCP IAP Windows lane** established (`clawx-win-rc-20260609`, no static IP). **moe.11** installer built + verified (sha256 `b01bb6c3…`). **Raj Ramdass 0/5 prompt replay** captured (tool-selection failure, not capability). | `skills/laptop/evidence/{2026-08-19-gcp-iap-windows-lane, 2026-08-20-moe11-iap-install-trim, 2026-08-20-raj-prompt-replay}/`; `de8e9759` |
| **2026-08-20** | **Offline architecture** designed; **lane G** eval added (offline proof + falsifiable egress guard; qwen2.5:3b, 0.5–2.6s). Two gaps named: (1) cloud turn fails instead of degrading [closed 08-21], (2) no outbox/sync [OPEN]. **Scale analysis**: 100M/mo dies at ~20 schools; ~71% of a turn is the fixed floor. **Doc-tooling steering** fix (`document.*` over Python) + 6-lane eval. | `c9f1aa34`, `c45c5bc4`, `fbb3743a`, `982fd5d4`, `73514b4f`, `c1b18125`; `docs/OFFLINE_ARCHITECTURE.md`, `docs/SCALE_ANALYSIS_2026-08-20.md` |
| **2026-08-21** | **Cloud→on-device degradation shipped** (gap 1 closed): send-time failover on `ECONNREFUSED`/`ENOTFOUND`/429; runtime-only channel move (never rewrites `preferredChannel`); 25 unit tests + lane G `G-degrade-classify`. | `bde78d94`; `src/lib/channel-degrade.ts`; `docs/OFFLINE_ARCHITECTURE.md` §3.1 |
| **2026-08-27** | **GA plan** written, grounded in the CLWX board and Raj's 0/5 feedback. | `261ac1bd`; `docs/GA_PLAN.md` |
| **2026-09-01** | **CLWX Plane board** stood up (OKR anchor + CLWX-0…CLWX-8, ceiling=Ready). `ministry-liaison-monitor` agent + skill created (two-project separation). This project-history folder written. Raj "more time + reissue link" note drafted (UNSENT). | this folder; `.claude/agents/ministry-liaison-monitor.md`; `~/openclaw-agent/outbound-drafts/2026-09-01-raj-more-time-reissue-link-DRAFT.md` |

---

## Codex sessions index

266 `.jsonl` sessions searched; the ClawX-relevant clusters:

- **2026-05-26** (29 sessions, 10:15–17:54) — demo-day: Ministry branding,
  principal-assistant plugin, Outlook/Forms automation, Windows prep.
- **2026-05-27** (12 sessions, 11:08–13:14) — post-demo: Windows flows, Forms,
  Outlook recovery, ASR.
- **2026-05-29** (4 sessions, 12:37–13:15) — release handoff: Windows playbook,
  runtime-readiness split, skill bundling.
- **2026-05-07** (3 sessions) — early T&T education-platform work (`tt-eduplatform`
  cwd; may be the separate video project — treat as UNVERIFIED for ClawX).
- **2026-01-20→02-10** (~20 sessions) — pre-fork Trinidad/ValueCell exploration.

**Caveat:** the Codex sessions are largely coordination/planning; the implementation
of record is the git history. Session paths above are exact so they can be re-opened.

---

## Two-project separation

| | ClawX principal-assistant pilot (**this repo**) | Curriculum-video generator (**separate**) |
|---|---|---|
| Contact | **Raj Ramdass** / Ansari Khan (MoE ICT) | **Karunesh Ramdass** |
| Signals | `moe.`, Ministry, principal, Outlook, Forms, `moe.gov.tt`, on-device model, APIM, Entra, Windows install | `Test N - <topic>` QA batches, slidegen, render defects (fractions, empty diagrams, TTS, legibility) |
| Artifacts | all of this repo (`extensions/moe-principal-assistant/`, `docs/`, `scripts/v2-*.ts`, `release/`, `skills/laptop/evidence/`) | not in this repo (UNVERIFIED — likely separate repo / `tt-eduplatform`); QA drop at `~/openclaw-agent/inbound-docs/Test N …` + `outbound-drafts/VIDEO_QA_TRACKER_2026-08-25.md` |

Rule: if you see **Karunesh** or **`Test N - <topic>`**, it is the video project — not ClawX.
Note Karunesh *also* appears in ClawX history once, as the 2026-06-10 external
Windows RC tester — that is a testing favour, not the video workstream.

---

## Open gaps

**FACTS:**

1. **Tool-catalog trim on HOLD** — `fix/tool-catalog-trim` (`7add864b`) cuts the
   floor ~7,550→~2,000 tok (~78% more affordable cloud tasks); resolves the on-device
   cascade hang; awaiting a reviewer pass (owner gate). Now on the scale critical path.
   (`docs/SCALE_ANALYSIS_2026-08-20.md` §2.3)
2. **No store-and-forward outbox** — no queue, retry ledger, or `pg` client. Offline
   form/audit writes have no durable once-only delivery. Design in
   `docs/OFFLINE_ARCHITECTURE.md` §5; not built.
3. **Ministry endpoints unverifiable** — all handoff values are placeholders; no probe
   possible until real endpoints land. `asr-azure.ts` is Azure Speech, not the APIM.
4. **Windows GA install evidence incomplete** — moe.11 GREEN over IAP (silent `/S`),
   but the **supported assisted-screen clean-VM install** has not been recorded.
   (`docs/GA_PLAN.md` Step 2)
5. **Forms preview/prefill blocked on Microsoft sign-in** — driver exists; clean-VM
   tabs land on `login.microsoftonline.com/.../authorize`. Needs a signed-in profile
   or approved Entra flow.
6. **Entra app registration / Graph still awaiting IT (Raj)** — real packet + redirect
   URI still owed (open since 2026-07-20); the hostname decision gates it.
7. **Prompt-caching answer unknown** — does the Foundry-behind-APIM deployment cache,
   and does a cache hit bill against the 100M? Highest-leverage budget question.
   (`docs/SCALE_ANALYSIS_2026-08-20.md` §2.4)
8. **Upstream fork divergence** — ~102 commits behind (v0.4.15→v0.5.2); only `3a241cf0`
   (safeRmSync) cherry-picked. Audit-then-cherry-pick; do not rebase mid-pilot.

**INFERENCE:**

9. **No per-user metering/caps in the broker** — `services/model-broker/server.mjs`
   authenticates but does no accounting; scale needs per-user caps + fleet reserve.
   (`docs/SCALE_ANALYSIS_2026-08-20.md` §3)
10. **No real signed-in identity** — the `userPrincipalName` used for `UserId` is a
    hardcoded stub; needs a real Entra sign-in producing a stable `oid`.
    (`docs/SCALE_ANALYSIS_2026-08-20.md` §4)

---

*Compiled from on-disk sources only; commit shas and session paths are quoted as
found and should be spot-checked before external citation.*
