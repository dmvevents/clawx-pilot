# GA Release Plan - 2026-06-09

## Target Result

Ship the Ministry of Education Windows app as a GA-quality installer for non-technical principals, with a supported online model path, safe Outlook and Forms automation, Office document handling, ASR expectations, and a documented fallback/support process.

Current status: **YELLOW - email-draft-fix RC candidate ready for prerelease upload, not GA**.

Operating OKR board: `docs/GA_OKRS_2026-06-10.md`.

Repeatable E2E regression process: `.agents/skills/ga-e2e-regression/SKILL.md`.
Clean Windows installed-app smoke process: `.agents/skills/windows-vm-smoke/SKILL.md`.
VM/browser visual acceptance criteria: `docs/GA_VM_BROWSER_VISUAL_ACCEPTANCE_CRITERIA.md`.

## Current RC Baseline

- Windows RC tag: `moe10-windows-rc-20260623-email-draft-fix`.
- Release asset: `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
- Installer SHA256: `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182` for the 2026-06-23 Outlook email draft/reply fix prerelease candidate.
- RC commit: see the GitHub release tag target commit.
- Operator instructions: `windows-pilot/plans/MOE_WINDOWS_END_TO_END_INSTRUCTIONS_2026-06-08.md`.
- Release notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-23_EMAIL_FIX_RELEASE_NOTES.md`.

This baseline is acceptable for controlled demo installs. GA requires the gates below.

2026-06-09 local rebuild after VM visual diagnostics:

- installer: `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`
- installer SHA256: `5566ea55aeadfaba60ecae0aa23fbb9644dceebc1c5f8137c0be3f6d5d11f692`
- blockmap SHA256: `f5eec5ac89dac542a2758b785c434b11cb0f53e0a23baa1474845d926cc2fc82`
- GCS prefix: `gs://clawx-rc-artifacts-622687731621/rc-local-20260609-forms-signin-diagnostic/`
- VM install evidence: `C:\Users\clawxtest\Downloads\clawx-vm-install-forms-signin-diagnostic-20260609-233250`
- VM visual smoke evidence: `C:\Users\clawxtest\Downloads\clawx-managed-cdp-visual-smoke-20260609-235054`
- local pulled screenshot/probe evidence: `/tmp/clawx-vm-visual-20260609-235054`

2026-06-10 local rebuild after Microsoft 365 programmatic package bootstrap:

- installer: `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`
- installer SHA256: `4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931`
- blockmap SHA256: `e07e35d200f884066ba531c7e135c7b4a00211938c82b79df0e527412bace5c7`
- GCS prefix: `gs://clawx-rc-artifacts-622687731621/rc-local-20260610-m365-programmatic-bootstrap/`
- GCS upload evidence: installer `390056265` bytes and blockmap `308222` bytes listed at `2026-06-10T02:10:51Z` / `2026-06-10T01:26:29Z`
- packaged runtime check confirmed `playwright-core`, `xlsx`, `docx`, `mammoth`, `pdf-parse`, `WinSpeechRecognize.exe`, `node.exe`, `uv.exe`, cloud gateway seed files, and Microsoft Graph example config
- packaged runtime check intentionally found `resources/microsoft-graph.json=false`; do not publish this as Graph-configured until MoE IT provides the real Entra public client ID

2026-06-10 GitHub prerelease publication:

- release: `https://github.com/dmvevents/clawx-pilot/releases/tag/moe10-windows-rc-20260610-bbc4eb1`
- installer asset: `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`
- installer SHA256: `4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931`
- instructions asset: `MOE_WINDOWS_RC_2026-06-10_USER_INSTRUCTIONS.md`
- direct URL checks returned HTTP 200 for the installer and instructions assets
- local ignored staging copies in `release/github/` were refreshed on
  2026-06-10 to match the June 10 installer and blockmap hashes:
  `4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931` and
  `e07e35d200f884066ba531c7e135c7b4a00211938c82b79df0e527412bace5c7`

2026-06-09 external tester feedback from Karunesh Ramdass on the June 10 prerelease:

- downloaded, installed, and tested the GitHub release installer successfully
- confirmed the online agent was set by default with no user setup necessary
- observed Gateway connection time around two minutes
- scanned local files successfully
- checked email successfully
- composed and sent email successfully
- tester plans broader follow-up tests on 2026-06-10

Treat this as strong RC evidence for install, online default, file scan, email,
and confirmed send. It is not yet full GA evidence because the pass must be
repeated, Gateway startup timing needs an accepted SLO or UX treatment, Forms
preview/dry-run still needs fresh tester evidence, and the send path should
stay covered by explicit same-session confirmation tests.

2026-06-10 local validation pass:

- Outlook/Graph/launch tests: 5 files, 31 tests passed.
- Windows package critical tests: 6 files, 53 tests passed.
- `pnpm run typecheck` passed.
- `pnpm run build:vite` passed with existing chunk-size/dynamic-import
  warnings only.
- `pnpm run harness:ci` passed; report at `artifacts/harness/latest.md`.
- Release secret grep found only placeholder/example key patterns, not full
  committed provider keys.
- Targeted branding grep of patched app-facing surfaces now returns only
  internal runtime/developer identifiers or comments allowed by the branding
  audit.

2026-06-10 principal onboarding pass:

- Settings > Microsoft 365 sign-in copy now states that passwords are entered
  only on Microsoft's sign-in page, never in the app.
- Settings > Principal setup stores Daily Report and Student Suspensions
  response links through `moeforms:get-urls` / `moeforms:set-urls`.
- `docs/MOE_PRINCIPAL_ONBOARDING_FLOW.md` documents principal setup,
  administrator provisioning, and pre-qualifying form questions.
- `tests/unit/moe-principal-setup-section.test.ts` covers Forms URL validation.

2026-06-10 manual rebuild after principal onboarding:

- GitHub Actions manual workflow `package-win-manual.yml` run `27299469846`
  succeeded on commit `832aaf3d70baa9bc377bfaaffeb984cd9986334b`.
- Manual workflow used `requireCloudGatewaySeed=true` and
  `requireMicrosoftGraphSeed=false`.
- Manual artifact hashes:
  - installer `fe8d7af9fe2db1054ec7ee2bfdd22d05f932ba486644b7d15b6153bb5f8f9219`
  - blockmap `a563185c8e68aa328fe7d09c0654430b98d1624dc1d0611d1e2b02a87a141220`
- Local `PATH="$HOME/.dotnet:$PATH" pnpm run build:win` also succeeded.
- Local rebuild hashes:
  - installer `4342b4e8bd849f27db769393e57129c5352631e7bd7aa40b7bdc7940960262c3`
  - blockmap `bb3706cae31960b1dbafee16fa404a86f0dbe9f8a5a8d396595e8af42e302e45`
- Package inspection confirmed runtime `playwright-core`, Office parsers,
  Windows ASR helper, Windows Node/uv/ffmpeg, cloud gateway seed files,
  Microsoft Graph example config, and MoE principal extensions.
- Full status: `windows-pilot/plans/MOE_WINDOWS_GA_STATUS_2026-06-10.md`.

2026-06-23 local rebuild after Outlook email draft/reply hardening:

- installer: `release/Ministry of Education-0.4.3-moe.10-win-x64.exe`
- installer SHA256: `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182`
- blockmap SHA256: `9ac78ae72aa6fd671ac044351f8b796dbc3d263d78f7bde5a39d4946c858f2b2`
- app.asar SHA256: `9f8c9b0c90d4ff8a3a3a0a59e244504531247d8425a19f30d109d4250a8e3f96`
- `PATH="$HOME/.dotnet:$PATH" pnpm run build:win` passed.
- Package inspection confirmed runtime `playwright-core`, Office parsers,
  Windows ASR helper, Windows Node/uv/ffmpeg, cloud gateway seed files,
  Microsoft Graph extension, MoE principal assistant extension, and no
  `app-update.yml`.
- Local signed-in Electron/Chrome CDP no-send matrix passed compose, reply,
  reply-all, and forward with body text in compose bodies, not recipient
  fields. The run observed `/api/outlook/read-inbox`, two
  `/api/outlook/reply` calls, and `/api/outlook/forward`, with no
  `/api/outlook/send`.
- ClawX-marker-scoped test draft cleanup succeeded and the post-run hygiene
  check found `openCompose=0`; the visible Drafts count stayed `[8]`.
- Full `pnpm test` passed: 148 files, 1115 passed, 5 skipped.
- `pnpm run typecheck`, `pnpm run lint:check`, `pnpm run harness:ci`, and
  `git diff --check` passed.

## GA Gates

| Gate | Required evidence | Current state |
|---|---|---|
| Installer reproducibility | `pnpm run build:win`, installer path, SHA256, `playwright-core` still in runtime dependencies | 2026-06-23 local `PATH="$HOME/.dotnet:$PATH" pnpm run build:win` passed with installer SHA256 `e35ee6cda63a942a585b0638831487562d66a0901b006cf2ccadfe81b0e6f182`; packaged runtime check confirmed `playwright-core`, `xlsx`, `docx`, `mammoth`, `pdf-parse`, ASR helper, `node`, `uv`, `ffmpeg.exe`, cloud gateway seed files, Microsoft Graph extension, MoE principal extension, and no `app-update.yml` |
| Clean install | fresh Windows user or laptop install, desktop shortcut launch, Gateway/Host API reachable | 2026-06-09 GCP Windows VM `clawx-win-rc-20260609` proof passed for an older local rebuild: downloaded bytes `390056548`, SHA256 matched, silent uninstall exit `0`, install exit `0`, app exe present; visual smoke showed Chrome CDP, Electron CDP, Host API, Gateway, and post-probe readiness true. 2026-06-09 external tester installed a GitHub prerelease successfully. 2026-06-23 hidden WinRM `/S /currentuser` testing against superseded assets reproduced a partial-install failure; do not use that unattended path as GA proof. The refreshed `e35ee6...` installer has local package/regression proof and needs a normal assisted VM/RDP or physical laptop installed-app smoke before this row is green for the current asset. |
| Online model path | installed app completes one chat through managed gateway/model broker or configured cloud provider; no raw upstream keys exposed to the user | GitHub Windows packaging requires `CLAWX_CLOUD_GATEWAY_CONFIG_JSON` and `CLAWX_CLOUD_GATEWAY_KEY`; VM proof confirmed packaged seed files present, `providerKeys=1`, local Qwen seeded with `default=false`, and `.openclaw` default model `custom-moecloud/moe-demo-pro`; 2026-06-09 external tester confirmed online agent defaulted with no user setup. Gateway startup was around two minutes and needs SLO/UX treatment. |
| Microsoft 365 programmatic config | installer can carry non-secret tenant/client defaults so Outlook can use Microsoft Graph after sign-in instead of Chrome troubleshooting | 2026-06-10 implementation added `resources/microsoft-graph.example.json`, ignored `resources/microsoft-graph.json` packaged-copy support, store fallback from packaged/user/env config, and optional GitHub Actions `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON` injection; needs real Entra client ID from IT |
| Runtime coherence | settings/provider store, `~/.openclaw/openclaw.json`, agent `models.json`, and latest transcript agree | VM install proof confirmed `.openclaw` default primary `custom-moecloud/moe-demo-pro`; provider/config coherence should be rechecked after a real chat transcript |
| Outlook safety | open/read/draft smoke passes through signed-in Chrome CDP or Microsoft Graph; send requires explicit same-session confirmation | VM visual smoke `20260609-235054` passed Outlook open/read and refused send/download without confirmation. 2026-06-09 external tester confirmed checking email plus compose/send worked. 2026-06-23 local signed-in Electron/Chrome Host API no-send matrix passed compose, reply, reply-all, and forward; body text landed in compose bodies and not recipient fields; no send route was observed; ClawX-marker-scoped cleanup left `openCompose=0`. Unit coverage verifies send refuses without confirmation, refuses mismatched recipient/subject/body drafts including short body strings in recipient fields, and clicks Send only inside one exact matching compose pane. |
| Outlook attach UX | a fresh user who asks "check my email" is routed through `outlook.*`, `browser.diagnose`, and `browser.repair_chrome_cdp`; the assistant must not tell the user to enable Chrome remote debugging, use `chrome://flags`, search the web, or run manual Chrome commands | user report on 2026-06-09 exposed old guidance; regression patch and chat-harness scenario added; local unit tests passed; clean installer proof now passed on GCP VM, but Chrome/Outlook sign-in proof still requires Chrome on the test image or a physical laptop |
| Forms safety | Forms list/preview/dry-run passes; submit requires explicit same-session confirmation | Forms list passes and submit without confirm refuses for both Daily Report and Suspensions. Settings now exposes the saved Daily Report and Student Suspensions response links through the existing MoE form URL store. Preview is blocked on clean VM by Microsoft sign-in: Forms tabs land on `login.microsoftonline.com/.../authorize`; driver now reports a precise sign-in-required diagnostic instead of selector timeout. Filling still needs signed-in Microsoft profile evidence. |
| Office files | sample Excel, Word, CSV, and PowerPoint analysis complete from Downloads through app chat | packaged runtime checks now validate seeded CSV rows, generated Excel data rows, Word OpenXML, PowerPoint OpenXML slides, and Office analysis summaries; 2026-06-09 external tester confirmed local file scanning worked. Still needs full installed-app chat evidence for the Office matrix. |
| ASR | Windows `ffmpeg.exe` and `WinSpeechRecognize.exe` are packaged, `asr:saveBlob` resolves bundled ffmpeg without PATH setup, and one transcript smoke passes through the configured high-quality backend or is explicitly deferred | 2026-06-22 packaging inspection confirmed `resources/bin/ffmpeg.exe` and `resources/bin/WinSpeechRecognize.exe`; 2026-06-23 fix adds packaged ffmpeg resolver coverage and release seed support for `resources/azure-speech.json` + `azure-speech.key`. GA packages should run the manual workflow with `requireAzureSpeechSeed=true` when microphone accuracy is release-critical; otherwise ASR is YELLOW and falls back to Windows native/Whisper. |
| Secrets | no committed upstream keys or test passwords; desktop stores only broker/client-scoped credentials | verify with git grep and install-state audit |
| UI trust | no raw model/vendor identity or ClawX/OpenClaw branding in principal-facing UI; cost hidden from frontend | 2026-06-10 remediation updated app metadata, title, menus, OAuth pages, notifications, setup copy, Settings links, attribution headers, and bundled agent context; targeted grep now leaves only internal runtime/developer identifiers in patched surfaces; broader branding issue remains open for icons, docs, and deeper support/dev surfaces |
| Observability | local logs redacted, support artifact capture documented, optional Phoenix/model tracing decision recorded | local logs exist; Phoenix optional pending |
| Documentation | first-run, install, support, and operator runbooks match the GA installer | RC docs exist; GA docs need final pass |
| E2E regression matrix | known demo/customer failures and adjacent risks have targeted tests plus package/VM evidence where applicable | 2026-06-23 added `ga-e2e-regression` process surfaces and expanded Outlook, ASR, package, Office-path, and plugin guidance tests; clean Windows VM smoke still required before GA |

## Workstreams

### 1. Installer And First Run

Owner skill: `windows-build-package`.

Tasks:

- run targeted unit tests and `pnpm run typecheck`;
- run `pnpm run prep:win-binaries`;
- run `pnpm run build:win`;
- compute SHA256 and create release notes;
- install on a clean Windows profile and verify desktop shortcut, Gateway, Host API, skills, Office helpers, and ASR helper.

### 2. Online Model Gateway

Owner skill: `windows-runtime-recovery`.

Tasks:

- decide the GA default: managed model broker endpoint preferred;
- ensure desktop stores only a broker-issued/client-scoped key, not upstream provider keys;
- keep `package-win-manual.yml` failing by default when the cloud gateway seed secrets are absent;
- package `resources/microsoft-graph.json` from `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON` once IT returns the Entra app registration;
- package `resources/azure-speech.json` and `azure-speech.key` from `CLAWX_AZURE_SPEECH_CONFIG_JSON` / `CLAWX_AZURE_SPEECH_KEY`, and run the workflow with `requireAzureSpeechSeed=true` for high-quality ASR GA builds;
- verify one installed-app chat through the broker;
- document failure handling when Wi-Fi or gateway is unavailable;
- keep local model fallback only as an explicit fallback, not the demo default.

### 3. Outlook And Forms

Owner skill: `windows-outlook-forms`.

Tasks:

- implement the production Outlook login flow as Microsoft Graph delegated
  OAuth for each signed-in Microsoft 365 user; require tenant/admin consent so
  teachers see a normal sign-in rather than a confusing permissions prompt;
- verify Microsoft Graph sign-in and Graph-backed Outlook read/draft first;
- verify Settings > Principal setup saves the Daily Report and Student
  Suspensions response links before Forms proof;
- verify signed-in user Chrome CDP attach only for browser fallback and Forms UI fallback;
- sign in to Microsoft in the ClawX-opened system Chrome profile before Forms preview proof, or move to an approved Microsoft/Entra flow;
- verify the model uses `outlook.*` and ClawX browser repair tools, not generic Chrome MCP troubleshooting;
- run Outlook open/read/draft smoke without sending;
- confirm Host API logs report `transport=graph` for read/search/draft/send once Graph is signed in;
- run Forms list/preview/dry-run without submitting;
- confirm no managed Chromium fallback is accepted as final proof;
- keep send/submit hard gates.

### 4. Office Files

Owner skill: `windows-runtime-recovery`.

Tasks:

- place separate sample data for Daily Report and Suspension flows in Downloads;
- run Excel analysis and Word/suspension-source extraction through the app chat;
- capture transcript/tool-call evidence without private content.

### 5. ASR

Owner skill: `windows-build-package`.

Tasks:

- verify the Windows ASR helper is bundled;
- run one microphone or file transcription smoke if hardware allows;
- if quality remains weak, mark ASR as best-effort for GA and leave cloud/high-quality ASR as a post-GA improvement.

### 6. Observability And Support

Owner skill: `ga-release-readiness`.

Tasks:

- document log locations and redaction rules;
- decide whether Phoenix is GA-required or post-GA;
- add a support bundle procedure for installer, app, Gateway, and browser logs;
- keep key/material redaction mandatory.

### 7. Admin And Security

Owner skill: `ga-release-readiness`.

Tasks:

- confirm no committed secrets;
- confirm Outlook/Forms access path does not require users to configure Chrome manually;
- keep Microsoft Graph disabled until Entra registration is approved;
- keep key rotation and broker ownership documented.

### 8. Branding And UX

Owner skill: `ga-release-readiness`.

Tasks:

- remove principal-facing `ClawX`, `OpenClaw`, upstream model, and developer
  brand names from the shipped UI and docs;
- keep technical `OpenClaw` names only in developer diagnostics, logs, file
  paths, and internal runbooks where they are needed for support;
- update package metadata, permission prompts, release notes, and chat harness
  prompts to use Ministry wording;
- add a branding grep check before GA.

## Validation Commands

Run locally before a release tag:

```bash
git status --short --branch
pnpm run typecheck
pnpm exec vitest run tests/unit/chrome-cdp.test.ts tests/unit/outlook-playwright-driver-cdp.test.ts tests/unit/forms-browser-driver-cdp.test.ts tests/unit/moe-principal-assistant-plugin.test.ts tests/unit/outlook-browser.test.ts
pnpm exec vitest run tests/unit/channel-router.test.ts tests/unit/provider-runtime-sync.test.ts
pnpm exec vitest run tests/unit/forms-browser-driver-cdp.test.ts tests/unit/forms-browser-submit-gate.test.ts
pnpm exec vitest run tests/unit/asr-ipc-provider-selection.test.ts tests/unit/asr-feature-flags.test.ts
pnpm run harness:ci
git grep -E "(sk-ant-|sk-proj-|hf_[A-Za-z0-9]{30,})" -- .
```

Run for Windows packaging:

```bash
pnpm run prep:win-binaries
pnpm run build:win
```

Run on the Windows laptop or clean profile:

```bash
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-probe-state.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-verify-outlook-tab.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-run-installed-gateway-smoke.ps1"'
ssh pilot 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\pilot-run-chat-procedures.ps1"'
```

The chat procedure harness includes `fresh-user-check-email-routes-outlook-tools`, which must observe `outlook.read_inbox` and must not observe Chrome setup/debugging instructions in tool inputs or the final answer.

## Agent Execution Plan

Codex:

- `ga_release_conductor` owns the gate table.
- `ga_e2e_regression_verifier` owns the known-failure regression matrix and test evidence.
- `windows_runtime_debugger` owns Gateway/model/Office/ASR diagnosis.
- `office_automation_verifier` owns Outlook/Forms/Office safety proof.
- `windows_release_packager` owns packaging and installer evidence.
- `ga_docs_researcher` verifies official docs when an external tool convention changes.

Claude Code:

- `/ga-release-readiness` starts the GA pass.
- `ga-e2e-regression-verifier` owns the known-failure regression matrix and test evidence.
- `ga-release-conductor` coordinates release evidence.
- Existing auditors cover production readiness, dependency classification, state idempotency, DOM selector stability, config coherence, and Windows smoke.

## GA Verdict Rules

Green:

- all release-critical gates have fresh evidence;
- clean install works without manual Chrome configuration beyond normal Microsoft sign-in;
- online model path is controlled and does not expose upstream provider keys;
- Outlook/Forms/Office flows pass with safety gates;
- docs and release notes match the shipped installer.

Yellow:

- demo/pilot can proceed, but at least one GA item remains accepted as a documented limitation.

Red:

- chat cannot complete through the intended online path;
- Gateway cannot recover reliably;
- installer fails fresh install;
- Outlook/Forms safety gates can be bypassed;
- secrets are exposed or committed.

## Next Action

Run the OKR validation pass, then rebuild the installer only after the gate
table is updated with fresh evidence.
