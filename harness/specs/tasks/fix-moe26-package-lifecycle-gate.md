---
id: fix-moe26-package-lifecycle-gate
title: Complete and prove the OpenClaw package lifecycle before shipping so the installed Gateway can start
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Fix the confirmed moe.26 installed regression where the Gateway exited 1 on
  every start with "openclaw: package lifecycle is incomplete. Reinstall with
  package scripts enabled, then retry. OpenClaw package postinstall did not
  complete its lifecycle marker". The bundle shipped OpenClaw 2026.9.2's
  .openclaw-lifecycle-pending install marker because pnpm never ran the
  package's postinstall (openclaw was not approved in
  pnpm.onlyBuiltDependencies) and bundle-openclaw.mjs copied the pnpm store
  entry verbatim; on the installed app the launcher's startup self-heal
  observably failed (its lifecycle children exited 0 without completing the
  marker — child env/argv mechanism pending root native diagnostics) and an
  in-place self-heal would prune the bundle's mirrored extension deps anyway,
  so the lifecycle must be completed and proven at build time.
touchedAreas:
  - harness/specs/tasks/fix-moe26-package-lifecycle-gate.md
  - package.json
  - scripts/openclaw-package-lifecycle.mjs
  - scripts/bundle-openclaw.mjs
  - scripts/verify-openclaw-bundle.mjs
  - tests/unit/openclaw-package-lifecycle.test.ts
expectedUserBehavior:
  - A freshly installed build's Gateway process starts instead of exiting 1 on the package-lifecycle gate; readiness and backend communication proceed over the existing Host API/RPC boundaries, which this task does not change.
  - pnpm install runs OpenClaw's own preinstall/postinstall (approved build scripts), clearing the lifecycle marker the way upstream requires.
  - bundle-openclaw.mjs completes any still-pending package lifecycle inside the owned build/openclaw copy with a real Node runtime, before extension-dependency mirroring, and fails the build if a marker survives; it never mutates the pnpm store or an extracted artifact.
  - verify-openclaw-bundle.mjs executes the ACTUAL shipped entrypoint (openclaw.mjs --version) from the prepared bundle as a positive control, and runs an isolated pending-marker negative control (lifecycle children exiting 0 without completing, the exact installed moe.26 shape) that must exit 1 with the lifecycle-incomplete stderr — proving the upstream guard stays intact rather than weakened, bypassed, or hand-cleared.
  - Startup never reinstalls or mutates the shipped package; the launcher gate only ever fires on a genuinely broken package and keeps failing readably.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
acceptance:
  - node_modules/openclaw carries no .openclaw-lifecycle-pending marker after pnpm install (openclaw approved in pnpm.onlyBuiltDependencies; pnpm log shows its preinstall/postinstall ran).
  - bundle-openclaw.mjs output reports the lifecycle step and build/openclaw contains neither .openclaw-lifecycle-pending nor dist/openclaw-install-guard.
  - verify-openclaw-bundle.mjs fails closed on a pending marker, on a failing shipped-entrypoint --version probe, and on a negative control that does NOT exit 1 with the lifecycle-incomplete stderr.
  - Focused tests in tests/unit/openclaw-package-lifecycle.test.ts pass, including the real-launcher negative control and the prepared-package positive path built from bounded fixture copies (never executing the lifecycle in shared node_modules).
docs:
  required: false
---

Root-cause and evidence chain, native diagnostics still owed by root, and the
independent-review status are recorded in the private evidence report kept
outside the repository (root's correction-evidence store for this fix branch).
This task does not bump versions, rebuild installers, publish, mutate
the Windows VM, or claim installed moe.26 acceptance — root builds and
verifies the next candidate independently. The gateway-transport harness rows
keep proving plugin-host communication; this task adds the missing
shipped-entrypoint (launcher) coverage that those rows deliberately skip.
