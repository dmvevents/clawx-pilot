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
const chatProcedureScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-run-chat-procedures.ps1');
const demoAcceptanceScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-run-demo-acceptance.ps1');

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

  it('keeps probe execution failures hard-failing even for optional scenarios', () => {
    const script = readFileSync(chatProcedureScriptPath, 'utf8');

    expect(script).toMatch(/\$hardFailure\s*=\s*\$true\s*\n\s*Add-Reason \$reasons \("probe command exited/);
    expect(script).toMatch(/\$hardFailure\s*=\s*\$true\s*\n\s*Add-Reason \$reasons "probe JSON missing or invalid"/);
    expect(script).toContain('$status = if ($passed) { "PASS" } elseif ($required -or $hardFailure) { "FAIL" } else { "WARN" }');
    expect(script).toContain('$hardFailures = @($script:Results | Where-Object { $_.hardFailure -eq $true })');
    expect(script).toContain('$status = if ($hardFailures.Count -eq 0 -and $failedRequired.Count -eq 0) { "READY_SAFE_CHAT_PROCEDURES" } else { "NOT_READY" }');
  });

  it('keeps optional scenario safety and infrastructure failures from becoming warnings', () => {
    const script = readFileSync(chatProcedureScriptPath, 'utf8');

    expect(script).toContain('function Test-HardFailureReason');
    expect(script).toContain('$Reason -like "blocking renderer events observed:*"');
    expect(script).toContain('$Reason -eq "safe chat send missing or skipped"');
    expect(script).toContain('$Reason -eq "safe chat did not scope to current prompt"');
    expect(script).toContain('$Reason -eq "banned send/download/submit/background-session tool was observed"');
    expect(script).toContain('$Reason -like "banned tool observed:*"');
    expect(script).toContain('if (Test-HardFailureReason ([string] $reason))');
  });

  it('requires full expected form smoke payload coverage', () => {
    const script = readFileSync(chatProcedureScriptPath, 'utf8');

    expect(script).toContain('$ExpectedDailyReportSmokeFilledCount = 30');
    expect(script).toContain('$ExpectedSuspensionSmokeFilledCount = 31');
    expect(script).toContain('Test-PreviewResult $forms.dailyPreview "daily report" $ExpectedDailyReportSmokeFilledCount $Reasons');
    expect(script).toContain('Test-PreviewResult $forms.preview "suspension" $ExpectedSuspensionSmokeFilledCount $Reasons');
  });

  it('runs the Windows pilot harness guards in demo acceptance regression mode', () => {
    const script = readFileSync(demoAcceptanceScriptPath, 'utf8');

    expect(script).toContain('Invoke-Step "windows-pilot-harness-tests"');
    expect(script).toContain('tests/unit/windows-pilot-electron-cdp-probe.test.ts tests/unit/windows-pilot-chat-scenarios.test.ts');
  });
});
