# Suspensions form — paste-into-Forms spec

The Forms admin DOM is too volatile for automation. For the demo we hand-build the cloned form once on `test.fac@fac.edu.tt` (5 min) and then drive the **response page** programmatically (much more stable surface).

## Setup steps (one-time, by hand)

1. In Chrome (the one on CDP port 18792), go to https://forms.office.com/ on the test.fac account.
2. Click "+ New Form".
3. Title: **Primary School Student Suspensions: Term 3 2025/26 (test clone)**
4. Description: **Test clone of the MoE Suspensions form for ClawX agent demo. Source: PDF dated Apr 29 2026.**
5. Add the questions below in order. Use the type given. Mark required (*) where indicated. Copy-paste option lists.
6. When done, click **Collect responses** → copy the URL → paste into `extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`.

## Questions (33 total — auto-generated from the JSON schema)

### Header

**1. Text — required ✓**
This form will record your name, please fill your name.

### General Information

**2. Choice — required ✓ — single answer**
Education District
- Caroni
- North Eastern
- Port of Spain & Environs
- South Eastern
- St. George East
- St. Patrick
- Victoria

**3. Choice — required ✓ — single answer**
School Type
- Denominational
- Government

**4. Choice — required ✓ — single answer**
Name of primary school
- (470+ options — for the test clone, just include the 8 most common: Aranguez GPS, Arima Boys' Government School, San Juan Boys Government, San Fernando ASJA Primary, Curepe Presbyterian Primary School, Tunapuna Hindu School, Sangre Grande Government Primary, Other)

### Perpetrator details

**5. Text — required ✓**
Name of perpetrator

**6. Choice — required ✓ — single answer**
Sex
- Male
- Female

**7. Date — required ✓**
Date of birth

**8. Choice — required ✓ — single answer**
Age of perpetrator
- 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15

**9. Text — required ✓**
Student birth certificate PIN

**10. Choice — required ✓ — single answer**
Class
- First Year
- Second Year
- Standard 1
- Standard 2
- Standard 3
- Standard 4
- Standard 5

### Incident

**11. Date — required ✓**
Date of infraction

**12. Date — required ✓**
Date of issue of suspension

**13. Text — required ✓** (number, restrict 1-10)
For the current Term (Term 2 2025/26) this student has been suspended ___ time(s)

**14. Choice — required ✓ — single answer**
The infraction occurred
- Before school
- During assembly
- During class time (member of staff present)
- During class time (unsupervised)
- During the change in class periods
- Break time
- Lunch time
- After school
- External to school

**15. Choice — required ✓ — single answer**
Type of infraction committed (main issue which prompted the suspension)
- Arson
- Assault with Weapon
- Assault without Weapon
- Bullying/Intimidation
- Class Truancy
- Cyber Bullying
- Disorderly/Disruptive Conduct
- Disrespect/Defiance of Authority
- Extortion and Taxing
- Fight with Weapon
- Fight without Weapon
- Forgery
- Gambling
- Possession of an Incendiary/Explosive Device
- Lewd/Inappropriate Behaviour
- Misuse of Technology
- Possession of Weapons
- Possession/Use of Alcohol
- Possession/Use of Drugs
- Possession/Use of Drugs (Pharmaceutical)
- Possession/Use of Tobacco/Vaping Products
- Propagation of Misinformation/Mischief
- Robbery/Theft
- Sexual Harassment
- Sexual Misconduct
- Threat with Weapon
- Threat without Weapon
- Use of Obscene Language
- Vandalism
- Other

**16. Choice — required ✓ — single answer**
Were there any additional infractions listed above committed during the incident?
- Yes
- No

**17. Choice — required ✓ — multiple answers**
Additional infractions committed during the incident
*(same option list as Q15)*

**18. Choice — required ✓ — single answer**
Was there a victim involved?
- Yes
- No

**19. Choice — required ✓ — single answer**
The victim was a/an
- Member of staff
- Student of the same school
- Student of another school
- Individual external to school

**20. Choice — required ✓ — single answer**
Were written reports collected from the perpetrator(s), victim(s), and other persons of interest?
- Yes
- No

**21. Choice — required ✓ — single answer**
Length of suspension (days)
- 1, 2, 3, 4, 5, 6, 7

**22. Choice — required ✓ — single answer**
Was an application made for an extended suspension?
- Yes
- No

**23. Choice — required ✓ — single answer**
Was the student referred to SSSD?
- Yes
- No

**24. Choice — required ✓ — single answer**
Was the student's parent/guardian/representative present when the suspension was issued?
- Yes
- No

**25. Choice — required ✓ — single answer**
Did the parent/guardian/representative sign the Notice of Suspension form?
- Yes
- No

### Adherence to the National School Discipline Matrix

**26. Choice — required ✓ — single answer**
Was the level of the offence, the identified consequence(s), and process to be followed (as outlined in the National School Discipline Matrix) taken into consideration when issuing the suspension?
- Yes
- No

**27. Choice — required ✓ — single answer**
Level of offence
- Minor
- Major
- Severe

### Parent Information

**28. Text — required ✓**
Name of the parent/guardian/representative present

**29. Text — required ✓** (number, restrict > 999999)
Parent/guardian/representative's phone number (1)

**30. Text — optional**
Parent/guardian/representative's phone number (2)

### Parent Address

**31. Text — required ✓**
House/apartment/light pole/mile marker number

**32. Text — required ✓**
Name of street

**33. Text — required ✓**
Name of city/town/village

---

## After the form exists

1. Click **Collect responses** → copy the form URL.
2. `echo "<URL>" > extensions/moe-principal-assistant/forms/suspensions-test-fac-url.txt`
3. Run `pnpm exec tsx scripts/forms-fill-suspensions.ts` to verify the fill-driver works end-to-end.
