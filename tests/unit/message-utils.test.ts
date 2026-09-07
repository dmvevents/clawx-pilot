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

  it('hides mid-text thinking blocks, not only leading ones', () => {
    expect(extractText({
      role: 'assistant',
      content: 'Deferral noted.<think>the user wants 3:40pm tomorrow</think> I will remind you at 3:40pm tomorrow.',
    })).toBe('Deferral noted.\nI will remind you at 3:40pm tomorrow.');
  });

  it('truncates an unclosed mid-text thinking block but keeps the text before it', () => {
    expect(extractText({
      role: 'assistant',
      content: 'Reminder acknowledged. <think>internal trailing notes without a close',
    })).toBe('Reminder acknowledged.');
  });

  it('collapses a cron-run user turn to its headline, hiding job id, instructions, and clock header', () => {
    expect(extractText({
      role: 'user',
      content: '[cron:d04cb6c2-c80d-4461-9deb-526d4fb98416 CLWX-67 reminder e2e 08:35] Reminder: 3:45pm — submit today\'s Daily Report.\n\nDeliver this reminder to the principal in one short message: the Primary\nSchool Daily Report is due by 3:45pm today. Ask whether they want to\nproceed now or defer.\nCurrent time: Saturday, September 5th, 2026 - 2:07 PM (Asia/Calcutta) / 2026-09-05 08:37 UTC',
    })).toBe('Reminder: 3:45pm — submit today\'s Daily Report.');
  });

  it('keeps the full message for a single-paragraph cron job', () => {
    expect(extractText({
      role: 'user',
      content: '[cron:5f1e2d3c-0a9b-4c8d-8e7f-1a2b3c4d5e6f Morning summary] Summarise my inbox every morning.\nCurrent time: Monday, September 7th, 2026 - 8:00 AM (America/Port_of_Spain) / 2026-09-07 12:00 UTC',
    })).toBe('Summarise my inbox every morning.');
  });

  it('falls back to the job name when a cron turn has no headline', () => {
    expect(extractText({
      role: 'user',
      content: '[cron:5f1e2d3c-0a9b-4c8d-8e7f-1a2b3c4d5e6f Daily Report reminder]',
    })).toBe('Daily Report reminder');
  });

  it('leaves ordinary user text mentioning cron or a current time untouched', () => {
    const text = 'What does the Current time: header in cron logs mean?';
    expect(extractText({ role: 'user', content: text })).toBe(text);
  });
});
