// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const packageJsonPath = join(process.cwd(), 'package.json');
const manualWindowsWorkflowPath = join(process.cwd(), '.github', 'workflows', 'package-win-manual.yml');
const installArtifactProbePath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-check-install-artifacts.ps1');
const seedDemoDocumentsScriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-seed-demo-documents.ps1');

describe('Windows package inspection contracts', () => {
  it('package:win prepares native Windows ASR and runtime binaries before packaging', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts: Record<string, string> };

    expect(pkg.scripts['package:win']).toContain('pnpm run prep:win-binaries');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run uv:download:win');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run node:download:win');
    expect(pkg.scripts['prep:win-binaries']).toContain('pnpm run win-asr:build:x64');
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
});
