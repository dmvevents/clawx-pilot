import { describe, it, expect } from 'vitest';
import {
  classifyProvider,
  pickAccountForChannel,
  publicLabel,
  publicStatusDot,
} from '@/lib/provider-display';

describe('classifyProvider', () => {
  it('treats known cloud vendor IDs as online', () => {
    for (const vendorId of [
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'ark',
      'moonshot',
      'siliconflow',
      'deepseek',
      'minimax-portal',
      'modelstudio',
    ]) {
      expect(classifyProvider({ vendorId })).toBe('online');
    }
  });

  it('treats ollama as on-device regardless of baseUrl', () => {
    expect(classifyProvider({ vendorId: 'ollama' })).toBe('on-device');
    expect(
      classifyProvider({ vendorId: 'ollama', baseUrl: 'https://example.com' }),
    ).toBe('on-device');
  });

  it('treats localhost / 127.0.0.1 baseUrls as on-device for any vendor', () => {
    expect(
      classifyProvider({ vendorId: 'custom', baseUrl: 'http://127.0.0.1:11434' }),
    ).toBe('on-device');
    expect(
      classifyProvider({ vendorId: 'custom', baseUrl: 'http://localhost:8000/v1' }),
    ).toBe('on-device');
    expect(
      classifyProvider({ vendorId: 'openai', baseUrl: 'http://127.0.0.1:8080' }),
    ).toBe('on-device');
  });

  it('treats custom vendor with non-localhost baseUrl as online', () => {
    expect(
      classifyProvider({ vendorId: 'custom', baseUrl: 'https://api.example.com/v1' }),
    ).toBe('online');
  });

  it('falls back to online for unknown vendor with no baseUrl', () => {
    expect(classifyProvider({ vendorId: 'mystery' })).toBe('online');
    expect(classifyProvider({})).toBe('online');
    expect(classifyProvider(null)).toBe('online');
    expect(classifyProvider(undefined)).toBe('online');
  });

  it('is case-insensitive on vendorId', () => {
    expect(classifyProvider({ vendorId: 'OLLAMA' })).toBe('on-device');
    expect(classifyProvider({ vendorId: 'OpenAI' })).toBe('online');
  });
});

describe('publicLabel', () => {
  it('returns "Online" for online class', () => {
    expect(publicLabel('online')).toBe('Online');
  });

  it('returns "On this device" for on-device class', () => {
    expect(publicLabel('on-device')).toBe('On this device');
  });
});

describe('pickAccountForChannel', () => {
  const local = { vendorId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', isDefault: true, enabled: true } as const;
  const cloudA = { vendorId: 'anthropic', isDefault: false, enabled: true } as const;
  const cloudB = { vendorId: 'openai', isDefault: true, enabled: true } as const;
  const cloudDisabled = { vendorId: 'anthropic', isDefault: false, enabled: false } as const;

  it('returns null when no account exists in the channel', () => {
    expect(pickAccountForChannel([local], 'online')).toBeNull();
    expect(pickAccountForChannel([cloudA], 'on-device')).toBeNull();
    expect(pickAccountForChannel([], 'online')).toBeNull();
  });

  it('prefers the default account when one exists in the channel', () => {
    expect(pickAccountForChannel([cloudA, cloudB], 'online')).toBe(cloudB);
  });

  it('falls back to the first enabled account when none is default', () => {
    expect(pickAccountForChannel([cloudDisabled, cloudA], 'online')).toBe(cloudA);
  });

  it('returns the only on-device account when one is configured', () => {
    expect(pickAccountForChannel([cloudA, local], 'on-device')).toBe(local);
  });
});

describe('publicStatusDot', () => {
  it('returns a red dot when offline regardless of class', () => {
    expect(publicStatusDot('online', false)).toBe('bg-red-500');
    expect(publicStatusDot('on-device', false)).toBe('bg-red-500');
  });

  it('returns an emerald dot for healthy online providers', () => {
    expect(publicStatusDot('online', true)).toBe('bg-emerald-500');
  });

  it('returns a neutral dot for healthy on-device providers', () => {
    expect(publicStatusDot('on-device', true)).toBe('bg-zinc-400');
  });
});
