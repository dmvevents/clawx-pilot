# GA Release Plan - 2026-06-09

## Target Result

Ship ClawX / Ministry of Education as a GA-quality Windows installer for non-technical principals, with a supported online model path, safe Outlook and Forms automation, Office document handling, ASR expectations, and a documented fallback/support process.

Current status: **YELLOW - RC/demo-ready, not GA**.

## Current RC Baseline

- Windows RC tag: `moe10-windows-rc-20260608-eb7146c`.
- Release asset: `Ministry.of.Education-0.4.3-moe.10-win-x64.exe`.
- Installer SHA256: `b981bde084340bcfafb6d527aba1a963118a82873a3c0b1b0c531eaf63cc8ecd`.
- RC commit: `eb7146ccf8b0e1282cfc7efcaab9e195c0576feb`.
- Operator instructions: `windows-pilot/plans/MOE_WINDOWS_END_TO_END_INSTRUCTIONS_2026-06-08.md`.
- Release notes: `windows-pilot/plans/MOE_WINDOWS_RC_2026-06-08_RELEASE_NOTES.md`.

This baseline is acceptable for controlled demo installs. GA requires the gates below.

## GA Gates

| Gate | Required evidence | Current state |
|---|---|---|
| Installer reproducibility | `pnpm run build:win`, installer path, SHA256, `playwright-core` still in runtime dependencies | RC evidence exists; rerun for GA |
| Clean install | fresh Windows user or laptop install, desktop shortcut launch, Gateway/Host API reachable | needs fresh GA rerun |
| Online model path | installed app completes one chat through managed gateway/model broker or configured cloud provider; no raw upstream keys exposed to the user | GitHub Windows packaging now requires `CLAWX_CLOUD_GATEWAY_CONFIG_JSON` and `CLAWX_CLOUD_GATEWAY_KEY` secrets so release installers include the managed gateway seed; clean Windows VM proof pending after rebuild |
| Runtime coherence | settings/provider store, `~/.openclaw/openclaw.json`, agent `models.json`, and latest transcript agree | must verify before tag |
| Outlook safety | open/read/draft smoke passes through signed-in Chrome CDP; send requires explicit same-session confirmation | RC path exists; rerun on clean install |
| Outlook attach UX | a fresh user who asks "check my email" is routed through `outlook.*`, `browser.diagnose`, and `browser.repair_chrome_cdp`; the assistant must not tell the user to enable Chrome remote debugging, use `chrome://flags`, search the web, or run manual Chrome commands | user report on 2026-06-09 exposed old guidance; regression patch and chat-harness scenario added; local unit tests passed; rebuilt installer and clean Windows proof still required |
| Forms safety | Forms list/preview/dry-run passes; submit requires explicit same-session confirmation | RC path exists; rerun on clean install |
| Office files | sample Excel and Word analysis complete from Downloads through app chat | needs fresh GA transcript proof |
| ASR | Windows ASR helper installed and one transcript smoke passes, or ASR explicitly marked best-effort for GA | pending decision/evidence |
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
- verify one installed-app chat through the broker;
- document failure handling when Wi-Fi or gateway is unavailable;
- keep local model fallback only as an explicit fallback, not the demo default.

### 3. Outlook And Forms

Owner skill: `windows-outlook-forms`.

Tasks:

- verify signed-in user Chrome CDP attach;
- verify the model uses `outlook.*` and ClawX browser repair tools, not generic Chrome MCP troubleshooting;
- run Outlook open/read/draft smoke without sending;
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
