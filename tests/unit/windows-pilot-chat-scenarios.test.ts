// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type DemoScenario = {
  id: string;
  prompt?: string;
  bannedToolAny?: string[];
};

const scenarioPath = join(process.cwd(), 'windows-pilot', 'scenarios', 'demo-chat-procedures.json');

function loadScenarios(): DemoScenario[] {
  const parsed = JSON.parse(readFileSync(scenarioPath, 'utf8')) as { scenarios?: DemoScenario[] };
  return parsed.scenarios ?? [];
}

describe('Windows pilot chat procedure scenarios', () => {
  it('keeps Downloads document scenarios read-only at the tool layer', () => {
    const documentScenarios = loadScenarios().filter((scenario) => scenario.id.startsWith('downloads-'));

    expect(documentScenarios.map((scenario) => scenario.id)).toEqual([
      'downloads-document-inventory',
      'downloads-excel-summary',
      'downloads-word-suspension-fields',
    ]);

    for (const scenario of documentScenarios) {
      expect([...(scenario.bannedToolAny ?? [])].sort()).toEqual([
        'edit',
        'forms.preview_daily_report',
        'forms.preview_suspension',
        'forms.submit_daily_report',
        'forms.submit_suspension',
        'outlook.download_attachment',
        'outlook.draft_email',
        'outlook.send_email',
        'patch',
        'sessions_spawn',
        'sessions_yield',
        'write',
      ].sort());
      expect(scenario.prompt).toContain('Do not modify files, create helper scripts, or write temporary files.');
    }
  });
});
