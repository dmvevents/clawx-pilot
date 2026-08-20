# Windows VM testing for the ClawX installer bug

Goal: reproduce and fix "installer tries to install dependencies every time, doesn't work" on a fresh Windows machine, without needing physical access to the pilot laptop.

## Recommendation for Anton (host = macOS)

**EC2 Windows Server 2022 in us-east-2** (Ohio, same region as his existing box `3.139.145.129`).

Reason: Windows Sandbox requires a Windows Pro/Enterprise **host**. Anton's dev machine is a Mac, so Sandbox is off the table for the person doing the debugging. EC2 gives a persistent RDP desktop from the Mac plus the ability to snapshot a clean AMI and revert between installer runs — which is exactly the disposable-clean-slate need. Estimated cost ~$0.10/hr running, ~$0 stopped (EBS storage only).

Secondary lane: **GitHub Actions `windows-latest`** for headless installer smoke once we suspect a fix — free, disposable, repeatable, and it already matches the runner used by `win-build-test.yml`.

Windows Sandbox `.wsb` is staged anyway so it's ready if we later hand the repro over to the pilot laptop (Windows 11 Pro) for a live walk-through.

## What's staged

| File | Purpose |
|---|---|
| `install-clawx.wsb` | Windows Sandbox config — mounts host folder read-only, auto-runs installer with `/log`. Requires a Windows Pro/Enterprise host. |
| `ec2-launch.sh` | EC2 `run-instances` command. **Do NOT execute** until Anton confirms keypair + SG. |
| `sg-rdp.json` | Security group ingress rule template: TCP 3389 from Anton's `/32` only. |
| `bootstrap-userdata.ps1` | EC2 user-data — pre-installs Chrome, 7zip, VS Redist, opens firewall for RDP. |
| `../../.github/workflows/windows-installer-smoke.yml` | GH Actions headless installer test (accepts `installer_url` input). |

## What is still needed from Anton

1. The installer zip (the one currently being uploaded).
2. Go-ahead + AWS keypair name to launch EC2 (the local `claude-code-local` IAM user cannot list keypairs; needs an admin-scoped token or a keypair name provided directly).
3. Confirmation of Anton's current public IP for the RDP SG (`/32` lockdown). Detected right now: `2600:4040:b5a4:6f00:b434:fa41:5b89:646b` (IPv6 — for RDP SG we need his IPv4; will re-detect at launch time).

## How this fits together

- **First repro**: RDP into EC2 → drop zip → run `.exe /log log.txt` → grep log for the dependency-install loop.
- **Fix iteration**: snapshot AMI once environment is "fresh Windows"; revert between runs so each install starts identical.
- **Confirm fix**: push branch, run `windows-installer-smoke.yml` workflow → get log artifact back headless.
- **Sign-off**: hand `.wsb` to Anton to run on the actual pilot laptop as a last sanity check before shipping.
