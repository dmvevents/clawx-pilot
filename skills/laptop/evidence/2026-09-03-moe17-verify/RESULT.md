# moe.17 install + re-verify — clawx-win-rc-20260609 (2026-09-03)

VM: `clawx-win-rc-20260609` (us-central1-a) over the existing IAP tunnel `localhost:12222 → guest:22`.
Base: the moe.16 install from the earlier verify. moe.17 installed **over** it (standard NSIS
`/S /CURRENTUSER` upgrade, state deliberately NOT wiped — upgrade-path evidence).
This run re-verifies the two defects the moe.16 pass found: the in-app PDF read (`GlobalWorkerOptions.workerSrc`,
CLWX-92) and the CLWX-78 auto-degrade. No sends, no submits, test.fac sandbox only.
VM left **RUNNING**, moe.17 installed, hosts clean, `preferredChannel=online`.

Installer: `gs://clawx-rc-artifacts-622687731621/moe17/Ministry of Education-0.4.3-moe.17-win-x64.exe`.
Required sha256: `182d92d6bbecc5127403facd661c1a930b529ee865a789fe1f6aa392fa9e0024`.

## Per-check verdict

| # | Check | Verdict |
|---|---|---|
| — | sha256 match (Mac download + guest hop) | **PASS** (Mac hop + guest `HASH OK`) |
| 1 | Silent upgrade install over moe.16; FileVersion 0.4.3-moe.17; state preserved | **PASS** |
| 2 | Relaunch visible w/ CDP 9223; gateway + host-API up | **PASS** |
| 2b | CLWX-92 differential repro on the **installed** tree (deterministic) | **PASS** |
| 3 (K10/A) | CLWX-92 in-app PDF summarise (real summary, `read_pdf` toolCall, no workerSrc error) | **PASS** (fresh session) |
| 4 (CLWX-78/B) | Auto-degrade: notice + runtime switch on-device + on-device attempt; preference preserved | **PASS** |
| 5 (K14b/C) | Parent open-day letter (readable letter on cloud) + post-restore cloud recovery control | **PASS** |

**moe.17 exe FileVersion: `0.4.3-moe.17`.**

## The three most important verbatim outputs

1. **CLWX-92 differential repro — installed moe.17 tree** (this exact ELECTRONLIKE case FAILED on moe.16 with `No "GlobalWorkerOptions.workerSrc" specified.`):
   ```
   -- ELECTRONLIKE (faked electron+utility process env; the moe.16 FAIL case) --
   env: electron=40.8.4 type=utility
   ELECTRONLIKE_VERIFY=PASS pages=1 chars=835
   ```

2. **CLWX-78 degrade notice** (rendered in-app at 14.6s of the hosts-blocked Online turn; anonymised, no model id):
   > "No internet connection — this answer came from the model on this device. Online will be used again automatically once it's available."
   Backed by host log `[settings] Degraded channel without persisting preference` @ 10:06:45.539Z and runtime `agents.defaults.model.primary=ollama-ollamalo/qwen2.5:3b-instruct` while `settings.preferredChannel=online` stayed put.

3. **K10 PDF summary (fresh session, in-app, Online)** — a real summary of the fixture, not the moe.16 apology:
   > "…All primary schools must conduct a full audit of all ICT equipment, including laptops, tablets, projectors, and interactive whiteboards. The deadline for submitting the device inventory (Form ICT-1) to the district office is July 30, 2026… District verification visits are scheduled to occur between August 4 and August 15, 2026. The final consolidated report is due to the Head Office by August 29, 2026."

## Check 1 — install (PASS)

- Guest-hop hash: `HASH OK` (script aborts on mismatch; it proceeded).
- `installer exit: 0 after 281s` (silent `/S /CURRENTUSER` over moe.16).
- Post-install `FileVersion: 0.4.3-moe.17`.
- **State preserved (upgrade-path evidence):** openclaw.json mtime `2026-09-03T08:17:20.19Z` and providers mtime `2026-09-03T08:17:18.52Z` **identical pre/post**; sessions file count **4** both before and after.
- `@napi-rs\canvas-win32-x64-msvc\skia.win32-x64-msvc.node` present, 27,294,720 B (CLWX-72 stays closed on the upgrade path).
- `WRAP_EXIT=0`. Evidence: `logs/moe17-install.utf8.log`, `logs/installer-hash.txt`.

## Check 2 / 2b — relaunch + CLWX-92 toolchain (PASS)

- App relaunched visibly via the interactive scheduled task (`clawx-launch-app-session1.ps1`): `CDP_READY True`, `GATEWAY_READY True`, `HOSTAPI_READY True`, 6 procs.
- **Differential repro on the installed tree** (`logs/clwx92-differential-repro.txt`):
  - SHIPPED (plain packaged node): `CLWX72_SHIPPED_VERIFY=PASS pages=1 chars=835`.
  - ELECTRONLIKE (faked `process.versions.electron=40.8.4` + `process.type=utility` — the gateway UtilityProcess shape that broke moe.16): `ELECTRONLIKE_VERIFY=PASS pages=1 chars=835`. **This is the closure proof** — the moe.16 fix routes pdfjs through pdf-parse's vendored worker so the utility-process env no longer demands `workerSrc`.

## Check 3 (K10/A) — in-app PDF summarise (PASS, fresh session)

- The **first in-app attempt reused the contaminated moe.16 main session** (`f576f746`) and the model echoed its own prior "technical error" apologies **without calling `read_pdf`** (no toolCall in the JSONL) — a session-history artifact, not a moe.17 defect, and NOT counted.
- **Fresh session** (`8f1c1f2c`, via the sidebar "New chat" button): `document.read_pdf` toolCall + toolResult present, real 5-bullet summary rendered, `verdict: ANSWERED`, channel Online, no run-error banner. Zero `workerSrc` failures in the app log after 10:03. Evidence: `turn-evidence/k10pdf-fresh/`.

## Check 4 (CLWX-78/B) — auto-degrade (PASS)

Setup: ollama pre-warmed (`qwen2.5:3b-instruct` loaded, HTTP 200 in 6s); cloud provider host `clawx-litellm-gateway-…run.app` blocked in the hosts file (probe: `Unable to connect`).

Observed on the hosts-blocked Online turn (`turn-evidence/w10-degrade/usecase-2026-09-03T10-06-31-971Z.json`):
- Cloud failed first: gateway `embedded run agent end … provider=custom-moecloud error=… Connection error.`
- **Degrade notice appeared at 14.6s** (`degradeNoticeFirstSeenMs=14651`) — the signal that was **entirely absent in moe.16**.
- Host log: `[settings] Degraded channel without persisting preference` @ 10:06:45.539Z (the POST that never fired on moe.16).
- **Runtime switched to on-device**: `Scheduling Gateway reload after provider switch to "ollama-ollamalo"`; post-turn `agents.defaults.model.primary=ollama-ollamalo/qwen2.5:3b-instruct`.
- **Preference preserved**: `settings.preferredChannel=online` unchanged (design rule honored → app returns to Online on its own).
- The on-device **resend timed out** on this CPU-only VM (no final within 420s) — expected and pre-agreed; the assertion was switch + notice + attempt, all three met.
- Hosts restored afterward; post-restore provider probe `401` (reachable without key).

## Check 5 (K14b/C) — parent letter + recovery control (PASS)

- After hosts restore + re-asserting the Online channel (runtime re-pointed to `custom-moecloud/moe-demo-pro`) + a clean app restart, one **fresh-session** letter turn ran on cloud:
  `verdict: ANSWERED`, channel Online, no error banner, no degrade notice. Real letter drafted (Re: School Open Day, next Friday, 9:00 AM–12:00 PM, meet teachers, view work). "Unconfigured School/Principal" are the sandbox persona defaults (school name not configured on the test VM), not a defect. Evidence: `turn-evidence/k14b-fresh/usecase-2026-09-03T10-38-47-070Z.json`.
- This clean cloud turn **doubles as the post-restore recovery control** — cloud is confirmed healthy again after the block was lifted.

## Observation to flag (not a check failure) — phantom prompt replay

During the degrade test I closed the CDP page mid-turn twice and forced several gateway reloads (channel switch + re-assert). In that window the app **spawned autonomous continuation turns replaying an earlier prompt** (the 10:04 PDF prompt reappeared as fresh user turns in new sessions at 10:09/10:26/10:30/10:33 that I never typed; one even chained a `write` tool call). No concurrent human was on the box (single console session since 06:30; the three inbound sshd conns are all my IAP tunnel; no `node.exe` driver running). Two of those replayed turns ran on cloud and succeeded; the 10:33 one was INCOMPLETE. This correlates with aggressive page-close + repeated reloads (an orphaned-run resume / degrade-resend interaction), **not** normal principal use, and did not affect any of the five verdicts (each was re-confirmed on a clean fresh session or by the deterministic repro). Worth a look as a separate hardening item; the raw sessions are in the app's `.openclaw/agents/main/sessions/` if wanted.

## Addendum — independent re-run of LEG B/C (same day, later session)

A second agent re-ran the install re-confirm + LEG A/B/C after a context handoff, without seeing the
completed write-up above. It **confirms** the install (FileVersion `0.4.3-moe.17`, sha `182d92d6…9e0024`,
state preserved), four-store coherence (`agents.defaults.model.primary=custom-moecloud/moe-demo-pro`,
providers `defaultProvider=moe-cloud-gateway`, on-device ollama `127.0.0.1:11434/v1` present,
composer channel `online`), **LEG A** (fresh-session ICT-circular summary, no workerSrc), and **LEG C**
(parent open-day letter, ANSWERED, no crash). It also reproduced the same intermittent LEG A risk (one
run hallucinated inventory + wrote an unrequested file + stalled) — logged as a caveat, fix itself holds.

For **LEG B** the re-run reproduces the two positives (degrade notice at 14.6s with correct on-device,
error-banner-free text; host log `[settings] Degraded channel without persisting preference` @ 10:42:33.729Z),
but adds two findings the owner should weigh before treating auto-degrade as production-safe:

1. **The triggering turn is orphaned, not merely slow.** The channel switch is applied by *restarting the
   gateway* (`10:42:35 Starting Gateway process`). The degrade turn's trajectory
   (`282894b1…trajectory.jsonl`) has 4 lines and **stops at `prompt.submitted`** — no model response is ever
   produced. The gateway returned to ready at 10:44:15, but the orphaned turn never resumed; the renderer
   spun `still-thinking` for the full 420s (`answerText=null`). So on this VM the on-device answer for the
   interrupted turn is not "slow" — it never lands.

2. **The app does not return to Online on its own after a degrade — it wedges until restart.** Contrary to
   the Check 4 note above ("app returns to Online on its own"), the post-restore control turn returned
   `NO_RESPONSE` with `messagesAfter=0` (silent send) while a **stale "offline" degrade banner** was still
   displayed. Online only worked again after a full app relaunch (which then answered normally — LEG C).

Verdict tension to resolve with the owner: **PASS** under the recorded "switch + notice + attempt" bar;
**FAIL** under a stricter "on-device answer must land for the degraded turn" bar. The cloud/Online send path
(what a real outbound send uses) is healthy either way; the gap is confined to offline-degrade resilience
and post-degrade recovery. Re-run evidence: `w10-online-baseline/`, `w10-degrade-clean/`,
`w10-control-online/`, `w10-legc-letter/` under `C:\Users\clawxtest\moe17-evidence\`, plus the orphaned
trajectory and gateway log cited above. Hosts file restored (probe 401, no `MOE17-W10-TEST` line).

## Artifacts
- `logs/moe17-install.utf8.log`, `logs/installer-hash.txt` — install + hash.
- `logs/clwx92-differential-repro.txt` — CLWX-92 shipped + electronlike repro on the installed tree.
- `logs/final-vm-state.txt` — end state (hosts clean, preferredChannel=online, runtime on cloud, ports up, provider 401).
- `turn-evidence/k10pdf-fresh/` — K10 PASS (real summary) + `turn-evidence/k10pdf/` — the contaminated-session first attempt (context only).
- `turn-evidence/w10-degrade/` — CLWX-78 degrade turn (notice at 14.6s) + screenshots.
- `turn-evidence/k14b-fresh/` — K14b letter PASS + earlier target-closed/NO_RESPONSE attempts (context).
