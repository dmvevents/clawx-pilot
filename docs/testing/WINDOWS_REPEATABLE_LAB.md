# Repeatable Windows GCP lab (CLWX-25 / CLWX-106 / CLWX-133)

A small launcher for a **stable, repeatable Windows test environment**: one
fresh Windows Server 2022 VM per unique run-id, recreated from a **pinned
Google public image** into an **isolated lab network**, never touching the
owner's VM. Faster iteration comes from recreating fresh VMs from one pinned
baseline instead of reusing mutated machines. Runs are close but **not
bit-identical or free**: the googet provider packages installed at first boot
are not pinned, and instances bill while RUNNING.

- Launcher: `windows-pilot/vm-testing/gcp-repeatable-lab.py` (stdlib Python, argv subprocess, no shell)
- Pinned config: `windows-pilot/vm-testing/lab-baseline.json`
- Tests: `tests/unit/gcp-repeatable-lab.test.ts` (fake `gcloud` on PATH; behavioral)

## What is pinned

| Item | Value |
|---|---|
| Project / zone | `gen-lang-client-0649986230` / `us-central1-a` |
| Machine | `n2-standard-8` (8 vCPU / 32 GiB), 100 GB `pd-ssd` |
| Network | custom VPC `clawx-test-lab`, subnet `clawx-test-lab-us-central1` `10.74.0.0/24` |
| Ingress | IAP-only (`35.235.240.0/20`) TCP 22 + 3389 via `clawx-test-lab-iap`, tag `clawx-repeatable-test` |
| Egress | ephemeral external IP (no Cloud NAT exists in us-central1; without an external IP the guest has no outbound Internet) |
| Identity | `--no-service-account --no-scopes`; `block-project-ssh-keys=TRUE` |
| Image | **exact name + numeric ID** in `windows-cloud`, pinned by root on 2026-09-08: `windows-server-2022-dc-v20260814`, ID `8676853931262012812`. No image *family*: families move and break repeatability. |
| Bootstrap | Google's supported Windows SSH path: `sysprep-specialize-script-cmd=googet -noconfirm=true install google-compute-engine-ssh` + `enable-windows-ssh=TRUE` (per Google's Windows SSH doc, `docs.cloud.google.com/compute/docs/connect/windows-ssh`; root validates). The googet provider packages are **not hermetically pinned** — record `googet installed` output post-boot in run evidence. |

Explicitly avoided: golden-image cloning of any signed-in state. Initial
repeatability is recreation from the pinned public image, **not** a snapshot
of the owner VM. The persistent signed-in tenant lane (owner VM
`clawx-win-rc-20260609`) stays a separate, protected environment.

## Commands

```sh
# Read-only: prints the exact gcloud argv as JSON; spawns no subprocess.
python3 windows-pilot/vm-testing/gcp-repeatable-lab.py plan --run-id smoke-a

# Provision one new VM. --image must exactly repeat the pinned image name.
python3 windows-pilot/vm-testing/gcp-repeatable-lab.py create \
  --run-id smoke-a \
  --image windows-server-2022-dc-v20260814 \
  --receipt-dir artifacts/lab-receipts
```

`create` fail-closes, in order: run-id syntax (`[a-z0-9-]`, 4–40, instance
name `clawx-lab-<run-id>`), protected-owner-name collision, placeholder or
non-numeric image config, `--image`/config mismatch, preexisting receipt or
lock, image **numeric ID readback** mismatch against `windows-cloud`,
preexisting instance with the same name (an existing VM is never reused as
fresh), and **drift** in any existing lab network/subnet/firewall (validated
against the exact pinned configuration; missing lab resources are created by
exact name, mismatched ones are refused, never adopted or mutated). A detected
`gcloud` failure aborts without marking provisioning successful. Preserve the failure
receipt; a subprocess timeout can still leave only the lock and supervisor output.

## One VM, one operator

`create` takes a durable exclusive lock (`<run-id>.lock.json`, `O_EXCL`) and
writes a write-once, read-only receipt (`<run-id>.receipt.json`) recording
launcher/config SHA-256, image name + pinned and readback IDs, executed argv,
start/end timestamps, which lab resources were created, the actual new
numeric instance ID and PASS/FAIL. Locks are never taken over; a failed
run-id stays consumed — pick a new one. Receipts live under the operator's
worktree `artifacts/` and are not committed.

## Manual baseline proof (2026-09-08) — not launcher proof

Root manually created two fresh VMs (A/B) from this pinned baseline, both
plain 8 vCPU / 32 GiB with no app tooling installed. Both passed RDP/SSH
protocol probes, authenticated access and the negative control — B only after
its boot settled (initial RDP refusal, later retry succeeded) — and both
reported Windows activation `LicenseStatus 1`. This is independent manual GCP
proof that the pinned image/network baseline works; it does **not** exercise
the launcher. Its separate live run is recorded below.

## What this does NOT prove

- **Provisioning ≠ readiness.** Reachability evidence remains
  `windows-pilot/vm-testing/gcp-iap-lane.sh probe` (real RDP/SSH protocol
  checks plus the closed guest `:9999` negative control) and the
  authenticated SSH marker (`echo CLAWX_VM_ACCESS_OK`), run against the new
  instance name. Provisioning also does not prove installer acceptance —
  the existing reviewed installed-evidence producer and probes own that.
- **Server 2022 ≠ Windows 10/11.** Client-OS, standard-user and
  microphone/tenant results still need their own environments.
- **Vanilla ≠ hosted runner.** GitHub-hosted runners have preinstalled
  toolchains; this lab is closer to vanilla but still a server image with
  cloud drivers.
- Fixture discipline: pin exact artifact filename + SHA-256 per run; never
  "the newest file".

## Current limitations and next commands

1. The image is pinned (`windows-server-2022-dc-v20260814` /
   `8676853931262012812`), so `plan` on the shipped baseline exits 0 with no
   blockers; `create` still refuses any placeholder or `--image` mismatch.
2. No delete/reset/stop/auto-cleanup in this version — deliberate, so the
   launcher cannot destroy anything. Cleanup is a root-executed, explicit
   command per instance, and only after confirming the target's name **and
   numeric instance ID match that run's receipt** (never delete on name
   alone), e.g.
   `gcloud compute instances delete clawx-lab-<run-id> --project=gen-lang-client-0649986230 --zone=us-central1-a`.
3. Instances bill while RUNNING; the receipt records start time so root can
   account for and stop/delete labs deliberately.
4. Each new run validates the named VPC/subnet/firewall against the pinned configuration; equivalent grouped/split TCP port entries are accepted, extra or unrestricted entries refused. Existing matching lab infrastructure is reused, never the VM itself.
5. Independent review approved the initial corrections. The first live `auto-c-20260908` run exposed a split-port representation mismatch and stopped before VM creation. Correction `300133e1` received root's independent delta review and 24 focused passes. New run `auto-d-20260908` successfully provisioned instance ID `4908385059495321872`; its authenticated guest baseline and RDP/SSH/closed-port checks then passed. Preserve both run receipts; never replace the failed one with the successful result.


## Guest readiness and the installed test sequence

1. After `create`, verify the returned name and numeric VM ID against its receipt. API provisioning duration is not Windows boot time. First boot can temporarily refuse RDP/SSH while services and instance keys settle. Retain failed attempts, allow a bounded readiness window and rerun the existing probe; do not create another VM to hide a boot failure.
2. Use free local ports with `CLAWX_WINVM=clawx-lab-<run-id>` when running `gcp-iap-lane.sh probe`. Require RDP protocol, SSH banner and closed guest-port control. Authenticate separately with `gcloud compute ssh clawxlab@clawx-lab-<run-id> --project=gen-lang-client-0649986230 --zone=us-central1-a --tunnel-through-iap --ssh-key-file=<private-lab-key-path> --command="echo CLAWX_VM_ACCESS_OK"`. Keep that operator key private; it is not an end-user requirement.
3. Record OS/build, CPU/RAM, activation, Google SSH package version, app/profile absence and developer-tool absence. Initial Google KMS activation on A failed; after normal KMS connectivity was established, `slmgr.vbs /ato` succeeded. D was already activated at its successful baseline check. Do not classify a reachable but unready guest as accepted.
4. Follow [VM access and environment setup](../../windows-pilot/vm-testing/README.md) to establish an interactive FreeRDP desktop and the intended standard-user test account. SSH Session 0 is only the operator context. Verify any changed tunnel's server identity against the trusted VM identity instead of disabling host-key checking. Modern SCP/SFTP closed unexpectedly in this baseline; `gcloud compute scp --scp-flag=-O` transferred the probe successfully. Check copied-file hashes for acceptance.
5. Select the exact installer and manifest from [the candidate pointer](../CURRENT_WINDOWS_RC.md), then follow [the installed acceptance producer](installed-acceptance-producer.md) and normal installer screens. Do not install development tooling in the clean acceptance profile. Keep resident agent/MCP development in a separately identified instrumented lane.
6. Validate the real user's sequence in [Connect your email and forms](../USER_GUIDE.md). QA uses a test account; end users use their own. Authenticate the correct Chrome profile/account before mailbox or Forms automation, and verify Forms access separately. Keep credentials out of receipts. Installed app → Host API → browser → authenticated account is the required product path.
7. Retain source/artifact hashes, environment and command identities, timestamps and PASS/FAIL/BLOCKED outcomes. A/B/D Server results do not satisfy Windows 10/11 or unaided-user acceptance. Stop idle disposable VMs only after a name+numeric-ID check against their receipts; stopped disks still incur storage charges. Reusing a previously tested profile is an upgrade run, not another clean-install result.

## Development use after a baseline

At 15:35 UTC on September 8, root assigned verified instance `clawx-lab-auto-d-20260908` / `4908385059495321872` to Claude's bounded native preflight repair lane. It may add portable operator-scoped Node/pnpm and the exact source/lockfile for two failing suites. Its earlier clean baseline remains historical evidence; subsequent developer-tool setup does not preserve a clean-machine acceptance claim. Recreate the pinned baseline with a new run ID when the next clean install is required. The original stakeholder RDP remains under root's separate ownership. Native setup/result paths belong in the lane receipt, not an assumed successful setup.

### Verified native development loop

The September 8 auto-d development setup used portable **Node 24.20.0**, **pnpm 10.33.4** from the candidate's packageManager pin and frozen OpenClaw **2026.9.2** dependencies. These are operator tools on a designated development VM, not end-user installation requirements. Reuse a verified setup; reselect pins from the next candidate when they change.

1. Verify the instance name/numeric ID and exclusive operator before guest changes. Keep tools, source, dependency store and logs under the operator's `clawx-dev` directory; use process-local PATH/COREPACK_HOME only. Record the transition out of the clean baseline.
2. Download the portable Node archive from its official versioned release and verify SHA256 against the official release checksum. Obtain the exact public source SHA archive and compare the verifier/tests/package.json/lockfile hashes with the reviewed local tree. Do not copy private account state or session logs.
3. Run pinned `pnpm install --frozen-lockfile` over a **kept-live SSH command**, with a bounded operator timeout, durable log and explicit native exit. The first detached hidden `Start-Process` returned “started” but left no log, exit receipt, dependencies or process. The kept-live replacement succeeded with native exit 0 in 318s. The exact cause of the detached disappearance remains unknown.
4. Keep PowerShell's `$LASTEXITCODE` from the actual Node/pnpm command and write it to the receipt before another native command can replace it. Outer SSH exit 0 alone does not prove a passing test. On interruption, inspect the log/exit receipt and owned processes before retrying; never start a second install merely because the first controller disappeared.
5. Run only the failing baseline suites first. Copy only the reviewed repair files, verify hashes again, then rerun the affected suites and a targeted control. September evidence reproduced the original two failures, then isolated one remaining cleanup failure; changing TEMP to a short path did not fix it. Preserve selected failure directories until the causal comparison is recorded.
6. Return code through an isolated worktree, focused checks and independent review. Record source/tool versions, paths, timestamps, native exit/counts and limitations in a private receipt; commit sanitized findings to the existing bug report. A development test still does not prove the installed package, Windows 10/11 or the principal's unaided workflow.

Evidence: [native source/blocker handoff](../bugs/CLWX-106-installed-verifier-identity.md), [setup failure and recovery](../bugs/CLWX-25-windows-lab-repeatability.md). The remaining SQLite lifetime repair has its own source owner; this procedure does not declare its result green.

### September 8 transfer and process-recovery controls

Use legacy SCP `-O` through the known-host IAP SSH route for this Server image. It copied the four native verifier/control files in 6.8s after the default SCP protocol failed. A piped base64/PowerShell `Console.In.ReadToEnd()` fallback stalled and left a guest PowerShell process; do not use it as the default transfer. Bind the received source with SHA256 before execution. When an encoded command exceeds Windows command-length limits, copy the `.ps1` and use `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <owned-path>`; retain the failed command receipt separately.

Process recovery is limited to verified owned PIDs/process groups. Never use broad `pkill -f` patterns for `gcloud`, `ssh`, `tunnel-through-iap`, `node` or app names. An author violated this boundary; root stopped that author group, checked existing tunnels, restored the original CDP forwards and stopped only the surviving guest transfer PID whose command line matched this task. Root then completed native proof without reinstalling dependencies. See [CLWX-25](../bugs/CLWX-25-windows-lab-repeatability.md) for receipts and the exact-source results.
