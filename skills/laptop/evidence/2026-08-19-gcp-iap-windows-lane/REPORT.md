# 2026-08-19 — GCP IAP Windows test lane established; EC2 lane retired

Operator: Anton Alexander. Session: `e8ebec8a`. Branch: `fix/tool-catalog-trim` @ `7add864b`.

Scope: establish a reproducible Windows test lane that does not depend on a residential
dynamic IP, and verify it end to end. Prompted by the Ministry infrastructure handoff
(2026-08-18) asking for a static IP to whitelist on their PostgreSQL firewall.

---

## FACTS (verified this session)

### F1 — The operator's residential IP is not static; it changed mid-session
| When | Detected public address |
|---|---|
| Earlier 2026-08-19 | `2600:4040:b5a4:6f00:…` (Charter/Spectrum prefix) |
| 02:4x UTC 2026-08-20 | IPv4 `50.76.62.94`, IPv6 `2603:3024:1573:8a00:…` (Comcast prefix) |

A different carrier prefix inside one session. Consequence: whitelisting the home IP on a
Ministry firewall would break on any lease renewal, and would place the operator's home
address in a government firewall ACL/change record.

### F2 — The AWS EC2 lane is dead, not merely blocked
`ec2-launch.sh` was previously believed blocked only on a keypair name. Probed the IAM
user `arn:aws:iam::058264135704:user/claude-code-local`:

| API call | Result |
|---|---|
| `ec2:DescribeInstances` | `UnauthorizedOperation` |
| `ec2:DescribeAddresses` | `UnauthorizedOperation` |
| `ec2:AllocateAddress` (dry-run) | `UnauthorizedOperation` |
| `ssm:DescribeInstanceInformation` | `AccessDenied` |

No EC2 permissions at all. Even with a keypair the launch would fail at `run-instances`,
and Elastic IPs are unobtainable. **The keypair was never the real blocker.**

### F3 — The GCP project already contained the whole solution (from June 2026)
| Asset | State |
|---|---|
| `clawx-win-rc-20260609` | Windows Server 2022 DC, e2-standard-4, 100 GB — was TERMINATED, disk intact |
| `clawx-allow-rdp-iap` | 3389 from `35.235.240.0/20` |
| `clawx-allow-winrm-iap` | 5986 from `35.235.240.0/20` |

The June work had already chosen IAP. It was simply stopped and forgotten.

### F4 — IAP reachability PASSES, and the result is trustworthy
VM started: `RUNNING`, internal `10.128.0.17`, external `104.198.33.236` (ephemeral).

| Guest port | Local port | Result |
|---|---|---|
| 3389 (RDP) | 13389 | **PASS** |
| 22 (sshd) | 12222 | **PASS** |
| 9999 (control, closed) | 19999 | **FAIL — refused** |

The control leg is what makes this evidence rather than noise. `gcloud` opens the local
listener *before* it knows whether the backend port is live, so a bare `nc -z` success on
one port proves little. Because 9999 was refused while 22 and 3389 succeeded, the
differential establishes that the PASS results reflect real guest-side listeners.

Consequence: the operator's IP is irrelevant to Windows testing. Source is Google's fixed
`35.235.240.0/20`.

### F5 — The installer was already on the Mac; the "waiting for zip" block was false
The session logged `IDLE holding for zip` **45+ times** between 2026-07-26 and 2026-07-27.
`release/` in fact contains eleven Windows installers, newest:

```
Ministry of Education-0.4.3-moe.10-win-x64.exe
  390,068,457 bytes
  sha256 e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182
  built 2026-06-23 01:18
```

Note a version gap: `package.json` is `0.4.3-moe.11`; the newest built installer is
`moe.10`. **moe.11 has never been packaged for Windows**, so testing moe.10 does not
exercise the current tree (which includes BUG-012 `fc435c6b` and the trim `7add864b`).

### F6 — Do NOT strip the VM's external IP
There is exactly one Cloud NAT in the project: `tt-eduplatform-nat` on router
`tt-eduplatform-router`, in **us-east1**. The VM is in **us-central1**, which has no NAT.
Removing its external IP leaves the guest with zero egress — it could not fetch Chrome,
OpenSSH, or installer dependencies, which is precisely what the bug under test needs.
IAP covers *inbound*; it does not provide outbound. Checked before mutating; not mutated.

### F7 — Fleet gateway IP was ephemeral; promoted to static (only mutation made)
`anton-claw-server` (`34.63.98.200`, `~/.ssh/config` as `gcp-anton`/`anton-claw`) held an
**ephemeral** address — a stop/start would have silently changed it and broken the gateway
tunnel. Promoted in place, same address, zero downtime:

```
anton-claw-static   34.63.98.200   EXTERNAL   IN_USE
```

### F8 — Local test suite is green on the HOLD branch
| Check | Result |
|---|---|
| `pnpm test` | **1154 passed**, 5 skipped, 152 files, 12.29s |
| `pnpm typecheck` | **clean** (exit 0) |
| `pnpm exec vitest run tests/unit/ondevice-tool-policy.test.ts` | **9/9 passed** |

### F9 — HOLD state, corrected
An earlier statement in this session that the branch was "unpushed" was **wrong**.

```
pilot  refs/heads/fix/tool-catalog-trim  ->  7add864b   PRESENT on remote
pilot  refs/heads/main                   ->  80b05c4b   unaffected
git merge-base --is-ancestor 7add864b pilot/main  ->  exit 1  (NOT an ancestor)
```

The branch **is** on `dmvevents/clawx-pilot`. It was not pushed by this session (all git
calls here were read-only: `status`, `log`, `ls-remote`, `merge-base`, `show`, `fetch`).
The substance of the HOLD holds — nothing merged, `main` untouched, `origin`
(ValueCell-ai upstream) never touched — but a reviewer assuming "remote is dark" should
know it is not.

---

## ANALYSIS

The static-IP question had two distinct answers that were being conflated:

1. **Windows testing needs no static IP at all.** IAP removes the requirement entirely.
2. **Ministry PostgreSQL access** is a separate problem, and per their own handoff the app
   server is *theirs* to provision and whitelist — so it needs no IP from us either. Their
   document also permits developer connections from the iGovTT network, which is free.
   A dedicated GCP jump host with a reserved static IP is the fallback if remote developer
   DB access is genuinely required (~$10–15/mo, one permanent IPv4 handed over once).

The forensics pass surfaced a systemic pattern worth more than any single fix: **three of
the four longest stalls were self-inflicted**, not externally blocked — 45+ idle cycles
waiting for an installer that was already on disk (F5), and a dead AWS lane held open for
a month on a "missing keypair" that was never the cause (F2). The lesson encoded into the
new lane script: **probe permissions and local artifacts before declaring an external
block.**

## Correction to the automated forensics report

`/tmp/forensics/report.md` states BUG-012 (`fc435c6b`) and the trim (`7add864b`) are
"committed but not pushed." Directly verified as wrong — both are on the pilot remote
(F9). The report is otherwise accurate and its loop detection was independently valuable.

---

## OPEN / NOT DONE

- **moe.11 Windows installer does not exist.** Testing the current tree requires
  `pnpm build:win` first. Testing moe.10 tests June code.
- **The installer bug itself is unverified.** The *lane* is proven (F4); the reported
  "installer reinstalls dependencies every time" defect has not been reproduced.
- **On-device 5-prompt re-test** still parked — `home-pilot` sshd down. The GCP VM is now
  a viable substitute and does not need the laptop.
- **VM is RUNNING and billing** (~$0.13/hr). `gcp-iap-lane.sh stop` when finished. The
  June startup script sets an 8-hour auto-shutdown.
- **Two drafts await the operator's gate**: Ministry infra reply
  (`~/openclaw-agent/outbound-drafts/2026-08-19-ministry-infra-handoff-reply-DRAFT.md`)
  and the corrected GPU-power reply to Randy — the latter still carrying the unresolved
  **H200 NVL 141GB vs "B200"** label discrepancy.

## Reproduce

```bash
windows-pilot/vm-testing/gcp-iap-lane.sh probe   # read-only, includes control leg
windows-pilot/vm-testing/gcp-iap-lane.sh start
windows-pilot/vm-testing/gcp-iap-lane.sh tunnel  # RDP 13389, sshd 12222
windows-pilot/vm-testing/gcp-iap-lane.sh stop
```
