# VM test base — persona-faithful replication of the principal's environment

*Created 2026-09-02. Owner: GA sprint. Status: design ratified, L2 snapshot pending
`gcloud auth login` (see Blockers).*

## The problem this solves

Every Windows test cycle so far has run against **one long-lived VM**
(`clawx-win-rc-20260609`) whose state is the accumulation of every prior
session: stale fixtures shadowing valid ones (the KR1 first re-run failure),
half-seeded configs (the empty-`agents` slow-ready), leftover Chrome profiles.
Each install "test" is really an upgrade-over-residue test. Fresh-install
evidence (KR2) requires state surgery, and a bad step costs the lane for days.

The fix is the standard one: **a layered golden-image strategy** where the
persona environment is captured once, and every test starts from a known layer.

## The persona baseline (what a principal's laptop actually looks like)

The test base must replicate the *deployment persona*, not a developer machine.
From the pilot fleet and the MoE hardware profile:

| Dimension | Persona value | Why it matters for tests |
|---|---|---|
| OS | Windows 11 24H2, x64 | NSIS installer target; PS 5.1 quirks (BOM writes, zip separators) |
| RAM | 16 GB | on-device model selection (qwen2.5:3b fits; 8B models do not) |
| OneDrive | **KFM ON** — Desktop/Documents redirected to `%USERPROFILE%\OneDrive\` | `resolveReadablePath` must resolve KFM paths (KR1 evidence class) |
| Browser | Chrome, signed into `test.fac@fac.edu.tt` Outlook (persona: `*@moe.gov.tt`) | Outlook/Forms lanes ride the user session over CDP :18792; managed Chromium is blocked by Conditional Access |
| Locale | en-TT / en-US | English-only product rule |
| Network | Ministry proxy/CAE-managed tenant | cloud degrade + offline lanes (KR3/KR4) |
| Local LLM | Ollama + `qwen2.5:3b-instruct` pulled | on-device default |
| User docs | Word/Excel/PDF suspension + daily-report sources on Desktop | doc-tooling lane; seeded via `windows-pilot/scripts/pilot-seed-demo-documents.ps1` (post-fix `1804aaab`+`128fcab6` ONLY — earlier seeds produced spec-violating OOXML) |
| Auto-update | OFF (PILOT_MODE) | installers hand-delivered |

## Layered snapshot model

Three layers, each a GCP disk snapshot (incremental, ~$0.026/GB-mo). Restoring
any layer = create a disk from the snapshot and boot a VM from it (~2-4 min),
or create a whole instance with `--source-snapshot`.

```
L0  base-os        Windows 11 24H2 + OpenSSH server + IAP firewall rule +
                   Chrome installed (signed out) + nothing else.
                   → for: installer-on-pristine-OS tests, dependency audits.

L1  persona-base   L0 + OneDrive KFM configured + Ollama + qwen2.5:3b pulled +
                   demo documents seeded (fixed seeder) + test.fac Chrome
                   profile signed in. NO ClawX installed. NO ~/.openclaw.
                   → for: KR2 fresh-install evidence, every release-candidate
                     first-boot test, G4-style Outlook triage on clean state.

L2  post-install   L1 + current RC installed, first boot completed, gateway
    (per release)  green, one on-device turn verified.
                   → for: regression matrices, upgrade tests (install moe.N+1
                     over L2-moe.N), demo prep, long-running lanes.
```

**Rule: never test on the mutable long-lived VM again once L1 exists.** The
long-lived VM becomes the *authoring* machine for the next layer only.

## Concrete commands (ready to run once gcloud auth is restored)

```bash
PROJECT=gen-lang-client-0649986230
ZONE=us-central1-a
DISK=clawx-win-rc-20260609

# 1. Preserve current state (evidence + working install) — VSS-consistent:
gcloud compute snapshots create clawx-l2-moe12-20260902 \
  --source-disk=$DISK --source-disk-zone=$ZONE --project=$PROJECT \
  --guest-flush \
  --description="L2 post-install: moe.12, KR1 PASS evidence on disk, fixtures valid"

# 2. Derive L1 (persona-base) from it: boot a scratch VM from the snapshot,
#    uninstall ClawX + delete %USERPROFILE%\.openclaw + %APPDATA%\Ministry of
#    Education + %LOCALAPPDATA%\Programs\Ministry of Education, verify the
#    persona checklist below, then snapshot that disk as clawx-l1-persona-vN.
gcloud compute disks create clawx-scratch-l1 --source-snapshot=clawx-l2-moe12-20260902 \
  --zone=$ZONE --project=$PROJECT
gcloud compute instances create clawx-l1-authoring --zone=$ZONE --project=$PROJECT \
  --machine-type=e2-standard-4 --disk=name=clawx-scratch-l1,boot=yes

# 3. Instantiate a disposable test VM from any layer:
gcloud compute instances create clawx-test-$(date +%Y%m%d-%H%M) \
  --source-snapshot=clawx-l1-persona-v1 \
  --zone=$ZONE --project=$PROJECT --machine-type=e2-standard-4
```

Auto-shutdown: keep the existing 8h-after-boot policy on all test VMs (cost
guard); disposable VMs are deleted after evidence capture, not kept.

## Persona verification checklist (run before blessing any L1/L2 snapshot)

Scriptable via `windows-pilot/scripts/pilot-lane-probe.ps1` + additions:

1. `[Environment]::OSVersion` = Win11 24H2; PS `$PSVersionTable` = 5.1.
2. OneDrive KFM: `Test-Path "$env:USERPROFILE\OneDrive\Desktop"` true AND the
   shell Desktop known-folder resolves under OneDrive.
3. `ollama list` contains `qwen2.5:3b-instruct`.
4. Seeded docs on Desktop pass the strict OOXML validator (no backslash
   entries, `word/document.xml` > 0 bytes) — `pilot-find-docx-copies.ps1`.
5. Chrome launches with the test.fac profile; `outlook.office.com` loads the
   inbox without a login prompt. (Session cookies age out — L1 snapshots need
   re-blessing when the Outlook session dies; record the sign-in date in the
   snapshot description.)
6. For L1: NO `~/.openclaw`, NO `%APPDATA%\Ministry of Education`, NO installed
   app. For L2: app version matches the snapshot name; gateway reaches ready;
   one on-device turn returns real text (use `pilot-run-chat-turn.ps1` +
   `pilot-read-last-message.js`).

## Known traps this design inherits (do not rediscover)

- **PS 5.1 zips**: never `CreateFromDirectory` for OOXML; use the fixed seeder.
- **BOM writes**: never `Set-Content -Encoding UTF8` for JSON configs.
- **Hidden launch kills the Gateway**: always launch the app visible (CimMethod
  launcher pattern in `pilot-run-chat-turn.ps1`).
- **Empty-config slow-ready**: a present-but-empty `~/.openclaw/openclaw.json`
  boots slower than no file at all (fix `61be816e` ships in moe.13; until then
  L1 must have NO config file, which is also the honest persona state).
- **Downloads shadows Desktop**: `resolveReadablePath` checks `Downloads\`
  before `OneDrive\Desktop` — never leave stale fixture copies in Downloads.
- **IAP tunnel auth**: `gcloud` user tokens expire and re-auth is interactive.
  For unattended lanes, mint a dedicated service account with
  `roles/iap.tunnelResourceAccessor` + `roles/compute.instanceAdmin.v1` and
  `gcloud auth activate-service-account --key-file=…` on the operator machine.
  This removes the single most frequent lane-killer.

## Blockers (current)

| # | Blocker | Owner action |
|---|---|---|
| 1 | `gcloud auth login` expired — snapshot/tunnel/instance ops all fail | Owner runs `gcloud auth login` (interactive). Then run step 1 above immediately. |
| 2 | Service-account for unattended IAP (trap #6) | Owner approves SA creation; agent can then script it. |
| 3 | test.fac Outlook session for L1 blessing | Needs `PILOT_TEST_PASSWORD` in local operator context at authoring time (never committed, never for `*@moe.gov.tt`). |
