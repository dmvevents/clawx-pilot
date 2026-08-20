/**
 * doc-tooling-steering.test.ts — regression tests for the three defects the
 * Ministry's 2026-07-21 prompt suite exposed (`incoming-tests/ClawX Agent
 * Tests/`, scored 0/5). See
 * `skills/laptop/evidence/2026-08-20-raj-prompt-replay/REPORT.md`.
 *
 * These are deliberately HARD tests. They assert on *agent-observable*
 * behaviour — what the model is told and what paths resolve — not on the
 * handlers, which already pass 7/7. The handler suite (`harness/run.ts`)
 * structurally CANNOT catch these, because it calls the handlers directly and
 * never consults a skill or resolves a bare filename.
 *
 * Defect A — OneDrive-redirected Desktop is invisible.
 *   Raj's tester: "I couldn't find any files in that folder." Only worked once
 *   they pasted an absolute path. Under Windows OneDrive Known Folder Move the
 *   real Desktop is %USERPROFILE%\OneDrive\Desktop, so a `~/Desktop` probe
 *   misses. Every Ministry laptop with KFM has this shape.
 *
 * Defect B — the sandbox guard refuses /tmp while claiming tmp is allowed.
 *   macOS /tmp is a symlink to /private/tmp; the candidate is realpath-resolved
 *   but the roots are not, so startsWith() fails.
 *
 * Defect C — the auto-enabled Anthropic doc skills steer the model to Python.
 *   CHAT-001-6.png shows the agent reading ~/.openclaw/skills/pdf/SKILL.md and
 *   then reaching for pdfplumber, burning 7 tool calls. This is the defect that
 *   actually produced the 0/5; the capability was never the blocker.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(__dirname, '../..');
const DOC_TOOLS = path.join(
  REPO_ROOT,
  'extensions/moe-principal-assistant/doc-tools.mjs',
);
const INDEX_MJS = path.join(
  REPO_ROOT,
  'extensions/moe-principal-assistant/index.mjs',
);
const PERSONA_MJS = path.join(
  REPO_ROOT,
  'extensions/moe-principal-assistant/persona.mjs',
);
const MANIFEST = path.join(
  REPO_ROOT,
  'resources/skills/preinstalled-manifest.json',
);

// The six document.* tools we actually ship.
const DOC_TOOLS_NAMES = [
  'document.read_pdf',
  'document.read_docx',
  'document.write_docx',
  'document.read_xlsx',
  'document.write_xlsx',
  'document.read_image',
] as const;

// The Python-backed Anthropic skills that compete with them.
const PYTHON_DOC_SKILLS = ['pdf', 'docx', 'xlsx', 'pptx'] as const;

async function loadDocTools() {
  return import(pathToFileURL(DOC_TOOLS).href);
}

describe('Defect A — file discovery must find the OneDrive-redirected Desktop', () => {
  // A principal says "the Staff Meeting Memo Draft" — a bare filename, no path.
  // resolveReadablePath must find it on a KFM-redirected Desktop.
  it('resolves a bare filename sitting in ~/OneDrive/Desktop', async () => {
    const { resolveReadablePath } = await loadDocTools();
    const home = os.homedir();
    const dir = path.join(home, 'OneDrive', 'Desktop');
    const name = `moe-kfm-probe-${process.pid}.docx`;
    const file = path.join(dir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(file, 'probe');
    try {
      expect(resolveReadablePath(name)).toBe(file);
    } finally {
      await rm(file, { force: true });
    }
  });

  it('resolves a bare filename in a subfolder of ~/OneDrive/Desktop', async () => {
    // Raj's tester used C:\Users\camer\OneDrive\Desktop\MoE Agent Testing Folder
    const { resolveReadablePath } = await loadDocTools();
    const home = os.homedir();
    const dir = path.join(home, 'OneDrive', 'Desktop', 'MoE Agent Testing Folder');
    const name = `moe-kfm-sub-${process.pid}.docx`;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), 'probe');
    try {
      expect(resolveReadablePath(name)).toBe(path.join(dir, name));
    } finally {
      await rm(path.join(dir, name), { force: true });
    }
  });

  it('still refuses a path outside the sandbox', async () => {
    // The KFM fix must not widen the sandbox. /etc/hosts exists on macOS+Linux.
    const { resolveReadablePath } = await loadDocTools();
    if (process.platform === 'win32') return;
    expect(() => resolveReadablePath('/etc/hosts')).toThrow(/refused to read/);
  });

  it('scans breadth-first, so a depth-1 sibling is not lost to the entry budget', async () => {
    // A depth-first walk spends its whole entry budget inside whichever
    // subfolder sorts first and never reaches the sibling at depth 1. On a
    // real ~/Documents (dozens of subfolders, thousands of descendants) that
    // means Output_Files/<file> — where the Ministry's P2 and P4 prompts
    // write their output — is never found despite sitting one level down.
    const { findWithinDir, findWithinDirLegacyDepthFirst } = await loadDocTools();
    const root = await mkdtemp(path.join(os.tmpdir(), 'moe-bfs-'));
    const target = `target-${process.pid}.docx`;
    try {
      // `aaa` sorts first and holds more entries than the budget allows, so a
      // depth-first walk is exhausted before it ever reaches `zzz`.
      const deep = path.join(root, 'aaa');
      await mkdir(deep, { recursive: true });
      for (let i = 0; i < 40; i++) {
        await mkdir(path.join(deep, `sub${String(i).padStart(3, '0')}`), {
          recursive: true,
        });
      }
      await mkdir(path.join(root, 'zzz'), { recursive: true });
      await writeFile(path.join(root, 'zzz', target), 'probe');

      // Budget deliberately smaller than the `aaa` subtree.
      expect(findWithinDir(root, target, 3, 30)).toBe(
        path.join(root, 'zzz', target),
      );
      expect(findWithinDirLegacyDepthFirst(root, target, 3, 30)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Defect B — the sandbox guard must honour its own error message', () => {
  it('accepts a file under the real tmp dir', async () => {
    const { resolveReadablePath } = await loadDocTools();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'moe-guard-'));
    const file = path.join(dir, 'probe.docx');
    await writeFile(file, 'probe');
    try {
      expect(() => resolveReadablePath(file)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a file under the /tmp symlink alias on macOS', async () => {
    // The guard's message says "or tmp directory are allowed" — /tmp must work.
    const { resolveReadablePath } = await loadDocTools();
    if (process.platform !== 'darwin') return;
    const dir = '/tmp/moe-guard-symlink';
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, 'probe.docx');
    await writeFile(file, 'probe');
    try {
      expect(() => resolveReadablePath(file)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Defect C — the model must be steered to document.* over the Python skills', () => {
  it('every document.* tool description tells the model to prefer it over the skill', async () => {
    const src = await readFile(INDEX_MJS, 'utf8');
    const missing: string[] = [];
    for (const name of DOC_TOOLS_NAMES) {
      // Grab the description string that follows this tool's name.
      const at = src.indexOf(`name: '${name}'`);
      expect(at, `${name} is not registered`).toBeGreaterThan(-1);
      const window = src.slice(at, at + 1600);
      if (!/[Pp]refer (this|these)/.test(window)) missing.push(name);
    }
    expect(
      missing,
      `these document.* tools do not tell the model to prefer them over the Python skills, ` +
        `so the model may pick the pdf/docx/xlsx skill and fail exactly as it did on 2026-07-21: ` +
        missing.join(', '),
    ).toEqual([]);
  });

  it('every document.* tool description states no Python is required', async () => {
    const src = await readFile(INDEX_MJS, 'utf8');
    const missing: string[] = [];
    for (const name of DOC_TOOLS_NAMES) {
      const at = src.indexOf(`name: '${name}'`);
      const window = src.slice(at, at + 1600);
      if (!/(WITHOUT invoking Python|no Python|without Python)/i.test(window)) {
        missing.push(name);
      }
    }
    expect(
      missing,
      `missing an explicit no-Python claim: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('the persona carries a hard routing rule for document.* like it does for outlook.*', async () => {
    const persona = await readFile(PERSONA_MJS, 'utf8');
    // The outlook.* rule is the standard to match — it is why Outlook routing is reliable.
    expect(
      /outlook\.\*/.test(persona),
      'the outlook.* routing rule vanished — that rule is the template here',
    ).toBe(true);
    expect(
      /document\.\*/.test(persona),
      'persona.mjs has no document.* routing rule, so nothing overrides the pdf/docx/xlsx ' +
        'skills that tell the model to use pypdf/pdfplumber/pandas',
    ).toBe(true);
  });

  it('the persona names the native tools and forbids the Python route', async () => {
    const persona = await readFile(PERSONA_MJS, 'utf8');
    for (const name of DOC_TOOLS_NAMES) {
      expect(persona, `persona does not name ${name}`).toContain(name);
    }
    expect(
      /pandoc|pdfplumber|pypdf|pandas|pytesseract|pip install/i.test(persona),
      'persona must explicitly name the Python tooling it is forbidding, otherwise the ' +
        'model has no reason to distrust the skill that recommends it',
    ).toBe(true);
    // Never tell a principal to run terminal commands (Raj's P5 did exactly that).
    expect(
      /never .{0,80}(install|terminal|command line|command-line)/i.test(persona),
      'persona must forbid asking the principal to install anything or run terminal commands',
    ).toBe(true);
  });

  it('the Python-backed doc skills are not auto-enabled', async () => {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      skills: Array<{ slug: string; autoEnable?: boolean }>;
    };
    const offenders = manifest.skills
      .filter((s) => (PYTHON_DOC_SKILLS as readonly string[]).includes(s.slug))
      .filter((s) => s.autoEnable === true)
      .map((s) => s.slug);
    expect(
      offenders,
      `these skills shell out to Python (absent from the Windows build: resources/bin/ ships ` +
        `only ffmpeg/node/uv/WinSpeechRecognize) yet are auto-enabled on every fresh install, ` +
        `so the model is handed them by default: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});

describe('Guard — the native path must not regress to needing Python', () => {
  it('doc-tools.mjs never shells out', async () => {
    const src = await readFile(DOC_TOOLS, 'utf8');
    // Comments legitimately mention Python; executable shell-outs must not exist.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const bad of [
      'child_process',
      'execSync',
      'spawnSync',
      'uv run',
      'pip install',
    ]) {
      expect(code, `doc-tools.mjs must not use ${bad}`).not.toContain(bad);
    }
  });

  it('the runtime deps the native path needs are real dependencies', async () => {
    const pkg = JSON.parse(
      await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    // electron-builder strips devDependencies from the asar — the moe.9 class.
    for (const dep of ['pdf-parse', 'mammoth', 'xlsx', 'docx']) {
      expect(
        pkg.dependencies?.[dep],
        `${dep} must be in dependencies, not devDependencies, or it is stripped from the asar`,
      ).toBeTruthy();
    }
  });

  it('doc-tools.mjs is present in the extension the build ships', () => {
    expect(existsSync(DOC_TOOLS)).toBe(true);
  });
});
