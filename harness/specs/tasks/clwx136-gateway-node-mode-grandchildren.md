---
id: clwx136-gateway-node-mode-grandchildren
title: Gateway execPath grandchildren must run as Node, not the GUI app
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make every OpenClaw child spawned from the Gateway utilityProcess via process.execPath execute as Node so worker stdout JSON contracts (SQLite read-only/integrity workers, package lifecycle children) cannot be corrupted by a booting GUI app instance.
touchedAreas:
  - electron/gateway/config-sync.ts
  - electron/utils/paths.ts
  - resources/gateway/clawx-gateway-node-mode-entry.mjs
  - tests/unit/config-sync.test.ts
  - tests/unit/gateway-node-mode-entry.test.ts
  - tests/unit/gateway-supervisor-doctor-repair.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - harness/specs/tasks/clwx136-gateway-node-mode-grandchildren.md
expectedUserBehavior:
  - Installed Windows startup reaches Gateway readiness with an existing OpenClaw state database; the SQLite read-only worker returns its one-object JSON result instead of "returned invalid JSON".
  - Gateway helper children (SQLite read-only/integrity workers, package lifecycle scripts) run headless as Node; no second GUI instance, no duplicate-instance stdout line, no stolen single-instance lock.
  - Gateway startup failure reporting is unchanged; invalid worker output still fails loudly rather than being swallowed.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - tests/unit/config-sync.test.ts
  - tests/unit/gateway-node-mode-entry.test.ts
acceptance:
  - The Gateway utilityProcess entry is the ClawX-owned Node-mode shim; the real OpenClaw entry is passed via CLAWX_GATEWAY_REAL_ENTRY and imported at its real path so import.meta.url-relative lifecycle checks keep working.
  - The shim sets ELECTRON_RUN_AS_NODE inside the Gateway process before OpenClaw loads, restores the argv[1] contract, and fails closed with a clear stderr message when CLAWX_GATEWAY_REAL_ENTRY is absent.
  - ELECTRON_RUN_AS_NODE is never placed in the utilityProcess fork env itself; an unfiltered passthrough would boot the utility process as plain Node.
  - No OpenClaw dist patching, no invalid-JSON swallowing, no timeout extension; worker parse failures remain fatal.
docs:
  required: false
---

Use this task spec for the CLWX-136 repair: the Gateway runs as an Electron utilityProcess where `process.execPath` is the GUI binary, and OpenClaw 2026.9.2 spawns SQLite/lifecycle children through `process.execPath` with the inherited environment. The native Windows probe on the exact installed moe.28 bytes proved the shipped worker emits valid JSON on success and error paths under Electron-as-Node (`v24.15.0`) and bundled `node.exe`; the shim guarantees that execution mode for the whole grandchild class. Installed-startup and ordinary-chat proof on a rebuilt identified artifact remain separate acceptance stages.
