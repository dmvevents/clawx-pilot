# GA Release Plan - 2026-06-09

## Target Result

Ship ClawX / Ministry of Education as a GA-quality Windows installer for non-technical principals, with a supported online model path, safe Outlook and Forms automation, Office document handling, ASR expectations, and a documented fallback/support process.

Current status: **YELLOW - RC/demo-ready after Microsoft sign-in, not GA**.

## Current RC Baseline

- Windows RC tag: `moe10-windows-rc-20260608-eb7146c`.
- Release asset: `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
- Installer SHA256: `b981bde084340bcfafb6d527aba1a963118a82873a3c0b1b0c531eaf63cc8ecd`.
- RC commit: `eb7146ccf8b0e1282cfc7efcaab9e195c0576feb`.
- Operator instructions: `windows-pilot/plans/MOE_WINDOWS_END_TO_END_INSTRUCTIONS_2026-06-08.md`.
- Release notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-08_RELEASE_NOTES.md`.

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

## GA Gates

| Gate | Required evidence | Current state |
|---|---|---|
| Installer reproducibility | `pnpm run build:win`, installer path, SHA256, `playwright-core` still in runtime dependencies | 2026-06-10 local build passed; installer SHA256 `4663ad8a1d46729633132ddac47fc8bc40c1d5d14fd29da231b53941b22d1931`; packaged runtime check confirmed `playwright-core`, `xlsx`, `docx`, `mammoth`, `pdf-parse`, ASR helper, `node`, `uv`, cloud gateway seed files, and Microsoft Graph example config |
| Clean install | fresh Windows user or laptop install, desktop shortcut launch, Gateway/Host API reachable | 2026-06-09 GCP Windows VM `clawx-win-rc-20260609` proof passed for the local rebuild: downloaded bytes `390056548`, SHA256 matched, silent uninstall exit `0`, install exit `0`, app exe present; visual smoke showed Chrome CDP, Electron CDP, Host API, Gateway, and post-probe readiness true |
| Online model path | installed app completes one chat through managed gateway/model broker or configured cloud provider; no raw upstream keys exposed to the user | GitHub Windows packaging requires `CLAWX_CLOUD_GATEWAY_CONFIG_JSON` and `CLAWX_CLOUD_GATEWAY_KEY`; VM proof confirmed packaged seed files present, `providerKeys=1`, local Qwen seeded with `default=false`, and `.openclaw` default model `custom-moecloud/moe-demo-pro`; model chat smoke still needed |
| Microsoft 365 programmatic config | installer can carry non-secret tenant/client defaults so Outlook can use Microsoft Graph after sign-in instead of Chrome troubleshooting | 2026-06-10 implementation added `resources/microsoft-graph.example.json`, ignored `resources/microsoft-graph.json` packaged-copy support, store fallback from packaged/user/env config, and optional GitHub Actions `CLAWX_MICROSOFT_GRAPH_CONFIG_JSON` injection; needs real Entra client ID from IT |
| Runtime coherence | settings/provider store, `~/.openclaw/openclaw.json`, agent `models.json`, and latest transcript agree | VM install proof confirmed `.openclaw` default primary `custom-moecloud/moe-demo-pro`; provider/config coherence should be rechecked after a real chat transcript |
| Outlook safety | open/read/draft smoke passes through signed-in Chrome CDP; send requires explicit same-session confirmation | VM visual smoke `20260609-235054` passed Outlook open/read and refused send/download without confirmation |
| Outlook attach UX | a fresh user who asks "check my email" is routed through `outlook.*`, `browser.diagnose`, and `browser.repair_chrome_cdp`; the assistant must not tell the user to enable Chrome remote debugging, use `chrome://flags`, search the web, or run manual Chrome commands | user report on 2026-06-09 exposed old guidance; regression patch and chat-harness scenario added; local unit tests passed; clean installer proof now passed on GCP VM, but Chrome/Outlook sign-in proof still requires Chrome on the test image or a physical laptop |
| Forms safety | Forms list/preview/dry-run passes; submit requires explicit same-session confirmation | Forms list passes and submit without confirm refuses for both Daily Report and Suspensions. Preview is blocked on clean VM by Microsoft sign-in: Forms tabs land on `login.microsoftonline.com/.../authorize`; driver now reports a precise sign-in-required diagnostic instead of selector timeout. Filling still needs signed-in Microsoft profile evidence. |
| Office files | sample Excel and Word analysis complete from Downloads through app chat | packaged runtime check confirmed parser dependencies and Office smoke reports `OFFICE_RUNTIME_READY`; still needs fresh app-chat transcript proof |
| ASR | Windows ASR helper installed and one transcript smoke passes, or ASR explicitly marked best-effort for GA | packaged runtime check confirmed `resources/bin/WinSpeechRecognize.exe`; quality remains best-effort until microphone/file transcription proof is captured |
| Secrets | no committed upstream keys or test passwords; desktop stores only broker/client-scoped credentials | verify with git grep and install-state audit |
| UI trust | no raw model/vendor identity in principal-facing UI; cost hidden from frontend | existing checklist green; rerun grep |
| Observability | local logs redacted, support artifact capture documented, optional Phoenix/model tracing decision recorded | local logs exist; Phoenix optional pending |
| Documentation | first-run, install, support, and operator runbooks match the GA installer | RC docs exist; GA docs need final pass |

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
- verify one installed-app chat through the broker;
- document failure handling when Wi-Fi or gateway is unavailable;
- keep local model fallback only as an explicit fallback, not the demo default.

### 3. Outlook And Forms

Owner skill: `windows-outlook-forms`.

Tasks:

- verify Microsoft Graph sign-in and Graph-backed Outlook read/draft first;
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
- `windows_runtime_debugger` owns Gateway/model/Office/ASR diagnosis.
- `office_automation_verifier` owns Outlook/Forms/Office safety proof.
- `windows_release_packager` owns packaging and installer evidence.
- `ga_docs_researcher` verifies official docs when an external tool convention changes.

Claude Code:

- `/ga-release-readiness` starts the GA pass.
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

Run a GA readiness pass against this plan, then rebuild the installer only after the gate table is updated with fresh evidence.
