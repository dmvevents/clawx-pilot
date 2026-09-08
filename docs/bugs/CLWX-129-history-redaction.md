# CLWX-129 — A generated history-review pack missed a credential shape

## Scope and current evidence

September 8, 2026; the bounded Bedrock history/skills author reported that a real project credential shape survived sanitization in an improved private review pack. This is a **sanitizer defect in unmerged local tooling**, not a claim that all historical logs or a public repository were exposed.

The first author stopped at its $9 spending cap while beginning the correction. Branch `lane/bedrock-history-skills-20260908`, worktree `/private/tmp/clawx-history-skills-20260908`. A separate bounded `history-finish` session owns the incomplete checkpoint. Source owners: `scripts/bedrock-history-review.py`, `tests/ops/test_bedrock_history_review.py`, mirrored `bedrock-history-review` skills and the dated report.

Private receipts: `artifacts/ga-fable-20260908/history-skills/`, `history-finish/` and the generated pack directory named by the author. Do not read or paste a known-contaminated pack into another model, board or report. This document deliberately excludes the value and exact credential-bearing excerpt.

## Expected behavior and verification

A candidate pack must pass local sanitization checks before model review; suspect records should be dropped rather than copied with uncertain masking. The exact missed shape, affected pack versions and whether it reached the earlier bounded critic are **not independently established at this checkpoint**. The author has been instructed to establish these facts without repeating the value. Do not infer either containment or broader exposure from a redaction count alone.

The handoff must include:

1. A synthetic equivalent of the missed shape and a failing regression against the prior sanitizer.
2. A minimal correction and unit-test result; local checks proving the known shape is absent from regenerated outputs.
3. Obsolete-pack disposition and exact private receipt paths, with no raw content in git.
4. Corrected extraction/coverage numbers. A critic of an older pack cannot be described as reviewing the regenerated pack.
5. Independent review/skill validation before integrating the script, skills or report.

No further critic/API call is authorized within the current corrective lane; the initial bounded Nova critique already exists. This avoids re-exporting suspect material and paying for repeated synthesis. Do not rotate unrelated credentials, mutate external accounts or reopen the full log-mining exercise as part of the code fix. Escalate a verified exposure fact with its exact scope and required action, without reproducing the secret.

The primary/critic findings remain advisory. Separately correct the report's overly strong claim that absent `.codex` mirrors make skills inaccessible: the current Codex catalog also loads `.agents/skills`. Record supported mirror drift without promoting that inference to ground truth.

## Coordinator verification update

The prose-credential regression/redactor exists in checkpoint `2b4a3e81`. Root reran 44 synthetic tests and three skill validations successfully and regenerated the 63-file inventory locally, with zero occurrences of the known missed class. Private receipt: `artifacts/ga-fable-20260908/history-review-corrected/redaction-correction-receipt.json`. No further model request was made. The available old pack also already has zero known-class matches; the originally reported affected version was not preserved separately. Historical exposure is therefore UNKNOWN; do not claim either an external leak or complete containment from these artifacts. The dated review now distinguishes its original coverage/critic from the corrected generation. Independent review remains required before integration.

Independent source review APPROVE: `artifacts/ga-fable-20260908/history-source-review/result.json`. It reran 44 synthetic tests, all three skill validations/mirror checks and a synthetic extract→pack→mocked-critic forward test with no real log reads or paid critic calls. Approved source is integrated into root operations as `4993cb2e`, separate from the product candidate. Advisory limits retained: regex masking is not a universal privacy guarantee; mirror parity tests cover SKILL.md but not referenced files; ambient static AWS credentials are not removed by this helper and may override named-profile intent. Do not infer account routing from profile configuration alone. Historical exposure remains UNKNOWN.
