# moe.18 full-matrix VM verify — clawx-win-rc-20260609 (2026-09-03; executed 2026-09-06)

**STATUS: RUN LANDED — NOT ALL-GREEN.** Steps 1–7 + K14 executed live on the
GCP IAP Windows VM with screenshots + app-log evidence (owner directive:
"testing in the VM … holistically; connected back to Google Instance"). Core
install/launch/migration/PDF/degrade paths PASS. **K13 direction 2 does NOT
fully clear its bar** — a real degrade-UX finding (raw "Connection error."
reachable + contradictory stacked run-error banners; see Findings). Steps 8
(K11 email), 9 (K12 badge), the no-clobber leg, and the full trust sweep were
**not run this session** and remain for the next tick. Per the packet
contract, ALL-GREEN is therefore not achievable this session and the Karunesh
handoff does NOT fire.

Installer (LOCAL — no GCS download needed):
`/Users/antonalexander/Github/moe-tt/ClawX/release/Ministry of Education-0.4.3-moe.18-win-x64.exe`
(432,028,001 bytes; same object uploaded to gs://clawx-rc-artifacts-622687731621/moe18/)
Required sha256: `5b0884ed4fd23dadcf67eb88937376d054ac994ffa801695c0d040a27d08d4e7` (verified BOTH hops)
Packet: /tmp/moe18-vm-verify-packet.md · Scripts: /tmp/moe18/ · Evidence pulled to /tmp/moe18-evidence-pull/

## Per-check verdict (packet steps)

| # | Check | Verdict |
|---|---|---|
| — | sha256 match (Mac hop + guest hop) | **PASS both hops** — Mac `5b0884ed…d4e7`; guest `Get-FileHash` = same |
| 1 | Pre-step: legacy-channel preseed (on-device, marker removed, no-BOM) | **PASS** — `preferredChannel online→on-device`, `hadMarker=False presentNow=False`, `BOM_PRESENT=False`, backup `settings.json.pre-moe18-20260906-051530.bak`; pre-state moe.17, 28 sessions, hosts clean, app+ollama stopped |
| 2 | Silent /S /CURRENTUSER install over moe.17; FileVersion 0.4.3-moe.18; state preserved | **PASS** — install exit 0 in 504s; `FileVersion 0.4.3-moe.18`; sessions/openclaw.json preserved; canvas binding present |
| 3 | Visible relaunch; CDP 9223 + gateway 18789 + host-API 13210 | **PASS** — launched via interactive scheduled task (NOT -WindowStyle Hidden); CDP 9223, gateway 18789 (pid logged), host-API 13210 all up |
| 4 | LAUNCH-CHANNEL headline: migration fired (online + marker + log line + runtime=cloud) | **PASS** — pill Online, migration marker written, migration log line present, runtime `custom-moecloud/moe-demo-pro` |
| 5 | K10 PDF regression (fresh session, real summary, read_pdf toolCall, no workerSrc) | **PASS** — fresh-session retry (first boot auto-loaded a Sep-3 session; NOT counted per moe.17 protocol); real ICT-audit summary; `read_pdf` toolCall 2026-09-06T05:36; workerSrc NONE |
| 6 | K13 dir 1 cloud→on-device (notice + switch + attempt) | **PASS core + FINDING** — correct amber degrade notice ("No internet connection — this answer came from the model on this device. Online will be used again automatically once it's available."); log "Degraded channel without persisting preference" (preference preserved); provider switch to ollama; on-device resend timed out (CPU-VM allowance). Post-restore auto-recovery ABSENT (runtime stuck on qwen while UI said online) — reassert-online repaired. **FINDING D0**: two run-error banners STACKED under the correct degrade notice (see Findings) |
| 7 | K13 dir 2 on-device outage → anonymised switch-to-Online prompt; NOT raw "Connection error." | **PARTIAL FAIL** — the correct amber prompt DID fire ("The model on this device isn't responding. Switch to Online to continue, or wait for the model on this device to come back."), anonymised, correct direction, Dismiss present, backend `rawError=Connection error.` stayed in gateway stderr. BUT a co-rendered `chat-run-error` banner shows online-centric copy ("The online assistant could not be reached … switch to 'On this device'") contradicting it, AND its "Technical details" expander surfaces raw "Connection error." — so the "NOT raw Connection error." clause is NOT met. First clean run (no mid-turn switch) `degradeNoticeFirstSeenMs=23353 channelAtDegrade=on-device`. NOTE: a mid-turn channel switch during the outage raced the gateway reload and dropped the send (NO_RESPONSE) — test artifact, but a real "silence-on-send on switch-during-outage" shape |
| 8 | K11 email chain readable degrade (no-creds, no-session box; NO sends) | **NOT RUN this session** |
| 9 | K12 badge tracks real gateway state (healthy → kill → restart) | **NOT RUN this session** |
| 10 | K14 five prompts (NSCC set) — answers, no raw errors | **ANSWERED 5/5, 0 raw errors — BUT content-shallow**: NSCC knowledge pack proven ABSENT from the installed moe.18 tree (moe18-nscc-probe.ps1 → NONE; no `nscc_lookup`). Answers are generic, not grounded in the National School Code. CLWX-42 / GA gap P12 named |
| 11 | Trust sweep — no model IDs / cost / raw HTTP in any evidence | **PARTIAL** — all pulled screenshots clean on model IDs / cost / raw HTTP EXCEPT the single leak in step 7 (raw "Connection error." behind run-error "Technical details"). Full sweep of every job's frames not completed this session |
| + | No-clobber leg: post-migration explicit On-device toggle survives relaunch | **NOT RUN this session** |
| 12 | End state: hosts clean, ollama running, app on Online, VM RUNNING | **PASS** — hosts clean; ollama RUNNING (OLLAMA_READY); channel reasserted Online via host-API (`success:true modelRef=custom-moecloud/moe-demo-pro`); recovery turn cleared the stacked banners (`freshSessionClicked=true`, `runErrorSeen=false`, `channelFinal=online`) — app sits clean on Online with NO error banner. Turn itself `TIMED_OUT_MID_TURN` only because the placeholder `moe-demo-pro` cloud gateway is unverifiable on this VM (known, not a defect). VM left RUNNING per owner (actively testing) |

## Findings (degrade-UX — CLWX-78 / CLWX-95 family)

**FINDING D0/D1 — run-error banners co-render with the correct degrade notice
(both K13 directions).** The `chat-degrade-notice` component is correct and
well-worded in both directions (amber; anonymised; explains fallback + recovery;
has Dismiss). But the generic `chat-run-error` component ALSO renders — up to
two stacked banners in dir 1 — using online-centric copy ("The online assistant
could not be reached … switch to 'On this device'" / "The online service is busy
right now …") regardless of which channel actually failed. In dir 2 (on-device
outage) this copy is the WRONG DIRECTION and contradicts the correct amber prompt
(one says switch to Online, the other says switch to On this device). Three error
banners at once reads as "the app is broken" — a principal-proxy veto class.

**FINDING D2 — raw "Connection error." reachable behind "Technical details".**
Expanding the run-error banner's "Technical details" reveals the literal string
"Connection error." (CDP probe: `leaksFound:["Connection error"]`). It is opt-in
(collapsed by default) and contains NO model IDs / provider name / cost / IP /
port — so it is the mildest leak class — but the packet's dir-2 bar explicitly
says "NOT raw 'Connection error.'", so this fails that clause.

Root cause is UI-layer notice de-duplication + channel-agnostic run-error copy,
not the degrade path (Lane A2 / commit 0925528e works). Backend log shows
`embedded run failover decision … decision=surface_error reason=timeout` — the
gateway surfaces an error to the renderer and the renderer paints the generic
run-error banner alongside the correct degrade notice.

## Evidence pointers

- Screenshots (Mac): `/tmp/moe18-evidence-pull/{k13out,k13out-clean,w10deg}/` — dir-1 stacked banners `w10deg/final-2026-09-06T05-38-58-719Z.png`; dir-2 correct+contradictory banners `k13out-clean/final-2026-09-06T06-24-54-105Z.png`
- App-log truth (guest): `moe18-degrade-truth.ps1 -SinceHour 06:2` → 4× `embedded run agent end isError=true … rawError=Connection error.` then `failover decision … decision=surface_error reason=timeout`; only "Degraded channel" line is the 05:39 dir-1 event
- CDP banner probe (guest): `moe18-banner-probe.js` → both banner texts + expanded Technical details + `leaksFound:["Connection error"]`
- NSCC absence: `moe18-nscc-probe.ps1` → `NONE` / `NO nscc_lookup HITS`
