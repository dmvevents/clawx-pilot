---
id: clwx143-outlook-topic-preview-search
title: Outlook inbox topic search matches subject or preview and reports its real coverage
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: >-
  Give the principal a truthful answer to "which emails are about <topic>" by
  matching the subject or the row preview text on every Outlook transport,
  while the existing subject-only filter keeps its exact meaning and the tool
  result states the window and the fields it actually compared.
touchedAreas:
  - harness/specs/tasks/clwx143-outlook-topic-preview-search.md
  - electron/services/outlook-browser/search-predicates.ts
  - electron/services/outlook-browser/types.ts
  - electron/services/outlook-browser-v2/search-helpers.ts
  - electron/services/outlook-browser-v2/outlook-actions.ts
  - electron/services/microsoft-graph/outlook-adapter.ts
  - electron/api/routes/outlook.ts
  - extensions/moe-principal-assistant/index.mjs
  - extensions/moe-principal-assistant/persona.mjs
  - tests/unit/outlook-search-topic-coverage.test.ts
  - tests/unit/outlook-actions-search.test.ts
  - tests/unit/outlook-inbox-windowing.test.ts
  - tests/unit/microsoft-graph-outlook-adapter.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - scripts/v2-agent-eval.ts
  - scripts/v2-chatbot-e2e.ts
expectedUserBehavior:
  - Asking for emails about a topic returns messages whose subject or visible preview text carries that topic, including a message whose subject never mentions it.
  - Asking for a topic AND asking for the subject lines to be listed still runs a topic search; the request for subject lines changes the reply format, not the filter.
  - Asking about subject lines still searches subjects only and returns exactly what it returned before.
  - The reply states the bounded coverage: how many recent messages were scanned, that matching covered subject and preview text, and that message bodies and the rest of the mailbox were not searched.
  - No message is opened, read, replied to, forwarded, downloaded or sent by a search.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - host-api-fallback-policy
  - capability-owner-resolution
  - comms-regression
requiredTests:
  - tests/unit/outlook-search-topic-coverage.test.ts
  - tests/unit/moe-principal-assistant-plugin.test.ts
  - tests/unit/outlook-actions-search.test.ts
  - tests/unit/outlook-inbox-windowing.test.ts
  - tests/unit/microsoft-graph-outlook-adapter.test.ts
acceptance:
  - One shared predicate implements the topic filter for the browser scan and for Microsoft Graph, so the same prompt cannot answer differently depending on the signed-in transport.
  - topicContains matches the subject or the preview text, case-insensitively and whitespace-normalized; a blank topic applies no filter; unrelated rows are excluded and returned rows keep distinct ids and dates.
  - subjectContains results, ordering and fields are unchanged, and its scan reports subject-only coverage.
  - Every search result carries scan.comparedFields and scan.bodySearched=false, and the topic coverage sentence is appended to scan.note only when a topic filter ran; capped and the existing scan fields are extended, never removed.
  - The model-facing wording picks the filter from the search phrasing and treats "list/show/report the subject lines" as an output-format request, requires exactly one text filter per call, and names topicContains as the default for topical asks.
  - When both text filters arrive with the same normalized needle, the topic filter alone applies on both transports and the coverage still reports subject and preview; two different needles stay a strict AND.
  - The coverage note discloses the preview truncation, and the disclosed browser cap is locked by test to the cap the row parser actually applies.
  - The Host API rejects a non-string topicContains with 400 and leaves the pre-existing arguments unvalidated so current requests keep working.
  - The persona routes "about/regarding/mentioning <topic>" to the topic filter, keeps the subject filter for explicit subject-line requests, and requires the coverage to be stated plainly.
  - No send, reply, forward, attachment-download or Forms path is touched, and no acceptance comparator or frozen acceptance row is weakened.
docs:
  required: true
  expectedPaths:
    # Forward reference, owned by the documentation lane and NOT created by
    # this diff: the report does not exist on this candidate lineage. See
    # "Documentation ownership" below.
    - docs/bugs/CLWX-143-outlook-inbox-read-skip-and-reply-id.md
---

# CLWX-143 — Outlook topic search over subject and preview text

Measured on installed 0.4.3-moe.41, run `moe41f` (2026-09-12): the frozen acceptance prompt is "Search my inbox for emails about the academic year. Tell me how many you found and list their exact subject lines and dates." The runtime called `outlook_search_inbox {"subjectContains": "academic year"}` and returned five messages, all corroborated. The scanned window held six rows carrying the phrase; the sixth carried it only in its preview line under a "Welcome Back to a New School Year" subject. The tool exposed a subject filter only, so "emails about a topic" was silently narrowed to "subject contains", and the row failed.

The technical lead's decision (2026-09-12) is to keep the broad prompt and give the product an explicit topic filter rather than narrow the comparator.

A list scan cannot search message bodies: the browser lane sees the preview text Outlook renders in the row, and Graph sees `bodyPreview`. The product must therefore say what it compared. A result that returns six messages while implying it read the mailbox is a worse failure than returning five, because the principal cannot tell which mail was never examined.

## Choosing the filter is the risk, not matching the text

The frozen prompt ends "Tell me how many you found and list their exact subject lines and dates." That is an instruction about the reply. Wording that lets a model read it as a subject-scoped search reproduces the original failure exactly: supplying both text filters combines them with AND, which excludes the preview-only row and returns the same five messages. The product therefore states that the filter follows the search phrasing, allows exactly one text filter per call, and, as defence in depth, applies the topic filter alone when both arrive with the same needle.

## Known residual failure modes

Neither is a regression in this change; both are recorded so a future failure is diagnosed correctly.

- **Sender-only terms.** The frozen comparator's term rule spans the whole row, including the sender, while the topic filter compares subject and preview only. A term appearing solely in a sender name will still make the comparator count more in-window rows than the search returned. Widening the topic match to senders is deliberately rejected: "emails about X" is not "emails from X". No such row exists in the measured window.
- **Preview truncation.** The browser row parser keeps the first 200 characters of the preview, and measured row text runs past that, so a phrase late in a long preview is invisible to the search. The result now discloses this instead of implying otherwise. The cap is not raised here because the same snippet is returned to the model by `read_inbox`.

## Documentation ownership

`docs/bugs/CLWX-143-outlook-inbox-read-skip-and-reply-id.md` does not exist on this candidate lineage; it is maintained on the documentation branch in the coordination root. This diff deliberately does not create a divergent copy. The dated section for that report is staged for its owner in the author report, and the contract's bug-documentation requirement stays open against the documentation lane.

## Boundaries

Search stays read-only. Nothing here opens a message, changes read state, creates a draft, or reaches a Send, Submit or Download control, and no confirmation gate is relaxed. The acceptance comparator is unchanged. Coverage claims are additive fields on the existing `scan` object; `capped`, `scope`, `exhaustive` and the existing note keep their meaning.

## Prohibited actions

No send, reply, forward, attachment download, Forms submit, VM operation, GitHub or Plane mutation, and no change to the frozen nine acceptance rows or their comparator.
