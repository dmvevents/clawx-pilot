---
id: align-chat-pending-send-deadline
title: Align pending chat send acknowledgement with the send deadline
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent the renderer watchdog from terminating or degrading an otherwise valid first send while chat.send is still within its existing 120-second acknowledgement deadline.
touchedAreas:
  - src/stores/chat.ts
  - tests/unit/chat-channel-degrade.test.ts
  - tests/e2e/chat-pending-send.spec.ts
  - harness/specs/tasks/align-chat-pending-send-deadline.md
expectedUserBehavior:
  - A cold first send that takes longer than the 90-second inactivity watchdog but acknowledges before the 120-second chat.send deadline remains in progress and adopts the returned run.
  - Once the current run is acknowledged, the active-run watchdog starts from that owned acknowledgement and still terminates a truly silent run after the existing inactivity budget.
  - A send that never acknowledges by the existing 120-second deadline exits visibly and does not replay or degrade indefinitely.
  - Late acknowledgements after cancellation, session switch or a newer send are aborted as orphaned work and cannot attach stale events to the current chat.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - completion-evidence
requiredTests:
  - tests/unit/chat-channel-degrade.test.ts
  - tests/e2e/chat-pending-send.spec.ts
acceptance:
  - The 90-second watchdog distinguishes pending chat.send acknowledgement from an acknowledged owned run and only protects the pending acknowledgement inside the existing 120-second send deadline.
  - Accepted current-run acknowledgements reset the owned-run inactivity timestamp without letting unrelated heartbeat/no-op events count as progress.
  - Explicit cancellation, superseding generations and session switches still cause late run acknowledgements and events to be aborted or ignored.
  - Media sends follow the same bounded pending-ack policy without introducing transport retries or direct Gateway access from the renderer.
docs:
  required: false
---

Use this task spec for renderer chat watchdog changes that affect the period before `chat.send` or `send-with-media` returns a run id. The existing Main/Gateway transport deadline remains 120 seconds; this task does not increase that limit or authorize replay of a write whose execution is uncertain.
