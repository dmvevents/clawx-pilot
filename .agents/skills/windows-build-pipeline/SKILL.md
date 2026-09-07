---
name: windows-build-pipeline
description: Improve, diagnose, or document the ClawX Windows build pipeline, including hosted GitHub packaging, source/profile provenance, cache strategy, and build failure prevention. Use windows-build-package for actual installer packaging and windows-vm-smoke for installed acceptance evidence.
---

# Windows Build Pipeline

Use this skill when the task is to make Windows builds smoother, reproducible, faster to diagnose, or safer to publish from GitHub Actions.

Start by reading `docs/build/windows-build-pipeline.md`, then inspect the specific workflow/script under discussion. Keep these boundaries clear:

- Build-pipeline work owns CI phase shape, cache/toolchain reliability, source/profile/receipt provenance, build artifact upload contracts and failure diagnostics.
- `windows-build-package` owns running the actual package command and checking installer/package mechanics.
- `windows-vm-smoke` owns installed Windows evidence.
- `ga-release-readiness` owns the GA/RC/demo-only verdict.

Required invariants:

- Do not weaken clean-source, keyless-public, no-direct-electron-builder-publish, compiled-output receipt, release manifest or release-evidence checks.
- Public hosted artifacts must not contain credential-bearing cloud gateway or Azure Speech seeds.
- Validate required Windows helpers before and after packaging, including pinned FFmpeg bytes, license and provenance notices. Bind the shipped helper directory in the release manifest; retained files from an older installation cannot satisfy package completeness.
- Do not publish, dispatch workflows, mutate GitHub releases, push branches, install on VMs, or touch Plane unless the parent explicitly authorizes that external action.
- Do not print provider keys, passwords, Host API tokens, private Forms URLs, email bodies, stakeholder transcripts or tenant-private runtime logs.

When improving the workflow, prefer small changes that expose phases and evidence: setup, dependency/cache, source/profile record, preflight, Windows binary preparation, compile/bundle, receipt verification, builder, seed scan and artifact upload. Run targeted smoke checks before spending another hosted Windows build, then preserve the full native build as the real artifact gate. Report what is implemented versus proposed, including the allowlisted build summary fields, and do not claim a speedup until a later native Windows run measures it.

Return the changed files, exact validation commands, remaining release/evidence gaps and whether runtime acceptance still needs the existing VM/GA lanes.
