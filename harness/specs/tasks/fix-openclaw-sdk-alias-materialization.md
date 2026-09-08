---
id: fix-openclaw-sdk-alias-materialization
title: Fix OpenClaw SDK alias repeated materialization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep repeated plugin loader startup passes from rewriting unchanged OpenClaw plugin-sdk alias files.
touchedAreas:
  - harness/specs/tasks/fix-openclaw-sdk-alias-materialization.md
  - scripts/bundle-openclaw.mjs
  - scripts/openclaw-sdk-alias-patch.mjs
  - scripts/verify-openclaw-bundle.mjs
  - tests/unit/clwx92-bundle-fixture.test.ts
  - tests/unit/openclaw-sdk-alias-patch.test.ts
expectedUserBehavior:
  - A fresh Windows startup can pass through plugin loading without spending repeated wall time rewriting unchanged SDK alias wrappers.
  - Missing or stale SDK alias package files and wrapper files are regenerated before plugin imports use them.
  - Runtime module wrapper import/export semantics stay compatible with the pinned OpenClaw plugin-sdk files.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
acceptance:
  - The actual pinned OpenClaw loader helper reproduces repeated writes on a second unchanged materialization.
  - The patched helper performs no mkdir/write work on a second unchanged materialization for the same dist root.
  - Missing package.json, stale wrappers, non-directory alias targets and source default-export changes are repaired.
  - Named and default wrapper imports continue to work.
  - The OpenClaw bundle patch is idempotent and fails closed if pinned target snippets drift.
docs:
  required: false
---

This task covers the CLWX-125 startup profile finding: pinned OpenClaw
`ensureOpenClawPluginSdkAlias` rewrites the alias `package.json` and every
`plugin-sdk/*.js` wrapper on every plugin loader pass. On Windows this dominated
startup in the first-turn CPU profile through repeated mkdir/write activity.

The fix must stay narrow. Do not disable providers or plugins, change registry
caching, memoize globally across dist roots, increase timeouts, or change runtime
module wrapper semantics. Patch only the pinned shipped OpenClaw bundle and
verify the patch as part of bundle verification.
