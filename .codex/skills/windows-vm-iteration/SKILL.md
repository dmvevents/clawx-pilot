---
name: windows-vm-iteration
description: Iterate on stakeholder-reported Windows failures through the GCP VM/fresh-user lane, from exact artifact diagnosis to bounded fix, installed retest, redacted evidence and handoff. Use for stakeholder connection/setup failures, vanilla Windows first-run gaps, VM development loops, or questions about using the VM to debug before release.
---

# Windows VM Iteration

## Objective

Turn a stakeholder-reported Windows failure into exact, artifact-bound diagnosis and the narrowest tested repair path that satisfies the user's requested outcome. Keep stakeholder evidence, hosted build identity, VM-installed behavior and GA release status separate.

This skill organizes the loop. It does not replace the access, build, smoke, runtime, Outlook/Forms or release-readiness skills.

## First reads

Always start with:

- `docs/PROJECT_CONTRACT.md`
- `docs/COMPLETION_PLAN.md`
- `docs/CURRENT_WINDOWS_RC.md`

Then read only the domain surface needed for the current failure:

- `windows-pilot/vm-testing/README.md` and `.agents/skills/gcp-iap-windows-lane/SKILL.md` for VM access, lifecycle or IAP tunnel work.
- `.agents/skills/windows-vm-smoke/SKILL.md` for installed-app smoke, fresh-profile proof or visible Windows evidence.
- `.agents/skills/windows-runtime-recovery/SKILL.md` for model route, Gateway, local/Ollama, stuck-thinking or provider coherence failures.
- `.agents/skills/windows-build-package/SKILL.md` for installer, helper binaries, shortcuts or package identity.
- `.agents/skills/windows-outlook-forms/SKILL.md` for Outlook, Forms, Chrome CDP, no-send or no-submit flows.
- `.agents/skills/ga-e2e-regression/SKILL.md` when a stakeholder/demo failure must become release-critical regression coverage.
- `.agents/skills/pilot-ssh-ops/SKILL.md` before touching the physical pilot laptop.
- `.agents/skills/ga-release-readiness/SKILL.md` and `docs/GA_RELEASE_EVIDENCE_MANIFEST.md` when making or changing a release verdict.

## Use this loop

1. **Intake the stakeholder report without overclaiming.** Record the exact app version, installer/source identity, timestamps, screenshots/logs received, and what the stakeholder could not test. A stakeholder failure on an older diagnostic build is still valid evidence for that build; do not blame the tester or convert it into acceptance of a newer candidate.
2. **Bind the baseline before mutation.** Identify the hosted build run, source commit, installer hash, installed EXE/ASAR hashes, user profile, Windows session and provider/model route. Hosted package verification, reused VM proof, fresh standard-user proof and external stakeholder proof are separate evidence classes.
3. **Prove access with controls.** Use the GCP IAP lane and require the real RDP protocol response, SSH banner, closed guest-port control and authenticated guest marker. Treat SSH Session 0 metadata as automation context; visual and interaction evidence must come from the actual RDP interactive session.
4. **Use one VM mutator.** Keep one controller responsible for app, Gateway, browser and model-service process changes. Stop only owned app/Gateway/client PIDs when needed. Do not broad-kill unrelated user processes. Back up `%APPDATA%\Ministry of Education` and `%USERPROFILE%\.openclaw` before state-changing install, configuration repair or profile cleanup; an ordinary app restart with no state mutation does not require a full backup.
5. **Prefer a fresh standard user for vanilla-machine claims.** A fresh or reused Server 2022 profile can prove installer and runtime mechanics, but neither establishes Windows 10/11 client acceptance. Standard-user setup must preserve ACL boundaries and avoid requiring elevation for normal first run. Exercise the actual shipped CMD/PowerShell entrypoint in a fresh process; dot-sourced helper tests do not prove default-path resolution or command-launch behavior.
6. **Diagnose before resizing or spending.** Capture CPU, RAM, disk, process and model-service state before any billable VM resize. Respect a recorded owner shutdown hold; generic permission to test does not override a specific hold on stopping the VM.
7. **Iterate narrowly on the VM when it shortens the loop.** Use the VM development workspace only after binding it to the release checkout and artifact under test. Keep fixes small, return reviewed diffs to the main checkout, and do not promote ad hoc diagnostic scripts to operational defaults until they land in the repository and pass review.
8. **Retest the exact claim.** Re-run the smallest installed-app check that can falsify the fix, then expand to the impacted journey: unprovisioned first-run, provisioned Online broker path, local unavailable-model behavior, on-device local path, Outlook/Forms, Office documents, ASR or startup as applicable. A working broker API narrows provisioning infrastructure only; it does not prove the installed Windows app, fresh setup helper, first turn or external acceptance. Silence from an accepted run does not prove provider failure. Correlate the original response and any automatic replay separately, verify fallback-target availability, and compare displayed answer origin with the recorded provider.
9. **Record evidence and hand off safely.** Keep raw/private logs outside git, or under a confirmed gitignored private artifact path. Put only redacted facts in tracked docs and Plane: artifact identity, environment, command or driver, result, limitation and next owner. Do not include endpoint URLs, credentials, key hashes, signed download URLs, private message bodies or full recipient lists.

## Stop condition

Follow the user's requested outcome. For a diagnostic-only request, stop with the reproduction, root cause, affected artifact/profile and next fix. For an authorized repair, continue through the fix and installed retest while the next step is actionable and inside existing authorization.

Honor persisted session authorization and continue already-authorized actions. Check authority before destructive, irreversible, credential-gated, external, billable or scope-changing actions; ask only for missing authority or a conflicting recorded hold. Before asking, make the proposed action concrete and reviewable.
