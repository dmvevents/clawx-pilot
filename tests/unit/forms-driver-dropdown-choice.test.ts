// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { normalizeChoiceText, selectDropdownChoice } from '../../electron/services/forms-browser-v2/forms-driver';

vi.mock('../../electron/services/chrome-cdp', () => ({
  CHROME_CDP_ENDPOINT: 'http://127.0.0.1:18792',
  ensureChromeCdpReady: vi.fn(),
  verifyCdpEndpointOwnershipForAttach: vi.fn(async () => ({ allowed: true })),
}));

type FakeOptionList = { texts: string[]; clicked: number[] };

/**
 * Minimal Playwright-shaped fakes for ONE dropdown question item and the page
 * that hosts the portalled listbox. Only the selectors the driver actually
 * uses are modelled; everything else reports count 0.
 */
function fakeDropdown(opts: {
  optionTexts: string[];
  shownAfterClick?: (idx: number) => string;
  hasSelect?: boolean;
  selectResult?: string[];
  listboxOpens?: boolean;
  filteredTexts?: string[];
}) {
  const list: FakeOptionList = { texts: opts.optionTexts, clicked: [] };
  let shown = '';
  const pressed: string[] = [];
  let filled = '';
  const zero = { first: () => zero, count: async () => 0, click: vi.fn(), innerText: async () => '', inputValue: async () => '' };
  const options = () => ({
    allInnerTexts: async () => list.texts,
    nth: (i: number) => ({
      click: async () => {
        list.clicked.push(i);
        shown = opts.shownAfterClick ? opts.shownAfterClick(i) : list.texts[i];
      },
    }),
  });
  const listbox = {
    waitFor: async () => {
      if (opts.listboxOpens === false) throw new Error('not visible');
    },
    locator: (sel: string) => {
      if (sel === '[role="option"]') return options();
      return zero;
    },
  };
  const item = {
    locator: (sel: string) => {
      if (sel === 'select') {
        return opts.hasSelect
          ? { first: () => ({ count: async () => 1, selectOption: async () => opts.selectResult ?? [] }) }
          : { first: () => zero };
      }
      if (sel.startsWith('[role="combobox"], [aria-haspopup')) {
        return { first: () => ({ count: async () => 1, click: vi.fn(async () => undefined) }) };
      }
      if (sel.startsWith('input[role="combobox"]')) {
        return {
          first: () => ({
            count: async () => (opts.filteredTexts ? 1 : 0),
            fill: async (v: string) => {
              filled = v;
              list.texts = opts.filteredTexts ?? list.texts;
            },
          }),
        };
      }
      if (sel === '[role="combobox"]') {
        return { first: () => ({ count: async () => 1, innerText: async () => shown, inputValue: async () => '' }) };
      }
      return { first: () => zero };
    },
  };
  const page = {
    locator: (sel: string) => {
      if (sel === '[role="listbox"]:visible') return { last: () => listbox };
      return { last: () => zero, first: () => zero };
    },
    keyboard: { press: async (k: string) => { pressed.push(k); } },
    waitForTimeout: async () => undefined,
  };
  return { page, item, list, pressed: () => pressed, filled: () => filled };
}

const SCHOOLS = ['Guaico Government Primary', 'Sangre Grande Government Primary', 'Sangre Grande Hindu', 'Toco Anglican'];

describe('selectDropdownChoice (CLWX-62)', () => {
  it('picks the single exact option from an ARIA combobox and verifies the control echoes it', async () => {
    const f = fakeDropdown({ optionTexts: SCHOOLS });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r).toEqual({ ok: true, via: 'combobox' });
    expect(f.list.clicked).toEqual([1]);
    expect(f.pressed()).toEqual([]);
  });

  it('matches case- and whitespace-insensitively but never by substring', async () => {
    const f = fakeDropdown({ optionTexts: SCHOOLS });
    const ok = await selectDropdownChoice(f.page as never, f.item as never, '  sangre grande   hindu ', 1000);
    expect(ok.ok).toBe(true);
    const g = fakeDropdown({ optionTexts: SCHOOLS });
    const sub = await selectDropdownChoice(g.page as never, g.item as never, 'Sangre Grande', 1000);
    expect(sub.ok).toBe(false);
    expect(sub.reason).toMatch(/not found in dropdown/);
    expect(g.list.clicked).toEqual([]);
    expect(g.pressed()).toEqual(['Escape']);
  });

  it('refuses an ambiguous option (two exact matches) and closes the list without clicking', async () => {
    const f = fakeDropdown({ optionTexts: [...SCHOOLS, 'Toco Anglican'] });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Toco Anglican', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous/);
    expect(f.list.clicked).toEqual([]);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('types to filter a virtualized list when the option is not rendered, then selects', async () => {
    const f = fakeDropdown({ optionTexts: ['Arima Boys\' Government Primary', 'Arouca Government Primary'], filteredTexts: ['Sangre Grande Government Primary'] });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r.ok).toBe(true);
    expect(f.filled()).toBe('Sangre Grande Government Primary');
    expect(f.list.clicked).toEqual([0]);
  });

  it('reports an unconfirmed selection when the control does not echo the chosen option', async () => {
    const f = fakeDropdown({ optionTexts: SCHOOLS, shownAfterClick: () => 'Select your answer' });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Guaico Government Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not confirmed/);
  });

  it('reports a dropdown that never opens and restores state with Escape', async () => {
    const f = fakeDropdown({ optionTexts: SCHOOLS, listboxOpens: false });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Guaico Government Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not open/);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('uses a native <select> by exact label when present', async () => {
    const f = fakeDropdown({ optionTexts: [], hasSelect: true, selectResult: ['sg'] });
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r).toEqual({ ok: true, via: 'select' });
    const g = fakeDropdown({ optionTexts: [], hasSelect: true, selectResult: [] });
    const miss = await selectDropdownChoice(g.page as never, g.item as never, 'Nowhere Primary', 1000);
    expect(miss.ok).toBe(false);
  });

  it('normalizes NBSP, whitespace and case', () => {
    expect(normalizeChoiceText('  Sangre Grande   Government Primary ')).toBe('sangre grande government primary');
  });
});
