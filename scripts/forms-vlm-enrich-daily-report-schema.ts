/**
 * VLM-enriched schema rebuild for the Daily Report form.
 *
 * Adapted from forms-vlm-enrich-schema.ts (suspensions form).
 * Sends each page of /tmp/daily-report-form.pdf to Bedrock Sonnet 4.5
 * and asks it to produce daily-report-schema.vlm.json with proper
 * field types and option lists.
 *
 * Output:
 *   extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PDF = '/tmp/daily-report-form.pdf';
const OUT = 'extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json';
const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

async function pdfPagesToImages(pdf: string): Promise<string[]> {
  try {
    execSync('which pdftoppm', { stdio: 'ignore' });
  } catch {
    console.error('pdftoppm not found. Run: brew install poppler');
    process.exit(1);
  }
  const tmpPrefix = '/tmp/daily-page';
  // Don't re-render if pages are already on disk (we rendered them in shell)
  let list: string[] = [];
  try {
    list = execSync(`ls ${tmpPrefix}-*.png | sort`).toString().trim().split('\n').filter(Boolean);
  } catch {
    // no pre-rendered pages on disk — render below
  }
  if (list.length === 0) {
    execSync(`pdftoppm -png -r 110 "${pdf}" "${tmpPrefix}"`, { stdio: 'inherit' });
    list = execSync(`ls ${tmpPrefix}-*.png | sort`).toString().trim().split('\n').filter(Boolean);
  }
  console.log(`Rendered ${list.length} pages`);
  return list;
}

async function askVlm(client: BedrockRuntimeClient, images: string[]): Promise<string> {
  const SYSTEM = `You are extracting the schema of a Microsoft Forms questionnaire from PDF screenshots.

The form is "Primary School Daily Report: Term 3 2025/26" used by Trinidad & Tobago school principals to file their daily-attendance and incident report (3:45pm deadline).

Output a JSON document with this EXACT shape:

{
  "title": "...",
  "description": "...",
  "fields": [
    {
      "id": "snake_case_id",
      "label": "the question text exactly as shown",
      "type": "text" | "number" | "date" | "single_choice" | "multi_choice",
      "required": true | false,
      "options": ["Option 1", "Option 2"]   // only for single_choice / multi_choice
    }
  ]
}

Rules:
- Field "type" must be one of: text, number, date, single_choice, multi_choice
- Use single_choice when the form shows radio buttons (one circle per option)
- Use multi_choice when the form shows checkboxes (square boxes, "Select all that apply")
- Use date when the form shows a calendar/date picker
- Use number when the question is restricted to numbers
- Use text otherwise
- Mark "required": true if the question label has a red asterisk (*)
- Include the FULL option list for choices. The school list has hundreds of options — include them all.
- Use snake_case for "id" (e.g. "education_district", "school_name", "principal_name")
- Output ONLY the JSON document. No prose, no markdown fences.`;

  const content: Array<{ type: string; source?: any; text?: string }> = [
    { type: 'text', text: 'Extract the form schema from these screenshots.' },
  ];
  for (const img of images) {
    const b64 = readFileSync(img).toString('base64');
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    });
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 32000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  };

  console.log(`Sending ${images.length} pages to Sonnet 4.5...`);
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
  const t0 = Date.now();
  const resp = await client.send(cmd);
  const decoded = new TextDecoder().decode(resp.body!);
  const parsed = JSON.parse(decoded) as { content?: Array<{ type?: string; text?: string }> };
  const text = parsed.content?.find((c) => c.type === 'text')?.text ?? '';
  console.log(`VLM done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${text.length} chars`);
  return text;
}

function cleanLabel(label: string): string {
  if (typeof label !== 'string') return label;
  // strip leading "1. ", "12. ", etc.
  let out = label.replace(/^\s*\d+\.\s*/, '');
  // strip trailing " *" (the required indicator)
  out = out.replace(/\s*\*\s*$/, '');
  return out.trim();
}

async function main() {
  const images = await pdfPagesToImages(PDF);
  const client = new BedrockRuntimeClient({ region: REGION });
  let allFields: any[] = [];
  let title = '';
  let description = '';

  const BATCH = 18;
  for (let i = 0; i < images.length; i += BATCH) {
    const slice = images.slice(i, i + BATCH);
    console.log(`\n--- batch ${i / BATCH + 1}: pages ${i + 1}-${i + slice.length} ---`);
    const text = await askVlm(client, slice);
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      writeFileSync(`/tmp/vlm-batch-${i}.txt`, text);
      console.error(`Batch ${i} did not return valid JSON. Saved to /tmp/vlm-batch-${i}.txt`);
      throw err;
    }
    if (parsed.title && !title) title = parsed.title;
    if (parsed.description && !description) description = parsed.description;
    if (Array.isArray(parsed.fields)) allFields = allFields.concat(parsed.fields);
  }

  // Post-process: clean labels (strip leading "1. " and trailing " *")
  for (const f of allFields) {
    if (f.label) f.label = cleanLabel(f.label);
  }

  // Dedupe by label
  const seen = new Set<string>();
  const unique = allFields.filter((f) => {
    const k = (f.label || '').toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const out = {
    $schema: 'https://json-schema.org/draft-07/schema#',
    id: 'moe.primary-school-daily-report.term-3.2025-26.vlm',
    title: title || 'Primary School Daily Report: Term 3 2025/26',
    description: description || 'VLM-enriched schema from PDF',
    capturedBy: 'Sonnet 4.5 via Bedrock',
    capturedAt: new Date().toISOString(),
    fieldCount: unique.length,
    fields: unique,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT}`);
  const types = unique.reduce<Record<string, number>>((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});
  console.log(`  ${unique.length} unique fields`);
  console.log(`  type breakdown:`, types);
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
