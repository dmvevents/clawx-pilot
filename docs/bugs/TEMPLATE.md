# CLWX-<number> — <observable defect>

## Identity and impact

- Reported/last verified: UTC timestamp plus reporter timezone where relevant.
- Owning card, related cards, owner and severity/affected journey.
- Status: observed / reproduced / fix proposed / source verified / installed verified. Name remaining gates.
- Environment: OS/build, VM or client, Windows user/session class, runtime/model route, source SHA, installer/build ID and hashes. Mark unknown fields explicitly; do not infer the installed artifact from the current checkout.
- Known working baseline: exact evidence/revision, or `UNVERIFIED owner recollection`.

## Reproduction and expected result

1. Minimal prerequisites and setup, including which steps change user state.
2. Exact synthetic input/action and relevant configuration.
3. Observed tool/event/result and visible behavior.

State the expected observable result and frequency/sample count. Do not reproduce a send/submit/download without its required authorization.

## Evidence and execution path

| Timestamp / revision | Evidence locator | Observation | What it does not prove |
|---|---|---|---|
| … | Sanitized report or private artifact path/hash | … | … |

Map intent → renderer/tool → Main/Gateway → service/dependency → external state → result/UI. Identify relevant files/functions at the stated revision. Use a small Mermaid diagram when it clarifies the failure boundary. Keep raw logs, credentials, recipients and private content out of this report.

## Cause and confidence

- Confirmed facts and source-supported mechanism.
- Competing hypotheses with the evidence that would distinguish them.
- Disproved hypotheses and why; do not promote temporal correlation to causation.

## Attempts, decisions and fix

| Attempt / commit | Change or experiment | Outcome | Decision / remaining limitation |
|---|---|---|---|
| … | … | PASS / FAIL / BLOCKED / NOT_RUN | … |

Include failed reviews and why an alternative was rejected. Name exact write ownership and conflicting lanes. Preserve compatibility/action gates.

## Verification and acceptance

For each criterion, record command or user action, tested revision/environment, result, evidence locator and remaining gap. Include meaningful positive and negative controls. Separate source/static, package, installed, live-account and stakeholder evidence. State independent reviewer and verdict; author tests cannot approve the change.

## Resume here

- Durable branch/commit and optional current worktree. Recovery command if needed.
- First next action and its stop condition; dependent tasks in order; work that may run independently.
- Required account-holder input, environment or authority, if any; identify its source.
- Current ownership and operational limits. Name any unsynchronized Plane payload.
- Do not repeat: disproved approaches or unchanged expensive checks.
