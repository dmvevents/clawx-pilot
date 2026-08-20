#!/usr/bin/env node
/**
 * eval/snapshot-skills.mjs — refresh eval/fixtures/skill-descriptions.json.
 *
 * The eval pipeline ranks the document.* tools against the skills that
 * compete with them, and a skill's pull comes entirely from its SKILL.md
 * `description` — that is the text the model sees when deciding. Those files
 * live in `~/.openclaw/skills/` and are not in the repo, so CI has nothing to
 * read. This captures them into a checked-in snapshot.
 *
 * `eval/lib/steering.mjs` prefers the live file whenever it exists and only
 * falls back to the snapshot, so a developer with skills installed always
 * evaluates against reality. Re-run this after upgrading a bundled skill:
 * a vendor rewriting the pdf skill's trigger list changes how hard it
 * competes, and a stale snapshot would hide that.
 *
 *   pnpm eval:snapshot-skills
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSkillFrontmatter, SKILL_SNAPSHOT, MANIFEST_JSON } from './lib/steering.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const home = os.homedir();
  const manifest = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
  const slugs = manifest.skills.map((s) => s.slug);

  const skills = [];
  const missing = [];
  for (const slug of slugs) {
    const p = path.join(home, '.openclaw/skills', slug, 'SKILL.md');
    if (!existsSync(p)) {
      missing.push(slug);
      continue;
    }
    const parsed = parseSkillFrontmatter(readFileSync(p, 'utf8'));
    skills.push({ slug, description: parsed?.description ?? '' });
  }

  if (!skills.length) {
    process.stderr.write(
      'eval:snapshot-skills: no skills found under ~/.openclaw/skills — nothing captured, leaving the existing snapshot alone.\n',
    );
    process.exit(1);
  }

  // Preserve any slug already in the snapshot that is not installed here, so
  // running this on a partially-provisioned box does not silently shrink
  // the competing catalogue and make the eval look easier than it is.
  let preserved = [];
  if (existsSync(SKILL_SNAPSHOT)) {
    const prev = JSON.parse(readFileSync(SKILL_SNAPSHOT, 'utf8'));
    const captured = new Set(skills.map((s) => s.slug));
    preserved = (prev.skills ?? []).filter((s) => !captured.has(s.slug));
  }

  const doc = {
    _comment:
      'Snapshot of SKILL.md frontmatter descriptions, captured from the live ' +
      '~/.openclaw/skills install so the eval runs on a clean CI box. ' +
      'eval/lib/steering.mjs prefers the live file when present and falls back ' +
      'to this. Regenerate with: pnpm eval:snapshot-skills',
    captured_at: new Date().toISOString().slice(0, 10),
    captured_from: '~/.openclaw/skills/<slug>/SKILL.md',
    skills: [...skills, ...preserved].sort((a, b) => a.slug.localeCompare(b.slug)),
  };
  writeFileSync(SKILL_SNAPSHOT, JSON.stringify(doc, null, 2) + '\n');

  process.stdout.write(
    `eval:snapshot-skills: captured ${skills.length} skill description(s) → ${path.relative(path.resolve(__dirname, '..'), SKILL_SNAPSHOT)}\n`,
  );
  if (preserved.length) {
    process.stdout.write(
      `  preserved ${preserved.length} not installed here: ${preserved.map((s) => s.slug).join(', ')}\n`,
    );
  }
  if (missing.length) {
    process.stdout.write(`  not installed: ${missing.join(', ')}\n`);
  }
}

main();
