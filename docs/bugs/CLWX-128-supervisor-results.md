# CLWX-128 — Claude supervisor can misclassify unsuccessful runs

## Scope and evidence

Independent source/tooling review on September 8, 2026. Operational branch `lane/claude-monitor-20260908`, worktree `/private/tmp/clawx-claude-monitor-20260908`; these files belong in the documentation/operations checkout, not the Windows product candidate.

Initial commit `440fe496` implements `scripts/claude-runner.py` with process supervision, private streams and structured status. Independent review at `artifacts/ga-fable-20260908/monitor-review/result.md` reproduced:

| Defect | Impact | Correction checkpoint |
|---|---|---|
| Contrary provider evidence could still produce CLI_SUCCEEDED | A requested Bedrock run could be misreported | `6f580756` checks real final `modelUsage` provider/model fields |
| Missing executable raised a traceback without a status receipt | A future agent could not distinguish spawn failure from no launch | `6f580756` adds structured SPAWN_FAILED and receipt |
| No vetted tool flags, including an empty tool set | A no-tool provider probe could not be expressed through the runner | `6f580756` adds explicit tools/allowed-tools options |

The delta reviewer independently verified all three corrections and reran 16 tests successfully. It found one remaining fail-open:

```python
s = StreamState('/dev/null')
s.observed_model = 'claude-fable-5'
s.result = {'type': 'result', 'subtype': 'error_during_execution', 'is_error': False}
classify(0, s, False, 'claude-fable-5')
# Actual at 6f580756: ('CLI_SUCCEEDED', (False, False))
```

Expected: a terminal error subtype cannot be successful, even with exit zero and `is_error:false`. `error_max_turns` reproduces the same issue. `classify()` only requires a truthy subtype. Full independent finding: `artifacts/ga-fable-20260908/monitor-delta-review/result.md`.

## Resume and acceptance

Root applied the narrow `subtype == success` requirement in `08891d6c`. The new fake-process negative control failed before the change; all 17 tests pass afterward. Final independent delta review APPROVE is retained at `artifacts/ga-fable-20260908/monitor-final-review/result.md`; reviewed changes are integrated in root as `d1605abf`. Reproduction command: `python3 -m unittest discover -s tests/ops -p test_claude_runner.py -v`. Preserve quiet-warning behavior, partial output, explicit model/provider routing, owned-process-tree cancellation and structured spawn failure. Operational acceptance does not establish Windows product acceptance.

The earlier real Bedrock probe returned `MONITOR_LIVE_OK` in seven seconds at the earlier revision. It does not prove the corrected classifier. Real receipts use `modelUsage["claude-fable-5"].provider == "bedrock"`; capture metadata only, not secret-bearing environment or transcript content. No additional paid live call is required merely to repeat unchanged provider connectivity.

CLI completion and task acceptance remain distinct. An explicit spending cap is expected control behavior, not a newly discovered bug. Preserve incomplete edits and the failed receipt, inspect them, then resume only the missing bounded work; never automatically replay a potentially executed write.
