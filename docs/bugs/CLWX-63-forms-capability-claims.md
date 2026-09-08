# CLWX-63 — Forms/files study overstates supported integration paths

## Identity and reproduction

Independent factual review on September 8, 2026 of unmerged documentation `a57e6bd7`, branch `lane/forms-files-review-20260908`, worktree `/private/tmp/clawx-forms-files-review-20260908`. Document: `docs/research/FORMS_FILES_CONNECTION_PLAN_2026-09-08.md`. Read its proposed tool routes/write paths and compare them with the Ministry persona, current adapters and cited primary Microsoft documentation. This is a documentation/planning defect; no unsupported submission was executed.

## Expected and actual

| Claim | Verified boundary / required correction |
|---|---|
| Generic upstream PDF tool is an accepted principal-facing route | Runtime capability exists, but Ministry persona mandates existing document.* tools. Keep upstream capability as reference context only. |
| Graph SharePoint list insertion is a Microsoft Forms submission | The API creates a list item. No reviewed evidence establishes that the Ministry form uses that list or recognizes the write as a Forms response. Confirm actual storage and owner-approved record semantics before proposing this as submission. |
| No MCP or programmatic submission surface can exist anywhere | The checked connector/catalog surfaces establish only a bounded search result; do not claim a universal negative over all community implementations. |
| Browser access necessarily clears the tenant's Conditional Access policy | Current tenant behavior is unverified. Third-party reports from other tenants cannot establish this account's policy. |
| Generic PDF registration tests close Ministry document journey gaps | Test persona-mandated document.* behavior and actual artifact/model combinations; upstream registration is diagnostic context only. |

## Evidence and handoff

Private independent review: `artifacts/ga-fable-20260908/forms-files-factual-review/result.json`, REQUEST_CHANGES, with precise replacement text. Source files checked: `extensions/moe-principal-assistant/persona.mjs`, tool registration and document helpers, Forms Graph scaffold/browser modules, and the existing thin MCP adapter. The reviewer rechecked the official Microsoft Forms connector actions, Graph listItem-create and Excel API documentation. The connector's listed detail/read operations do not establish a submit action; Graph's cloud workbook/list surfaces do not imply local-file or Forms-response semantics.

Next: make bounded prose/task-acceptance corrections in the existing study; preserve verified native tools and the existing adapter, then verify the revised claims. Do not add a second MCP server, infer tenant grants, or implement direct-store submission from the current draft. Keep CLWX-71 optional for native app journeys. No installed, account-holder, Forms preview or submission evidence is supplied by this study. Root owns board/current docs; the study remains held until corrected.

Current corrective dispatch: `forms-files-correction` in the existing study worktree, base `a57e6bd7`. Scope is the bounded factual correction only; no new runtime/MCP/submit integration or tenant action. Root owns board and bug-report synchronization.
