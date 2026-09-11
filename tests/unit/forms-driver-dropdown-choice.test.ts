// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  cssAttrValue,
  normalizeChoiceText,
  selectDropdownChoice,
  valueEchoesTarget,
} from '../../electron/services/forms-browser-v2/forms-driver';

vi.mock('../../electron/services/chrome-cdp', () => ({
  CHROME_CDP_ENDPOINT: 'http://127.0.0.1:18792',
  ensureChromeCdpReady: vi.fn(),
  verifyCdpEndpointOwnershipForAttach: vi.fn(async () => ({ allowed: true })),
}));

const SCHOOLS = ['Guaico Government Primary', 'Sangre Grande Government Primary', 'Sangre Grande Hindu', 'Toco Anglican'];

type Options = { texts: string[]; wanted?: string };

/**
 * Playwright-shaped fakes for ONE dropdown question item plus the page that
 * hosts the (portalled) listbox. Models only the selectors the driver uses:
 * everything else reports count 0. `listboxes` lets a control open more than
 * one visible listbox so the ambiguity guards can be exercised.
 */
function fakeDropdown(opts: {
  optionTexts: string[];
  filteredTexts?: string[];
  shownAfterClick?: (text: string) => string;
  hasSelect?: boolean;
  selectResult?: string[];
  listboxOpens?: boolean;
  ariaControls?: string | null;
  popupIdCount?: number;
  visibleListboxCount?: number;
  listboxInItemCount?: number;
  hasFilterInput?: boolean;
  textsChangeBeforeClick?: string[];
  exactFilterCount?: number;
}) {
  const state: Options = { texts: opts.optionTexts };
  const clickedTexts: string[] = [];
  const pressed: string[] = [];
  const filled: string[] = [];
  let shown = '';
  const zero = {
    first: () => zero,
    count: async () => 0,
    click: vi.fn(),
    innerText: async () => '',
    inputValue: async () => '',
    fill: vi.fn(),
    getAttribute: async () => null,
    waitFor: async () => undefined,
    locator: () => zero,
    filter: () => zero,
    allInnerTexts: async () => [],
    nth: () => zero,
  };
  const optionsLocator = () => ({
    allInnerTexts: async () => state.texts,
    count: async () => state.texts.length,
    nth: (i: number) => ({
      innerText: async () => (opts.textsChangeBeforeClick ? opts.textsChangeBeforeClick[i] : state.texts[i]) ?? '',
      click: async () => {
        const text = (opts.textsChangeBeforeClick ? opts.textsChangeBeforeClick[i] : state.texts[i]) ?? '';
        clickedTexts.push(text);
        shown = opts.shownAfterClick ? opts.shownAfterClick(text) : text;
      },
    }),
    filter: () => {
      const n = opts.exactFilterCount ?? state.texts.filter((t) => normalizeChoiceText(t) === normalizeChoiceText(state.wanted ?? '')).length;
      return {
        count: async () => n,
        first: () => ({
          click: async () => {
            const text = state.wanted ?? '';
            clickedTexts.push(text);
            shown = opts.shownAfterClick ? opts.shownAfterClick(text) : text;
          },
        }),
      };
    },
  });
  const listbox = {
    waitFor: async () => {
      if (opts.listboxOpens === false) throw new Error('not visible');
    },
    count: async () => opts.popupIdCount ?? 1,
    locator: (sel: string) => (sel === '[role="option"]' ? optionsLocator() : zero),
  };
  const item = {
    locator: (sel: string) => {
      if (sel === 'select') {
        return opts.hasSelect
          ? { first: () => ({ count: async () => 1, selectOption: async () => opts.selectResult ?? [] }) }
          : { first: () => zero };
      }
      if (sel === '[role="combobox"], [aria-haspopup="listbox"]') {
        return {
          first: () => ({
            count: async () => 1,
            click: vi.fn(async () => undefined),
            getAttribute: async (name: string) => (name === 'aria-controls' ? (opts.ariaControls ?? null) : null),
          }),
        };
      }
      if (sel === 'input[role="combobox"], [role="combobox"] input') {
        return {
          first: () => ({
            count: async () => (opts.hasFilterInput === false ? 0 : opts.filteredTexts ? 1 : 0),
            fill: async (v: string) => {
              filled.push(v);
              if (v && opts.filteredTexts) state.texts = opts.filteredTexts;
              if (v === '') state.texts = opts.optionTexts;
            },
          }),
        };
      }
      if (sel === '[role="listbox"]:visible') {
        const n = opts.listboxInItemCount ?? 0;
        return { count: async () => n, locator: (s: string) => (s === '[role="option"]' ? optionsLocator() : zero), waitFor: async () => undefined };
      }
      if (sel === '[role="combobox"]') {
        return { first: () => ({ count: async () => 1, innerText: async () => shown, inputValue: async () => '' }) };
      }
      return { first: () => zero };
    },
  };
  const page = {
    locator: (sel: string) => {
      if (sel.startsWith('[id="')) return { ...listbox, count: async () => opts.popupIdCount ?? (opts.ariaControls ? 1 : 0) };
      if (sel === '[role="listbox"]:visible') {
        const n = opts.visibleListboxCount ?? 1;
        return { ...listbox, count: async () => n };
      }
      return zero;
    },
    keyboard: { press: async (k: string) => { pressed.push(k); } },
    waitForTimeout: async () => undefined,
  };
  return { page, item, clickedTexts: () => clickedTexts, pressed: () => pressed, filled: () => filled, state };
}

// The fake's exact-text filter needs to know what the driver asked for.
function withWanted<T extends { state: Options }>(f: T, wanted: string): T {
  f.state.wanted = wanted;
  return f;
}

describe('selectDropdownChoice (CLWX-62)', () => {
  it('picks the single exact option from a popup bound by aria-controls and verifies the echo', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: 'school-listbox' }), 'Sangre Grande Government Primary');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r).toEqual({ ok: true, via: 'combobox' });
    expect(f.clickedTexts()).toEqual(['Sangre Grande Government Primary']);
    expect(f.pressed()).toEqual([]);
  });

  it('matches case- and whitespace-insensitively but never by substring', async () => {
    const ok = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: 'lb' }), 'Sangre Grande Hindu');
    expect((await selectDropdownChoice(ok.page as never, ok.item as never, '  sangre grande   hindu ', 1000)).ok).toBe(true);
    const sub = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: 'lb', exactFilterCount: 0 }), 'Sangre Grande');
    const r = await selectDropdownChoice(sub.page as never, sub.item as never, 'Sangre Grande', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not found in dropdown/);
    expect(sub.clickedTexts()).toEqual([]);
    expect(sub.pressed()).toEqual(['Escape']);
  });

  it('refuses an ambiguous option (two exact matches) without clicking', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: [...SCHOOLS, 'Toco Anglican'], ariaControls: 'lb' }), 'Toco Anglican');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Toco Anglican', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous dropdown option/);
    expect(f.clickedTexts()).toEqual([]);
    expect(f.pressed()).toEqual(['Escape']);
  });

  /**
   * Review lane A M4 / lane B M1: the popup used to be resolved with
   * page-global `[role="listbox"]:visible.last()`, so an unrelated open listbox
   * could have one of ITS options clicked — an answer written to another question.
   */
  it('refuses when several visible listboxes cannot be bound to this question', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: null, visibleListboxCount: 3 }), 'Toco Anglican');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Toco Anglican', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous dropdown popup/);
    expect(f.clickedTexts()).toEqual([]);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('binds a listbox rendered inside the question item when there is exactly one', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: null, listboxInItemCount: 1, visibleListboxCount: 5 }), 'Guaico Government Primary');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Guaico Government Primary', 1000);
    expect(r).toEqual({ ok: true, via: 'combobox' });
    expect(f.clickedTexts()).toEqual(['Guaico Government Primary']);
  });

  it('types to filter a virtualized list, then selects, and clears the filter when it still fails', async () => {
    const ok = withWanted(fakeDropdown({
      optionTexts: ["Arima Boys' Government Primary", 'Arouca Government Primary'],
      filteredTexts: ['Sangre Grande Government Primary'],
      ariaControls: 'lb',
    }), 'Sangre Grande Government Primary');
    const r = await selectDropdownChoice(ok.page as never, ok.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r.ok).toBe(true);
    expect(ok.filled()).toEqual(['Sangre Grande Government Primary']);

    const miss = withWanted(fakeDropdown({
      optionTexts: ['Arouca Government Primary'],
      filteredTexts: ['Arouca Government Primary'],
      ariaControls: 'lb',
      exactFilterCount: 0,
    }), 'Nowhere Primary');
    const bad = await selectDropdownChoice(miss.page as never, miss.item as never, 'Nowhere Primary', 1000);
    expect(bad.ok).toBe(false);
    // filter text typed, then cleared on the failure path so nothing it wrote survives
    expect(miss.filled()).toEqual(['Nowhere Primary', '']);
    expect(miss.pressed()).toEqual(['Escape']);
  });

  /** Review lane A M5: a re-render between reading the options and clicking an index. */
  it('refuses when the list re-renders between the read and the click', async () => {
    const f = withWanted(fakeDropdown({
      optionTexts: SCHOOLS,
      ariaControls: 'lb',
      exactFilterCount: 0, // exact-text locator finds nothing, so the index path is taken
      textsChangeBeforeClick: ['Toco Anglican', 'Guaico Government Primary', 'Sangre Grande Hindu', 'Arouca Government Primary'],
    }), 'Sangre Grande Government Primary');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/re-rendered/);
    expect(f.clickedTexts()).toEqual([]);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('reports an unconfirmed selection and closes the popup', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: 'lb', shownAfterClick: () => 'Select your answer' }), 'Guaico Government Primary');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Guaico Government Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not confirmed/);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('reports a dropdown that never opens and restores state with Escape', async () => {
    const f = withWanted(fakeDropdown({ optionTexts: SCHOOLS, ariaControls: 'lb', listboxOpens: false }), 'Guaico Government Primary');
    const r = await selectDropdownChoice(f.page as never, f.item as never, 'Guaico Government Primary', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/did not open/);
    expect(f.pressed()).toEqual(['Escape']);
  });

  it('uses a native <select> by exact label when present', async () => {
    const f = fakeDropdown({ optionTexts: [], hasSelect: true, selectResult: ['sg'] });
    expect(await selectDropdownChoice(f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000)).toEqual({ ok: true, via: 'select' });
    const g = fakeDropdown({ optionTexts: [], hasSelect: true, selectResult: [] });
    expect((await selectDropdownChoice(g.page as never, g.item as never, 'Nowhere Primary', 1000)).ok).toBe(false);
  });
});

describe('normalizeChoiceText / valueEchoesTarget', () => {
  it('normalizes NBSP, whitespace and case', () => {
    expect(normalizeChoiceText('  Sangre Grande   Government Primary ')).toBe('sangre grande government primary');
  });
  it('accepts an echo per line or segment but never a substring', () => {
    expect(valueEchoesTarget('Name of school\nSangre Grande Hindu', 'sangre grande hindu')).toBe(true);
    expect(valueEchoesTarget('Sangre Grande Hindu Primary', 'sangre grande hindu')).toBe(false);
    expect(valueEchoesTarget('', 'sangre grande hindu')).toBe(false);
  });
});

/** Review lane B M2: pre-existing selector injection on the radio/checkbox aria-label path. */
describe('cssAttrValue', () => {
  it('neutralises a value crafted to close the quote and append a Submit selector', () => {
    const hostile = 'x"], [role="button"][aria-label="Submit';
    const escaped = cssAttrValue(hostile);
    expect(escaped).toBe('x\\"], [role=\\"button\\"][aria-label=\\"Submit');
    const selector = `[role="radio"][aria-label="${escaped}"]`;
    // Every quote inside the value is escaped, so the selector stays ONE attribute match.
    expect(selector.match(/(?<!\\)"/g)?.length).toBe(4);
    expect(selector).not.toMatch(/(?<!\\)"\]\s*,/);
  });
  it('escapes backslashes before quotes so an escaped quote cannot be re-opened', () => {
    expect(cssAttrValue('a\\"b')).toBe('a\\\\\\"b');
  });
});
