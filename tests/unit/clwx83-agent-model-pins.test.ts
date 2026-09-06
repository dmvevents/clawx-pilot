/**
 * CLWX-83 guard (finding #4): agent model pins must resolve.
 *
 * A stale pin ("gpt-5.3-codex-spark") silently lost 1-2 subagent workers per
 * wave for a MONTH because nothing validated pins before spawn. This suite
 * (a) audits the REAL repo agent surfaces on every test run and (b) proves
 * the doctor's detection with known-bad fixtures, so the guard is falsifiable.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../');

function loadDoctor() {
  return import('../../scripts/agent-model-pins-doctor.mjs');
}

function readDirFiles(dir: string, suffix: string): Array<{ path: string; text: string }> {
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => ({ path: join(dir, name), text: readFileSync(join(dir, name), 'utf8') }));
}

const allowlist = JSON.parse(
  readFileSync(join(repoRoot, 'scripts/agent-model-allowlist.json'), 'utf8'),
);

describe('CLWX-83 agent model pins', () => {
  it('allowlist file is well-formed', () => {
    expect(allowlist.tierAliases).toEqual(expect.arrayContaining(['haiku', 'sonnet', 'opus', 'fable']));
    expect(allowlist.knownBadModels).toContain('gpt-5.3-codex-spark');
    expect(Array.isArray(allowlist.codexModels)).toBe(true);
    expect(allowlist.codexModels.length).toBeGreaterThan(0);
  });

  it('real repo agent surfaces carry no unknown or bare-ID model pins', async () => {
    const { auditRepoAgentSurfaces } = await loadDoctor();
    const codexTomlFiles = readDirFiles(join(repoRoot, '.codex/agents'), '.toml');
    const agentMdFiles = [
      ...readDirFiles(join(repoRoot, '.claude/agents'), '.md'),
      ...readDirFiles(join(repoRoot, '.codex/agents'), '.md'),
    ];
    // The audit is only meaningful if it actually saw the surfaces.
    expect(codexTomlFiles.length).toBeGreaterThan(0);
    expect(agentMdFiles.length).toBeGreaterThan(0);
    const { failures } = auditRepoAgentSurfaces({ codexTomlFiles, agentMdFiles, allowlist });
    expect(failures).toEqual([]);
  });

  it('flags a toml pin of a model outside the allowlist (the spark class)', async () => {
    const { auditRepoAgentSurfaces } = await loadDoctor();
    const { failures } = auditRepoAgentSurfaces({
      codexTomlFiles: [
        { path: 'fixture.toml', text: 'name = "x"\nmodel = "gpt-5.3-codex-spark"\nmodel_reasoning_effort = "high"\n' },
      ],
      agentMdFiles: [],
      allowlist,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('gpt-5.3-codex-spark');
  });

  it('catches pins in every TOML spelling: single quotes, dotted keys, inline tables', async () => {
    const { parseTomlModelPins } = await loadDoctor();
    expect(parseTomlModelPins("model = 'gpt-5.3-codex-spark'\n")).toEqual([
      { section: '', model: 'gpt-5.3-codex-spark' },
    ]);
    expect(parseTomlModelPins('profiles.spark.model = "gpt-5.3-codex-spark"\n')).toEqual([
      { section: '', model: 'gpt-5.3-codex-spark' },
    ]);
    expect(parseTomlModelPins('profile = { model = "gpt-5.3-codex-spark", effort = "high" }\n')).toEqual([
      { section: '', model: 'gpt-5.3-codex-spark' },
    ]);
    // Trailing comment after the value must not hide the pin.
    expect(parseTomlModelPins('model = "gpt-5.5" # pinned\n')).toEqual([{ section: '', model: 'gpt-5.5' }]);
  });

  it('does NOT report pins or profile tables from inside multi-line strings', async () => {
    const { parseTomlModelPins, parseLegacyProfileTables } = await loadDoctor();
    const doc = [
      'developer_instructions = """',
      'Example: set model = "fake-doc-example" in your config.',
      '[profiles.example-in-doc]',
      '"""',
      'model_reasoning_effort = "high"',
    ].join('\n');
    expect(parseTomlModelPins(doc)).toEqual([]);
    expect(parseLegacyProfileTables(doc)).toEqual([]);
  });

  it('accepts allowlisted toml pins and pin-free tomls', async () => {
    const { auditRepoAgentSurfaces } = await loadDoctor();
    const { failures } = auditRepoAgentSurfaces({
      codexTomlFiles: [
        { path: 'ok.toml', text: `model = "${allowlist.codexModels[0]}"\n` },
        { path: 'nopin.toml', text: 'name = "y"\nmodel_reasoning_effort = "high"\n' },
      ],
      agentMdFiles: [],
      allowlist,
    });
    expect(failures).toEqual([]);
  });

  it('flags a bare model ID in agent-md frontmatter, accepts tier aliases', async () => {
    const { auditRepoAgentSurfaces } = await loadDoctor();
    const bare = auditRepoAgentSurfaces({
      codexTomlFiles: [],
      agentMdFiles: [{ path: 'bad.md', text: '---\nname: x\nmodel: claude-sonnet-4-6\n---\nbody' }],
      allowlist,
    });
    expect(bare.failures).toHaveLength(1);
    expect(bare.failures[0]).toContain('tier alias');
    const alias = auditRepoAgentSurfaces({
      codexTomlFiles: [],
      agentMdFiles: [
        { path: 'ok.md', text: '---\nname: x\nmodel: sonnet\n---\nbody' },
        { path: 'nopin.md', text: '---\nname: y\n---\nbody' },
      ],
      allowlist,
    });
    expect(alias.failures).toEqual([]);
  });

  it('frontmatter parsing survives trailing comments, quotes, and a UTF-8 BOM', async () => {
    const { parseAgentMdModelPin, auditRepoAgentSurfaces } = await loadDoctor();
    // A trailing YAML comment must not hide a bare-ID pin.
    expect(parseAgentMdModelPin('---\nmodel: claude-sonnet-4-6 # pinned for X\n---\nbody')).toBe(
      'claude-sonnet-4-6',
    );
    // A quoted tier alias is still a valid alias, not a failure.
    const quoted = auditRepoAgentSurfaces({
      codexTomlFiles: [],
      agentMdFiles: [{ path: 'q.md', text: '---\nmodel: "sonnet"\n---\nbody' }],
      allowlist,
    });
    expect(quoted.failures).toEqual([]);
    // A BOM'd file (the PS 5.1 Set-Content class) must still be parsed.
    expect(parseAgentMdModelPin('﻿---\nmodel: claude-sonnet-4-6\n---\nbody')).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('user-config audit fails known-bad pins and warns on legacy [profiles.*] tables', async () => {
    const { auditCodexUserConfig } = await loadDoctor();
    const text = [
      'model = "gpt-5.5"',
      '[profiles.spark-lane]',
      'model = "gpt-5.3-codex-spark"',
      '[profiles.other]',
      `model = "${allowlist.codexModels[0]}"`,
    ].join('\n');
    const { failures, warnings } = auditCodexUserConfig(text, allowlist);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('gpt-5.3-codex-spark');
    expect(warnings.some((w: string) => w.includes('legacy [profiles.*]'))).toBe(true);
  });

  it('user-config audit is clean on a pin-free modern config', async () => {
    const { auditCodexUserConfig } = await loadDoctor();
    const { failures, warnings } = auditCodexUserConfig('model = "gpt-5.5"\nmodel_reasoning_effort = "high"\n', allowlist);
    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
