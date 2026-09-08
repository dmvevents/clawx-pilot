# CLWX-43 — Slow successful inbox response

## Identity and impact

Observed September 8, 2026, 15:04–15:06 UTC (19:04–19:06 Dubai). Existing latency card CLWX-43 remains In Progress; CLWX-125/133 own related recovery/release evidence. Root owns installed measurement. This is one successful but slow assisted turn, with no performance acceptance or implemented performance fix.

Installed artifact: **0.4.3-moe.25**, source `8058e9b5b3050463c72a11c8e5da56616206f6e3`, hosted run `34203201042`, installer SHA256 `f8ac20f96f4f4dbfab6498144a989dbf83d61dd98c16459682db8a86460db0b2`. Server 2022, original 4-vCPU/16-GiB VM, standard-user Session 2. [Baseline](../evidence/WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md) binds installed EXE/ASAR hashes. Online route labels are `custom-moecloud` / `moe-demo-pro`; actual cloud model identity is UNKNOWN from these receipts. Current moe.26 source is a different, uninstalled candidate.

## Reproduction and expected result

1. Use the installed app and verified user Chrome profile, already signed into the expected QA mailbox. Preserve tabs and drafts.
2. Open a fresh Online chat through `windows-pilot/scripts/pilot-chat-turn-driver.js`, with `--new-session --expected-channel online --turn-timeout 150 --composer-timeout 30 --terminal-quiet 30`.
3. Ask to read the three newest messages and return only message/unread counts. Do not send, download or submit.

Actual: correct count/unread result, confirmed `outlook.read_inbox`, browser transport, no error chip and stable terminal state. The driver's `answerLatencyMs` is **95,044 ms**. Expected: usable response within an explicit product budget; the card's proposed p50 ≤15s / p90 ≤30s is not owner-approved acceptance. Five matched cold plus five warm final-candidate samples remain required.

## Evidence and execution path

Private receipt prefix: `artifacts/ga-fable-20260908/windows-lab/inbox-chat/`. No private mailbox content is reproduced here.

| Clock / event | Timestamp UTC | Interval within that clock |
|---|---|---|
| Mac driver: Send click completed | 15:04:37.301 | Start |
| Mac driver: stable answer recognized | 15:06:12.345 | 95,044 ms |
| Windows Gateway: user record | 15:05:00.936 | Start |
| Windows Gateway: tool-use record | 15:05:42.350 | 41,414 ms |
| Windows Gateway: Outlook tool result | 15:05:48.487 | 6,137 ms |
| Windows Gateway: final assistant record | 15:05:52.710 | 4,223 ms; 51,774 ms from user record |

Receipts: `chat-turn-2026-09-08T15-04-21-169Z.json`, `timing-metadata.json`, `gateway-tool-provenance.json`, `installed-transport-proof.json`. Guest session: `de46b8e9-8206-48ef-8fdf-60a48012c072.jsonl`. Path: UI Send → Main/Gateway → Online provider → `outlook.read_inbox` → installed Outlook browser service → authenticated user Chrome → tool result → provider final answer → renderer → driver stability check.

## Cause and confidence

Confirmed: the Gateway-recorded tool interval is 6.137s, so the observed mailbox operation does not account for all 95s. The 41.414s preceding the tool-use record is not a pure inference measurement. Queueing, request preparation and provider/network timing remain unseparated.

The driver records Send after the click returns and records an answer only after unchanged acceptable text persists for at least nine seconds; it then runs a separate terminal check (32.059s here). Thus 95.044s is neither first-token latency nor a measurement including the subsequent 32.059s check. No incident-time Mac/guest clock-offset bound was collected: do not assign cross-clock residuals to transport or rendering. Assistant usage fields are zero-valued; token consumption/cost is UNKNOWN, not zero.

## Attempts, verification and resume

The installed direct Host API read separately passed in 8.702s; its different path makes it a diagnostic comparison, not a matched performance sample. This turn's correctness and no-send scope PASS. Performance distribution, budget disposition, final-candidate comparison and independent performance review are NOT_RUN. No code or infrastructure was changed to improve this sample.

After a reviewed installer exists, root should collect matched cold/warm workloads with correlated preparation, first-token and terminal events plus resource measurements. Bind clocks or use one monotonic observer before attributing time across systems. Keep the driver's stability duration distinct. Stop with measured distributions and explicit budget disposition, or a reproducible failing phase for a bounded repair. Do not resize the original VM or change model routing based on this single observation. The separate native-preflight Claude lane owns its lab VM; no concurrent mutation there. Original card acceptance and historical measurements remain on Plane.
