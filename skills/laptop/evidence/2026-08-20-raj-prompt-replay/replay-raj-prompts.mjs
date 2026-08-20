#!/usr/bin/env node
/**
 * replay-raj-prompts.mjs — replays the 5 prompts from Raj's 2026-07-21 test
 * suite (`incoming-tests/ClawX Agent Tests/Prompt Tests.docx`, scored 0/5)
 * against the shipping native document.* handlers.
 *
 * Run from the repo root:
 *   node skills/laptop/evidence/2026-08-20-raj-prompt-replay/replay-raj-prompts.mjs
 *
 * Fixtures are copied to ~/moe-agent-test/ because doc-tools.mjs sandboxes
 * reads to the user's home (and, on macOS, /tmp fails the guard — see REPORT.md).
 *
 * CAVEAT: this calls the handlers DIRECTLY. It cannot catch a tool-SELECTION
 * failure, which is the failure mode Raj actually hit (the model consulted
 * ~/.openclaw/skills/pdf/SKILL.md and reached for pdfplumber). A green run here
 * does not substitute for an in-app LLM-driven test.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const dt = await import(
  path.join(REPO, 'extensions/moe-principal-assistant/doc-tools.mjs')
);

const SANDBOX = path.join(os.homedir(), 'moe-agent-test');
const IN = path.join(SANDBOX, 'Input_Files');
const OUT = path.join(SANDBOX, 'Output_Files');

await fs.rm(SANDBOX, { recursive: true, force: true });
await fs.mkdir(IN, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
for (const f of await fs.readdir(path.join(HERE, 'fixtures'))) {
  await fs.copyFile(path.join(HERE, 'fixtures', f), path.join(IN, f));
}

const results = [];
const check = async (name, fn) => {
  try {
    results.push([name, 'PASS', await fn()]);
  } catch (err) {
    results.push([name, 'FAIL', err.message]);
  }
};
const str = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

// P1 — "Open the Staff Meeting Memo Draft document and summarize its main points"
await check('P1 read_docx (summarize memo)', async () => {
  const out = str(await dt.readDocx({ path: path.join(IN, 'Staff Meeting Memo Draft.docx') }));
  if (!/ICT equipment audit/i.test(out)) throw new Error('agenda content missing');
  if (!/30 July 2026/.test(out)) throw new Error('deadline missing');
  return `${out.length} chars; agenda + action items + 30 Jul deadline present`;
});

// P2 — "Save the edited copy as Staff_Memo_Final.docx ... Do not overwrite the original"
await check('P2 write_docx (Staff_Memo_Final.docx)', async () => {
  await dt.writeDocx({
    path: path.join(OUT, 'Staff_Memo_Final.docx'),
    title: 'Internal Memorandum',
    paragraphs: [
      'To: All Teaching Staff',
      'From: The Principal',
      'Subject: Term 3 Staff Meeting',
      'ICT device counts are due 30 July 2026.',
    ],
  });
  const back = str(await dt.readDocx({ path: path.join(OUT, 'Staff_Memo_Final.docx') }));
  if (!/Internal Memorandum/.test(back)) throw new Error('roundtrip lost title');
  return 'written to Output_Files + re-read verified';
});

await check('P2b original NOT overwritten', async () => {
  const out = str(await dt.readDocx({ path: path.join(IN, 'Staff Meeting Memo Draft.docx') }));
  if (!/Staff Meeting Memo Draft/.test(out)) throw new Error('original mutated');
  return 'original intact';
});

// P3 — "Summarize the ICT Equipment Audit circular"
await check('P3 read_pdf (ICT circular)', async () => {
  const out = str(
    await dt.readPdf({ path: path.join(IN, '01_Ministry_Circular_ICT_Equipment_Audit.pdf') }),
  );
  for (const key of ['30 July 2026', '29 August 2026', 'ICT-1']) {
    if (!out.includes(key)) throw new Error(`missing ${key}`);
  }
  return 'deadlines 30 Jul / 4-15 Aug / 29 Aug + Form ICT-1 all extracted';
});

// P4 — "Calculate each student's average and assign a grade using the scale in the workbook"
await check('P4 read_xlsx (gradebook)', async () => {
  const out = str(await dt.readXlsx({ path: path.join(IN, 'Student Marks Gradebook.xlsx') }));
  if (!out.includes('Student A')) throw new Error('rows missing');
  if (!/Grade Scale|Instructions/.test(out)) throw new Error('grade-scale sheet missing');
  return `marks + grade-scale sheet both read (${out.length} chars)`;
});

await check('P4b write_xlsx (Marks_Updated.xlsx)', async () => {
  await dt.writeXlsx({
    path: path.join(OUT, 'Marks_Updated.xlsx'),
    sheets: [
      {
        name: 'Grades',
        rows: [
          ['Student', 'Average', 'Grade'],
          ['Student A', 86, 'B'],
          ['Student B', 65.5, 'D'],
          ['Student C', 93.25, 'A'],
          ['Student D', 54, 'F'],
          ['Student E', 78, 'C'],
          ['Student F', 43.75, 'F'],
        ],
      },
    ],
  });
  const back = str(await dt.readXlsx({ path: path.join(OUT, 'Marks_Updated.xlsx') }));
  if (!/93\.25/.test(back)) throw new Error('roundtrip lost values');
  return '6 averages + grades written; roundtrip OK';
});

// P5 — "Open the Student Support Referral Form image and list each visible field and value"
await check('P5 read_image (referral form)', async () => {
  const out = JSON.stringify(
    await dt.readImage({ path: path.join(IN, 'Student_Support_Referral_Form.png') }),
  );
  if (!/base64|data:image|mimeType/i.test(out)) throw new Error('no image payload returned');
  return `image payload ${out.length} chars -> VLM reads it, no OCR binary needed`;
});

console.log('\n=========== RAJ 5-PROMPT REPLAY -- shipping document.* tools ===========');
let passed = 0;
for (const [name, status, detail] of results) {
  if (status === 'PASS') passed += 1;
  console.log(`${status}  ${name}\n      ${detail}`);
}
console.log(`\nSCORE: ${passed}/${results.length}   (Raj 2026-07-21 baseline: 0/5)`);
process.exit(passed === results.length ? 0 : 1);
