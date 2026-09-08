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
exact name, mismatched ones are refused, never adopted or mutated). Any
`gcloud` failure aborts; there is no false PASS.

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
this launcher, which has never executed a real `create`.

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
4. First real run needs root's read-only cloud discovery confirming the lab
   VPC/subnet/firewall names are unclaimed, then an authorized `create`,
   then `gcp-iap-lane.sh` probes with `CLAWX_WINVM=clawx-lab-<run-id>`.
5. Independent review (2026-09-08) returned CHANGES_REQUIRED; findings
   F1/F2/F4 are fixed in this revision and the reviewer follows up on the
   delta before root's first `create`.
