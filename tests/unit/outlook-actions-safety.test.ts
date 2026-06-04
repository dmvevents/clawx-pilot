// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { OutlookActions } from '@electron/services/outlook-browser-v2/outlook-actions';

type OpenDraftSnapshot = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  searchableText: string;
};

type TestActions = OutlookActions & {
  looksLikeSignin: () => Promise<boolean>;
  readOpenDraftSnapshot: () => Promise<OpenDraftSnapshot | null>;
  clickSendInVerifiedDraft: () => Promise<boolean>;
  clickByRoleOrVlm: () => Promise<void>;
};

const matchingDraft: OpenDraftSnapshot = {
  to: ['recipient@example.invalid'],
  cc: [],
  bcc: [],
  subject: 'Demo subject',
  body: 'Body is not logged by this test.',
  searchableText: 'recipient@example.invalid Demo subject Body is not logged by this test.',
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
  actions.readOpenDraftSnapshot = vi.fn(async () => matchingDraft);
  actions.clickSendInVerifiedDraft = vi.fn(async () => true);
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
    actions.readOpenDraftSnapshot = vi.fn(async () => null);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/No open draft/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft subject differs', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      subject: 'Different subject',
      searchableText: 'recipient@example.invalid Different subject Body is not logged by this test.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/subject does not match/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft recipients differ', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      to: ['other@example.invalid'],
      searchableText: 'other@example.invalid Demo subject Body is not logged by this test.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/To recipients/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when open draft body differs', async () => {
    const { actions } = createActions();
    actions.readOpenDraftSnapshot = vi.fn(async () => ({
      ...matchingDraft,
      body: 'Different body.',
      searchableText: 'recipient@example.invalid Demo subject Different body.',
    }));

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/body does not match/i);
    expect(actions.clickSendInVerifiedDraft).not.toHaveBeenCalled();
  });

  it('refuses confirmed send when the matching draft send button is not found', async () => {
    const { actions } = createActions();
    actions.clickSendInVerifiedDraft = vi.fn(async () => false);

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: 'Demo subject',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result.reason).toMatch(/Send button inside the verified open draft/i);
  });

  it('sends confirmed mail only when the verified open draft matches', async () => {
    const { actions } = createActions();

    const result = await actions.sendEmail({
      to: 'recipient@example.invalid',
      subject: ' Demo subject ',
      body: 'Body is not logged by this test.',
      confirm: true,
    });

    expect(result).toEqual({ status: 'sent', message: 'Email sent via Outlook Web.' });
    expect(actions.clickSendInVerifiedDraft).toHaveBeenCalledTimes(1);
    expect(actions.clickByRoleOrVlm).not.toHaveBeenCalled();
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
