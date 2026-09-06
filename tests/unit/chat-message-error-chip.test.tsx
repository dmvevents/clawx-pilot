/**
 * CLWX-105 guards: the in-line error chip on error-stopped assistant
 * messages (src/pages/Chat/ChatMessage.tsx).
 *
 * The gap this closes (found independently by the CLWX-104 Codex + Claude
 * review lanes): an error-stopped assistant message with EMPTY content
 * rendered NOTHING — after the D0 fix removed the stale global banner
 * repaint, a historical failure had no surface at all on session re-open.
 * The chip is that surface: anonymised principal wording first, raw string
 * only behind the collapsed expander (the banner's rules).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import type { RawMessage } from '@/stores/chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Render the KEY so assertions pin which wording class was chosen.
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

function assistantMessage(overrides: Record<string, unknown> = {}): RawMessage {
  return {
    role: 'assistant',
    content: '',
    timestamp: 1_757_000_000_000,
    ...overrides,
  } as unknown as RawMessage;
}

describe('CLWX-105 in-line error chip', () => {
  it('renders the chip for an error-stopped assistant message with EMPTY content (the re-open gap)', () => {
    render(<ChatMessage message={assistantMessage({ stopReason: 'error', errorMessage: 'Connection error.' })} />);
    const chip = screen.getByTestId('chat-message-error-chip');
    expect(chip).toBeTruthy();
    // Anonymised class wording, not the raw string, is the visible line.
    expect(chip.textContent).toContain('errorDisplay.');
  });

  it('accepts the snake_case field variants the gateway history emits', () => {
    render(<ChatMessage message={assistantMessage({ stop_reason: 'error', error_message: 'HTTP 429 too many requests' })} />);
    expect(screen.getByTestId('chat-message-error-chip')).toBeTruthy();
  });

  it('classifies through principalErrorDisplay — a rate-limit raw string gets the rate-limited wording', () => {
    render(<ChatMessage message={assistantMessage({ stopReason: 'error', errorMessage: 'HTTP 429: rate limit exceeded' })} />);
    const chip = screen.getByTestId('chat-message-error-chip');
    expect(chip.textContent).toContain('errorDisplay.rateLimited');
  });

  it('keeps the raw detail behind the collapsed expander — never inline (trust rule)', () => {
    const raw = 'HTTP 429: rate limit exceeded';
    render(<ChatMessage message={assistantMessage({ stopReason: 'error', errorMessage: raw })} />);
    const chip = screen.getByTestId('chat-message-error-chip');
    const details = chip.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false); // collapsed by default
    expect(details!.textContent).toContain('errorDisplay.detailsLabel');
    // The raw string lives INSIDE the expander only.
    const visibleLine = chip.querySelector('p');
    expect(visibleLine!.textContent).not.toContain(raw);
  });

  it('renders the chip BELOW the text when the failed message still carried partial content', () => {
    render(<ChatMessage message={assistantMessage({ content: 'I started to answer but', stopReason: 'error', errorMessage: 'Connection error.' })} />);
    expect(screen.getByTestId('chat-message-error-chip')).toBeTruthy();
    expect(screen.getByText(/I started to answer but/)).toBeTruthy();
  });

  it('renders NOTHING extra for a normal empty assistant message (no error stop) — the null path is unchanged', () => {
    const { container } = render(<ChatMessage message={assistantMessage()} />);
    expect(container.querySelector('[data-testid="chat-message-error-chip"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('never renders the chip on user messages, even with error-shaped fields', () => {
    render(<ChatMessage message={assistantMessage({ role: 'user', content: 'hello', stopReason: 'error', errorMessage: 'x' })} />);
    expect(screen.queryByTestId('chat-message-error-chip')).toBeNull();
  });

  it('never leaks model IDs, providers, or cost into the visible line (anonymisation hard rule)', () => {
    render(<ChatMessage message={assistantMessage({ stopReason: 'error', errorMessage: 'model gemini-2.5-pro failed via google provider, cost $0.0023' })} />);
    const visibleLine = screen.getByTestId('chat-message-error-chip').querySelector('p');
    expect(visibleLine!.textContent).not.toMatch(/gemini|google|\$0\.0023/);
    expect(visibleLine!.textContent).toContain('errorDisplay.');
  });
});
