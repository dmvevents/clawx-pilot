---
name: ministry-liaison-monitor
description: Read and monitor the project detail coming from Raj Ramdass (Ministry ICT — the ClawX principal-assistant pilot) and Karunesh Ramdass (the curriculum-video QA workstream). Use when new files land in the inbound-docs drop, before a Ministry working session, or when asked "what has Raj/Karunesh asked for and what's still open". Produces a sourced, per-person, per-project status. Read-only: never sends mail, never opens credential links, never mutates state.
---

# Ministry liaison monitor

Turn the raw inbound drop into a current, sourced picture of what the two
Ramdass contacts have asked of us, tagged to the correct project, with the next
action obvious. This is the skill; the read-only worker is the
`ministry-liaison-monitor` agent (`.claude/agents/ministry-liaison-monitor.md`).

## The one rule that matters most

**Two projects, never merged.**

- **Raj Ramdass** (+ Ansari Khan) → **ClawX principal-assistant pilot** (this repo):
  APIM, Entra, redirect URI, PostgreSQL, `UserId`, Graph scopes, Outlook/Forms,
  Windows install, offline/scale. **This is the focus.**
- **Karunesh Ramdass** → **curriculum-video generator** (separate): the
  `Test N - <topic>` QA batches, slidegen render defects.

Default focus is ClawX. Video-QA items are tracked only to keep them out of the
ClawX picture.

## Workflow

1. **List new inbound.** `ls -t ~/openclaw-agent/inbound-docs/` — anything with a
   recent mtime is new. Classify each by project using the filename convention
   (`MOE …`, `SSMD … Agenda` → Raj/ClawX; `Test N - <topic> …` → Karunesh/video).
2. **Extract asks + decisions + deadlines** from each new Raj/ClawX doc. Cite the
   file + line. For Karunesh docs, summarise into the video section only.
3. **Reconcile against our replies.** Cross-check every Raj ask against
   `~/openclaw-agent/outbound-drafts/2026-08-19-ministry-infra-handoff-reply-DRAFT.md`
   and `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` — is it answered (in a draft),
   unanswered, or owner-gated?
4. **Flag time-boxed items.** Compare expiries against `date`. The moevault
   credential link (5 accesses, expired ~2026-08-26) is the standing example.
5. **Report** two columns — *what we owe* vs *what we're waiting on* — per person,
   per project. Surface any drift vs the CLWX Plane board as a finding.

## Hard rules

- **Draft only, no outbound.** Never send to Raj / Karunesh / Ansari / the
  Ministry. Sending is the owner's gate. Surface the draft + its path instead.
- **Never open the moevault / secure-send link.** Report its state from the docs;
  opening it is owner-gated and semi-irreversible (a spent access can't be recovered).
- **No secrets** in output — no keys, passwords, or full credential URLs.
- **Read-only** — no edits, no git writes, no form submission, no state mutation.
- Cite every claim; separate FACTS / INFERENCE / OPEN QUESTIONS.

## Related

- `.claude/agents/ministry-liaison-monitor.md` — the read-only worker.
- `docs/MINISTRY_REPLY_DRAFT_2026-08-20.md` / the outbound infra-reply draft — our
  answers to Raj's Section 6 asks (UNSENT).
- CLWX Plane board (`81a2ea23-e060-49b4-a344-1ab0339f46d5`) — source of truth for
  the ClawX work.
