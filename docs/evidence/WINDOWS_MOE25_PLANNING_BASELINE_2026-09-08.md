# Windows moe.25 baseline before the research pause

The owner paused implementation and builds on September 8 to study OpenClaw, Outlook skills, VoltAgent and AionUi before choosing improvements. This record preserves already completed observations. **GA remains RED.** No new Windows chat, email or document acceptance was run during the documentation pass.

## Artifact and environment

| Field | Evidence |
|---|---|
| Version / source | `0.4.3-moe.25` / `8058e9b5b3050463c72a11c8e5da56616206f6e3` |
| Hosted run | [34203201042](https://github.com/dmvevents/clawx-pilot/actions/runs/34203201042), completed before the pause |
| Build checks | 206 native test files / 2,173 passed / 11 skipped; 36 host package checks PASS; five manifest entries match |
| Installer | `Ministry of Education-0.4.3-moe.25-win-x64.exe`, 394,151,522 bytes |
| Installer SHA256 | `f8ac20f96f4f4dbfab6498144a989dbf83d61dd98c16459682db8a86460db0b2` |
| Installed ASAR SHA256 | `ca7e5009a70de5c68f971465b7db34dff88afc6218e674481d11ce47e80ff6d3` |
| Installed EXE SHA256 | `5dde7d5e8921cc8a92f71332a48cfdb158d01f7779ade2f886483c8419772704` |
| Runtime | OpenClaw `2026.4.23`; Electron `40.8.4`; bundled helper Node `22.16.0` |
| Machine | Existing GCP Windows Server 2022 build 20348 VM; 4 vCPU / 16 GiB; IAP SSH/RDP; no public-IP requirement |
| User/install class | Standard-user interactive desktop, assisted existing-profile upgrade from moe.24; not a clean Windows 10/11 installation |
| State preservation | 61 application-profile files and 265 OpenClaw files backed up with matching hashes before installation |
| Installer result | Exit 0; installed hashes match; receipt completed `2026-09-08T08:53:52.2182973Z` |

The normal installer was observed on the interactive desktop. Its final auto-launch checkbox was cleared so that the first shortcut launch could be measured. CDP was enabled for observation; no diagnostic OpenClaw bundle patches or model profiling were applied to this installation.

## First shortcut startup observation

| Event | UTC / elapsed |
|---|---|
| Shortcut launch requested | `08:54:43.2333246Z` |
| Observer started | `08:54:46.329Z` |
| Stable-ready interval began | `08:59:01.512Z`; **258.279 seconds after shortcut launch** |
| Stable-ready verdict | `08:59:23.316Z`; **280.083 seconds after shortcut launch** |
| Continuous stable interval | 21.804 seconds against a 20-second observation requirement |
| Observed state | Gateway running and ready; composer enabled; history loaded; idle; Online channel; existing Main session |

The observer's final `elapsedMs=276987` is measured from observer startup, not shortcut launch. Keep those clock origins distinct. This is one sample on a reused Server profile. A green Online indicator is not proof of the effective provider for a subsequent run. No moe.25 model turn was executed before this checkpoint.

## Acceptance still missing

- Existing-Main, genuinely fresh-session and next-turn Online answers, each correlated to the effective cloud route and followed by a quiet terminal window.
- Cancellation, connectivity recovery, on-device behavior, full document fidelity and authenticated Microsoft journeys on the same artifact.
- Fresh Windows 10/11 standard-user installation, unaided stakeholder rerun and acceptable measured latency.
- Microphone/ASR is **DEFERRED by owner direction**, outside this release's functional acceptance. Packaged helper integrity and public keyless checks remain required.

No moe.25 private download was uploaded or sent; no release was published. Moe.22 remains the last artifact with the broader recorded document journey results. Those results do not transfer automatically to moe.25.

## Evidence locations and paused work

Local allowlisted receipts: `artifacts/windows-vm/20260908-moe25/host-verification-receipt.json`, `host-verification.json`, `install-result.json`, `profile-backup.json`, `environment-preinstall.json`, and `first-startup-readiness.json`. The observer is `observe-startup.cjs`; its last row and launch timestamp produce the elapsed values above. These artifacts are local/ignored; the committed record contains only the redacted summary.

The exploratory upgrade worktree `/private/tmp/clawx-openclaw-2026-9-upgrade-20260908`, branch `fix/openclaw-2026-9-upgrade-20260908`, is based on `8058e9b5`. It contains unfinished dependency, wrapper, bundler, verifier and test changes, including removals of old patch files/tests. Two dependency-install commands completed before the pause. **No commit, bundle verification, package build, VM deployment or hosted workflow was produced by that lane.** Its dependency tree is separate from the root and moe.25 baseline trees. Do not integrate its changes or treat removed patches as reviewed migration decisions.

The next work is the [source study and improvement plan](../research/OPENCLAW_WINDOWS_IMPROVEMENT_STUDY_2026-09-08.md), under [COMPLETION_PLAN.md](../COMPLETION_PLAN.md). The [first-response RCA](WINDOWS_FIRST_RESPONSE_RCA_2026-09-08.md) retains earlier failure, diagnostic repair and historical code evidence.
