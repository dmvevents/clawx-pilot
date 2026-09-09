# CLWX-110 — pilot distribution checklist and revised-schedule note (DRAFT, HELD)

**Status: DRAFT — HELD. Nothing here has been sent.** Outward delivery requires the owner's explicit go for this specific message, after the release verdict. The September 7 authorization covers stakeholder notification *once released*; it does not authorize sending a schedule note while acceptance is incomplete. GA is **RED**.

Scope: the pilot slice of CLWX-110 only. Fleet rollout (450 laptops) stays open and uncompleted; nothing in this document plans or authorizes it.

Prepared 2026-09-09 by the GA lead. Internal facts sit in §2–§4; §1 is the only text intended to leave the project, and it deliberately contains no card numbers, hashes, build identifiers, hostnames or internal tooling names.

## 1. Held note to Raj (Ministry ICT) — outward text, not yet sent

> Subject: ClawX pilot — status and what we still need from the Ministry
>
> Hello Raj,
>
> A short honest update, and a request.
>
> Where we are: the desktop assistant installs and upgrades correctly on our test machine, and the core online chat, mailbox reading and form-preview journeys have each worked in testing. We then found a defect that stopped the application starting up after an upgrade. We have identified the cause, fixed it, had the fix independently reviewed, and produced a new build that passes all of our package checks. What remains is to verify that new build actually starts and runs on a clean machine before anyone else installs it.
>
> Why I am not giving you a date yet: the last two dates we could have given would both have been wrong, because each new build has exposed one further startup problem. I would rather give you one date I can keep. As soon as the new build passes installed verification on a clean standard-user machine, I will write to you the same day with a firm date and the installer.
>
> What we need from the Ministry to finish, none of which we can do ourselves:
>
> 1. **A Windows 10 or 11 test laptop of the same specification the principals will use.** All of our current evidence comes from a Windows Server test machine. That is not proof for a principal's laptop, and I do not want to discover the difference during a rollout.
> 2. **The redirect URIs for the application registration**, so that sign-in works from the desktop application rather than only through the browser session we use today.
> 3. **Confirmation of which mailbox and forms permissions have actually been granted**, and for which accounts. We currently drive Outlook and Forms through each user's own signed-in browser session, which works, but the direct integration needs the consent recorded on the Ministry side.
>
> On the pilot itself, we are planning for the seven districts, with each principal using their own Ministry account on their own laptop, automatic updates switched off so nothing changes under a principal mid-term, and a named support contact for the pilot period. I have a full setup and onboarding checklist ready and will share it with the installer.
>
> Thank you for your patience on the dates. I would rather be late than have a principal open this for the first time and have it fail.
>
> — [sender name to be filled by the owner before sending]

Drafting notes for the owner: no date, no version number and no internal identifiers appear above by design. If you prefer to give an indicative window, add it yourself — the agent will not invent one. The three asks are the same three that have been outstanding since the August 18 infrastructure handoff; they are restated because they still gate completion, not as new requests.

## 2. Distribution checklist — pilot

Every row is a precondition for handing an installer to a principal, and each names who can clear it.

| # | Item | Requirement | Owner | State today |
|---|---|---|---|---|
| 1 | Verified candidate | One identified build whose installer, application archive and executable hashes are recorded, and which has passed installed startup and an ordinary chat on a clean standard-user machine | GA lead | **BLOCKED** — build and package checks pass; installed startup not yet verified |
| 2 | Auto-update OFF | Automatic updates must remain disabled in pilot mode so a principal's machine cannot change itself mid-term | GA lead | Enforced in pilot mode; re-confirm on the accepted artifact |
| 3 | Per-laptop signed-in Chrome | Each principal signs into the application-controlled Chrome profile with **their own** Ministry account; no shared or QA account on a principal's machine | Principal, assisted | Procedure documented in the user guide; unaided rerun NOT_RUN |
| 4 | Windows client parity | Installed on the same Windows 10/11 build the principals use, as a standard user | Ministry (hardware) | **EXTERNAL BLOCKER** — no such machine available to us |
| 5 | Onboarding per principal | §3 checklist completed and signed off per laptop | Pilot coordinator | Not started |
| 6 | Support and escalation | One named support contact, a stated response window for the pilot, and a recorded route for a principal to report a failure | Owner | Not appointed |
| 7 | Fix-shipping cadence | Agreed cadence for pilot fixes, and the rule that a new build restarts installed verification rather than shipping on the previous build's evidence | GA lead + owner | Rule holds internally; cadence not agreed with the Ministry |
| 8 | Seven districts | Named principal, district and laptop per pilot participant before distribution | Pilot coordinator | Not collected |
| 9 | Data handling statement | What the application stores locally, what leaves the machine, and what a principal should not put into it | Owner | Not written |
| 10 | Rollback | A recorded way to return a laptop to its prior state, and the backup taken before installation | GA lead | Backup procedure proven on the test machine; per-laptop rollback not documented |

## 3. Onboarding checklist — per principal, per laptop

1. Record the laptop, the district and the principal's Ministry account before touching the machine.
2. Confirm Windows edition and that the principal's account is a **standard user**, not an administrator.
3. Back up any existing application data and browser profile, and record that the backup was verified.
4. Install from the accepted installer only, and check the installer hash against the release record before running it.
5. Confirm automatic updates are off.
6. Have the **principal** sign into the application-controlled Chrome profile with their own account. Never sign in on their behalf, and never use a test account on a principal's laptop.
7. Confirm the correct mailbox appears and that the principal recognises it as theirs.
8. Open the authorised forms destination once, and confirm nothing is submitted during setup.
9. Walk one real task end to end with the principal watching: a document into a reviewed form, or a school-policy question.
10. Show the review-and-confirm step explicitly: the application never sends or submits without their confirmation.
11. Show what to do when sign-in has expired and when the wrong account is signed in.
12. Give the support contact and the failure-reporting route in writing.
13. Record the outcome per laptop as PASS, FAIL or BLOCKED, with what failed. A blocked laptop is not a pilot participant until it passes.

## 4. Why no date is proposed

Three consecutive candidates each exposed exactly one further fatal startup boundary, each visible only on a real installed Windows machine. Two of the three were invisible to a fully green source and package suite. Prudent planning therefore assumes at least one more unknown boundary after the current fix, and no calendar commitment is defensible until the current candidate has actually started and held a conversation on a clean machine. The internal planning window recorded in the sprint is a planning window, not a promised date, and must not be quoted to the Ministry as one.

Resume action for this card: hold this draft until the release verdict. When installed acceptance passes, fill the sender name, add whatever date the owner is willing to commit, and send **only** on the owner's explicit go for this message. Remaining criteria: rows 1, 3, 4, 5, 6, 8, 9 and 10 of §2 are unmet, and the fleet scope stays out of scope.
