// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('GA E2E regression process contracts', () => {
  it('keeps Codex, OMX, and Claude skill bodies aligned', () => {
    const officialCodexSkill = read('.agents/skills/ga-e2e-regression/SKILL.md');
    const omxCodexSkill = read('.codex/skills/ga-e2e-regression/SKILL.md');
    const claudeSkill = read('.claude/skills/ga-e2e-regression/SKILL.md');

    expect(officialCodexSkill).toBe(omxCodexSkill);
    expect(officialCodexSkill).toBe(claudeSkill);
    expect(officialCodexSkill).toContain('Outlook summarized Sent Items instead of Inbox');
    expect(officialCodexSkill).toContain('Reply archived the source message');
    expect(officialCodexSkill).toContain('Draft body landed in `To:`');
    expect(officialCodexSkill).toContain('ASR reported `ffmpeg-not-found` or low quality');
    expect(officialCodexSkill).toContain('Do not send email, reply, forward, download attachments, or submit Forms');
    expect(officialCodexSkill).not.toContain('[TODO');
  });

  it('keeps Windows VM smoke skills aligned across agent surfaces', () => {
    const officialCodexSkill = read('.agents/skills/windows-vm-smoke/SKILL.md');
    const omxCodexSkill = read('.codex/skills/windows-vm-smoke/SKILL.md');
    const claudeSkill = read('.claude/skills/windows-vm-smoke/SKILL.md');

    expect(officialCodexSkill).toBe(omxCodexSkill);
    expect(officialCodexSkill).toBe(claudeSkill);
    expect(officialCodexSkill).toContain('Installer SHA256 matches');
    expect(officialCodexSkill).toContain('Electron CDP probe');
    expect(officialCodexSkill).toContain('key hashes');
    expect(officialCodexSkill).not.toContain('[TODO');
  });

  it('exposes matching verifier agents with no-send/no-submit and no-secret boundaries', () => {
    const codexAgent = read('.codex/agents/ga-e2e-regression-verifier.toml');
    const claudeAgent = read('.claude/agents/ga-e2e-regression-verifier.md');
    const combined = `${codexAgent}\n${claudeAgent}`;

    expect(codexAgent).toContain('.agents/skills/ga-e2e-regression/SKILL.md');
    expect(claudeAgent).toContain('.claude/skills/ga-e2e-regression/SKILL.md');
    expect(combined).toMatch(/Do not send email/i);
    expect(combined).toMatch(/submit Forms/i);
    expect(combined).toMatch(/key-file hashes/i);
    expect(combined).toMatch(/private Forms URLs/i);
    expect(combined).toContain('Gateway/model coherence');
  });

  it('registers the process in cross-agent startup and interoperability docs', () => {
    const agents = read('AGENTS.md');
    const claude = read('CLAUDE.md');
    const interoperability = read('docs/AGENT_SKILL_INTEROPERABILITY.md');
    const gaPlan = read('docs/GA_RELEASE_PLAN_2026-06-09.md');

    for (const content of [agents, claude, interoperability, gaPlan]) {
      expect(content).toContain('ga-e2e-regression');
      expect(content).toContain('windows-vm-smoke');
    }

    expect(interoperability).toContain('.codex/agents/ga-e2e-regression-verifier.toml');
    expect(interoperability).toContain('.claude/agents/ga-e2e-regression-verifier.md');
    expect(gaPlan).toContain('E2E regression matrix');
  });

  it('keeps reviewed-draft send documentation aligned with the confirm-only path', () => {
    const product = read('docs/PRODUCT_PRINCIPAL_ASSISTANT.md');
    const outlook = read('docs/AGENT_OUTLOOK.md');
    const plugin = read('extensions/moe-principal-assistant/index.mjs');

    for (const content of [product, outlook, plugin]) {
      expect(content).toMatch(/confirm: true/i);
      expect(content).toMatch(/reviewed draft/i);
    }

    expect(product).toContain('Optional recipient/subject/body arguments are safety assertions');
    expect(outlook).toContain('Normal reviewed sends after principal review should call `{ confirm: true }`');
    expect(`${product}\n${outlook}`).not.toContain('AND the open compose pane');
  });
});
