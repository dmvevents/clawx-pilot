---
name: windows-build-pipeline
description: Improve, diagnose, or document the ClawX Windows build pipeline, including hosted GitHub packaging, source/profile provenance, cache strategy, and build failure prevention. Use windows-build-package for actual installer packaging and windows-vm-smoke for installed acceptance evidence.
allowed-tools: Read, Bash, Grep, Glob
---

# Windows Build Pipeline

Use this skill when build work is about GitHub Actions packaging reliability, source/profile provenance, cache/toolchain behavior, or failure prevention.

First read `docs/build/windows-build-pipeline.md`. Then inspect only the workflow, scripts and tests needed for the assigned build-pipeline change.

Boundaries:

- Build-pipeline work owns CI phase shape, cache/toolchain reliability, build profile/source/receipt records, artifact upload contracts and diagnostics.
- `windows-build-package` owns actual packaging and installer mechanics.
- `windows-vm-smoke` owns installed Windows proof.
- `ga-release-readiness` owns the release verdict.

Rules:

- Do not weaken clean-source, keyless-public, no-direct-publish, compiled-output receipt, manifest or release-evidence checks.
- Public hosted artifacts must not contain credential-bearing cloud gateway or Azure Speech seeds.
- Do not push, dispatch workflows, publish releases, install on VMs, or mutate Plane/GitHub unless the parent explicitly authorizes that external action.
- Do not print provider keys, passwords, Host API tokens, private Forms URLs, email bodies, stakeholder transcripts or tenant-private runtime logs.

Run targeted smoke checks before spending another hosted Windows build, then preserve the full native build as the real artifact gate. Report implemented changes versus proposed follow-ups, allowlisted summary/provenance fields, exact validation commands, and any remaining dependency on installed VM/GA evidence.
