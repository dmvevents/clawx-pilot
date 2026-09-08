---
id: cloud-gateway-vision-model-metadata
title: Preserve managed MOE cloud gateway vision metadata
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Ensure managed MOE cloud gateway aliases keep image input capability when ClawX writes OpenClaw runtime provider metadata, so native document image tool results are forwarded to the configured cloud model instead of being downgraded to text-only placeholders.
touchedAreas:
  - harness/specs/tasks/cloud-gateway-vision-model-metadata.md
  - electron/services/providers/provider-runtime-sync.ts
  - electron/utils/openclaw-auth.ts
  - electron/shared/pi-ai-model-cost.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/openclaw-auth.test.ts
expectedUserBehavior:
  - Online `moe-demo-pro` document image requests can inspect native image blocks returned by `document.read_image`.
  - Generic custom providers keep the current text-only capability default unless explicitly configured elsewhere.
  - The model broker and document tools are unchanged by this repair.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - gateway-readiness-policy
  - active-config-guards
requiredTests:
  - pnpm exec vitest run tests/unit/provider-runtime-sync.test.ts tests/unit/openclaw-auth.test.ts
  - pnpm harness validate --spec harness/specs/tasks/cloud-gateway-vision-model-metadata.md
acceptance:
  - Saved/ensured/header-refreshed managed cloud gateway config writes preserve `input: ["text", "image"]` in OpenClaw provider metadata.
  - The managed `moe-cloud-gateway` provider sync writes `input: ["text", "image"]` for `moe-demo-pro` and `moe-demo` in per-agent model provider entries.
  - The managed `custom-moecloud` default-provider override writes `input: ["text", "image"]` for `moe-demo-pro` and `moe-demo` in OpenClaw provider entries.
  - Already-prefixed model refs such as `custom-moecloud/moe-demo-pro` become unprefixed provider row ids and are not double-prefixed in defaults.
  - Stale managed `models.json` rows with `input: ["text"]` are replaced with `input: ["text", "image"]` on sync.
  - Existing nonzero model pricing and unrelated model metadata are preserved when managed vision metadata replaces stale input capability.
  - Arbitrary custom providers and unrelated model ids retain the current capability default.
  - A local pi-ai transform diagnostic proves tool-result image blocks are omitted for text-only metadata and preserved for `input: ["text", "image"]`.
docs:
  required: false
---

Installed moe.22 P5 evidence showed `document.read_image` returned a native PNG content block for the verified Student Support Referral Form, but `custom-moecloud/moe-demo-pro` was registered as text-only in OpenClaw model metadata. This task scopes the source regression to managed gateway model metadata and leaves installed P5 proof to the VM acceptance pass for the rebuilt artifact.
