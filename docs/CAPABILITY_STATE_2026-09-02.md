# Capability state — deep dive, 2026-09-02

*Task-by-task analysis of the 8 principal-assistant capabilities through four
lenses: what works TODAY (with live evidence), the machinery behind it, the
gaps, and the ask that closes each gap. Forms get the deep section (owner
request). Pairs with `docs/MINISTRY_GRAPH_ACCESS_PLAN.md` and the asks doc.*

## Scorecard (chronological by capability number)

| # | Capability | Today | Live evidence (2026-09-02 unless noted) |
|---|---|---|---|
| 1 | Email read/draft/send | **● LIVE** | 15/15 eval + 4-step send-gate proof + 3-turn LLM smoke, all on the NEW outlook.cloud.microsoft domain, after closing a gate false-negative (`a8322ad9`) |
| 2 | Daily MoE forms | **● LIVE (clone lane)** | `forms-fill-suspensions.ts`: opened cloned form, **29/32 fields filled, 0 errors**, submit gate refused without confirm — TODAY |
| 3 | Letters & reports | ◐ Built | `document.write_docx`/`write_xlsx` registered (P2/P5-class); templates dir still empty; no in-app write turn captured yet |
| 4 | Leave & attendance | ◐ Built (read) | rides capability 8's read stack |
| 5 | Routine-query response | ● LIVE | KR1 turn + fresh-install turns (moe.13/14) |
| 6 | Minutes & memos | ● LIVE (transcription) | Win ASR helper bundled + fixed (Atlas §14, CLWX-20 Ready); drafting = capability 3 machinery |
| 7 | Inventory & follow-up | ◐ Built | taskflow + agentTurn cron; no live cron-fire evidence captured this sprint |
| 8 | Document processing | **● LIVE (read)** | KR1 full PASS: tool-select + KFM resolve + parse + faithful summary on shipped build |

## Forms — the deep dive

### The machinery (all committed, all exercised today)

```
extensions/moe-principal-assistant/forms/
  suspensions-schema.vlm.json    32 fields, VLM-captured   ← the demo form
  daily-report-schema.vlm.json   57 fields, VLM-captured
  suspensions-schema.json        8-field structural spec
  *-test-fac-url.txt             LIVE cloned forms on the sandbox tenant
electron/services/forms-browser-v2/
  forms-driver.ts                field classification + fill + SubmitResult gates
  suspensions-actions.ts / daily-report-actions.ts
  manager.ts                     previewSuspension / previewDailyReport / submit*
electron/api/routes/forms.ts     host-API; confirm-gated submits; outbox audit (KR5)
```

### Three-tier strategy (docs/MSFORMS_AUTOMATION.md) and where each tier stands

| Tier | Path | Status |
|---|---|---|
| A | Browser automation of the RESPONSE page (not the editor — editor DOM rotates weekly) | **WORKING TODAY** on the cloned forms; 29/32 fill + gate proof. Note: daily-report clone already redirects to `forms.cloud.microsoft` — same migration wave as Outlook; response page survived it |
| B | Graph Forms API | Dead end — no public write API (landscape report) |
| C | **Power Automate webhook → SharePoint/Excel (RECOMMENDED for production)** | Blocked on Ministry: IT must create the flows and hand us the flow URLs — this is one of THE ASKS |

### Gaps and their exact closers

1. **3 skipped fields in today's fill** (29/32): conditional/branching fields
   the driver skips by design when the branch is inactive. Verify by
   inspection next lane session; likely correct behavior, not a defect.
2. **Production destination**: the clone lane proves the interaction; real
   MoE forms need either Tier C (flow URLs from Raj — preferred, no DOM risk)
   or Tier A against the real forms (works but inherits rotation risk).
3. **Sign-in dependency (ATLAS-15)**: resolved operationally by the dedicated
   Chrome profile (signed in once, persists). Production installs get this
   from the same profile pattern — or entirely bypassed by Tier C.
4. **Field-mapping drift**: schemas are VLM-captured snapshots
   (`capturedAt` stamped). If the Ministry edits a form, re-run the capture
   scripts (`forms-capture-*.ts`, `forms-vlm-enrich-*.ts`). Ask: freeze the
   production form versions or notify on change.

### Form-filling flow (what the demo actually exercises)

Document lands (capability 8 reads it) → agent extracts the 32 fields into
`SuspensionsPayload` (`principal.suspension_payload` tool, schema-validated)
→ `previewSuspension` fills the response page field-by-field with the
principal watching → hard-confirm gate: `submit` refuses until
`confirm:true` from an explicit principal yes → KR5 outbox records the audit
event durably. Every link in that chain has live evidence as of today except
the LLM extraction leg on the shipped Windows build (the Mac dev path has it;
queue one extraction turn on the pilot lane for completeness — small ask,
agent-executable).

## Writing documents (capabilities 3/6 detail)

`document.write_docx` / `write_xlsx` are registered with the same native
(no-Python) backends as the proven read path. What's missing is not machinery
but EVIDENCE + TEMPLATES: (a) one in-app P2-style turn ("rewrite X, save as
Y.docx, don't overwrite") on the pilot lane — the P2/P5 fixtures are already
on the VM Desktop; (b) authoring the letter/memo templates
(`extensions/moe-principal-assistant/templates/` is empty — post-demo item
since May, now the biggest gap in the writing story).

## The one structural risk across everything browser-driven

Microsoft's office.com → cloud.microsoft migration (Outlook hit us
2026-09-02; Forms daily-report clone already redirects) is a rolling,
tenant-by-tenant DOM/domain rotation. Every browser-lane defect this sprint
was this class. The durable answers, in order: Tier C for forms (no browser),
Graph for email (no browser), and the 3-fallback selector rule + the
`outlook-lane-debug` skill for whatever must stay on the browser.
