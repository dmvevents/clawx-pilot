# moe.18 full-matrix VM verify — clawx-win-rc-20260609 (2026-09-03)

**STATUS: PREP STAGED — VM NOT YET TOUCHED.** Blocked on gcloud interactive
reauth on the Mac (org periodic-reauth policy; `gcloud auth login` required —
reported to team-lead 2026-09-03, msg 7f9a60d3). Probed and exhausted:
cached access tokens both expired (freshest 2026-09-03 14:17 UTC), the
gcloud-login skill's service-account key file is 0 bytes (setup never
completed), no other SA key on disk, tunnel listener on :12222 is alive but
every connection dies at kex (token mint fails). A background poll watches for
restored credentials; this file is overwritten with live results the moment
the run starts. Do NOT read PENDING rows below as a dead run — check the
STATUS line and the mtime.

Installer (LOCAL — no GCS download needed):
`/Users/antonalexander/Github/moe-tt/ClawX/release/Ministry of Education-0.4.3-moe.18-win-x64.exe`
(432,028,001 bytes; same object uploaded to gs://clawx-rc-artifacts-622687731621/moe18/)
Required sha256: `5b0884ed4fd23dadcf67eb88937376d054ac994ffa801695c0d040a27d08d4e7` (verify BOTH hops)
Mac hop verified 2026-09-03: `shasum -a 256` = `5b0884ed…d4e7` MATCH.
Packet: /tmp/moe18-vm-verify-packet.md · Scripts: /tmp/moe18/ (adopted from the
prior verifier's staging + this agent's preseed/migration/dismiss additions)

## Per-check verdict (packet steps)

| # | Check | Verdict |
|---|---|---|
| — | sha256 match (Mac hop + guest hop) | Mac hop PASS · guest hop PENDING |
| 1 | Pre-step: legacy-channel preseed (on-device, marker removed, no-BOM) | PENDING |
| 2 | Silent /S /CURRENTUSER install over moe.17; FileVersion 0.4.3-moe.18; state preserved | PENDING |
| 3 | Visible relaunch; CDP 9223 + gateway 18789 + host-API 13210 | PENDING |
| 4 | LAUNCH-CHANNEL headline: migration fired (online + marker + log line + runtime=cloud) | PENDING |
| 5 | K10 PDF regression (fresh session, real summary, read_pdf toolCall, no workerSrc) | PENDING |
| 6 | K13 dir 1 cloud→on-device (notice + switch + attempt; addendum obs re-recorded) | PENDING |
| 7 | K13 dir 2 on-device outage → anonymised switch-to-Online prompt; dismiss; no re-raise | PENDING |
| 8 | K11 email chain readable degrade (no-creds, no-session box; NO sends) | PENDING |
| 9 | K12 badge tracks real gateway state (healthy → kill → restart) | PENDING |
| 10 | K14 five prompts (NSCC set) — answers, no raw errors | PENDING |
| 11 | Trust sweep — no model IDs / cost / raw HTTP in any evidence | PENDING |
| + | No-clobber leg: post-migration explicit On-device toggle survives relaunch | PENDING |
| 12 | End state: hosts clean, ollama running, app on Online, VM RUNNING | PENDING |
