// @vitest-environment node
/**
 * CLWX-98: every exact Suspensions form option text must round-trip the
 * canonicalization pipeline unchanged. The alias tables in index.mjs map
 * loose free-text ("got in a fight", "level 2") onto exact option texts, but
 * the patterns are tried in order and `.*` spans words — so an earlier,
 * broader pattern can rewrite an exact option ("Fight without Weapon" ->
 * "Fight with Weapon"). On a statutory form that is silent data corruption.
 *
 * This suite iterates EVERY option text of EVERY choice field in the
 * canonical schema (extensions/moe-principal-assistant/forms/
 * suspensions-schema.json) through the real forms.preview_suspension tool
 * and asserts identity, catching the whole alias-order class rather than
 * any single pair.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pluginConfig = {
  principalName: 'Mrs. Test',
  schoolName: 'Demo Primary',
  educationDistrict: 'Victoria',
  schoolType: 'Government',
};

interface RegisteredTool {
  name: string;
  execute?: (toolCallId: string, params?: Record<string, unknown>) => Promise<unknown>;
}

interface SchemaField {
  id: string;
  type: string;
  options?: string[];
  optionsRef?: string;
}

async function loadPlugin() {
  return import('../../extensions/moe-principal-assistant/index.mjs');
}

function jsonResponse(data: unknown) {
  return {
    status: 200,
    ok: true,
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

const schemaPath = fileURLToPath(
  new URL('../../extensions/moe-principal-assistant/forms/suspensions-schema.json', import.meta.url),
);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  sections: Array<{ fields: SchemaField[] }>;
};
const schemaFields = schema.sections.flatMap((section) => section.fields);
const fieldById = new Map(schemaFields.map((field) => [field.id, field]));

function optionsFor(field: SchemaField): string[] | undefined {
  if (field.options) return field.options;
  // The multi-choice additional_infractions question reuses the primary
  // infraction list; the schema records that as an optionsRef.
  if (field.optionsRef === 'infraction_options_same_as_primary') {
    return fieldById.get('primary_infraction')?.options;
  }
  // school_name (optionsRef: school_list_full) has no canonical in-repo
  // list to iterate; it is also deliberately NOT identity-preserving in
  // demo mode (SUSPENSION_DEMO_SCHOOL_ALIASES maps the real school name to
  // the test.fac clone's "Aranguez GPS"), so it stays out of this suite.
  return undefined;
}

// Conditionally-required incident details refuse even in demo mode
// (CLWX-79), so exercising some options needs a companion field.
function payloadFor(fieldId: string, option: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [fieldId]: fieldId === 'additional_infractions' ? [option] : option,
  };
  if (fieldId === 'additional_infractions') payload.additional_infractions_present = 'Yes';
  if (fieldId === 'additional_infractions_present' && option === 'Yes') {
    payload.additional_infractions = ['Vandalism'];
  }
  if (fieldId === 'victim_type') payload.victim_present = 'Yes';
  if (fieldId === 'victim_present' && option === 'Yes') payload.victim_type = 'Member of staff';
  return payload;
}

describe('suspensions option-text identity round-trip (CLWX-98)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('previews every exact choice-option text unchanged', async () => {
    const previousPort = process.env.CLAWX_HOST_API_PORT;
    const previousToken = process.env.CLAWX_HOST_API_TOKEN;
    const previousDemo = process.env.MOE_DEMO_DEFAULTS;
    process.env.CLAWX_HOST_API_PORT = '13210';
    process.env.CLAWX_HOST_API_TOKEN = 'test-token';
    // Demo defaults let a single-field payload pass the required-field
    // refusal so each option is exercised in isolation; the field under
    // test is always provided, so its value is never a default.
    process.env.MOE_DEMO_DEFAULTS = '1';

    const sentPayloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      sentPayloads.push((body as { payload: Record<string, unknown> }).payload);
      return jsonResponse({ success: true, data: { status: 'previewed', filledCount: 32, skippedCount: 0, errors: [] } });
    }));

    try {
      const { register } = await loadPlugin();
      const tools: RegisteredTool[] = [];
      register({
        pluginConfig,
        registerTool: (tool: RegisteredTool) => tools.push(tool),
        log: { info() {}, warn() {} },
      });
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      const preview = byName['forms.preview_suspension'];
      expect(preview?.execute).toBeDefined();

      const failures: string[] = [];
      let optionCount = 0;
      for (const field of schemaFields) {
        const options = optionsFor(field);
        if (!options) continue;
        for (const option of options) {
          optionCount += 1;
          const before = sentPayloads.length;
          const result = (await preview.execute!(
            `roundtrip-${field.id}-${optionCount}`,
            { payload: payloadFor(field.id, option) },
          )) as { status?: string; reason?: string };
          if (result.status !== 'previewed') {
            failures.push(`${field.id} = ${JSON.stringify(option)} refused (${result.reason ?? result.status})`);
            continue;
          }
          const sent = sentPayloads[before]?.[field.id];
          const expected = field.id === 'additional_infractions' ? [option] : option;
          if (JSON.stringify(sent) !== JSON.stringify(expected)) {
            failures.push(`${field.id}: ${JSON.stringify(option)} -> ${JSON.stringify(sent)}`);
          }
        }
      }

      // Sanity floor: the schema has 20 inline/ref'd choice fields; a broken
      // loader must not silently pass an empty iteration.
      expect(optionCount).toBeGreaterThan(100);
      expect(failures).toEqual([]);
    } finally {
      if (previousPort === undefined) delete process.env.CLAWX_HOST_API_PORT;
      else process.env.CLAWX_HOST_API_PORT = previousPort;
      if (previousToken === undefined) delete process.env.CLAWX_HOST_API_TOKEN;
      else process.env.CLAWX_HOST_API_TOKEN = previousToken;
      if (previousDemo === undefined) delete process.env.MOE_DEMO_DEFAULTS;
      else process.env.MOE_DEMO_DEFAULTS = previousDemo;
    }
  });
});
