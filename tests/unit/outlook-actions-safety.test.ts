// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  readOpenSubject: () => Promise<string | null>;
  clickByRoleOrVlm: () => Promise<void>;
};

function createActions() {
  const driver = {
    ensureOutlookTab: vi.fn(async () => ({ url: () => 'https://outlook.office.com/mail/inbox' })),
    screenshotViewport: vi.fn(async () => ({ png: Buffer.alloc(0), width: 1, height: 1 })),
    clickAt: vi.fn(),
  };
  const grounder = {
    ground: vi.fn(),
  };
  const actions = new OutlookActions(driver as never, grounder as never) as TestActions;
  actions.looksLikeSignin = vi.fn(async () => false);
  actions.readOpenSubject = vi.fn(async () => 'Demo subject');
  actions.clickByRoleOrVlm = vi.fn(async () => undefined);
  return { actions, driver, grounder };
}

describe('OutlookActions safety gates', () => {
  it('refuses send without confirm before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: false,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/confirm/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when no draft subject is open', async () => {
    const { actions } = createActions();
    actions.readOpenSubject = vi.fn(async () => null);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/No open draft/i);
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft subject differs', async () => {
    const { actions } = createActions();
    actions.readOpenSubject = vi.fn(async () => 'Different subject');

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/subject does not match/i);
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
  });

  it('sends confirmed mail only when the open draft subject matches', async () => {
    const { actions } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: ' Demo subject ',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickByRoleOrVlm).toHaveBeenCalledTimes(1);
  });

  it('refuses attachment download without confirm before touching Outlook', async () => {
    const { actions, driver } = createActions();

    const result = await actions.downloadAttachment({
      id: 'message-1',
      filename: 'report.pdf',
      confirm: false,
    });

    expect(result).toMatchObject({ status: 'refused', filename: 'report.pdf' });
    expect(result.reason).toMatch(/confirm/i);
    expect(driver.ensureOutlookTab).not.toHaveBeenCalled();
  });
});
