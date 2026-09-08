# moe.26 installed Windows evidence — September 8, 2026

Current result: assisted installer GUI completion and installed identity PASS; native installer exit NOT_CAPTURED; startup FAIL; journeys BLOCKED_CLWX135. GA remains RED. This report records evidence, while `docs/COMPLETION_PLAN.md` owns the next work.

| Identity | Value |
|---|---|
| Product source / hosted run | `8bb7a77907faf35fb8fc4136073ce340ea9a9aaa` / 34256868050 |
| Version / profile | `0.4.3-moe.26` / keyless-public |
| Installer SHA256 / bytes | `5de74d6d1ce40b5c4c5d963f66bc74dd6c880c4972a6dbf82cd88c1ac5beb620` / 476768641 |
| Installed ASAR SHA256 | `a81d7dd0cf030df2ab934068aaacf8d5d9edcb70d984c2a07dce72854b7c62bd` |
| Installed EXE SHA256 | `44ff6a6f90fc5872b38626f544e7f19166185ecf2e5bb607f66dc3ddf386f902` |
| Environment | Original GCP Server 2022, 4 CPUs / 16 GiB; standard-user QA Session 2; existing profile and prior developer provisioning |
| Access | Fresh authenticated strict-known-host IAP SSH; certificate-pinned FreeRDP |
| Install mode | Normal assisted `/CURRENTUSER`; license, default user-local destination and completion page observed |

The installer transferred through the existing private uniform-access GCS bucket using the guest's existing workload identity, with no public IAM grant. Native Windows length and hash match the manifest. Before mutation, restricted backups verified every file: 61 app-data and 634 OpenClaw files, plus the previous app.asar. Chrome and signed-in QA state were retained.

Root observed `Ministry of Education has been installed on your computer`, unchecked Run, then clicked Finish at 18:42:19UTC. Fresh native hash readback at 18:43:06UTC matched both shipped files. The observer task had terminated before it captured native exit. Its result 267014 is a scheduler result, **not the installer exit code**. Operational event logging was disabled; the original 15-minute limit is a likely cause but remains unproven. The native exit remains UNKNOWN. No duplicate installer was launched.

A separate private reconciliation requires successful GUI evidence, current hash equality and absence of the actual installer process. The first diagnostic shortcut task refused a missing reconciliation; after correcting the private stale-PID guard, reconciliation passed and a separately identified shortcut launch started at 18:45:23.501UTC. Diagnostic CDP 9224 avoids the retained old 9223 listener anomaly. Existing cloud provisioning and local model service were present: this does not establish a vanilla-machine setup result.

Required same-candidate startup, existing/fresh/next chat, Outlook/drafts, Forms previews, document discovery/fidelity/reopen, offline local behavior, recovery, matched latency, Windows 10/11 and unaided stakeholder acceptance remain incomplete. No send, attachment download or form submission is authorized by these probes. No public release has occurred.

Private evidence: `artifacts/windows-vm/20260908-moe26/` holds native download/hash, backup, observed installer controls and viewed completion screenshot, failed observer/reconciliation attempts, successful reconciliation, startup observer and later journey receipts. Secrets and private account/body/Form URLs remain excluded from committed evidence and Plane. [CLWX-25](../bugs/CLWX-25-windows-lab-repeatability.md) contains the transferable observer/access RCA.


At the end of the 360-second observer, startup was NOT_READY and observer exit 1. The Gateway log repeatedly reports incomplete package lifecycle and code 1; neither chat nor Microsoft tests were started. Exact native pending marker and postinstall hashes agree with the extracted9.2 package. Working moe.25 used OpenClaw 2026.4.23 with no pending marker. [CLWX-135](../bugs/CLWX-135-openclaw-package-lifecycle.md) records the regression, causal limits and bounded repair. Root requested graceful idle app quit to stop retries; the failed artifact remains unchanged for diagnosis.
