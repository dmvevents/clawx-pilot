/**
 * VLM-enriched schema rebuild.
 *
 * Sends each page of /tmp/suspensions-form.pdf to Bedrock Sonnet 4.5 (the same
 * VLM we use to ground Outlook UI) and asks it to produce a corrected
 * suspensions-schema.json with proper field types and option lists.
 *
 * The hand-captured schema has each field but I marked some as text where they
 * should be choice/date. The VLM looking at the actual PDF can fix that.
 *
 * Output:
 *   extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json
 *
 * Once it looks right, we promote it over the original schema and re-run
 * forms-bulk-add (with Choice + Date support added) to rebuild the form.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PDF = '/tmp/suspensions-form.pdf';
const OUT = 'extensions/moe-principal-assistant/forms/suspensions-schema.vlm.json';
const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

async function pdfPagesToImages(pdf: string): Promise<string[]> {
  // Use pdftoppm if available (poppler-utils via brew). Fallback to sips for one-pager?
  try {
    execSync('which pdftoppm', { stdio: 'ignore' });
  } catch {
    console.error('pdftoppm not found. Run: brew install poppler');
    process.exit(1);
  }
  const tmpPrefix = '/tmp/suspensions-page';
  // Clean previous
  try { execSync(`rm -f ${tmpPrefix}-*.png`); } catch {
    // nothing to clean
  }
  // -r 100 gives ~850x1100 PNGs which is fine for VLM
  execSync(`pdftoppm -png -r 110 "${pdf}" "${tmpPrefix}"`, { stdio: 'inherit' });
  // Collect generated paths
  const list = execSync(`ls ${tmpPrefix}-*.png | sort`).toString().trim().split('\n').filter(Boolean);
  console.log(`Rendered ${list.length} pages`);
  return list;
}

async function askVlm(client: BedrockRuntimeClient, images: string[]): Promise<string> {
  const SYSTEM = `You are extracting the schema of a Microsoft Forms questionnaire from PDF screenshots.

The form is "Primary School Student Suspensions: Term 3 2025/26" used by Trinidad & Tobago school principals.

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
- Use snake_case for "id" (e.g. "education_district", "perpetrator_dob")
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

async function main() {
  const images = await pdfPagesToImages(PDF);
  // Bedrock supports up to 20 images per turn. Send in batches if needed.
  // For this 28-page PDF, splitting into 2 batches and merging.
  const client = new BedrockRuntimeClient({ region: REGION });
  let allFields: any[] = [];
  let title = '';
  let description = '';

  const BATCH = 18; // leave headroom
  for (let i = 0; i < images.length; i += BATCH) {
    const slice = images.slice(i, i + BATCH);
    console.log(`\n--- batch ${i / BATCH + 1}: pages ${i + 1}-${i + slice.length} ---`);
    const text = await askVlm(client, slice);
    // Strip any accidental markdown fences
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

  // Dedupe by label (the VLM may emit the same field if it spans batches)
  const seen = new Set<string>();
  const unique = allFields.filter((f) => {
    const k = (f.label || '').toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const out = {
    $schema: 'https://json-schema.org/draft-07/schema#',
    id: 'moe.primary-school-student-suspensions.term-3.2025-26.vlm',
    title: title || 'Primary School Student Suspensions: Term 3 2025/26',
    description: description || 'VLM-enriched schema from PDF',
    capturedBy: 'Sonnet 4.5 via Bedrock',
    capturedAt: new Date().toISOString(),
    fieldCount: unique.length,
    fields: unique,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log(`  ${unique.length} unique fields, types:`, [...new Set(unique.map((f) => f.type))].join(', '));
}

main().catch((err) => {
  console.error('CRASH:', err);
  process.exit(1);
});
