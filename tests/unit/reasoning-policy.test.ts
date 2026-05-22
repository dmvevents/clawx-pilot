import { describe, expect, it } from 'vitest';
import {
  resolveReasoningVisibility,
  visibilityToThinkingLevel,
} from '@electron/services/llm-router/reasoning-policy';

describe('visibilityToThinkingLevel', () => {
  it('maps hidden to off', () => {
    expect(visibilityToThinkingLevel('hidden')).toBe('off');
  });

  it('maps condensed to medium', () => {
    expect(visibilityToThinkingLevel('condensed')).toBe('medium');
  });

  it('maps expanded to high', () => {
    expect(visibilityToThinkingLevel('expanded')).toBe('high');
  });
});

describe('resolveReasoningVisibility', () => {
  it('falls back to global default when nothing else is set', () => {
    expect(
      resolveReasoningVisibility({ globalDefault: 'condensed' }),
    ).toBe('condensed');
  });

  it('respects per-user setting over the global default', () => {
    expect(
      resolveReasoningVisibility({
        perUser: 'expanded',
        globalDefault: 'condensed',
      }),
    ).toBe('expanded');
  });

  it("treats per-user 'auto' as defer-to-default", () => {
    expect(
      resolveReasoningVisibility({
        perUser: 'auto',
        globalDefault: 'hidden',
      }),
    ).toBe('hidden');
  });

  it('per-session legacy thinking level overrides per-user', () => {
    expect(
      resolveReasoningVisibility({
        perSession: 'off',
        perUser: 'expanded',
        globalDefault: 'condensed',
      }),
    ).toBe('hidden');
  });

  it('per-session "low" maps to condensed', () => {
    expect(
      resolveReasoningVisibility({
        perSession: 'low',
        globalDefault: 'expanded',
      }),
    ).toBe('condensed');
  });

  it('per-session "high" maps to expanded', () => {
    expect(
      resolveReasoningVisibility({
        perSession: 'high',
        globalDefault: 'hidden',
      }),
    ).toBe('expanded');
  });

  it('per-message override wins over everything else', () => {
    expect(
      resolveReasoningVisibility({
        perMessage: 'hidden',
        perSession: 'high',
        perUser: 'expanded',
        globalDefault: 'condensed',
      }),
    ).toBe('hidden');
  });

  it('ignores unrecognised per-session strings', () => {
    expect(
      resolveReasoningVisibility({
        perSession: 'gibberish',
        perUser: 'expanded',
        globalDefault: 'condensed',
      }),
    ).toBe('expanded');
  });

  it('ignores empty / null per-session strings', () => {
    expect(
      resolveReasoningVisibility({
        perSession: '',
        globalDefault: 'condensed',
      }),
    ).toBe('condensed');
    expect(
      resolveReasoningVisibility({
        perSession: null,
        globalDefault: 'expanded',
      }),
    ).toBe('expanded');
  });

  it('round-trips visibility → thinking level for each canonical state', () => {
    const cases: Array<['hidden' | 'condensed' | 'expanded', 'off' | 'medium' | 'high']> = [
      ['hidden', 'off'],
      ['condensed', 'medium'],
      ['expanded', 'high'],
    ];
    for (const [vis, level] of cases) {
      const resolved = resolveReasoningVisibility({ globalDefault: vis });
      expect(visibilityToThinkingLevel(resolved)).toBe(level);
    }
  });
});
