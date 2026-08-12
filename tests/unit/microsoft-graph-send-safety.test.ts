// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphCalls } from '../../electron/services/microsoft-graph/manager';
import { sendEmailWithGraph } from '../../electron/services/microsoft-graph/outlook-adapter';

vi.mock('../../electron/services/microsoft-graph/manager', () => ({
  graphCalls: {
    sendMail: vi.fn(),
  },
}));

const mockGraphCalls = vi.mocked(graphCalls);

describe('Microsoft Graph send safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses confirm-only send because Graph cannot verify a reviewed Outlook draft', async () => {
    const result = await sendEmailWithGraph({ confirm: true });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/visible reviewed Outlook draft/i);
    expect(mockGraphCalls.sendMail).not.toHaveBeenCalled();
  });

  it('refuses confirmed send with a blank body before calling Graph', async () => {
    const result = await sendEmailWithGraph({
      to: 'teacher@example.edu',
      subject: 'Follow up',
      body: '   ',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(mockGraphCalls.sendMail).not.toHaveBeenCalled();
  });
});
