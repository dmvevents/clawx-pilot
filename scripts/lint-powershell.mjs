/**
 * PowerShell lint gate for the windows-pilot surface (CLWX-83).
 *
 * Why this exists: the Mac dev box had no PowerShell parser, so PS 5.1-class
 * bugs (quoting, BOM, PS7-only syntax) only surfaced live on the pilot
 * laptop. This target runs PSScriptAnalyzer over windows-pilot/ with the
 * repo settings file (which enables PSUseCompatibleSyntax pinned to 5.1+7.0,
 * the fleet's two runtimes).
 *
 * Gate semantics:
 *   exit 0 — no gating findings (Warning/Information reported as counts)
 *   exit 1 — gating findings: any ParseError, any Error-severity finding,
 *            or any PSUseCompatibleSyntax finding (5.1-compat is the
 *            load-bearing class; it ships as Warning severity upstream, so
 *            it is elevated here), or an analyzer error mid-run
 *   exit 2 — tooling/inputs missing (pwsh, PSScriptAnalyzer, settings file,
 *            target dir, or ZERO analyzable files found); distinct code so
 *            CI can tell infra from findings
 *
 * False-GREEN hardening (adversarial review, this card): the analyzer's
 * "cannot find path"/"settings invalid" errors are statement-terminating,
 * NOT process-terminating — pwsh would exit 0 with an empty findings array.
 * The PS payload therefore try/catches the analyzer call (verified to turn
 * those into exit 1) and reports the analyzed-file COUNT, which the gate
 * requires to be > 0.
 *
 * Run: pnpm lint:ps   (see windows-pilot/README.md for pwsh install options)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = join(repoRoot, 'windows-pilot');
const SETTINGS = join(repoRoot, 'windows-pilot', 'PSScriptAnalyzerSettings.psd1');

// Severity values that fail the gate outright.
const GATING_SEVERITIES = new Set(['Error', 'ParseError']);
// Rules elevated to gating regardless of their upstream severity.
const GATING_RULES = new Set(['PSUseCompatibleSyntax']);

function resolvePwsh() {
  const candidates = [
    process.env.CLAWX_PWSH,
    'pwsh',
    join(process.env.HOME ?? '', 'tools', 'powershell-7', 'pwsh'),
    '/opt/homebrew/bin/pwsh',
    '/usr/local/bin/pwsh',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim()) {
      return { path: candidate, version: probe.stdout.trim() };
    }
  }
  return null;
}

function main() {
  const pwsh = resolvePwsh();
  if (!pwsh) {
    console.error('[lint:ps] pwsh not found. Install options:');
    console.error('  - Homebrew (needs sudo for the pkg): brew install --cask powershell');
    console.error('  - User-local, no sudo: download the osx tar.gz from');
    console.error('    https://github.com/PowerShell/PowerShell/releases and extract to ~/tools/powershell-7');
    console.error('  - Or set CLAWX_PWSH to an existing pwsh binary.');
    process.exit(2);
  }
  // Preflight the inputs — a missing settings file or target dir must be a
  // loud infra failure, never an empty-and-GREEN analyzer run.
  for (const [label, path] of [
    ['settings file', SETTINGS],
    ['target dir', TARGET_DIR],
  ]) {
    if (!existsSync(path)) {
      console.error(`[lint:ps] ${label} missing: ${path}`);
      process.exit(2);
    }
  }

  const scratch = mkdtempSync(join(tmpdir(), 'clawx-psa-'));
  const outFile = join(scratch, 'findings.json');
  try {
    const psCommand = [
      // $ErrorActionPreference = Stop: PSScriptAnalyzer's per-file problems
      // surface as NON-terminating error records that skip the try/catch and
      // still produce JSON for the files it did process — a partial-analysis
      // false GREEN (Codex adversarial review, 2026-09-06). Stop promotes
      // every error record to terminating, so any analyzer-side error fails
      // the run loudly instead of shrinking its coverage.
      'try {',
      "  $ErrorActionPreference = 'Stop';",
      '  Import-Module PSScriptAnalyzer -ErrorAction Stop;',
      `  $files = @(Get-ChildItem -Path '${TARGET_DIR}' -Recurse -Include *.ps1,*.psm1,*.psd1 -File);`,
      `  $results = @(Invoke-ScriptAnalyzer -Path '${TARGET_DIR}' -Recurse -Settings '${SETTINGS}' -ErrorAction Stop);`,
      '  $payload = @($results | Select-Object RuleName, Severity, ScriptPath, Line, Message);',
      '  $doc = @{ filesAnalyzed = $files.Count; findings = $payload };',
      `  ConvertTo-Json -InputObject $doc -Depth 4 -EnumsAsStrings | Set-Content -Path '${outFile}' -Encoding utf8NoBOM;`,
      '} catch { Write-Error $_; exit 1 }',
    ].join(' ');

    const run = spawnSync(pwsh.path, ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });

    if (run.status !== 0 || !existsSync(outFile)) {
      const stderr = (run.stderr ?? '').trim();
      if (/could not (?:be )?load(?:ed)?|not recognized|No match was found|Import-Module/i.test(stderr)) {
        console.error('[lint:ps] PSScriptAnalyzer module missing. Install with:');
        console.error(`  ${pwsh.path} -NoProfile -Command 'Install-Module PSScriptAnalyzer -Scope CurrentUser -Force'`);
        console.error(`  (pwsh ${pwsh.version} at ${pwsh.path})`);
        process.exit(2);
      }
      console.error('[lint:ps] analyzer run failed:');
      console.error(stderr || run.stdout || `exit=${run.status}`);
      process.exit(2);
    }

    let doc;
    try {
      doc = JSON.parse(readFileSync(outFile, 'utf8'));
    } catch {
      console.error('[lint:ps] analyzer produced unreadable output — treating as failure.');
      process.exit(2);
    }
    const filesAnalyzed = doc?.filesAnalyzed ?? 0;
    const findings = doc?.findings ?? [];
    if (filesAnalyzed === 0) {
      console.error(`[lint:ps] ZERO PowerShell files found under ${TARGET_DIR} — refusing to report GREEN on a no-op run.`);
      process.exit(2);
    }

    const gating = findings.filter(
      (f) => GATING_SEVERITIES.has(f.Severity) || GATING_RULES.has(f.RuleName),
    );
    const advisory = findings.filter((f) => !gating.includes(f));

    const counts = {};
    for (const f of advisory) counts[f.Severity] = (counts[f.Severity] ?? 0) + 1;
    console.log(`[lint:ps] pwsh ${pwsh.version} · PSScriptAnalyzer over ${filesAnalyzed} file(s) in windows-pilot/ (settings: PSScriptAnalyzerSettings.psd1)`);
    console.log(
      `[lint:ps] findings: ${findings.length} total — gating ${gating.length}, advisory ${Object.entries(counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') || 'none'}`,
    );

    if (gating.length > 0) {
      console.error(`[lint:ps] GATE FAIL — ${gating.length} gating finding(s) (Error/ParseError/PSUseCompatibleSyntax):`);
      for (const f of gating) {
        const file = String(f.ScriptPath ?? '?').split('/').pop();
        console.error(`  ${file}:${f.Line} [${f.Severity}/${f.RuleName}] ${f.Message}`);
      }
      process.exit(1);
    }
    console.log('[lint:ps] GREEN — no Error/ParseError/PSUseCompatibleSyntax findings.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
