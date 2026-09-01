# Ministry liaison log

_Generated 2026-09-01 by the `ministry-liaison-monitor` agent (read-only) from
the WhatsApp store, `~/openclaw-agent/inbound-docs/`, and the SHA256-verified
`liaison-archive/2026-09-01/`. No phone numbers, links, or credentials appear
here by policy — see the source archive for raw provenance._

**One person, two hats.** Raj Ramdass is the Ministry ICT liaison for **both**
the ClawX principal-assistant pilot **and** a separate curriculum-video project.
Karunesh Ramdass tests the video project. **Never conflate the two workstreams.**
This log keeps them in separate sections.

Cross-refs: [[project_ministry_infra_handoff]], [[project_ministry_endpoints_unverifiable]],
[[project_token_budget_scale_ceiling]]. Full asks/blockers table: `GA_EXECUTION_PLAN` §1 Lane C.

---

## A. Raj / ClawX — chronological (abridged)

| Date | Dir | Summary |
|---|---|---|
| 2026-04-27 | Raj→us | First captured contact; coordinating an in-person visit. |
| 2026-04-29 | Raj→us | Minister to receive 2000 laptops at a ceremony; wants to test "Sov AI" content generation. |
| 2026-05-01 | Raj→us | Shares MoE forms (Drive folder). |
| 2026-05-25 | Raj→us | Lists the **7 principal-assistant features** (email, daily forms, letters, leave/attendance, routine queries, minutes, inventory). |
| 2026-06-21 | Raj→us | **Testing feedback:** draft ✓, read ✓, summary ✓; **send ✗, reply ✗** — plus 4 defects (see §C). |
| 2026-06-22/23 | both | Principals-association demo; "I'm worried" → we reassured; demo ran 06-23. **No post-demo verdict captured.** |
| 2026-07-10 | Raj→us | Microsoft 365 integration handed to Ansari (needs permissions). |
| 2026-07-17 | us→Raj | GPU infra summary; chatbot blocked on IT-approved MCP server; "must go live before school opens", 20 principals to test a week. |
| 2026-07-20 | Ansari→Raj→us | Proposal reviewed, no issues; **"the only thing I absolutely need is the redirect URIs."** Scopes: User.Read, Mail.Read, Calendars.Read, Contacts.Read (delegated). Write scopes need extra security analysis. |
| **2026-08-18** | Ansari→Raj→us | **MOE Email AI Assistant Handoff doc** (14.6 KB): APIM+Foundry (100M tok/mo), PostgreSQL, Entra app. Redirect URI, APIM hostname, PostgreSQL hostname **all placeholders.** |

**Last inbound from Raj: 2026-07-20.** Gap ≈ 6 weeks as of 2026-09-01.

---

## B. Open asks — who owes whom

**We owe Raj/Ministry (all drafted, none sent — owner-gated):**
1. **Redirect URI** — draft value ready. ~6 weeks overdue. Gates KR7.
2. **Deployment-model + client-type decision** — desktop/public-client/no-DB vs hosted/confidential/DB. Needs a working session.
3. **Working-session windows** — Ansari offered; we haven't proposed times.
4. **APIM smoke-test confirmation** — blocked until the expired credential link is reissued (link **never opened**, expired ~2026-08-26).

**Ministry owes us (external, B4):**
- Redirect-URI registration (after we send the value); real APIM + PostgreSQL hostnames (placeholders, unprobeable); credential-link reissue; MCP-server enablement status; Power Automate flow URLs; **June-23 demo outcome.**

**Closed:** Graph permission set decided (read-only Mail/Calendars/User granted; Contacts declined); Foundry model chosen by Ministry; PostgreSQL provisioned but we intend to decline it for a desktop deployment.

---

## C. Product defects Raj reported (candidate board cards)

| Defect (2026-06-21 unless noted) | Sev | Note |
|---|---|---|
| Send fails: "draft subject has been changed before it can be sent" | HIGH | Likely addressed by the moe.10 hard-confirm gate — **verify, don't assume.** |
| Reply misinterprets email content (meal prefs read as shirt sizes) | MED | Extraction/classification defect. |
| Reply action archives the original email | MED | Unintended side effect. |
| Draft response landed in the "To:" field (one-off) | LOW | File if reproducible. |
| PDF read inconsistencies (2026-06-30, via Karunesh) | MED | No repro detail. |
| Document-search inconsistency (2026-07-17) | MED | Check if already tracked. |

**"0/5 feedback": NOT FOUND** in any captured channel. If it exists it's off this
dataset (Slack/in-person/email). Do not attribute a numeric score without a source.

**Action:** file the four 06-21 defects + two vague items as CLWX bug cards via
`scripts/report-bug.mjs` (verify the send-gate one against moe.10 first).

---

## D. Ministry documents inventory

**ClawX — add to repo:**
- **MOE Email AI Assistant Handoff (2026-08-18)** → recommend `docs/MINISTRY_INFRA_HANDOFF_2026-08-18.md`; have `MINISTRY_REPLY_DRAFT_2026-08-20.md` cite it as the source packet.
- **SSMD Practitioner Series Day-9 agenda (AI in admin functions)** → project attribution unclear; park in `docs/context/` or ask Raj which project it ties to.

**Video project — do NOT add to this repo** (kept in `~/openclaw-agent/`): pyth-theorem, flower, Test 1–5 QA batches, VIDEO_QA_TRACKER.

**Referenced but absent (retrieve/ask):** real MoE forms (Suspensions, Daily Report — in the 05-01 Drive link, not yet pulled); "Sov AI" docs; 2000-laptop plan; MCP-server status; June-23 demo outcome; pre-04-27 history.

---

## E. Karunesh / video project — SEPARATE (visibility only)

Last inbound 2026-08-25 (awaiting our reply, ~6 days). August batch: 20+ videos
(ELA/IT/Maths/Science). Defects: diagram-internal text illegibility (**P0, universal,
length-independent**); fraction renders as raw code (**P0**); narration garbles large
numbers/decimals (P2); empty diagram containers + header overlap in 180s lessons but
**not** in 60s clips → pipeline-load/truncation issue, not a spec fault. Drafted reply
(`VIDEO_QA_TRACKER_2026-08-25.md`) unsent. **This is not a ClawX deliverable** — tracked
here only so the two workstreams don't collide.

---

## F. Structural gap in the record

The WhatsApp store keeps inbound reliably but **our outbound replies are largely
not stored** (~61% inbound captured, our side incomplete). We have an *intent*
ledger (`outbound-drafts/`) but not a *sent* ledger. Consequence: we cannot always
prove what we already promised. Mitigation: treat `outbound-drafts/` as intent, and
confirm any "already answered" claim against an actual sent artifact before relying on it.
