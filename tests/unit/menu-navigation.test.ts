import { beforeEach, describe, expect, it, vi } from 'vitest';

// CLWX-51: menu items must navigate to routes the renderer actually defines.
// Chat lives at '/', not '/chat'; sending '/chat' left the window blank.

const { sendMock, buildFromTemplateMock, setApplicationMenuMock, openExternalMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  buildFromTemplateMock: vi.fn((template: unknown) => template),
  setApplicationMenuMock: vi.fn(),
  openExternalMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (...args: unknown[]) => buildFromTemplateMock(...args),
    setApplicationMenu: (...args: unknown[]) => setApplicationMenuMock(...args),
  },
  app: { name: 'Ministry of Education' },
  shell: { openExternal: (...args: unknown[]) => openExternalMock(...args) },
  BrowserWindow: {
    getFocusedWindow: () => ({ webContents: { send: sendMock } }),
  },
}));

type MenuItem = {
  label?: string;
  role?: string;
  submenu?: MenuItem[];
  click?: () => void | Promise<void>;
};

function flattenItems(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const item of items) {
    out.push(item);
    if (Array.isArray(item.submenu)) {
      out.push(...flattenItems(item.submenu));
    }
  }
  return out;
}

async function buildMenuItems(): Promise<MenuItem[]> {
  const { createMenu } = await import('@electron/main/menu');
  createMenu();
  const template = buildFromTemplateMock.mock.calls.at(-1)?.[0] as MenuItem[];
  return flattenItems(template);
}

function navigateTargetsFrom(item: MenuItem): string[] {
  sendMock.mockClear();
  item.click?.();
  return sendMock.mock.calls
    .filter(([channel]) => channel === 'navigate')
    .map(([, path]) => path as string);
}

describe('application menu navigation targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes "New Chat" to the chat home at "/"', async () => {
    const items = await buildMenuItems();
    const newChat = items.find((item) => item.label === 'New Chat');

    expect(newChat).toBeDefined();
    expect(navigateTargetsFrom(newChat!)).toEqual(['/']);
  });

  it('routes the "Chat" navigate item to "/"', async () => {
    const items = await buildMenuItems();
    const chat = items.find((item) => item.label === 'Chat');

    expect(chat).toBeDefined();
    expect(navigateTargetsFrom(chat!)).toEqual(['/']);
  });

  it('never navigates to the non-existent "/chat" route', async () => {
    const items = await buildMenuItems();

    for (const item of items) {
      if (typeof item.click === 'function') {
        expect(navigateTargetsFrom(item)).not.toContain('/chat');
      }
    }
  });
});
