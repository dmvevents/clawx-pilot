import { describe, expect, it } from 'vitest';
import { extractText, extractTextSegments } from '@/pages/Chat/message-utils';

describe('chat message utils', () => {
  it('strips provider final wrappers from assistant display text', () => {
    expect(extractText({
      role: 'assistant',
      content: [{ type: 'text', text: '<final>The outlook.open tool succeeded.</final>' }],
    })).toBe('The outlook.open tool succeeded.');
  });

  it('strips square-bracket final wrappers from assistant display text', () => {
    expect(extractText({
      role: 'assistant',
      content: '[final]Done.[/final]',
    })).toBe('Done.');
  });

  it('keeps embedded final text that is not a wrapper', () => {
    expect(extractText({
      role: 'assistant',
      content: 'The final report is ready.',
    })).toBe('The final report is ready.');
  });

  it('strips final wrappers from execution graph text segments', () => {
    expect(extractTextSegments({
      role: 'assistant',
      content: [{ type: 'text', text: '<final>Opened Outlook.</final>' }],
    })).toEqual(['Opened Outlook.']);
  });

  it('hides closed provider thinking blocks before assistant display text', () => {
    expect(extractText({
      role: 'assistant',
      content: '<think>internal notes</think><final>Visible answer.</final>',
    })).toBe('Visible answer.');
  });

  it('hides unclosed provider thinking output instead of leaking it', () => {
    expect(extractText({
      role: 'assistant',
      content: '<think>internal notes without a closing tag',
    })).toBe('');
  });

  it('recovers final content from an unclosed thinking wrapper when a final block is present', () => {
    expect(extractText({
      role: 'assistant',
      content: '<think>internal notes <final>Visible answer.</final>',
    })).toBe('Visible answer.');
  });
});
