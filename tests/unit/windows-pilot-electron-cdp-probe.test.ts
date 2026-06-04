// @vitest-environment node
import { describe, expect, it } from 'vitest';

const {
  summarizeChatHistory,
} = require('../../windows-pilot/scripts/pilot-electron-cdp-probe.js') as {
  summarizeChatHistory: (result: unknown, mode: string, verificationToken: string) => {
    scopedToCurrentPrompt: boolean;
    completed: boolean;
    finalAnswerEchoedMarker: boolean;
    expectedToolResultOk: boolean;
    expectedToolOnly: boolean;
    noBannedSideEffects: boolean;
    observedToolCalls: Array<{ name: string }>;
    observedToolResults: Array<{ name: string; isError: boolean }>;
  };
};

function textMessage(role: string, text: string) {
  return {
    role,
    content: [{ type: 'text', text }],
  };
}

function toolCallMessage(name: string, id = `${name}-1`) {
  return {
    role: 'assistant',
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', name, id }],
  };
}

function toolResultMessage(name: string, isError = false, id = `${name}-1`) {
  return {
    role: 'toolResult',
    toolName: name,
    toolCallId: id,
    isError,
    content: [{ type: 'text', text: '{"status":"ok"}' }],
  };
}

function finalMessage(token: string) {
  return {
    role: 'assistant',
    stopReason: 'stop',
    content: [{ type: 'text', text: `Done. Verification token: ${token}` }],
  };
}

function history(messages: unknown[]) {
  return {
    success: true,
    result: { messages },
  };
}

describe('Windows Electron CDP probe transcript evaluator', () => {
  it('scopes to the current verification token after a long history', () => {
    const token = 'pilot-safe-chat-token';
    const olderMessages = Array.from({ length: 75 }, (_item, index) => textMessage('assistant', `older ${index}`));
    const summary = summarizeChatHistory(history([
      ...olderMessages,
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('forms.list'),
      toolResultMessage('forms.list'),
      finalMessage(token),
    ]), 'forms-list', token);

    expect(summary.scopedToCurrentPrompt).toBe(true);
    expect(summary.completed).toBe(true);
    expect(summary.finalAnswerEchoedMarker).toBe(true);
    expect(summary.expectedToolResultOk).toBe(true);
    expect(summary.expectedToolOnly).toBe(true);
  });

  it('flags extra tool calls in exact-tool safe chat modes', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.open'),
      toolResultMessage('outlook.open'),
      toolCallMessage('outlook.read_inbox'),
      toolResultMessage('outlook.read_inbox'),
      finalMessage(token),
    ]), 'outlook-open', token);

    expect(summary.expectedToolResultOk).toBe(true);
    expect(summary.expectedToolOnly).toBe(false);
    expect(summary.observedToolCalls.map((tool) => tool.name)).toContain('outlook.read_inbox');
  });

  it('flags banned side-effect tools even when the final token is echoed', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('outlook.send_email'),
      toolResultMessage('outlook.send_email'),
      finalMessage(token),
    ]), 'custom', token);

    expect(summary.completed).toBe(true);
    expect(summary.finalAnswerEchoedMarker).toBe(true);
    expect(summary.noBannedSideEffects).toBe(false);
  });

  it('requires the expected tool result to be non-error', () => {
    const token = 'pilot-safe-chat-token';
    const summary = summarizeChatHistory(history([
      textMessage('user', `Verification token: ${token}`),
      toolCallMessage('forms.list'),
      toolResultMessage('forms.list', true),
      finalMessage(token),
    ]), 'forms-list', token);

    expect(summary.expectedToolResultOk).toBe(false);
    expect(summary.observedToolResults).toEqual([
      expect.objectContaining({ name: 'forms.list', isError: true }),
    ]);
  });
});
