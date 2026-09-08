# Bug handoffs

Each report gives another agent enough evidence to continue without the original chat. Use [TEMPLATE.md](TEMPLATE.md) for newly discovered product, test or tooling defects. The live Plane board owns work status; [the completion plan](../COMPLETION_PLAN.md) owns release priorities. Dates and verification scopes below are checkpoints, not release verdicts.

| Card | Reproducible report | Scope |
|---|---|---|
| CLWX-130 | [Windows Chrome start and recovery](CLWX-130-windows-chrome-start.md) | Owner-observed timeout; source routing gap; Windows-session ownership observations |
| CLWX-131 | [Graph readiness diagnosis](CLWX-131-graph-readiness-diagnosis.md) | Owner-observed fictional configuration lookup; source fix approved and integrated; installed rerun open |
| CLWX-39 | [Graph sign-in recovery](CLWX-39-graph-sign-in-recovery.md) | Cancellation/reauthentication gaps and a callback-state defect found in the unmerged repair |
| CLWX-63 | [Forms capability claims](CLWX-63-forms-capability-claims.md) | Unmerged study confuses runtime tools, record-store writes and supported Forms submission |
| CLWX-102 | [macOS test Keychain dialogs](CLWX-102-macos-test-keychain.md) | REOPENED after fixture-only retest; repeated app launches contained; desktop UI testing held |
| CLWX-115 | [Fidelity validator false passes](CLWX-115-fidelity-validator.md) | Original defects repaired; adjacent borrowed-negation failure still under correction |
| CLWX-128 | [Claude supervisor result classification](CLWX-128-supervisor-results.md) | Independent-review defects and their correction evidence |
| CLWX-129 | [History review redaction gap](CLWX-129-history-redaction.md) | Sanitizer miss in a private generated pack; bounded corrective work |
| CLWX-87 | [Whisper.cpp cancellation window](CLWX-87-whisper-cancellation.md) | Backlog adapter reports cancellation accepted before cancellation can take effect |

Earlier defects remain in [the defect register](../DEFECT_REGISTER_2026-09-02.md), [the blocker collection](../BLOCKER_BUG_COLLECTION_2026-09-03.md) and their linked evidence. Extend their existing records when sufficient; avoid copying the entire historical ledger here. New findings need the current template's handoff detail and an index link.
