# CLWX-25 — Shared Windows test state and access-contract drift

## Identity and impact

Reported September 8, 2026. Owner CLWX-25, related CLWX-106/125/133. Existing test machine: `clawx-win-rc-20260609`, Server 2022, 4 vCPUs/16 GiB, multiple RDP users, persistent development tools and prior installer state. Source checkout `fix/doc-tooling-steering` at `f4d0d0cb`; this is an environment defect record, not evidence about a new installer. The owner requested a stable repeatable testing environment and faster iteration while preserving their active session.

The single shared VM makes app/Gateway/browser mutations serial and contaminates clean-install claims. Three RDP sessions still share CPU, disk and machine state. An administrator profile, source checkout or source test is not a standard-user Windows 10/11 installer result.

## Reproduction and expected result

Read `windows-pilot/vm-testing/README.md`, then describe the selected instance, installed history and firewall configuration without changing it. The existing guest carries development tools and reused app profiles; no current clean-image recreation procedure was verified before this task. Expected: a versioned baseline, unique fresh machine identity, explicit tooling/user class, readiness checks, artifact-bound evidence and one operator per desktop.

A related access-contract mismatch was observed by a project-scoped firewall GET: `clawx-allow-ssh-iap` allows TCP 22 from `0.0.0.0/0` to tag `clawx-windows-test`. Its name and IAP runbook do not establish IAP-only SSH access. Other ingress rules may also apply on the shared default VPC; this observation is not a complete exposure audit and does not prove an attack. Existing RDP rule is IAP-restricted. Expected: network policy matches the documented access boundary.

## Cause, evidence and decisions

Confidence HIGH: shared VM/profile history and the firewall API response directly establish these facts. No latency percentage or exploit is inferred.

Private receipts: `artifacts/ga-fable-20260908/windows-lab/`. Root created a **separate** custom VPC `clawx-test-lab`, subnet `10.74.0.0/24`, IAP-only TCP 22/3389 firewall and two new instances from exact public image `windows-cloud/windows-server-2022-dc-v20260814`, image ID `8676853931262012812`. Each requests n2-standard-8, 32 GiB and 100 GB SSD with no cloud service account, project SSH keys blocked and no copied stakeholder state. The external address supplies outbound connectivity; the new network has no general public ingress rule. Recorded network/subnet/firewall GETs confirm the intended configuration.

Initial recreation uses the pinned public OS image. It is **not** a snapshot of the owner's installed or signed-in machine. The Google SSH package installed at bootstrap is recorded, not claimed hermetically pinned. Node/Git/Python/Claude/MCP remain absent in the clean lane. Future agent tooling belongs in a separately identified instrumented environment.

Original VM, its firewall rule and its active desktop were not modified. The original rule's wider SSH scope remains unresolved pending an appropriately scoped change that preserves current access; creating the new lane does not claim to repair it.

## Failed probes retained

- Modern default `gcloud compute scp` closed its SFTP connection against this Google Windows OpenSSH setup. Explicit `--scp-flag=-O` transferred the existing environment probe successfully. No server config was loosened. Transfer failure's precise SFTP cause remains UNKNOWN; use the verified compatibility path and verify copied bytes when used for acceptance.
- A one-off PowerShell probe with `$ErrorActionPreference='Stop'` misclassified `ssh -V` stderr as NativeCommandError. Reading the executable's FileVersion removed this diagnostic error. It was not an SSH authentication failure.
- Initial Windows activation on A returned `0xC004F074`, LicenseStatus 5. After Google KMS DNS/TCP 1688 passed, the normal `slmgr.vbs /ato` retry reported activation successful and LicenseStatus 1. B independently reported LicenseStatus 1. No licensing bypass or firewall change was used; preserve the first-boot failure as a transient readiness observation.

## Verification and resume

### First real launcher run: restricted firewall falsely rejected

At 14:35:02 UTC, root ran the independently reviewed launcher (`9822832e`) with run ID `auto-c-20260908`. It exited 1 after 13.089 seconds, before creating a VM, and retained its immutable FAIL receipt and consumed lock. The named firewall's actual API response has two `allowed` entries: TCP port `22`, and TCP port `3389`. The launcher required one entry containing both ports. Expected: these equivalent restricted representations pass; extra ports, unrestricted TCP, other protocols, wrong source/target/network still refuse. Actual: the valid split representation was classified as drift.

Confirmed cause, HIGH confidence: `check_firewall` checks `len(allowed) != 1`; the fake-gcloud success fixture only covered Google's combined representation. The real network was not loosened or altered. Bounded correction owns only the comparison and behavioral fixtures; root will run a new unique ID after independent approval. Receipt: `artifacts/ga-fable-20260908/windows-lab/launcher/auto-c-20260908.receipt.json`; actual firewall readback: `lab-firewalls.json` in its parent directory. Do not delete the failed receipt, reuse the lock or modify the valid firewall to accommodate the test fixture.

First VM has authenticated SSH marker, RDP protocol and SSH banner passes plus closed guest-port 9999 IAP rejection. Guest baseline confirms 8 CPUs/32 GiB, no app/OpenClaw state or developer commands; the existing environment probe confirms no installed app or Gateway/Host API/CDP listeners. These probes run as the operator administrator in SSH Session 0. They do not establish an interactive standard-user installer journey.

A second fresh machine passed the same connection/baseline checks after first boot settled. Its first RDP probe returned IAP backend 4003; the later complete RDP/SSH/closed-control probe passed. Both machines have valid Windows activation. These are two manual recreation results; launcher execution is recorded separately below. The Claude launcher author owns only its provisioning script, pinned config, behavior tests and repeatable-lab runbook. First review rejected a numeric-ID response with the wrong VM name (false PASS), a stale test firewall literal after root pinned the config, stale runbook wording and malformed-JSON failure without a receipt. Correction `b57b940b` adds exact response-name verification, config-derived test expectations and a retained FAIL receipt for malformed JSON. Independent re-review APPROVE: 15 tests and three additional adversarial controls. Root integrated as `9822832e` (with prerequisite commits `0aca3e4d`/`969ae25e`). Root owns cloud mutations and Plane. A gcloud subprocess timeout still exits unsuccessfully without a final receipt; retain the consumed lock and supervisor output, inspect cloud state, then choose a new run ID. No automatic retry may create duplicate resources. No GA or clean Windows client result follows from infrastructure readiness. Keep the original owner-session hold and no-send/no-submit constraints.


### Corrected live provisioning and owner-window update

Correction `300133e1` (operations integration `d1863164`) accepts the exact union of explicit TCP ports across grouped or split entries. Each entry is checked before union, so an added unrestricted TCP entry cannot disappear during normalization. Root independently inspected the full two-file delta and tested the real Google response plus extra unrestricted/UDP entries; 24 focused tests passed. Real run `auto-d-20260908` then returned PASS with newly created instance ID `4908385059495321872`, name `clawx-lab-auto-d-20260908`. The earlier C failure remains immutable. This establishes actual launcher provisioning; guest readiness is recorded separately.

The owner subsequently stated they are no longer using RDP and authorized its use. The original VM's observation-only desktop hold is lifted for root-controlled testing; the Mac Electron/Keychain hold remains. Existing loopback SSH access initially failed host-key verification because the local port changed. Root compared the current three public keys with the previously trusted localhost:12222 entry and independently matched Ed25519 to `compute.2748349704588098112` in Google known_hosts. The active IAP tunnel PID targeted that exact original VM. Explicit HostKeyAlias plus strict checking produced `CLAWX_VM_ACCESS_OK`; no checking was disabled and no key was replaced.

### Native development setup: detached command did not establish installation

At 16:22 UTC, after the native author supervisor timed out, root made a read-only SSH check of isolated `auto-d` (ID `4908385059495321872`). Portable Node 24.20.0 and exact public `1d745567` source had prior checksum/file-hash receipts. However the author's hidden `Start-Process` dependency command had only returned “install started”: there was **no install log, no exit receipt, no node_modules directory and no surviving owned development process**. This is setup NOT_COMPLETE, not a successful dependency install or native test. Private root receipt: `artifacts/ga-fable-20260908/windows-lab/native-recovery-status.json`; original command and source hashes remain in the author stream.

The precise reason for the detached process disappearing is UNKNOWN. Windows SSH child-job lifetime and command launch failure remain hypotheses. Resume must inspect existing state and use a kept-live, bounded SSH command with explicit native exit capture, or an explicitly owned durable task with receipt. An initial Start-Process acknowledgment is not completion evidence. Do not repeat unchanged source/Node downloads, launch another hidden install, or alter machine-wide PATH/services. The resumed Claude author remains the only mutator of auto-d; root owns the original RDP. Native test dependency setup has a ten-minute bounded recovery attempt before recording a concrete blocker; hosted CI can provide native validation after source approval. Recreate the pinned image for future clean-install claims.

The kept-live replacement install completed in 318s with pnpm 10.33.4 and native exit 0. This prepared environment then reproduced the exact original two failures and narrowed the corrected result to one persistent SQLite cleanup failure, including a short-path control. [CLWX-106](CLWX-106-installed-verifier-identity.md) owns that source defect. The first native resume subsequently reached its supervision deadline; the sole next lab owner is `moe26-db-lifetime`, which reuses the verified tools/source/dependencies. Infrastructure access and native reproduction now work; neither establishes a successful installer or fresh-client acceptance.

## Native transfer recovery scope breach — September 8, 17:03 UTC

Claude author `moe26-db-lifetime` committed source checkpoint `99468423`, then failed a `gcloud compute scp` transfer (connection closed). Its fallback piped base64 into PowerShell `Console.In.ReadToEnd()` over SSH; no received files appeared and the command remained active beyond 120 seconds. Instead of stopping only its owned transfer process, the lane issued broad `pkill -f` patterns for `tunnel-through-iap` and `gcloud compute ssh`. Those patterns are not scoped to the assigned VM, task or process group and violated the one-mutator/owned-process contract. Do not reuse this recovery command.

Root sent SIGINT only to the verified author process group 61559 at 17:03:18 UTC. The supervisor classified the stopped run CLI_FAILED; source checkpoint and private transcript remain preserved. Independent read-only source review continues. Post-containment original SSH/RDP ports 35222/35389 were reachable; CDP forwards 48792/49223 were closed. Root verified the original SSH host identity, restarted just those two forwards and confirmed all four ports reachable. This is tunnel recovery evidence, not a new app acceptance run. Exact effects on any other connection are UNKNOWN. No guest app/profile change is attributed to this event.

Root takes over auto-d native proof after inspecting surviving guest transfer processes. Stop only the exact process IDs whose command line matches this task's stalled incoming-file/ReadToEnd command. Reuse the already-proven legacy SCP `-O` transfer with IAP, known host identity and SHA256 readback; do not repeat dependency installation. Preserve any subsequent transfer/proof results separately. Private receipts: `artifacts/ga-fable-20260908/windows-lab/db-lifetime-{containment,post-containment}.json`, `native-db-root/`.

Root recovery results: verified stalled transfer PID3948 stopped; legacy SCP `-O` copied all four files in 6.8s, exit 0. The first large encoded PowerShell verification command was rejected before execution with “command line is too long”; transferred `.ps1` plus `-File` passed, binding all six source/package/lock hashes. No dependency reinstall. Native cached-handle controls and repaired normal/short-TEMP suites now pass (33 and23 tests, each native exit0). Original failed receipts were retained with distinct retry filenames. Exact source `99468423` proceeds to hosted34255425275; Server development proof is not fresh Win10/11 acceptance.

## GCP credential refresh expires during native iteration — 17:18–17:24 UTC

After the verified99468423 native runs, the attempted8bb7a779 full-unit lane failed at legacy SCP transfer with `Reauthentication failed. cannot prompt during non-interactive execution`. The driver asserted transfer exit before invoking PowerShell/tests, so the suite **did not launch**; previous “running” status is corrected to NOT_RUN. A fresh read-only auto-d probe failed the same way. Exactly one CLI account is registered. The existing authorized-user ADC belongs to the same quota project, but its refresh also fails; the failed private token output was removed. New original-VM SSH through the existing IAP listener resets at key exchange. Existing established CDP/RDP streams were not forcibly stopped and are a separate access class.

Required recovery is account-holder `gcloud auth login`; root requested it while continuing the reviewed one-line fixture correction through hosted34256868050. This is an authentication boundary, not VM/test or installer failure. Do not change firewall/VM identity or relabel pre-transfer failure as a test result. Once credentials are renewed, verify instance/host identity and process/state before resuming. Private evidence: `windows-lab/native-db-root/fixture-copy-transfer.json`, `root-native-full-driver.log`, `full-native-progress.json`, `windows-lab/adc-refresh-status.json` under `artifacts/ga-fable-20260908/`.

## Existing connection boundary and artifact transfer — 17:39–17:50 UTC

Existing original Windows Chrome/Electron CDP endpoints each return HTTP200 with websocket metadata at17:39:04UTC; new SSH still requires account-holder GCP reauthentication. Do not label the running desktop dead or command access restored. Hosted8bb7a779 successfully produced moe.26 while the account-holder request remained pending. Slow host artifact download was recovered with64 bounded concurrent HTTP ranges:452chunks,227.21s, exact Content-Range/length per chunk and final GitHub archive SHA256/length agreement. Only the two exact owned serial transfer PIDs were stopped after replacement proof; no broad process kill or VM/network change. The partial serial artifact is not acceptance. Scripts/receipts: `/private/tmp/clawx-moe26-run-34256868050/`; all36 extracted payload checks and172 compiled files pass. Installed testing remains NOT_RUN pending restored command access and state backup.

## Durable access recommendation — researched September 8

The current evidence proves a user-credential reauthentication requirement;
it does not identify the exact session-policy or refresh-token expiry trigger.
Keeping a tunnel open does not repair that authorization boundary. The
[repeatable lab runbook](../testing/WINDOWS_REPEATABLE_LAB.md#durable-automation-access--proposed-not-deployed-2026-09-08)
now records the proposed follow-up: separate GCP test controller with an
attached, narrowly scoped service account; renewed credentials; owned tunnel
supervision; guest/controller job receipts; and one operator per VM. Human RDP
and Windows/Microsoft account authentication remain separate.

Official Google documentation supports attached workload identity, per-VM IAP
access and port conditions. IAP's documented one-hour limit is inactivity,
not a universal active-session lifetime. Existing user CLI/ADC refresh failure
is not fixed by this research. No IAM/network/VM identity or session policy was
changed. Acceptance requires renewal/reconnect, restart/reboot, no-personal-
credentials, no-duplicate-job and permission-revocation controls; an overnight
soak may run in parallel with product acceptance. GitHub federation and
Tailscale are recorded alternatives, not installed dependencies. Current
moe.26 installed testing is still pending access restoration.

## Access recovered; stale Windows diagnostic listener — 18:12–18:23 UTC

The renewed root credential context passed an exact auto-d instance read and fresh authenticated original-VM SSH via IAP. The old local35222 tunnel still reset; a fresh proxy worked without modifying Windows identity, IAM or firewall. A new certificate-pinned RDP connection restored the existing standard user to active Session2. The verifiedmoe26 installer was uploaded to the existing private, uniform-access bucket and downloaded with the original guest workload identity; native SHA256 and476768641-byte size match the release manifest. No public release was made.

Before upgrade, the installedmoe25 app accepted a graceful `app:quit` through its own renderer and exited. CIM reports no installed app processes and PID388 absent; ports13210/18789 are clear. Nevertheless Windows continues reporting a Listen row on diagnostic9223 owned by the absentPID388, and `/json/version` gives no HTTP response. Closing only the root-owned SSH CDP-forward PID4829, after exact command/PGID verification, did not clear it. Root did not kill unrelated processes or reset Windows. The premature installer-status query found no task because the preflight correctly withheld launch.

Cause remains UNKNOWN; no evidence this is a moe26 product regression (it has not launched). The assisted test helper now uses free diagnostic9224 and still requires all app processes absent, the oldPID absent, and the real service ports clear before protected profile backup/install. This changes only private operator scripts, not product source or acceptance results. Preserve this anomaly for lifecycle follow-up; a passing new-port launch does not prove old9223 was released. Private receipts: `artifacts/windows-vm/20260908-moe26/{quit-terminal-check,stale-debug-listener-diagnosis,close-owned-cdp-forward,after-owned-forward-close,diagnostic-port-adaptation}.json`.

The controller author remained live but spent804.6s without producing source edits. Root verified its PID/PGID, interrupted only that owned CLI group, inspected the zero-edit worktree, and resumed the same session at explicit medium effort with a smaller bootstrap/probe scope. Initial result is CLI_FAILED/owner-interrupted, with observed Fable5/Bedrock and a client estimate ofUSD3.14 (not a billing statement). General job orchestration and durability soak remain deferred until the minimum controller/probe is reviewed and deployed; they are not silently claimed as implemented. Receipts: `artifacts/ga-fable-20260908/durable-controller-author/owner-interruption.json`, task `durable-controller-resume`.


### moe.26 assisted installer observer loss — September 8, 18:42 UTC

Normal standard-user `/CURRENTUSER` installation reached the explicit successful completion page; root observed the text, unchecked Run, and invoked Finish. Installed ASAR `a81d7dd0cf030df2ab934068aaacf8d5d9edcb70d984c2a07dce72854b7c62bd` and EXE `44ff6a6f90fc5872b38626f544e7f19166185ecf2e5bb607f66dc3ddf386f902` match moe.26 source `8bb7a779`, run34256868050. The private uniform-access GCS object and native installer download also matched the manifest. Backup verified 61 app-data plus634 OpenClaw files before mutation, with restricted ACL and previous ASAR retained.

The task that waited for installer exit had a15-minute execution limit. Its later40-minute settings readback already showed Ready; after Finish, result267014 and missing `install-result.json` establish that the observer terminated. The Task Scheduler operational log is disabled, so the precise termination trigger remains UNKNOWN; the original limit is the leading explanation, not a proven event. Native installer exit is **NOT_CAPTURED**, never inferred as0 from the successful GUI. The five-minute UI observer timeout likewise was not installer failure: extraction CPU/I/O continued and the Finish page appeared later. No repeat installer was launched to manufacture a receipt.

A separate reconciliation records GUI completion, fresh installed hashes and no matching installer CIM process. Its explicit status is `GUI_COMPLETE_HASH_VERIFIED_NATIVE_EXIT_UNKNOWN`; diagnostic startup may use that evidence while complete install acceptance retains the exit gap. An initial reconciliation refused because historical PID5192 was reported present by Get-Process despite adjacent CIM absence; identity/reuse cause UNKNOWN. The first shortcut task then correctly refused the missing receipt, so no app launched. Root corrected this private guard to actual installer name/path and dispatched a newly identified launcher only after successful reconciliation. No product gate was weakened.

Evidence: private `artifacts/windows-vm/20260908-moe26/` contains native hash/readback, the viewed Finish screenshot, original failed reconciliation, scheduler log availability, startup dispatch and separate successful reconciliation. Future assisted observers need their full execution budget set **before** start and explicit liveness monitoring through Finish. Exact owned process identity is required; stale PIDs alone cannot identify a running installer. Standard-user Windows10/11, fresh-machine setup and full same-candidate acceptance remain unverified.

### Controller source findings before deployment

The initial controller attempt was interrupted after804.6s without edits; its medium-effort continuation produced a CLI, focused tests and documentation but reached the900s supervisor deadline. Both retain Fable5/Bedrock final usage evidence. Root's source inspection found: stripped CLOUDSDK_CONFIG could fall back to personal default credentials; a local bound listener was treated as remote access while backend closure could incorrectly satisfy an IAM-denial check; process-group termination did not assert the owned child group. The SSH option terminator/config boundary also requires correction. `durable-controller-correct` owns those bounded repairs; independent review and cloud deployment remain pending. No unreviewed controller code has run against cloud resources.

### moe.27 retest preparation — September 8, 20:05 UTC

The first stage preflight stopped before creating the guest directory: a Python raw-string WQL filter passed literal backslashes around the Chrome process name, and `Get-CimInstance` rejected the query (0x80041017). Root replaced the fragile filter with an explicit PowerShell `Where-Object` predicate; a new receipt preserves the failed attempt rather than overwriting it. At20:05:47UTC the corrected check passed: app/service/diagnostic listeners absent,11 QA Chrome processes retained in Session2,24.3GiB free, new source/run-specific directory created. All five staged PowerShell scripts pass native parsing. No installer was staged or launched at this checkpoint. Private evidence: `artifacts/windows-vm/20260908-moe27/prepare-reviewed-run-stage.json`, `prepare-reviewed-run-stage-retry.json`, `reviewed-run-script-transfer.json`, `reviewed-run-script-parse.json`.

The prepared install observer requires a40-minute budget at registration and verifies it before starting; the first-launch helper now requires captured native installer exit0 and matching source/run/EXE/ASAR evidence. The obsolete historicalPID388 guard is removed; current app/listener identity checks remain. These are prepared private operator changes, not yet proof that a new installation completed or that the prior observer-loss defect cannot recur.
