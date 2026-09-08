// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageJsonPath = join(process.cwd(), 'package.json');
const manualWindowsWorkflowPath = join(process.cwd(), '.github', 'workflows', 'package-win-manual.yml');
const installArtifactProbePath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-check-install-artifacts.ps1');
const seedDemoDocumentsScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-seed-demo-documents.ps1');
const officeRuntimeCheckScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-office-runtime-check.ps1');
const demoOfficeAnalysisScriptPath = join(process.cwd(), 'scripts', 'demo-office-analysis-e2e.mjs');
const afterPackScriptPath = join(process.cwd(), 'scripts', 'after-pack.cjs');
const managedCdpVisualSmokeScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-managed-cdp-visual-smoke.ps1');
const electronCdpProbeRunnerPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-run-electron-cdp-probe.ps1');
const silentInstallScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-run-silent-install.ps1');
const suspensionFormsSkillPath = join(process.cwd(), 'windows-pilot', 'skills', 'forms-suspension-fill.md');
const suspensionFormsVerifierPath = join(process.cwd(), 'windows-pilot', 'agents', 'forms-fill-verify.md');
const principalDemoScriptPath = join(process.cwd(), 'windows-pilot', 'plans', 'PRINCIPAL_DEMO_SCRIPT.md');
const suspensionsSchemaPath = join(process.cwd(), 'extensions', 'moe-principal-assistant', 'forms', 'suspensions-schema.json');

describe('Windows package inspection contracts', () => {
  it('package:win prepares native Windows ASR and runtime binaries before packaging', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts: Record<string, string> };

    expect(pkg.scripts['package:win']).toContain('pnpm run prep:win-binaries');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run uv:download:win');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run node:download:win');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run win-asr:build:x64');
  });

  it('records build source, finalizes compiled output receipt, and keeps release packaging staged', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts: Record<string, string> };

    expect(pkg.scripts.package).toMatch(/^node scripts\/release-build-source\.mjs record &&/);
    expect(pkg.scripts.package).toContain('zx scripts/bundle-preinstalled-skills.mjs && node scripts/release-build-source.mjs receipt');
    expect(pkg.scripts.build).toMatch(/^node scripts\/release-build-source\.mjs record &&/);
    expect(pkg.scripts.build).toContain('zx scripts/bundle-preinstalled-skills.mjs && node scripts/release-build-source.mjs receipt && pnpm run electron:download && node scripts/run-electron-builder.mjs');
    expect(pkg.scripts.release).toContain('pnpm run electron:download && node scripts/run-electron-builder.mjs --publish never');
    expect(pkg.scripts.release).not.toContain('--publish always');
  });

  it('manual Windows packaging validates cloud, Graph, and Azure seed files without printing keys', () => {
    const workflow = readFileSync(manualWindowsWorkflowPath, 'utf8');

    expect(workflow).toContain('Prepare cloud gateway seed');
    expect(workflow).toContain('Prepare Microsoft Graph seed');
    expect(workflow).toContain('Prepare Azure Speech seed');
    expect(workflow).toContain("apiKeyFile -ne 'azure-speech.key'");
    expect(workflow).toContain("throw \"CLAWX_AZURE_SPEECH_CONFIG_JSON must not contain secret field: $blocked. Use CLAWX_AZURE_SPEECH_KEY instead.\"");
    expect(workflow).toContain('key redacted');
    expect(workflow).not.toContain('Write-Host $env:AZURE_SPEECH_KEY');
  });

  it('fresh-install artifact probe records packaged ASR binaries and seed files by metadata only', () => {
    const script = readFileSync(installArtifactProbePath, 'utf8');

    expect(script).toContain('resources\\bin\\ffmpeg.exe');
    expect(script).toContain('resources\\bin\\WinSpeechRecognize.exe');
    expect(script).toContain('resources\\resources\\cloud-gateway.json');
    expect(script).toContain('resources\\resources\\cloud-gateway.key');
    expect(script).toContain('resources\\resources\\azure-speech.example.json');
    expect(script).toContain('resources\\resources\\azure-speech.json');
    expect(script).toContain('resources\\resources\\azure-speech.key');
    expect(script).toContain('-not $isSecretMetadataOnly');
    expect(script).toContain('SecretMetadataOnly');
    expect(script).toContain('Get-FileHash');
    expect(script).not.toContain('Get-Content');
  });

  it('demo document seeding creates CSV plus OpenXML Office packages without Office COM automation', () => {
    const script = readFileSync(seedDemoDocumentsScriptPath, 'utf8');

    expect(script).toContain('moe-demo-attendance-results.csv');
    expect(script).toContain('Write-DemoWorkbook');
    expect(script).toContain('Write-DemoWordDocument');
    expect(script).toContain('Assert-OpenXmlPackage');
    expect(script).toContain('System.IO.Compression.ZipFile');
    expect(script).not.toContain('New-Object -ComObject');
  });

  it('seeds the attendance workbook from the same CSV row matrix with data rows', () => {
    const script = readFileSync(seedDemoDocumentsScriptPath, 'utf8');
    const attendanceRowsMatch = script.match(/\$attendanceRows = @\(([\s\S]*?)\n\)/);

    expect(attendanceRowsMatch?.[1]).toBeTruthy();
    expect(attendanceRowsMatch?.[1].match(/@\("Demo Primary School"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(script).toContain('$attendanceCsvLines = @($attendanceRows | ForEach-Object { ($_ -join ",") })');
    expect(script).toContain('$xlsxCreated = Write-DemoWorkbook $attendanceXlsx $attendanceRows');
  });

  it('seeds a PowerPoint attendance summary artifact beside the CSV and workbook', () => {
    const script = readFileSync(seedDemoDocumentsScriptPath, 'utf8');

    expect(script).toContain('$attendancePptx = Join-Path $DownloadsPath "moe-demo-attendance-summary.pptx"');
    expect(script).toContain('$pptxCreated = Write-DemoPowerPointPresentation $attendancePptx $attendanceRows');
    expect(script).toContain('Write-State "ATTENDANCE_PPTX" $(if ($pptxCreated) { $attendancePptx } else { "failed" })');
    expect(script).toContain('$requiredPlainFilesReady -and $xlsxCreated -and $docxCreated -and $pptxCreated');
  });

  it('validates generated PowerPoint files as OpenXML packages with slide content', () => {
    const script = readFileSync(seedDemoDocumentsScriptPath, 'utf8');

    expect(script).toContain('function Write-DemoPowerPointPresentation');
    expect(script).toContain('ppt/presentation.xml');
    expect(script).toContain('ppt/slides/slide1.xml');
    expect(script).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
    expect(script).toContain('Demo Primary School');
    expect(script).toContain('Standard 4');
    expect(script).toContain('Transport delay affected two pupils');
  });

  it('checks the seeded PowerPoint content in the Windows Office runtime smoke', () => {
    const script = readFileSync(officeRuntimeCheckScriptPath, 'utf8');

    expect(script).toContain('moe-demo-attendance-summary.pptx');
    expect(script).toContain('function Test-PowerPointOpenXml');
    expect(script).toContain('ppt/slides/slide1.xml');
    expect(script).toContain('PPTX_SLIDE_TEXT: data rows present');
    expect(script).toContain('Total enrolled: 140');
    expect(script).toContain('Total present: 132');
    expect(script).toContain('Total absent: 8');
    expect(script).toContain('Transport delay affected two pupils');
    expect(script).toContain('STATE: OFFICE_RUNTIME_READY_WITH_POWERPOINT');
  });

  it('summarizes generated PowerPoint slides in the Office analysis CLI', () => {
    const script = readFileSync(demoOfficeAnalysisScriptPath, 'utf8');

    expect(script).toContain('function summarizePptx');
    expect(script).toContain('ppt\\/slides\\/slide');
    expect(script).toContain('extractPresentationParagraphs');
    expect(script).toContain("args.pptx || args.powerpoint");
    expect(script).toContain("result.powerpoint = summarizePptx(powerpointPath)");
    expect(script).toContain(".replace(/\\\\/g, '/')");
  });

  it('runs the managed CDP visual smoke through no-send/no-submit probe evidence', () => {
    const script = readFileSync(managedCdpVisualSmokeScriptPath, 'utf8');

    expect(script).toContain('ManagedCdpVisualSmoke');
    expect(script).toContain('clawx-managed-cdp-visual-smoke-');
    expect(script).toContain('electron-cdp-probe.out.txt');
    expect(script).toContain('-OutlookSmoke');
    expect(script).toContain('-OutlookStateMatrix');
    expect(script).toContain('-ChromeEndpoint');
    expect(script).toContain('-FormsSmoke');
    expect(script).toContain('-VisualAcceptance');
    expect(script).toContain('PROBE_EXIT_CODE');
    expect(script).toContain('POST_PROBE_CHROME_CDP_READY');
    expect(script).toContain('POST_PROBE_ELECTRON_CDP_READY');
    expect(script).toContain('POST_PROBE_HOSTAPI_READY');
    expect(script).toContain('POST_PROBE_GATEWAY_PORT_READY');
    expect(script).not.toContain('-SendEmail');
    expect(script).not.toContain('-SubmitForms');
  });

  it('exposes the Outlook state matrix through the Electron CDP probe runner', () => {
    const script = readFileSync(electronCdpProbeRunnerPath, 'utf8');

    expect(script).toContain('[switch]$OutlookStateMatrix');
    expect(script).toContain('[string]$ChromeEndpoint = "http://127.0.0.1:18792"');
    expect(script).toContain('"--chrome-endpoint", $ChromeEndpoint');
    expect(script).toContain('"--outlook-state-matrix"');
  });

  it('captures diagnostic install-tree evidence when silent NSIS install times out', () => {
    const script = readFileSync(silentInstallScriptPath, 'utf8');

    expect(script).toContain('[int] $TimeoutSeconds = 1800');
    expect(script).toContain('function Capture-InstallTreeSummary');
    expect(script).toContain('install-tree-');
    expect(script).toContain('resources\\openclaw\\node_modules\\playwright-core\\package.json');
    expect(script).toContain('resources\\bin\\ffmpeg.exe');
    expect(script).toContain('resources\\bin\\WinSpeechRecognize.exe');
    expect(script).toContain('Capture-InstallTreeSummary "timeout"');
    expect(script).toContain('Capture-InstallTreeSummary "after"');
  });

  it('patches NSIS direct extraction to write the app archive into the install directory', () => {
    const script = readFileSync(afterPackScriptPath, 'utf8');

    expect(script).toContain('ClawX-patched-v2: extract directly to $INSTDIR');
    expect(script).toContain('SetOutPath "$INSTDIR"');
    expect(script).toContain('Nsis7z::Extract "${FILE}"');
    expect(script).toContain('already patched with explicit $INSTDIR outdir');
  });

  it('keeps suspension Forms field-count guidance aligned with the live schema', () => {
    const schema = JSON.parse(readFileSync(suspensionsSchemaPath, 'utf8')) as {
      questionCount: number;
      sections: Array<{ fields: Array<{ id: string; required?: boolean }> }>;
    };
    const fields = schema.sections.flatMap((section) => section.fields);
    const requiredFields = fields.filter((field) => field.required);
    const browserFillableRequiredFields = requiredFields.filter((field) => field.id !== 'respondent_name');
    const docs = [
      readFileSync(suspensionFormsSkillPath, 'utf8'),
      readFileSync(suspensionFormsVerifierPath, 'utf8'),
      readFileSync(principalDemoScriptPath, 'utf8'),
    ].join('\n');

    expect(schema.questionCount).toBe(32);
    expect(fields).toHaveLength(33);
    expect(requiredFields).toHaveLength(32);
    expect(browserFillableRequiredFields).toHaveLength(31);
    expect(docs).toContain('31 browser-fillable');
    expect(docs).toContain('respondent_name');
    expect(docs).not.toContain('31/31 required');
    expect(docs).not.toContain('31 of 31 required');
  });
});
