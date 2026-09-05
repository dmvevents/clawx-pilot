/**
 * CLWX-64 — re-stamp the schema-drift fingerprints on the driver-consumed
 * forms schemas after a verified recapture or edit.
 *
 *   pnpm exec tsx scripts/forms-stamp-fingerprint.ts          # stamp both
 *   pnpm exec tsx scripts/forms-stamp-fingerprint.ts <path>   # stamp one
 *
 * The fill drivers refuse to fill when a schema's content does not match its
 * stored fingerprint, and tests/unit/forms-schema-fingerprint.test.ts guards
 * the committed files — run this ONLY after verifying the schema against the
 * live form (the whole point is that a schema change is a conscious act).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeLabelsFingerprint } from '../electron/services/forms-browser-v2/schema-fingerprint';

interface SchemaField {
  label: string;
}

const DEFAULT_TARGETS = [
  'extensions/moe-principal-assistant/forms/suspensions-schema.json',
  'extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json',
];

function flattenLabels(schema: {
  fields?: SchemaField[];
  sections?: Array<{ fields: SchemaField[] }>;
}): string[] {
  if (Array.isArray(schema.sections)) {
    return schema.sections.flatMap((s) => s.fields).map((f) => f.label);
  }
  if (Array.isArray(schema.fields)) {
    return schema.fields.map((f) => f.label);
  }
  throw new Error('schema has neither sections[] nor fields[] — not a driver-consumed form schema');
}

const targets = process.argv[2] ? [process.argv[2]] : DEFAULT_TARGETS;
for (const target of targets) {
  const abs = path.resolve(target);
  const schema = JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
  const labels = flattenLabels(schema as Parameters<typeof flattenLabels>[0]);
  schema.fingerprint = computeLabelsFingerprint(labels);
  writeFileSync(abs, JSON.stringify(schema, null, 2) + '\n');
  const fp = schema.fingerprint as { questionCount: number; orderedLabelsHash: string };
  console.log(`${target}: stamped ${fp.questionCount} questions, hash ${fp.orderedLabelsHash.slice(0, 12)}`);
}
console.log('Done. Run: pnpm exec vitest run tests/unit/forms-schema-fingerprint.test.ts');
