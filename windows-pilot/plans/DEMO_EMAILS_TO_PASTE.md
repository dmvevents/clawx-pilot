# Demo emails — paste into test.fac@fac.edu.tt inbox

These are the 3 emails the demo runbook + smoke harness expect in the inbox. Send them from any other test address (a personal Gmail, etc.) **into** `test.fac@fac.edu.tt` 5+ minutes before the demo.

The suspension-report email is encoded narratively to cover all 32 fields the suspension schema needs. The agent extracts these via Pro-mode (gemini-2.5-pro).

---

## Email 1 — Parent meeting request

**To:** test.fac@fac.edu.tt
**Subject:** `Parent meeting Tuesday — request to attend`

**Body:**

```
Good morning,

I would like to request your attendance at a meeting scheduled for this
Tuesday at 3:30 pm at Aranguez Government Primary School. The meeting
will discuss your child's recent academic progress and behaviour
adjustments for the upcoming term.

Please confirm your attendance and bring your child's most recent
report card for reference.

Kind regards,
Ms. Patricia Johnson
Parent Liaison
Aranguez Government Primary School
```

Demo-time use: Path 1 Turn 2 — the principal will say "Draft a reply to the parent meeting email saying I'll be there at 4 pm and to bring a copy of the report card." Agent uses `outlook.search_inbox` → `outlook.read_email` → `outlook.reply`.

---

## Email 2 — Suspension report (32-field narrative)

**To:** test.fac@fac.edu.tt
**Subject:** `Re: Suspension report — Standard 4 student`

**Body:**

```
This suspension report concerns Jayden Paul, a 10-year-old male
student (DOB 15-Mar-2016, PIN 200316045237) in Standard 4 at Aranguez
Government Primary School, located in the Caroni education district.

The incident occurred on 24-May-2026, during break time, when the
student engaged in a fight without weapon with another student of the
same school, constituting a major-level infraction.

At the time of the incident, a staff member was not present; written
reports were collected from both the perpetrator and the victim. The
infraction was classified as a major offence under the National School
Discipline Matrix, and the suspension was issued on 25-May-2026 with a
duration of three days.

This is the student's second suspension during the current term
(Term 2 2025/26). The student's parent, Mr. Rohan Paul, was present
when the suspension was issued and signed the Notice of Suspension
form. Contact details for the parent are 868-625-4789 (primary), and
his residence is located at 47 Palm Avenue, Aranguez.

An extended suspension application was not filed, and the student was
not referred to SSSD at this time. The discipline matrix process was
followed in full during this suspension. No additional infractions
were recorded during the incident.

—
Principal Desk
Aranguez Government Primary School
```

Demo-time use: Path 2 Turn A — "Read the suspension report email from this morning and fill out the Term 3 Suspensions form. Don't submit yet — let me review." Agent extracts these 32 fields and calls `forms.preview_suspension`.

**Field coverage (verify before sending):**
- Student name: Jayden Paul
- Age: 10
- Sex: male
- DOB: 15-Mar-2016
- PIN: 200316045237
- Standard: 4
- School: Aranguez Government Primary
- District: Caroni
- Incident date: 24-May-2026
- Time of day: break time
- Infraction type: fight without weapon
- Infraction severity: major
- Same-school other party: yes
- Staff present: no
- Written report from perpetrator: yes
- Written report from victim: yes
- Suspension issued date: 25-May-2026
- Duration: 3 days
- Suspension count this term: second
- Term: 2 2025/26
- Parent name: Rohan Paul
- Parent present at issuance: yes
- Notice of Suspension signed: yes
- Parent phone: 868-625-4789
- Parent address: 47 Palm Avenue, Aranguez
- Extended suspension applied: no
- SSSD referral: no
- Discipline matrix followed: yes
- Additional infractions: no
- (Plus the 3 boilerplate metadata fields in the form schema)

---

## Email 3 — MoE Circular (filler)

**To:** test.fac@fac.edu.tt
**Subject:** `MoE Circular: Term 3 deadlines`

**Body:**

```
Circular No. 12/2026
Ministry of Education, Trinidad & Tobago

To: All Principals

Re: Term 3 2025/26 Administrative Deadlines

Attached are the critical deadlines for the beginning of Term 3.
Please ensure all reports and enrolment confirmations reach the
Ministry by 5 June 2026. The updated discipline matrix guidelines
are also included for your reference.

Regards,
Mrs. Eleanor Noel
Curriculum Coordinator
Ministry of Education
```

Demo-time use: Path 0 / Path 1 Turn 1 — "Show me my 5 most recent emails". Agent calls `outlook.read_inbox(5)` and the principal sees 3+ realistic-looking emails.

---

## Send checklist

- [ ] Send Email 1 from your test sender to `test.fac@fac.edu.tt`
- [ ] Send Email 2 (suspension narrative — verify all 32 fields are encoded)
- [ ] Send Email 3 (MoE Circular)
- [ ] Open the test.fac inbox in the CDP-attached Chrome
- [ ] Confirm 3 emails visible at the top of the inbox
- [ ] Inbox is on the **Inbox** folder (not Focused/Other split)
