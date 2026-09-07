---
name: gcp-iap-windows-lane
description: Run Windows installer and runtime testing on the GCP Windows VM over IAP TCP forwarding, without any public IP or firewall whitelist. Use when Windows testing is needed and the pilot laptop is unreachable, when a test lane appears blocked on a static/whitelisted IP, or when an AWS/EC2 Windows lane fails with permission errors. Covers reachability probing with a mandatory control leg, VM lifecycle, egress constraints, and installer-artifact discovery.
---

# GCP IAP Windows Lane

## Objective

Reach a Windows test VM for installer and runtime validation **without** exposing a public
port and **without** whitelisting any operator IP. Google proxies the connection from
`35.235.240.0/20`, so a residential dynamic IP is irrelevant.

Established and verified 2026-08-19. Evidence:
`skills/laptop/evidence/2026-08-19-gcp-iap-windows-lane/REPORT.md`.

## First Reads

- `skills/laptop/evidence/2026-08-19-gcp-iap-windows-lane/REPORT.md`
- `.claude/skills/windows-vm-smoke/SKILL.md` (the smoke ladder this lane feeds — this skill
  provides rung 2 access; that skill defines what to check once you are in)
- `docs/WINDOWS_PROBLEMS_ATLAS.md`
- `windows-pilot/vm-testing/gcp-iap-lane.sh`

## The lane

```bash
windows-pilot/vm-testing/gcp-iap-lane.sh probe    # read-only
windows-pilot/vm-testing/gcp-iap-lane.sh start    # billable while RUNNING
windows-pilot/vm-testing/gcp-iap-lane.sh tunnel   # RDP -> 13389, sshd -> 12222
windows-pilot/vm-testing/gcp-iap-lane.sh stop     # billing -> ~$0, disk retained
```

Target: `clawx-win-rc-20260609`, zone `us-central1-a`, Windows Server 2022 DC,
e2-standard-4, 100 GB. Override with `CLAWX_WINVM` / `CLAWX_WINVM_ZONE`.

## Hard rules

**Always run the control leg.** Use the current `gcp-iap-lane.sh probe`: require real RDP protocol and SSH banner responses plus the IAP backend rejection for closed guest port 9999. A local `nc -z` success is only listener readiness. Perform an authenticated SSH marker separately. Use free override ports when working tunnels exist; the probe refuses occupied ports and cleans up only its own processes. See `windows-pilot/vm-testing/README.md` for current commands and environment fidelity requirements.

**Never strip the VM's external IP.** There is no Cloud NAT in `us-central1` (the project's
only NAT is `tt-eduplatform-nat` in `us-east1`). IAP is inbound only. Removing the external
IP leaves the guest with zero egress, so it cannot download Chrome, OpenSSH, or installer
dependencies — which is exactly what installer-dependency bugs need to exercise.

**Respect the recorded VM lifecycle hold.** Starting the existing VM is part of authorized Windows testing when required. Do not stop it while the current owner shutdown hold applies. Report its final observed state; running incurs compute charges and stopped disks still incur storage charges.

**Do not use the EC2 lane.** `windows-pilot/vm-testing/ec2-launch.sh` cannot work: the
`claude-code-local` IAM user has no EC2 permissions (`ec2:DescribeInstances`,
`ec2:DescribeAddresses`, `ec2:AllocateAddress`, `ssm:DescribeInstanceInformation` all
denied). The long-cited "missing keypair name" was never the real blocker.

## Before declaring an external block

Two of the longest stalls in this project's history were self-inflicted. Check these first:

1. **Is the artifact already local?** `ls release/*win-x64.exe`. The session idled 45+ times
   "holding for zip" while eleven installers sat in `release/`.
2. **Is it a permissions problem, not a missing input?** Dry-run the API
   (`aws ec2 allocate-address --dry-run`, `gcloud ... --dry-run`) before waiting on a human
   for a parameter.

## Version discipline

Read `docs/CURRENT_WINDOWS_RC.md` and the selected versioned manifest. Historical installer filenames/hashes in the August report are not current inputs. Hash the actual installer and installed app.asar. Testing an older or source-unknown artifact is useful regression evidence with that scope, never validation of the current working tree. Source-bound release acceptance requires the current build/provenance pipeline and measured installed evidence.

## Static IP guidance

If asked for a static IP for testing, the answer is that none is needed — that is the point
of this lane. For *Ministry database* access the answer is also usually none: per the
2026-08-18 handoff, the Ministry provisions and whitelists the app server themselves, and
their document permits developer connections from the iGovTT network. Only if remote
developer DB access is genuinely required does a dedicated GCP jump host with a reserved
static address become the answer (~$10–15/mo, one permanent IPv4 handed over once).

Related: reserve any IP the fleet depends on. `anton-claw-server` (`34.63.98.200`) ran on an
**ephemeral** address until 2026-08-19; a stop/start would have silently broken the gateway
tunnel. Now reserved as `anton-claw-static`.

## Evidence to record

Follow `skills/laptop/evidence/README.md`. A lane report must include: VM status and
internal IP, the firewall rules matched, the reachability table **with the control-leg
result**, the installer filename + sha256 + byte size under test, and anything not done.
