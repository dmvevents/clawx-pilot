# Repeatable Windows lab and authenticated browser evidence — September 8, 2026

Scope: infrastructure, operations source and assisted Microsoft browser setup. **GA remains RED.** The product candidate remains unbuilt at this checkpoint; the installed Microsoft observations below belong only to **0.4.3-moe.25**. Raw receipts are private under `artifacts/ga-fable-20260908/windows-lab/`.

## Repeatable infrastructure

The root operator created an isolated custom VPC/subnet with IAP-only ingress for TCP 22/3389, no cloud service account and no copied stakeholder state. The baseline is pinned to `windows-cloud/windows-server-2022-dc-v20260814`, numeric image ID `8676853931262012812`; each VM has 8 vCPUs, 32 GiB RAM and 100 GB SSD. Actual guest probes confirm Server 2022 Datacenter build 20348, activation LicenseStatus 1, OpenSSH 8.9.1.0, no app/OpenClaw profile and no Node/npm/pnpm/Git/Python/uv/Claude commands. Provider bootstrap packages remain unpinned, so this is not a bit-identical image claim.

| Run | Actual result |
|---|---|
| Manual A, `clawx-lab-a-20260908`, ID `7401981722240067778` | Authenticated SSH, RDP protocol, SSH banner, closed guest-port control and guest baseline PASS. Initial activation failed; normal Google KMS connectivity plus `slmgr.vbs /ato` succeeded. Stopped after name/ID verification. |
| Manual B, `clawx-lab-b-20260908`, ID `8516818648026687851` | Same baseline/access/activation PASS. Initial RDP IAP 4003 was retained; later complete readiness probe passed after boot settled. Stopped after name/ID verification. |
| Launcher `auto-c-20260908` | FAIL in 13.089s before VM creation: valid split firewall port entries falsely rejected. Immutable receipt and lock retained. |
| Corrected launcher `auto-d-20260908`, ID `4908385059495321872` | Real provisioning PASS in 35.135s, reusing the exact validated lab network. First SSH attempt hit boot/key-propagation refusal; retained retry succeeded. Guest baseline, authenticated access and full RDP/SSH/closed-port control PASS; activated. Baseline receipt retained; later assigned to the native preflight development lane. Recreate a fresh instance for future clean-machine acceptance. |

Provisioning durations include launcher API checks and are not Windows boot, app startup or product latency measurements. All guest baseline probes used the operator administrator through SSH Session 0. These results do not establish interactive standard-user installation or Windows 10/11 acceptance. Stopped VM disks still incur storage charges.

The launcher is [documented end to end](../testing/WINDOWS_REPEATABLE_LAB.md). Initial review required exact create-response identity, configuration-derived fixtures and a retained failure receipt for malformed JSON; correction `b57b940b` received independent APPROVE with 15 tests. The first live run exposed the split-port gap. Correction `300133e1`, integrated as `d1863164`, received root's independent delta review, real-response controls and 24 focused passes. The earlier root combined operations run had four suites/91 tests passing before this last correction. Failure history, residual timeout-without-final-receipt behavior and the unchanged original default-VPC SSH rule are preserved in [CLWX-25](../bugs/CLWX-25-windows-lab-repeatability.md).

## Assisted installed browser and mailbox result

The owner released the original VM's RDP observation-only hold. Root remained the only desktop mutator; the Mac Electron/Keychain launch hold remains.

1. The existing SSH tunnel's current public keys matched the prior trusted port and Google known-host identity `compute.2748349704588098112`. An explicit HostKeyAlias with strict checking restored authenticated access. No host-key check was disabled.
2. FreeRDP connected to the existing standard-user session using a certificate SHA256 obtained from the SSH-verified guest; its password was passed through stdin, not command arguments.
3. Initial guest state showed the installed moe.25 app in Session 2 but the user-Chrome automation port 18792 in operator Session 1. Session 2 also had an OpenClaw-managed browser, which was excluded from Microsoft acceptance. This reproduces the ownership condition tracked by CLWX-130; it is not a claim that every earlier timeout had that cause.
4. Root gracefully closed only the verified operator's ClawX CDP profile. The installed app then opened Outlook through renderer → Host API → browser service in **5,421 ms**. Guest readback verified PID 2748, Session 2, the expected standard-user Chrome profile and `managedProfile=false`.
5. One attempt using a privately recovered historical QA credential reached Outlook. Root opened the account menu and verified the exact expected mailbox in its visible account region, with inbox controls present. The initial identity check was retained as unverified while the account menu content loaded; a URL alone never passed authentication.
6. At **15:02:18 UTC**, the installed app's `/api/outlook/read-inbox` returned HTTP 200, success true and **three messages** in about **8.7 seconds**. Raw message details remain private. No send, attachment download or Forms submit occurred.

7. A fresh ordinary **Online chat** requested only the count and unread count of the three newest messages. It returned “3 messages, all unread,” with no error chip, and passed the driver's 30-second terminal stability check. The driver's send-to-stable-answer measurement was **95,044 ms**, one sample; it includes its nine-second unchanged-answer condition and is not first-token latency. The renderer receipt listed no tool names, so root checked the actual Gateway session: `de46b8e9-8206-48ef-8fdf-60a48012c072.jsonl` records **`outlook.read_inbox` at 15:05:42.350 UTC**. Provider/model route labels were `custom-moecloud` / `moe-demo-pro`; those labels alone do not identify the cloud model behind the broker.

Private proof: `inbox-chat/chat-turn-2026-09-08T15-04-21-169Z.json` and `inbox-chat/gateway-tool-provenance.json`, alongside the account/profile and Host API receipts. The installed artifact's exact identity remains the [moe.25 baseline](WINDOWS_MOE25_PLANNING_BASELINE_2026-09-08.md); no candidate bytes changed during these tests.

This is assisted Server/standard-user browser, Host API and model-driven inbox evidence on moe.25. The 95-second sample does not meet a repeated-workload performance criterion. Graph OAuth, draft/reopen, final-candidate rerun and unaided Windows client acceptance remain separate checks. Browser authentication does not prove Graph authentication.

Read-only timing extraction subsequently found **41,414 ms** from the Gateway's user record to its tool-use record, **6,137 ms** to the Outlook tool result, then **4,223 ms** to the final assistant record: **51,774 ms** within the guest's clock domain. This narrows the observed browser-tool interval; it does not isolate inference, queueing, network or renderer delay. No incident-time host/guest clock-offset receipt exists, so the remaining driver interval is not assigned to a component. Zero-valued usage fields provide no usable token/cost measurement. [CLWX-43](../bugs/CLWX-43-inbox-latency.md) preserves exact timestamps, measurement semantics and the next test.

## Installed Forms previews and Graph boundary

On the same installed moe.25 and user Chrome session, `/api/forms/list` returned both forms as `available`. This list only checks configured links; root then invoked the installed **preview** routes with the existing synthetic fixtures from `scripts/forms-fill-daily-report.ts` and `scripts/forms-fill-suspensions.ts`:

| Installed Host API route | Result | Duration |
|---|---|---|
| `/api/forms/preview-daily-report` | `previewed`; 55 filled, 2 skipped, 0 errors | 19,703 ms |
| `/api/forms/preview-suspension` | `previewed`; 29 filled, 4 skipped, 0 errors | 16,512 ms |

Both calls returned HTTP 200. An independent read-only observation found filled controls on both live form pages, the expected synthetic student/PIN on Suspensions, no sign-in obstruction and no submission receipt (`forms-visible-readback.json`). No submit route was invoked; these are assisted synthetic previews, not statutory reports or submission acceptance. Private receipts: `owner-form-daily-report-private.json` and `owner-form-suspensions-private.json`. The same final-candidate rerun and unaided principal flow remain required.

The installed `msgraph:status` separately reports `configured:false`, `signedIn:false`, no account and no granted scopes. Its `effectiveMock:true` derives from the missing Graph secret; this does **not** make the inbox checks mock evidence: actual installed app logs show both successful three-message reads as **`transport=browser status=ok`**, alongside the earlier `needs_signin`. Private allowlisted proof: `inbox-chat/installed-transport-proof.json`; Graph/configuration receipt: `owner-installed-forms-graph-private.json`. No successful Graph connection is claimed.

## Repeatable login-helper result

Reviewed helper `59465b57` now passes native Windows controls using the installed moe.25 runtime: wrong expected account refuses with child exit 11; exact account verifies with child exit 0. The account menu is opened only as needed and restored. Root retained and corrected an SSH-wrapper exit-code capture issue; the distributed laptop copy now matches the reviewed script. [CLWX-61 handoff](../bugs/CLWX-61-test-mail-auth-identity.md) records exact hashes, source/review, commands and limits. The controls used an already-authenticated inbox; signed-out entry remains separate.

## End-user documentation and next validation

[Connect your email and forms](../USER_GUIDE.md) is written for principals using their **own** Microsoft accounts. It covers signing into the app's Chrome profile before email automation, verifying the mailbox, separate Microsoft 365 Settings sign-in, form links/access, review-before-send/submit and recovery/support. The QA mailbox is only a fixture. Onboarding/design/operator docs and VM skills link the guide; local link checks passed. CLWX-134 now explicitly requires an unaided user to follow it on the selected Windows artifact, with original acceptance retained.

Source integration and the reviewed QA login-helper repair are complete in their respective product and operations branches. Claude Fable 5 on Bedrock now owns native preflight repair and the separate lab VM's development workspace. Root retains sole control of the original RDP desktop, evidence and release decisions. Review/integrate the native repair, identify/build the next installer, then rerun the affected installed journeys and end-user guide. No source or infrastructure result grants GA readiness.
