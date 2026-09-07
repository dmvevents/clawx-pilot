---
name: windows-build-pipeline
description: Improve, diagnose, or document the ClawX Windows build pipeline, including hosted GitHub packaging, source/profile provenance, cache strategy, and build failure prevention. Use windows-build-package for actual installer packaging and windows-vm-smoke for installed acceptance evidence.
---

# Windows Build Pipeline

Read `docs/build/windows-build-pipeline.md` before changing build workflow, provenance, cache, or failure-diagnostic behavior.

This skill owns build pipeline quality: CI phase ordering, dependency/toolchain setup, cache policy, source/profile/compiled-output receipts, build artifact upload contracts and diagnostics. It does not own installer acceptance or the GA verdict.

Keep these boundaries:

- Use `windows-build-package` for actual package execution and installer mechanics.
- Use `windows-vm-smoke` for installed Windows proof.
- Use `ga-release-readiness` for GA/RC/demo-only release decisions.

Do not weaken clean-source, keyless-public, no-direct-publish, compiled-receipt, manifest or evidence checks. Public hosted artifacts must not include credential-bearing cloud gateway or Azure Speech seeds. Do not push, dispatch, publish, install on VMs or mutate Plane/GitHub unless explicitly authorized for that external action.

For workflow improvements, prefer phase-visible changes: setup, dependency/cache, source/profile record, preflight, Windows binary preparation, compile/bundle, receipt verification, builder, seed scan and artifact upload. Run targeted smoke checks before spending another hosted Windows build, then preserve the full native build as the real artifact gate. Separate proposed improvements from implemented behavior, report allowlisted summary/provenance fields, and return exact validation evidence.
