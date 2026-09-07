import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'windows-pilot', 'scripts', 'pilot-record-app-window.ps1');
const verifierPath = join(process.cwd(), 'scripts', 'verify-app-window-recording.mjs');
const script = readFileSync(scriptPath, 'utf8');
const verifier = readFileSync(verifierPath, 'utf8');
const pwsh = findPwsh();
const ffmpeg = findMediaTool('ffmpeg');
const ffprobe = findMediaTool('ffprobe');

function findPwsh(): string | null {
  for (const candidate of [
    process.env.CLAWX_PWSH,
    'pwsh',
    join(process.env.HOME ?? '', 'tools', 'powershell-7', 'pwsh'),
    '/opt/homebrew/bin/pwsh',
    '/usr/local/bin/pwsh',
    'powershell',
  ].filter(Boolean) as string[]) {
    const result = spawnSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
    });
    if (result.status === 0) return candidate;
  }
  return null;
}


function findMediaTool(name: string): string | null {
  for (const candidate of [
    process.env[`CLAWX_${name.toUpperCase()}`],
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ].filter(Boolean) as string[]) {
    const result = spawnSync(candidate, ['-version'], { encoding: 'utf8' });
    if (result.status === 0) return candidate;
  }
  return null;
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-window-recording-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runPowerShell(body: string, dir: string) {
  if (!pwsh) return null;
  const runner = join(dir, 'runner.ps1');
  writeFileSync(runner, body);
  return spawnSync(pwsh, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('pilot app window recording script', () => {
  it('documents capture-only evidence and never emits product or visual success', () => {
    expect(script).toContain('APP_WINDOW_RECORDING_CAPTURE_ONLY');
    expect(script).toContain("status = 'CAPTURE_ONLY'");
    expect(script).toContain("visualVerdict = 'NOT_RUN'");
    expect(script).toContain("productVerdict = 'NOT_RUN'");
    expect(script).not.toMatch(/visualVerdict\s*=\s*['"]PASS['"]/);
    expect(script).not.toMatch(/productVerdict\s*=\s*['"]PASS['"]/);
  });

  it('captures a named app window with gdigrab title input instead of the full desktop', () => {
    expect(script).toContain("'-f', 'gdigrab'");
    expect(script).toContain("'-i', \"title=$($window.title)\"");
    expect(script).toContain('Resolve-AppWindow -RequestedTitle $WindowTitle -ExpectedName $ExpectedProcessName');
    expect(script).toContain('app window title ambiguous');
    expect(script).toContain("'-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2'");
    expect(script).not.toContain("'-i', 'desktop'");
    expect(script).not.toContain("scale='max($MinWidth,iw)'");
  });

  it('fails closed for Session 0, missing tools, undersized metadata, blank captures, and overwrite attempts', () => {
    expect(script).toContain('Session 0 cannot capture the user desktop');
    expect(script).toContain('$Name not found; pass -$($Name.Substring');
    expect(script).toContain('Resolve-InstalledFfmpegPath');
    expect(script).toContain('TryResolve-InstalledFfprobePath');
    expect(script).toContain('HOST_VERIFY_REQUIRED');
    expect(script).toContain('RequireGuestVerification');
    expect(script).toContain('native app window client width $($window.clientWidth) is below required $MinWidth');
    expect(script).toContain('capture width $width is below required $MinimumWidth');
    expect(script).toContain('all extracted frames appear blank');
    expect(script).toContain('run directory already exists');
    expect(script).toContain("'-n'");
  });

  it('verifies duration, dimensions, at least 8 frames, first/last frame schedule, and SHA256 metadata', () => {
    expect(script).toContain('Assert-CaptureMetadata');
    expect(script).toContain('New-FrameSchedule');
    expect(script).toContain("if ($Count -lt 8) { throw 'at least 8 frames are required' }");
    expect(script).toContain('$last = [Math]::Max([double]0, [double]($DurationSeconds - 0.2))');
    expect(script).toContain('System.Text.UTF8Encoding($false)');
    expect(script).toContain('Get-Sha256 $videoPath');
    expect(script).toContain('guestVerificationStatus');
    expect(script).toContain('nativeClientWidth');
    expect(script).toContain('nativeWindowWidth');
    expect(script).toContain('expectedInstallDir');
    expect(script).toContain('frameScheduleSeconds');
    expect(script).toContain('frameStats');
  });

  it('uses safe argument arrays so titles and paths with spaces are single argv entries', () => {
    if (!pwsh) return;

    withTempDir((dir) => {
      const fakeTool = join(dir, 'fake tool.sh');
      const stdoutPath = join(dir, 'stdout with spaces.txt');
      const stderrPath = join(dir, 'stderr with spaces.txt');
      writeExecutable(
        fakeTool,
        `#!/usr/bin/env bash
printf '%s\n' "$#"
printf '%s\n' "$1"
printf '%s\n' "$2"
printf '%s\n' "$3"
printf 'warn with spaces\n' >&2
`,
      );

      const result = runPowerShell(
        `
$ErrorActionPreference = 'Stop'
$env:CLAWX_RECORD_APP_WINDOW_DOT_SOURCE_ONLY = '1'
. ${psSingleQuote(scriptPath)}
$result = Invoke-ExternalTool -FilePath ${psSingleQuote(fakeTool)} -Arguments @('first arg', 'title=Ministry of Education', 'C:\\Path With Spaces\\app-window.mp4') -StdoutPath ${psSingleQuote(stdoutPath)} -StderrPath ${psSingleQuote(stderrPath)}
[pscustomobject]@{
  exitCode = $result.exitCode
  stdout = Get-Content -LiteralPath ${psSingleQuote(stdoutPath)} -Raw
  stderr = Get-Content -LiteralPath ${psSingleQuote(stderrPath)} -Raw
} | ConvertTo-Json -Compress
`,
        dir,
      );

      expect(result?.status).toBe(0);
      const parsed = JSON.parse(String(result?.stdout).trim()) as { exitCode: number; stdout: string; stderr: string };
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout.split(/\r?\n/).filter(Boolean)).toEqual([
        '3',
        'first arg',
        'title=Ministry of Education',
        'C:\\Path With Spaces\\app-window.mp4',
      ]);
      expect(parsed.stderr).toContain('warn with spaces');
    });
  });

  it('computes run directory, metadata, and frame scheduling behavior through the PowerShell helpers', () => {
    if (!pwsh) return;

    withTempDir((dir) => {
      const root = join(dir, 'output root with spaces');
      const result = runPowerShell(
        `
$ErrorActionPreference = 'Stop'
$env:CLAWX_RECORD_APP_WINDOW_DOT_SOURCE_ONLY = '1'
. ${psSingleQuote(scriptPath)}
$script:ExpectedInstallDir = 'C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education'
$runDir = New-UniqueRunDirectory -RootDir ${psSingleQuote(root)} -RequestedRunId 'run 01/unsafe'
$schedule = New-FrameSchedule -DurationSeconds 12.5 -Count 8
$expectedRoot = Get-ExpectedInstallDirectory
$ok = Assert-CaptureMetadata -Metadata ([pscustomobject]@{ streams = @([pscustomobject]@{ codec_type = 'video'; width = 1280; height = 720 }); format = [pscustomobject]@{ duration = '12.25' } }) -MinimumWidth 1280 -MinimumDurationSeconds 10
$tooSmall = $false
try { Assert-CaptureMetadata -Metadata ([pscustomobject]@{ streams = @([pscustomobject]@{ codec_type = 'video'; width = 1279; height = 720 }); format = [pscustomobject]@{ duration = '12.25' } }) -MinimumWidth 1280 -MinimumDurationSeconds 10 | Out-Null } catch { $tooSmall = $_.Exception.Message -like 'capture width 1279*' }
[pscustomobject]@{
  runDir = $runDir
  exists = Test-Path -LiteralPath $runDir
  framesDirExists = Test-Path -LiteralPath (Join-Path $runDir 'frames')
  scheduleCount = $schedule.Count
  first = $schedule[0].seconds
  last = $schedule[-1].seconds
  width = $ok.width
  height = $ok.height
  durationSeconds = $ok.durationSeconds
  tooSmall = $tooSmall
  defaultInstallRoot = $expectedRoot
} | ConvertTo-Json -Compress
`,
        dir,
      );

      expect(result?.status).toBe(0);
      const parsed = JSON.parse(String(result?.stdout).trim()) as {
        runDir: string;
        exists: boolean;
        framesDirExists: boolean;
        scheduleCount: number;
        first: number;
        last: number;
        width: number;
        height: number;
        durationSeconds: number;
        tooSmall: boolean;
        defaultInstallRoot: string;
      };
      expect(parsed.runDir).toContain('run-01-unsafe');
      expect(parsed.exists).toBe(true);
      expect(parsed.framesDirExists).toBe(true);
      expect(parsed.scheduleCount).toBe(8);
      expect(parsed.first).toBe(0);
      expect(parsed.last).toBe(12.3);
      expect(parsed.width).toBe(1280);
      expect(parsed.height).toBe(720);
      expect(parsed.durationSeconds).toBe(12.25);
      expect(parsed.tooSmall).toBe(true);
      expect(parsed.defaultInstallRoot).toContain('Ministry of Education');
    });
  });


  it('uses a directory-boundary check for installed app path matching', () => {
    expect(script).toContain('function Test-PathUnderDirectory');
    expect(script).toContain('Test-PathUnderDirectory -Path $_.executablePath -Directory $installRoot');
    expect(script).not.toContain('$exeFull.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)');
  });

  it('rejects sibling install-directory prefixes instead of accepting Ministry of Education-old', () => {
    if (!pwsh) return;

    withTempDir((dir) => {
      const result = runPowerShell(
        `
$ErrorActionPreference = 'Stop'
$env:CLAWX_RECORD_APP_WINDOW_DOT_SOURCE_ONLY = '1'
. ${psSingleQuote(scriptPath)}
$installRoot = 'C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education'
$siblingExe = 'C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education-old\\Ministry of Education.exe'
$correctExe = 'C:\\Users\\clawxtest\\AppData\\Local\\Programs\\Ministry of Education\\Ministry of Education.exe'
[pscustomobject]@{
  siblingAccepted = Test-PathUnderDirectory -Path $siblingExe -Directory $installRoot
  correctAccepted = Test-PathUnderDirectory -Path $correctExe -Directory $installRoot
} | ConvertTo-Json -Compress
`,
        dir,
      );

      expect(result?.status).toBe(0);
      const parsed = JSON.parse(String(result?.stdout).trim()) as { siblingAccepted: boolean; correctAccepted: boolean };
      expect(parsed.siblingAccepted).toBe(false);
      expect(parsed.correctAccepted).toBe(true);
    });
  });

  it('is parseable by local PowerShell when available', () => {
    if (!pwsh) return;

    withTempDir((dir) => {
      const result = runPowerShell(
        `
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(${psSingleQuote(scriptPath)}, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { throw ($errors | ForEach-Object { $_.Message }) -join '; ' }
'OK'
`,
        dir,
      );
      expect(result?.status).toBe(0);
      expect(result?.stdout.trim()).toBe('OK');
    });
  });


  it('host verifier extracts a deterministic frame inventory from a valid recording', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'recording with spaces.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.2',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);

      const outDir = join(dir, 'host verify output');
      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--out-dir', outDir,
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('STATE:APP_WINDOW_RECORDING_CAPTURE_ONLY_VERIFIED');
      const manifest = JSON.parse(readFileSync(join(outDir, 'host-verification.json'), 'utf8')) as {
        status: string;
        visualVerdict: string;
        productVerdict: string;
        video: { width: number; height: number; durationSeconds: number; sha256: string };
        frames: Array<{ path: string; seconds: number; sha256: string; signal: { blank: boolean } }>;
      };
      expect(manifest.status).toBe('CAPTURE_ONLY_VERIFIED');
      expect(manifest.visualVerdict).toBe('NOT_RUN');
      expect(manifest.productVerdict).toBe('NOT_RUN');
      expect(manifest.video.width).toBe(1280);
      expect(manifest.video.height).toBe(720);
      expect(manifest.video.durationSeconds).toBeGreaterThanOrEqual(1);
      expect(manifest.video.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.frames).toHaveLength(8);
      expect(manifest.frames[0].seconds).toBe(0);
      expect(manifest.frames.at(-1)?.seconds).toBeGreaterThanOrEqual(1);
      expect(manifest.frames.every((frame) => frame.sha256.match(/^[a-f0-9]{64}$/))).toBe(true);
      expect(manifest.frames.some((frame) => !frame.signal.blank)).toBe(true);
      for (const frame of manifest.frames) {
        expect(existsSync(join(outDir, frame.path))).toBe(true);
      }
    });
  });


  it('host verifier binds pulled recordings to the guest manifest video hash', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'app-window.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);
      const guestManifest = join(dir, 'guest-manifest.json');
      writeFileSync(guestManifest, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'clawx.appWindowRecording',
        status: 'CAPTURE_ONLY',
        visualVerdict: 'NOT_RUN',
        productVerdict: 'NOT_RUN',
        capture: { guestVerificationStatus: 'HOST_VERIFY_REQUIRED' },
        source: {
          nativeClientWidth: 1280,
          nativeClientHeight: 720,
          preserveNativeSize: true,
          videoFilter: 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
        },
        files: [{ role: 'video', path: 'app-window.mp4', sha256: sha256(video) }],
      })}
`);

      const outDir = join(dir, 'bound verify');
      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--manifest', guestManifest,
        '--out-dir', outDir,
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('boundManifest=true');
      const manifest = JSON.parse(readFileSync(join(outDir, 'host-verification.json'), 'utf8')) as {
        sourceManifest: { path: string; sha256: string; source: { nativeClientWidth: number } };
      };
      expect(manifest.sourceManifest.path).toBe(guestManifest);
      expect(manifest.sourceManifest.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.sourceManifest.source.nativeClientWidth).toBe(1280);
    });
  });

  it('host verifier rejects guest manifests that used an upscaling capture filter', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'app-window.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);
      const guestManifest = join(dir, 'upscaled-guest-manifest.json');
      writeFileSync(guestManifest, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'clawx.appWindowRecording',
        status: 'CAPTURE_ONLY',
        visualVerdict: 'NOT_RUN',
        productVerdict: 'NOT_RUN',
        source: {
          nativeClientWidth: 640,
          nativeClientHeight: 360,
          preserveNativeSize: false,
          videoFilter: "scale='max(1280,iw)':-2",
        },
        files: [{ role: 'video', path: 'app-window.mp4', sha256: sha256(video) }],
      })}
`);

      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--manifest', guestManifest,
        '--out-dir', join(dir, 'upscaled-verify'),
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('guest manifest native client width 640 is below required 1280');
    });
  });



  it('host verifier accepts a valid guest manifest with a UTF-8 BOM from older PowerShell writers', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'app-window.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);
      const guestManifest = join(dir, 'bom-guest-manifest.json');
      const payload = JSON.stringify({
        schemaVersion: 1,
        kind: 'clawx.appWindowRecording',
        status: 'CAPTURE_ONLY',
        visualVerdict: 'NOT_RUN',
        productVerdict: 'NOT_RUN',
        source: {
          nativeClientWidth: 1280,
          nativeClientHeight: 720,
          preserveNativeSize: true,
          videoFilter: 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
        },
        files: [{ role: 'video', path: 'app-window.mp4', sha256: sha256(video) }],
      });
      writeFileSync(guestManifest, `\uFEFF${payload}\n`, 'utf8');

      const outDir = join(dir, 'bom-bound-verify');
      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--manifest', guestManifest,
        '--out-dir', outDir,
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('boundManifest=true');
      const manifest = JSON.parse(readFileSync(join(outDir, 'host-verification.json'), 'utf8')) as {
        sourceManifest: { path: string; source: { nativeClientWidth: number } };
      };
      expect(manifest.sourceManifest.path).toBe(guestManifest);
      expect(manifest.sourceManifest.source.nativeClientWidth).toBe(1280);
    });
  });

  it('host verifier rejects a supplied guest manifest when the pulled video hash differs', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'app-window.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);
      const guestManifest = join(dir, 'guest-manifest.json');
      writeFileSync(guestManifest, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'clawx.appWindowRecording',
        status: 'CAPTURE_ONLY',
        visualVerdict: 'NOT_RUN',
        productVerdict: 'NOT_RUN',
        files: [{ role: 'video', path: 'app-window.mp4', sha256: '0'.repeat(64) }],
      })}
`);

      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--manifest', guestManifest,
        '--out-dir', join(dir, 'bad-bound'),
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('pulled video hash does not match guest manifest video hash');
    });
  });


  it('host verifier can fall back to ffmpeg metadata parsing when ffprobe is unavailable', () => {
    if (!ffmpeg) return;

    withTempDir((dir) => {
      const video = join(dir, 'fallback.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=1280x720:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);

      const outDir = join(dir, 'fallback verify');
      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--out-dir', outDir,
        '--ffmpeg', ffmpeg,
        '--no-ffprobe',
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      const manifest = JSON.parse(readFileSync(join(outDir, 'host-verification.json'), 'utf8')) as {
        tools: { metadataSource: string; ffprobe: string | null };
        frames: unknown[];
      };
      expect(manifest.tools.metadataSource).toBe('ffmpeg-fallback');
      expect(manifest.tools.ffprobe).toBeNull();
      expect(manifest.frames).toHaveLength(8);
    });
  });

  it('host verifier rejects undersized recordings instead of producing a capture verdict', () => {
    if (!ffmpeg || !ffprobe) return;

    withTempDir((dir) => {
      const video = join(dir, 'undersized.mp4');
      const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', 'testsrc=size=640x360:rate=10',
        '-t', '1.1',
        '-pix_fmt', 'yuv420p',
        video,
      ], { encoding: 'utf8' });
      expect(generated.status).toBe(0);

      const result = spawnSync('node', [
        verifierPath,
        '--video', video,
        '--out-dir', join(dir, 'verify-small'),
        '--ffmpeg', ffmpeg,
        '--ffprobe', ffprobe,
        '--min-duration', '1',
        '--frame-count', '8',
      ], { encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('STATE:APP_WINDOW_RECORDING_VERIFY_INVALID');
      expect(result.stderr).toContain('width 640 is below required 1280');
    });
  });

  it('host verifier keeps capture verification separate from visual and product acceptance', () => {
    expect(verifier).toContain("status: 'CAPTURE_ONLY_VERIFIED'");
    expect(verifier).toContain("visualVerdict: 'NOT_RUN'");
    expect(verifier).toContain("productVerdict: 'NOT_RUN'");
    expect(verifier).not.toMatch(/visualVerdict:\s*['"]PASS['"]/);
    expect(verifier).not.toMatch(/productVerdict:\s*['"]PASS['"]/);
  });


  it('exists at the canonical Windows pilot path for scheduled-task upload', () => {
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(verifierPath)).toBe(true);
  });
});
