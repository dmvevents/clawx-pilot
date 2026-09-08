# Reviewed moe.26 source and hosted build — September 8, 2026

**Source acceptance PASS; Windows artifact acceptance NOT_RUN; GA RED.** Root fast-forwarded `release/moe26-plan-execution` to clean `1d7455673774fd70c086b41b405c8ece868ce302`, version `0.4.3-moe.26`, verified the same remote SHA on `dmvevents/clawx-pilot`, and dispatched [hosted run 34244582967](https://github.com/dmvevents/clawx-pilot/actions/runs/34244582967) at 15:24:49 UTC. The build failed native preflight: 2,297 tests passed, two failed, 57 skipped. No installer was produced. Profile is `keyless-public`; required credential-seed inputs are false and publication inputs are absent. No installer hash, installation, release tag or GA publication is claimed.

## Reviewed integration

The assembly preserves the approved browser `41359e1`, artifact harness `8bf5d32` and installed verifier `8935bc0a` commit ancestry. Independent integration review APPROVE verified all browser/verifier files remain byte-identical to their approved tips; the harness differs only by the three bounded integration deltas below. No additional product/runtime change was hidden in the merges.

- `c4a85343`: correct the evidence row name to the actual fast packaging check, `plugin-registration.full`.
- `44dad46d`: reconcile the harness with the reviewed `browser.open_chrome` registration, raising the exact inventory from 34 to 35.
- `1d745567`: correct the separately stale upgrade-verifier inventory, including existing `outlook.readiness`; preserve missing/extra/duplicate rejection and bind the positive check to actual reviewed plugin registration/manifest.

The final independent Claude Fable 5 / Bedrock reviewer passed 104 focused tests across the harness and two verifier suites. Its report is `/private/tmp/clawx-ga-integration-review-20260908/artifacts/REVIEW.md`; provider/model provenance matched. The author receipt is `/private/tmp/clawx-ga-integration-20260908/artifacts/INTEGRATION_RECEIPT.md`. Both are private operational evidence.

## Final source verification

| Check at `1d745567` | Result and scope |
|---|---|
| Full source unit run | 2,327 PASS, 0 FAIL, 29 SKIP; recorded exit 0. Reviewer verified the retained summary. Skips remain unproved platform/environment rows. |
| Typecheck / lint | PASS; lint retains 43 existing warnings. |
| Root PowerShell lint | PASS over 54 files: 0 gating findings; 148 warnings and 14 informational findings retained. |
| Root agent doctor | PASS repository surfaces; existing user-config legacy-profile warnings retained. |
| Root direct document harness | All five deterministic DOCX/PDF/XLSX/image prompts PASS; no Electron, model or installer exercised. |
| Browser/harness communication checks | Prior reviewed byte-identical browser checks and assembled comms replay/compare PASS. Browser-only task-spec validation does not claim unrelated assembled-file coverage. |

The first source run's two manifest failures, baseline reproduction, initially wrong OpenClaw dependency symlink, masked pipeline exit, supervision timeout and intermittent on-device setup-hook timeout remain recorded in [CLWX-106](../bugs/CLWX-106-installed-verifier-identity.md). Final tests used the locked OpenClaw 2026.9.2 install without changing shared dependency content. Earlier harness/verifier author MODEL_MISMATCH receipts are retained; root accepts the reviewed source based on reproducible tests and independent Fable/Bedrock approval, not the requested model label alone.

## Native failure and next evidence

Native failure details and the dedicated VM repair lane are in [CLWX-106](../bugs/CLWX-106-installed-verifier-identity.md). The seed test timed out at 5s; the verifier cleanup threw EPERM after exercising the actual runtime. Mac source passes remain valid in that scope but do not override these Windows failures. The hosted Windows job must pass native preflight, runtime preparation, staged bundle checks and packaging before artifact identity is verified. Extract and compare installer/ASAR/EXE/helpers/source/profile hashes, then run installed acceptance. The [successful assisted moe.25 browser inbox and Forms previews](WINDOWS_REPEATABLE_LAB_2026-09-08.md) remain a prior-artifact baseline. They do not transfer to moe.26. Windows 10/11 standard-user, Graph OAuth, documents/local/recovery/performance, unaided stakeholder and strict release evidence remain required.
