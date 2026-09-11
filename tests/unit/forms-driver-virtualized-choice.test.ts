// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { selectVirtualizedRadioChoice } from '../../electron/services/forms-browser-v2/forms-driver';

vi.mock('../../electron/services/chrome-cdp', () => ({
  CHROME_CDP_ENDPOINT: 'http://127.0.0.1:18792',
  ensureChromeCdpReady: vi.fn(),
  verifyCdpEndpointOwnershipForAttach: vi.fn(async () => ({ allowed: true })),
}));

/**
 * CLWX-62, measured live on the production Daily Report (installed moe.36,
 * 2026-09-11): "Name of school" has 454 options but renders ~80 radios at a
 * time, each in a <label> whose text is the school name, aria-label EMPTY, no
 * combobox / select / listbox, no scroll container inside the question item —
 * the rendered window changes as the PAGE scrolls. The target option was not in
 * the DOM at all when filling started, which is why both original tiers failed.
 *
 * The fake models exactly that: a window of labels that shifts with scrollY.
 */
function fakeVirtualizedQuestion(opts: {
  options: string[];
  windowSize?: number;
  pxPerOption?: number;
  questionTop?: number;
  questionHeight?: number;
  checkedAfterClick?: boolean | null;
  duplicateTarget?: string;
}) {
  const windowSize = opts.windowSize ?? 80;
  const pxPerOption = opts.pxPerOption ?? 50;
  let scrollY = 0;
  const clicked: string[] = [];
  const scrolls: number[] = [];
  const visibleOptions = () => {
    const start = Math.max(0, Math.min(opts.options.length - windowSize, Math.floor(scrollY / pxPerOption)));
    const window = opts.options.slice(start, start + windowSize);
    if (opts.duplicateTarget && window.includes(opts.duplicateTarget)) window.push(opts.duplicateTarget);
    return window;
  };
  const labelLocator = (matcher?: RegExp) => ({
    count: async () => (matcher ? visibleOptions().filter((t) => matcher.test(t)).length : visibleOptions().length),
    filter: ({ hasText }: { hasText: RegExp }) => labelLocator(hasText),
    first: () => ({
      click: async () => {
        const hit = visibleOptions().find((t) => matcher!.test(t));
        clicked.push(hit ?? '<none>');
      },
      evaluate: async () => (opts.checkedAfterClick === undefined ? true : opts.checkedAfterClick),
    }),
  });
  const item = {
    locator: (sel: string) => {
      if (sel === 'label') return labelLocator();
      if (sel.includes('radio')) return { count: async () => visibleOptions().length };
      return { count: async () => 0 };
    },
    boundingBox: async () => ({ x: 0, y: opts.questionTop ?? 100, width: 600, height: opts.questionHeight ?? opts.options.length * pxPerOption }),
  };
  const page = {
    evaluate: async (fn: unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.includes('window.scrollY')) return scrollY;
      if (src.includes('window.innerHeight')) return 800;
      if (src.includes('scrollTo')) {
        scrollY = Number(arg ?? 0);
        scrolls.push(scrollY);
        return undefined;
      }
      return undefined;
    },
    waitForTimeout: async () => undefined,
  };
  return { page, item, clicked: () => clicked, scrolls: () => scrolls, finalScroll: () => scrollY };
}

const SCHOOLS = Array.from({ length: 454 }, (_, i) => `School ${String(i).padStart(3, '0')} Government Primary`);
const TARGET_FAR_DOWN = SCHOOLS[400];

describe('selectVirtualizedRadioChoice (CLWX-62, live-measured shape)', () => {
  it('clicks an option that is already in the rendered window without scrolling', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[10], 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([SCHOOLS[10]]);
  });

  it('scrolls the page until a far-down option renders, then clicks it and restores the scroll position', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, TARGET_FAR_DOWN, 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([TARGET_FAR_DOWN]);
    expect(f.scrolls().length).toBeGreaterThan(1);
    expect(f.finalScroll()).toBe(0); // original position restored
  });

  it('reports how far it looked when the option does not exist at all', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, 'Nowhere Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found in the virtualized choice list after \d+ scroll passes/);
    expect(r.reason).toMatch(/options rendered per window/);
    expect(f.clicked()).toEqual([]);
    expect(f.finalScroll()).toBe(0);
  });

  it('refuses an exactly duplicated option rather than guessing', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, duplicateTarget: SCHOOLS[5] });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[5], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous option \(2 labels match exactly\)/);
    expect(f.clicked()).toEqual([]);
  });

  it('reports a click the control does not confirm as selected', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, checkedAfterClick: false });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not report it selected/);
  });

  it('accepts a control that cannot report its state (null) rather than failing a real selection', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, checkedAfterClick: null });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(true);
  });

  it('refuses an empty target', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    expect((await selectVirtualizedRadioChoice(f.page as never, f.item as never, '   ', 1000)).ok).toBe(false);
  });
});
