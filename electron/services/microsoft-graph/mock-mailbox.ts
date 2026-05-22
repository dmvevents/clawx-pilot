/**
 * Fixture mailbox for stakeholder demos when no Entra app registration is yet
 * configured. Realistic Trinidad & Tobago Ministry of Education message shapes
 * (parent emails, supplier invoices, MoE circulars, school-board notices)
 * matching the Microsoft Graph `/me/messages` response schema.
 *
 * The shape is intentionally a strict subset of what Graph returns so the same
 * renderer code paths work whether the data is real or mock.
 */

export interface MockGraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: Array<{ emailAddress: { name: string; address: string } }>;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  body?: { contentType: 'HTML' | 'Text'; content: string };
  webLink: string;
  /** Always true in fixtures so the renderer can badge them. */
  __mock: true;
}

const NOW = () => new Date();
const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const DAYS_AGO = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export const MOCK_MAILBOX: MockGraphMessage[] = [
  {
    id: 'mock-001',
    subject: 'Circular 04/2026 — Term 3 attendance reporting reminder',
    from: {
      emailAddress: {
        name: 'School Supervision III',
        address: 'school.supervision@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: HOURS_AGO(2),
    isRead: false,
    bodyPreview:
      'All Primary School Principals are reminded that the daily attendance return must be submitted by 3:45 pm using the official Microsoft Forms link. Late returns will be flagged in the district report.',
    body: {
      contentType: 'HTML',
      content:
        '<p>Dear Principal,</p><p>All Primary School Principals are reminded that the daily attendance return must be submitted by <strong>3:45 pm</strong> using the official Microsoft Forms link. Late returns will be flagged in the district report.</p><p>Yours faithfully,<br/>Office of the School Supervisor III</p>',
    },
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-001',
    __mock: true,
  },
  {
    id: 'mock-002',
    subject: 'Re: Bus delay this morning — Standard 4 pupil',
    from: {
      emailAddress: {
        name: 'Mrs. Boodoo (Parent)',
        address: 'sboodoo@example.com',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: HOURS_AGO(5),
    isRead: false,
    bodyPreview:
      "Good morning Madam Principal, I wish to inform you that my son's school bus arrived 50 minutes late today. He missed first period mathematics. Could you kindly advise on the make-up arrangement?",
    body: {
      contentType: 'Text',
      content:
        "Good morning Madam Principal,\n\nI wish to inform you that my son's school bus arrived 50 minutes late today. He missed first period mathematics. Could you kindly advise on the make-up arrangement?\n\nKind regards,\nMrs. S. Boodoo",
    },
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-002',
    __mock: true,
  },
  {
    id: 'mock-003',
    subject: 'NSDSL meal distribution — supplier invoice INV-2487',
    from: {
      emailAddress: {
        name: 'NSDSL Vendor Office',
        address: 'invoices@nsdsl.example',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: HOURS_AGO(20),
    isRead: true,
    bodyPreview:
      'Please find attached invoice INV-2487 for meals delivered Mon 05 May to Fri 09 May. Net 30 days. Confirm receipt and counts via the standard form.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-003',
    __mock: true,
  },
  {
    id: 'mock-004',
    subject: 'Suspension form — reminder to submit same day',
    from: {
      emailAddress: {
        name: 'Student Support Services Division',
        address: 'sssd@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(1),
    isRead: true,
    bodyPreview:
      'Where a suspension is issued, the relevant Microsoft Forms record should be completed on the same day where possible. Late submissions reduce the district reporting accuracy.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-004',
    __mock: true,
  },
  {
    id: 'mock-005',
    subject: 'PTA meeting — agenda items requested',
    from: {
      emailAddress: {
        name: 'PTA Chair (Mr. Maharaj)',
        address: 'pta.chair@school.example',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(2),
    isRead: false,
    bodyPreview:
      'Dear Madam Principal, the PTA executive meets next Wednesday at 4:00 pm. Please share any items you would like added to the agenda.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-005',
    __mock: true,
  },
  {
    id: 'mock-006',
    subject: 'Curriculum Division — Standard 5 SEA mock paper distribution',
    from: {
      emailAddress: {
        name: 'Curriculum Planning & Development',
        address: 'cpdd@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(2),
    isRead: true,
    bodyPreview:
      'Mock SEA papers for Standard 5 will be delivered to your school on Friday. Kindly arrange a secure storage area and ensure papers are not opened before 8:30 am Monday.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-006',
    __mock: true,
  },
  {
    id: 'mock-007',
    subject: 'Maintenance request follow-up — leaking roof, classroom 3B',
    from: {
      emailAddress: {
        name: 'School Buildings Unit',
        address: 'buildings@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(3),
    isRead: true,
    bodyPreview:
      'A contractor has been assigned to inspect the reported roof leak in classroom 3B on Thursday between 10:00 am and 12:00 pm. Please ensure the room is unoccupied during that window.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-007',
    __mock: true,
  },
  {
    id: 'mock-008',
    subject: 'Caribbean Examinations Council — registration deadline this Friday',
    from: {
      emailAddress: {
        name: 'CXC Local Office',
        address: 'tt-office@cxc.example',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(4),
    isRead: false,
    bodyPreview:
      'Reminder: Standard 5 SEA registration data must be submitted via the school portal by Friday 5:00 pm. Late changes incur a fee.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-008',
    __mock: true,
  },
  {
    id: 'mock-009',
    subject: 'Re: Teacher cover for Mrs. Persad (medical leave)',
    from: {
      emailAddress: {
        name: 'School Supervisor — Caroni',
        address: 'caroni.supervisor@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(5),
    isRead: true,
    bodyPreview:
      'A short-term cover teacher has been identified. Confirmation paperwork will arrive via the District Office. Please ensure attendance and timetable adjustments are reflected in the Daily Report.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-009',
    __mock: true,
  },
  {
    id: 'mock-010',
    subject: 'Health & Safety drill — quarterly fire evacuation',
    from: {
      emailAddress: {
        name: 'School Safety Programme',
        address: 'safety@moe.gov.tt',
      },
    },
    toRecipients: [
      { emailAddress: { name: 'Principal', address: 'principal@school.example' } },
    ],
    receivedDateTime: DAYS_AGO(7),
    isRead: true,
    bodyPreview:
      'Your school is due for the quarterly fire evacuation drill. Please schedule between Mon 19 May and Fri 23 May. Submit the after-action report within five working days.',
    webLink: 'https://outlook.office.com/mail/mock/AAMkAG-010',
    __mock: true,
  },
];

void NOW; // exported helper kept available; explicit reference to avoid unused-warning
