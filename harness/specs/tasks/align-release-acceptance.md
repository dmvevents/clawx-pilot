---
id: align-release-acceptance
title: Bind GA release acceptance to tested source and installed artifact evidence
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Bind strict release evidence and staged publication to the tested source and installed artifacts while preserving development health checks.
touchedAreas:
  - ".gitattributes"
  - "tests/unit/harness-windows-e2e.test.ts"
  - ".agents/skills/ga-e2e-regression/SKILL.md"
  - ".agents/skills/ga-release-readiness/SKILL.md"
  - ".agents/skills/windows-demo-resume/SKILL.md"
  - ".gitignore"
  - ".claude/agents/ga-release-conductor.md"
  - ".claude/agents/ministry-liaison-monitor.md"
  - ".claude/commands/windows-demo-resume.md"
  - ".claude/skills/ga-e2e-regression/SKILL.md"
  - ".claude/skills/ga-release-readiness/SKILL.md"
  - ".claude/skills/ga-sprint-driver/SKILL.md"
  - ".claude/skills/ministry-liaison-monitor/SKILL.md"
  - ".claude/skills/ministry-liaison-send/SKILL.md"
  - ".claude/skills/windows-demo-resume/SKILL.md"
  - ".codex/agents/ga-release-conductor.toml"
  - ".codex/skills/ga-e2e-regression/SKILL.md"
  - ".codex/skills/ga-release-readiness/SKILL.md"
  - ".codex/skills/windows-outlook-demo/SKILL.md"
  - "AGENTS.md"
  - "README.md"
  - "README.zh-CN.md"
  - "README.ja-JP.md"
  - "CLAUDE.md"
  - "docs/AGENT_SKILL_INTEROPERABILITY.md"
  - "docs/COMPLETION_PLAN.md"
  - "docs/CURRENT_WINDOWS_RC.md"
  - "docs/GA_FINISH_SPRINT_2026-09-03.md"
  - "docs/GA_LOOP_PROMPT.md"
  - "docs/GA_PLAN.md"
  - "docs/GA_RELEASE_EVIDENCE_MANIFEST.md"
  - "docs/GA_RELEASE_PLAN_2026-06-09.md"
  - "docs/GA_SPRINT_STATE_VECTOR.md"
  - "docs/PROJECT_CONTRACT.md"
  - "docs/project-history/README.md"
  - "docs/wiki/GA_READINESS.md"
  - "harness/specs/rules/completion-evidence.md"
  - "harness/specs/scenarios/gateway-backend-communication.md"
  - "scripts/ga-gate.mjs"
  - "scripts/ga-gate-verdict.mjs"
  - "tests/unit/ga-gate-verdict.test.ts"
  - "harness/specs/tasks/align-release-acceptance.md"
  - "windows-pilot/AGENTS.md"
  - "scripts/release-build-source.mjs"
  - "scripts/run-electron-builder.mjs"
  - "scripts/release-hash-manifest.mjs"
  - "scripts/installed-release-evidence.mjs"
  - "scripts/release-evidence.mjs"
  - "scripts/release-build-profile.mjs"
  - "scripts/vm-verify-moe19.sh"
  - "tests/unit/release-hash-manifest.test.ts"
  - "tests/unit/release-build-source.test.ts"
  - "tests/unit/run-electron-builder.test.ts"
  - "tests/unit/windows-package-inspection.test.ts"
  - "tests/unit/installed-release-evidence.test.ts"
  - "tests/unit/release-evidence.test.ts"
  - "tests/unit/release-build-profile.test.ts"
  - "tests/unit/release-publication-workflows.test.ts"
  - "tests/unit/vm-evidence-collector.test.ts"
  - "tests/fixtures/installed-release-evidence.ts"
  - "package.json"
  - "docs/release-manifests/0.4.3-moe.20.json"
  - ".github/workflows/package-win-manual.yml"
  - ".github/workflows/release.yml"
  - ".github/workflows/release-evidence-manual.yml"
  - "windows-pilot/scripts/pilot-run-installed-gateway-smoke.ps1"
  - "docs/evidence/CLWX-106_release-gate_review_2026-09-07.md"
  - ".agents/skills/gcp-iap-windows-lane/SKILL.md"
  - ".claude/skills/gcp-iap-windows-lane/SKILL.md"
  - ".agents/skills/windows-vm-smoke/SKILL.md"
  - ".codex/skills/windows-vm-smoke/SKILL.md"
  - ".claude/skills/windows-vm-smoke/SKILL.md"
  - "skills/laptop/skills/windows-vm-smoke/SKILL.md"
  - "windows-pilot/vm-testing/README.md"
  - "windows-pilot/vm-testing/gcp-iap-lane.sh"
  - "windows-pilot/scripts/pilot-fresh-install-environment.ps1"
  - "windows-pilot/scripts/pilot-record-app-window.ps1"
  - "scripts/verify-app-window-recording.mjs"
  - "tests/unit/gcp-iap-lane.test.ts"
  - "tests/unit/windows-app-recording.test.ts"
  - "docs/WINDOWS_INSTALL_RUNBOOK.md"
  - "docs/evidence/WINDOWS_VM_TESTING_2026-09-07.md"
  - "electron/main/index.ts"
  - "electron/utils/openclaw-cli.ts"
  - "tests/unit/openclaw-cli.test.ts"
  - "electron/main/cloud-gateway-provider-seed.ts"
  - "electron/main/local-provider-seed.ts"
  - "electron/main/gateway-plugin-config-seed.ts"
  - "electron/services/providers/provider-runtime-sync.ts"
  - "electron/services/providers/channel-router.ts"
  - "electron/utils/openclaw-auth.ts"
  - "tests/unit/channel-router.test.ts"
  - "tests/unit/provider-runtime-sync.test.ts"
  - "tests/unit/cloud-gateway-provider-seed.test.ts"
  - "tests/unit/local-provider-seed.test.ts"
  - "tests/unit/gateway-plugin-config-seed.test.ts"
  - "tests/unit/gateway-boot-convergence.test.ts"
  - "harness/specs/scenarios/gateway-startup-diagnostics.md"
  - "docs/plane-board/CLWX-board-export.json"
  - "docs/plane-board/CLWX-board.md"
  - "docs/PLANE_BOARD_API.md"
  - "docs/evidence/WINDOWS_RUNTIME_RECOVERY_2026-09-07.md"
  - "src/stores/chat.ts"
  - "src/stores/chat/types.ts"
  - "tests/unit/chat-artifact-panel-layout.test.tsx"
  - "tests/unit/chat-channel-degrade.test.ts"
  - "windows-pilot/scripts/pilot-chat-turn-driver.js"
  - "windows-pilot/scripts/pilot-run-chat-turn.ps1"
  - "tests/unit/windows-pilot-harness-honesty.test.ts"
  - "src/pages/Chat/index.tsx"
  - "src/pages/Chat/ChatInput.tsx"
  - "src/pages/Chat/ExecutionGraphCard.tsx"
  - "electron/api/routes/settings.ts"
  - "scripts/verify-openclaw-bundle.mjs"
  - "scripts/bundle-openclaw.mjs"
  - "scripts/openclaw-pricing-cache-patch.mjs"
  - "tests/unit/openclaw-pricing-cache-patch.test.ts"
  - "scripts/clwx92-workerenv-check.mjs"
  - "eval/fixtures/clwx92-public-pdf-fixture.pdf"
  - "tests/unit/clwx92-bundle-fixture.test.ts"
  - "tests/unit/settings-degrade-route.test.ts"
  - "tests/unit/chat-page-execution-graph.test.tsx"
  - "tests/e2e/chat-task-visualizer.spec.ts"
expectedUserBehavior:
  - "Normal development health runs fail on blocked required T1 lanes. Static-only mode explicitly excludes live lanes; unset dispatch opt-ins remain skips. Neither mode establishes release acceptance."
  - "Strict release runs fail when renderer E2E, T1 live lane, or installed Windows app evidence is absent or non-passing."
  - "The current T2 probe is reported as unresolved evidence rather than accepted as installed-app proof."
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "completion-evidence"
  - "backend-communication-boundary"
requiredTests:
  - "tests/unit/openclaw-pricing-cache-patch.test.ts"
  - "tests/unit/openclaw-cli.test.ts"
  - "tests/unit/clwx92-bundle-fixture.test.ts"
  - "tests/unit/chat-channel-degrade.test.ts"
  - "tests/unit/channel-router.test.ts"
  - "tests/unit/settings-degrade-route.test.ts"
  - "tests/unit/windows-pilot-harness-honesty.test.ts"
  - "tests/unit/chat-page-execution-graph.test.tsx"
  - "tests/unit/release-build-profile.test.ts"
  - "tests/unit/ga-gate-verdict.test.ts"
  - "tests/unit/release-build-source.test.ts"
  - "tests/unit/run-electron-builder.test.ts"
  - "tests/unit/release-hash-manifest.test.ts"
  - "tests/unit/installed-release-evidence.test.ts"
  - "tests/unit/release-evidence.test.ts"
  - "tests/unit/release-publication-workflows.test.ts"
  - "tests/unit/vm-evidence-collector.test.ts"
  - "tests/unit/gcp-iap-lane.test.ts"
  - "tests/unit/windows-app-recording.test.ts"
acceptance:
  - "Windows checkout preserves LF source and embedded scripts while retaining binary PDF bytes; native Windows preflight executes portable subprocess fixtures without POSIX executable assumptions."
  - "`node scripts/ga-gate.mjs --release` and `GA_GATE_RELEASE=1 node scripts/ga-gate.mjs` select strict release scoring without enabling live send or form submit actions."
  - "Strict release scoring uses explicit criterion identifiers on rows, not row-label or log regexes."
  - "Strict release scoring fails closed on missing required criteria and required rows with SKIP, BLOCKED, NOT_RUN, INFO, FAIL, or an unexpected status."
  - "`optional: true` does not bypass a release-required criterion failure."
  - "`GA_GATE_STATIC=1` combined with strict release mode cannot exit successfully."
  - "The runner uses the same exported pure scorer covered by unit tests."
  - "Publication refuses missing/changed evidence, unproven or dirty build source, mismatched installer/app hashes, and missing installed producer observations before uploading or marking a manifest published."
  - "Plain manifest regeneration does not retroactively certify old artifacts; merged platform artifacts retain their own provenance."
  - "Packaging rejects missing compiled-output receipts, stale entrypoints, or changed dist/dist-electron bytes before the builder starts."
  - "Windows acceptance binds every required portable producer file to the run; private diagnostic logs are excluded and cannot substitute for status evidence."
  - "A complete machine-produced fixture passes; paper PASS, missing/ambiguous producers, wrong source, or altered bytes fail."
  - "The IAP probe verifies real RDP and SSH protocols and a provider-rejected closed guest port, with no false success from a local listener or unavailable VM."
  - "Installed evidence includes a redacted pre-mutation Windows environment profile; Server, reused-state and privilege observations do not certify client or clean-machine coverage."
  - "App-window recordings preserve native dimensions, bind the installed executable and video bytes, and report capture-only until visual and product outcomes are reviewed."
  - "Pre-start boot convergence writes provider/channel configuration without queuing a deferred Windows Gateway restart; live settings refresh and acknowledged send-time cutover remain intact."
  - "Installed runtime acceptance measures RPC readiness, actual online chat and artifact outcomes on the rebuilt candidate; board updates distinguish source, package and installed proof."
  - "Normal non-static scoring exits nonzero for blocked required T1 checks, including an explicitly requested send check with no authenticated Outlook tab."
  - "Startup preserves bundled browser settings and existing ACP/ACPX config; installations without any ACP setup do not probe an unshipped coding-agent adapter."
  - "A successful owning cloud turn cancels pending degradation before a stale payload can be replayed; streaming and history-discovered terminal outcomes share ownership semantics."
  - "Installed chat acceptance rejects unexpected channel degradation, duplicate prompt replay, and a visible answer with unfinished recovery."
  - "Publication rejects report, required execution, and installed observations older than 24 hours, including stale observations inside a fresh report."
  - "Packaged PDF parsing uses a checked-in synthetic public fixture and fails if it is missing; excluding private evidence cannot silently skip the parser regression."
  - "Public hosted packaging does not inject cloud or speech credentials, verifies staged seed absence before upload, and binds the explicit build profile to publication provenance."
  - "Pinned OpenClaw pricing refresh normalizes only configured candidate providers, preserves exact/alias/wrapper and LiteLLM pricing lookup, and packaging rejects missing or partially applied patch code."
  - "Pending session recovery remains visible to users and the terminal acceptance driver when a new turn replaces the originating notice; operation completion cannot erase a newer session pin."
docs:
  required: true
---

CLWX-106 closes the gap where a scorecard could truthfully print missing release
coverage while the process exit still succeeded. This task adds a strict release
judgement over the existing gate rows without changing the live action gates.

The continuation implements T2 evidence ingestion, per-artifact build provenance,
and staged-publication enforcement. SSH availability remains diagnostic; only
complete machine producer observations bound to the current candidate can pass.
The existing independent review artifact belongs to the preceding verdict change;
it is not approval of this continuation.

Task baseline is `58d04eb0`, the source at the start of the alignment. This working
branch contains earlier product work unrelated to this task; do not widen this
spec to all changes since upstream `origin/main`. Validate the actual task diff:

```sh
pnpm harness validate --spec harness/specs/tasks/align-release-acceptance.md --since 58d04eb0
pnpm harness run --spec harness/specs/tasks/align-release-acceptance.md --since 58d04eb0 --dry-run
```

These commands include the task's committed, working-tree and untracked changes;
they do not use `--no-diff`. The ignored local scheduler change preserves all
fields except the existing sprint prompt and is verified separately.

September 7 continuation: restored VM access exposed a pre-start provider refresh
that restarts the first ready Gateway. The runtime repair and live Plane evidence
synchronization continue this integrated acceptance task; see the dated Windows
runtime report for the new candidate and observations.
