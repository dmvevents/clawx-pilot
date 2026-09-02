# KR2 fresh-state install run — moe.13 on Windows (IAP VM) — 2026-09-02

First fresh-state boot of moe.13 on the persona VM. Proves the slow-ready fix
live, captures a green first turn, and flushes out two NEW boot-path defects —
both root-caused and fixed same-day (ship in moe.14).

## Environment
- VM `clawx-win-rc-20260609` (RUNNING, IAP), guest `clawxtest`.
- Safety net taken FIRST: disk snapshot `clawx-l2-moe12-kr1pass-20260902`
  (VSS/guest-flush, READY, 2.5 GB) — the L2 restore point from
  `docs/VM_TEST_BASE.md`.
- Installer: **moe.13** via GCS (`clawx-rc-artifacts-622687731621`), sha256
  `a8494ec0…deb3ecf` **verified on guest == build host**.
- Fresh state: `.openclaw` and `%APPDATA%\Ministry of Education` MOVED to
  `.kr2-20260902.bak` (reversible), silent `/S` install (324 s), launched
  VISIBLE via CimMethod with CDP :9223.

## Result 1 — slow-ready fix PROVEN live (the KR2 headline)

Timed first boot on completely fresh state:

| Milestone | Time after launch |
|---|---|
| host-API :13210 bound | 5 s |
| CDP :9223 up | 5 s |
| `openclaw.json` created | 5 s |
| **gateway :18789 bound** | **51 s** |
| `agents.defaults.model.primary` set | yes (`custom-moecloud/moe-demo-pro`) |

Baseline on moe.11/moe.12: composer disabled ~4–5 minutes
(`retryAfterMs≈285000`). **51 s vs ~285 s+** — `61be816e`
(ensureBootableAgentsConfig upgrade-in-place) works on the shipped artifact.

## Result 2 — green first turn on fresh install (captured)

Prompt: "What are three things you can help a school principal with today?"
Driver (with the IF-8 placeholder guard): `verdict=ANSWERED, settled=true`,
real persona answer (daily reports + suspension forms, letters/memos/email,
document summarisation). Evidence JSON:
`chat-turn-2026-09-02T04-38-56-421Z.json` (guest,
`Downloads\clawx-chat-turn-evidence\`). UA confirms
`MinistryofEducation/0.4.3-moe.13`. This run also serves as the
**DRIVER-SETTLE regression proof** (register group C): the fixed driver
settled on real content, not a placeholder.

## Result 3 — two NEW defects found live (both fixed same-day)

### 3a. Channel choice silently clobbered every boot
Attempting the on-device leg: wrote `preferredChannel: "on-device"`
(BOM-less) with the app stopped, relaunched — and the setting came back
`"online"`. Root cause: `cloud-gateway-provider-seed.ts` forced
`preferredChannel='online'` on EVERY boot whenever it differed. A principal
choosing "On this device" would be silently reverted at next launch — a
trust-class defect (the UI anonymisation exists precisely so principals never
wonder "why did the AI change?"). **Fix `38085ba3`:** default to online only
when no choice exists (undefined/null); test updated to assert
respect-existing-choice + new fresh-default case.

### 3b. EPERM race on the atomic config rename (Windows)
First-boot log: `[local-provider-seed] syncSavedProviderToRuntime failed:
EPERM … rename openclaw.json.tmp.5736… -> openclaw.json`. Windows rename over
a target held OPEN by another process (gateway reading the config / AV scan)
throws EPERM — so the on-device provider never reached `models.providers` on
first boot (only `custom-moecloud` present). **Fix `38085ba3`:** bounded
retry (5×, 100 ms backoff) on EPERM/EBUSY/EACCES in
`writeOpenClawConfig`'s rename. 64 config/seed/boot tests green.

## KR2 box status after this run

| Sub-criterion | Status |
|---|---|
| Fresh state → gateway ready, no manual steps | ✅ 51 s, timed, on shipped moe.13 |
| Green first turn, recorded | ✅ captured (online channel) |
| Green **on-device** turn on fresh install | ◐ blocked by 3a on the installed build — re-verify on **moe.14** (both fixes; built this session) |
| Assisted-GUI install recording | ○ needs a human-at-screen or RDP session (silent-install tree evidence already on file from moe.11/12) |

**Net:** the KR2 recording run on moe.14 is now a verification pass, not a
debug session. The run already paid for itself: two shipped-build defects
found and fixed that no amount of unit testing had surfaced.
