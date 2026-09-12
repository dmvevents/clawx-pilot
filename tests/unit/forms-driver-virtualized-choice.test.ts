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
 *
 * Review lane B (MINOR-C): the `evaluate` fake used to return a canned value
 * without ever running the callback, so the read-back logic inside it was
 * untested and MINOR-D (a radio associated by `for=` rather than wrapped by its
 * label) was invisible. The fake now INVOKES the callback against a small DOM
 * stub, in both association shapes.
 */
type Association = 'wrap' | 'for';

interface FakeRadio {
  __text: string;
  checked: boolean;
  getAttribute: (n: string) => string | null;
  closest: (sel: string) => unknown;
  parentElement: { textContent: string } | null;
}

function fakeVirtualizedQuestion(opts: {
  options: string[];
  windowSize?: number;
  pxPerOption?: number;
  questionTop?: number;
  questionHeight?: number;
  association?: Association;
  /** what the question reports as selected after the click */
  verify?: 'ok' | 'none' | 'wrong' | 'multi' | 'throw';
  duplicateTarget?: string;
  radiogroupCount?: number;
  /** for a multi-radiogroup item: how many groups render the target */
  groupsOwningTarget?: number;
  /**
   * Live shape (installed moe.39, 2026-09-11): the question's boundingBox covers
   * only the RENDERED window (~80 options), not the whole list, and it does not
   * grow as options render. Any bound derived from it stops the walk early.
   */
  itemHeightCoversWindowOnly?: boolean;
  /** total scrollable page height; scrollY clamps to pageHeight - viewport */
  pageHeight?: number;
  /** render every label with non-breaking spaces instead of ordinary ones */
  nbspInLabels?: boolean;
  throwOnClick?: boolean;
}) {
  const windowSize = opts.windowSize ?? 80;
  const pxPerOption = opts.pxPerOption ?? 50;
  const association = opts.association ?? 'wrap';
  const verify = opts.verify ?? 'ok';
  let scrollY = 0;
  let selected: string | null = null;
  const clicked: string[] = [];
  const scrolls: number[] = [];
  const waits: number[] = [];
  // Rendered text can differ from the target by whitespace only: Microsoft Forms
  // renders some option labels with a non-breaking space. Review lane A: a RegExp
  // match tests the RAW text, so that difference produced "option not found" for an
  // option that is present — the same message a genuine absence produces.
  const renderText = (t: string) => (opts.nbspInLabels ? t.replace(/ /g, '\u00a0') : t);
  const visibleOptions = () => {
    const start = Math.max(0, Math.min(opts.options.length - windowSize, Math.floor(scrollY / pxPerOption)));
    const window = opts.options.slice(start, start + windowSize);
    if (opts.duplicateTarget && window.includes(opts.duplicateTarget)) window.push(opts.duplicateTarget);
    return window;
  };

  // --- the DOM stub the read-back callback actually runs against.
  const labelId = (text: string) => `opt-${text.replace(/\W+/g, '-')}`;
  const buildRoot = () => {
    const texts = visibleOptions();
    const labels = texts.map((t) => ({
      textContent: renderText(t),
      getAttribute: (n: string) => (n === 'for' && association === 'for' ? labelId(t) : null),
      __for: association === 'for' ? labelId(t) : null,
    }));
    const selectedTexts = (): string[] => {
      if (verify === 'none' || selected === null) return [];
      if (verify === 'wrong') return [texts.find((t) => t !== selected) ?? '<other>'];
      if (verify === 'multi') return [selected, texts.find((t) => t !== selected) ?? '<other>'];
      return [selected];
    };
    const radios: FakeRadio[] = texts.map((t) => {
      const wrapping = labels[texts.indexOf(t)];
      return {
        __text: t,
        checked: selectedTexts().includes(t),
        getAttribute: (n: string) => {
          if (n === 'id') return association === 'for' ? labelId(t) : null;
          // The live form leaves aria-label empty and points aria-labelledby at a
          // span; neither is how the wrap shape is read back, so keep them null
          // and let `closest('label')` / `label[for=]` do the work.
          return null;
        },
        closest: (sel: string) => (sel === 'label' && association === 'wrap' ? wrapping : null),
        parentElement: association === 'wrap' ? null : { textContent: t },
      };
    });
    return {
      querySelectorAll: (sel: string) => {
        if (sel === 'label') return labels;
        if (sel.includes('radio')) return radios;
        return [];
      },
      querySelector: (sel: string) => {
        const m = /^label\[for="(.*)"\]$/.exec(sel);
        if (m) return labels.find((l) => l.__for === m[1]) ?? null;
        const byId = /^\[id="(.*)"\]$/.exec(sel);
        if (byId) return radios.find((r) => r.getAttribute('id') === byId[1]) ?? null;
        return null;
      },
    };
  };

  const labelLocator = (matcher?: RegExp) => ({
    count: async () => (matcher ? visibleOptions().filter((t) => matcher.test(renderText(t))).length : visibleOptions().length),
    filter: ({ hasText }: { hasText: RegExp }) => labelLocator(hasText),
    first: () => ({
      click: async () => {
        if (opts.throwOnClick) throw new Error('click failed');
        const hit = visibleOptions().find((t) => matcher!.test(renderText(t)));
        clicked.push(hit ?? '<none>');
        selected = hit ?? null;
      },
    }),
    nth: (i: number) => ({
      click: async () => {
        if (opts.throwOnClick) throw new Error('click failed');
        const t = visibleOptions()[i];
        clicked.push(t ?? '<none>');
        selected = t ?? null;
      },
    }),
  });
  const emptyLabelLocator: { count: () => Promise<number>; filter: (o: unknown) => unknown; first: () => unknown } = {
    count: async () => 0,
    filter: () => emptyLabelLocator,
    first: () => ({ click: async () => { throw new Error('no option'); } }),
  };
  const scopeLocator = {
    locator: (sel: string) => {
      if (sel === 'label') return labelLocator();
      if (sel.includes('radio')) return { count: async () => visibleOptions().length };
      return { count: async () => 0 };
    },
    evaluate: async (fn: (root: unknown, arg?: unknown) => unknown, arg?: unknown) => {
      if (verify === 'throw') throw new Error('evaluate failed');
      return fn(buildRoot(), arg);
    },
  };
  const item = {
    locator: (sel: string) => {
      if (sel === '[role="radiogroup"]') {
        const n = opts.radiogroupCount ?? 0;
        const owning = opts.groupsOwningTarget ?? n;
        return {
          count: async () => n,
          first: () => scopeLocator,
          // Only the first `owning` groups render the target option.
          nth: (i: number) => (i < owning
            ? scopeLocator
            : {
              ...scopeLocator,
              locator: (sel2: string) => (sel2 === 'label' ? emptyLabelLocator : scopeLocator.locator(sel2)),
            }),
        };
      }
      if (sel === 'label') return labelLocator();
      if (sel.includes('radio')) return { count: async () => visibleOptions().length };
      return { count: async () => 0 };
    },
    evaluate: scopeLocator.evaluate,
    boundingBox: async () => ({
      x: 0,
      // Viewport-relative, like Playwright's: it scrolls out of view as the page moves.
      y: (opts.questionTop ?? 100) - (opts.itemHeightCoversWindowOnly ? Math.min(scrollY, opts.questionTop ?? 100) : 0),
      width: 600,
      height: opts.itemHeightCoversWindowOnly
        ? windowSize * pxPerOption
        : opts.questionHeight ?? opts.options.length * pxPerOption,
    }),
  };
  const page = {
    evaluate: async (fn: unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.includes('window.scrollY')) return scrollY;
      if (src.includes('window.innerHeight')) return 800;
      if (src.includes('scrollTo')) {
        const want = Number(arg ?? 0);
        const max = (opts.pageHeight ?? opts.options.length * pxPerOption + 2000) - 800;
        scrollY = Math.max(0, Math.min(want, max));
        scrolls.push(scrollY);
        return undefined;
      }
      return undefined;
    },
    waitForTimeout: async (ms: number) => { waits.push(ms); },
  };
  return {
    page,
    item,
    clicked: () => clicked,
    scrolls: () => scrolls,
    settleWaits: () => waits.filter((ms) => ms === 60),
    finalScroll: () => scrollY,
  };
}

const SCHOOLS = Array.from({ length: 454 }, (_, i) => `School ${String(i).padStart(3, '0')} Government Primary`);
// Live-shaped vocabulary (2026-09-12 measurement): 80 options, one distinctive token
// each, almost all ending in "Government Primary"; the near-miss is offered as an
// abbreviation the profile does not use.
const LIVE_LIKE_TOWNS = ['Arouca', 'Barataria', 'Carenage', 'Curepe', 'Diego Martin', 'Laventille', 'Maraval',
  'Morvant', 'Petit Valley', 'St James', 'Santa Cruz', 'Tunapuna', 'Valsayn', 'Woodbrook', 'Belmont', 'Cascade',
  'Chaguanas', 'Couva', 'Cunupia', 'Freeport', 'Gasparillo', 'Marabella', 'Penal', 'Siparia', 'Fyzabad',
  'Point Fortin', 'La Brea', 'Cedros', 'Princes Town', 'Rio Claro', 'Mayaro', 'Guayaguayare', 'Tabaquite',
  'Talparo', 'Arima', 'Piarco', 'Wallerfield', 'Toco', 'Matelot', 'Blanchisseuse', 'Maracas', 'Paramin',
  'Moruga', 'Debe', 'Barrackpore', 'Erin', 'Oropouche', 'Claxton Bay', 'Preysal', 'California', 'Carapichaima',
  'Chase Village', 'Enterprise', 'Longdenville', 'Felicity', 'Edinburgh', 'Endeavour', 'Charlieville',
  'Lange Park', 'Montrose', 'Caroni', 'Kelly Village', 'Warrenville', 'Jerningham', 'Todds Road', 'Flanagin Town',
  'Brasso Seco', 'Lopinot', 'Surrey', 'Bon Air', 'Trincity', 'Tacarigua', 'Dinsley', 'Macoya', 'El Dorado',
  'Five Rivers', 'Mausica', 'Malabar', 'Santa Rosa'];
const LIVE_LIKE_SCHOOLS = [...LIVE_LIKE_TOWNS.map((t) => `${t} Government Primary`), 'Aranguez GPS'];
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

  /**
   * Review lane B (MINOR-D): with the walk as tier 1 for EVERY choice question,
   * a form that associates its radio by `for=` instead of wrapping it in the
   * label must still verify. Reading back through the clicked handle's
   * descendants missed exactly this shape and would have failed a correct
   * selection.
   */
  it('verifies the selection when the radio is associated by for= rather than wrapped', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, association: 'for' });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[12], 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([SCHOOLS[12]]);
  });

  /**
   * Review lane B (MINOR-B): the settle poll waits for the TARGET, not for an
   * option count that never changes on a constant-size window. When each scroll
   * re-renders the window, no 60 ms settle wait is needed at all.
   */
  it('does not burn a fixed settle delay on every scroll pass', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, TARGET_FAR_DOWN, 1000);
    expect(r.ok).toBe(true);
    expect(f.settleWaits()).toEqual([]);
  });

  /**
   * The live moe.39 failure, reproduced: with the item's height covering only the
   * rendered window, an item-height bound stopped the walk after 6 passes — about
   * 77 of 454 options — and reported "option not found" for an option that exists.
   * The walk must keep going while the page still moves and the window still
   * changes, so it reaches option ~400.
   */
  it('reaches a far-down option when the question reports only the rendered window height', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, itemHeightCoversWindowOnly: true, pageHeight: 30000 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, TARGET_FAR_DOWN, 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([TARGET_FAR_DOWN]);
    expect(f.scrolls().length).toBeGreaterThan(6);
    expect(f.finalScroll()).toBe(0);
  });

  it('names the closest offered options when the target is absent', async () => {
    const f = fakeVirtualizedQuestion({ options: [...SCHOOLS.slice(0, 5), 'Sangre Grande Government Primary'], windowSize: 6 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, 'Sangre Grande Primary School', 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/closest offered: "Sangre Grande Government Primary"/);
  });

  it('still stops on a short list instead of scrolling to the page bottom', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS.slice(0, 12), windowSize: 12, itemHeightCoversWindowOnly: true, pageHeight: 30000 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, 'Nowhere Primary', 1000);
    expect(r.ok).toBe(false);
    expect(f.scrolls().length).toBeLessThan(8);
  });

  /**
   * Review lane A: whitespace-only differences must not read as absence. The label
   * renders with non-breaking spaces, the target uses ordinary ones, and the regex
   * prefilter therefore misses — the normalized comparison has to find and click it.
   */
  it('clicks an option whose rendered label differs only by non-breaking spaces', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, nbspInLabels: true });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[9], 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([SCHOOLS[9]]);
  });

  it('reports how far it looked when the option does not exist at all', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, 'Nowhere Primary', 1000);
    expect(r.ok).toBe(false);
    // The message must name what the principal can act on: the value is not offered,
    // how many options were seen, and the nearest ones. It must NOT describe scroll
    // passes as the explanation. Review MODERATE-2: on a list whose window changed
    // while walking, the count is what was seen, never claimed as the total.
    expect(r.reason).toMatch(/does not offer "Nowhere Primary"/);
    expect(r.reason).toMatch(/at least 80 option\(s\) were seen/);
    expect(r.reason).not.toMatch(/offers 80 option/);
    expect(r.reason).not.toMatch(/scroll passes\)/);
    expect(f.clicked()).toEqual([]);
    expect(f.finalScroll()).toBe(0);
  });

  /**
   * The live pilot form (2026-09-12): 80 fixed radio options, almost all ending in
   * "Government Primary", and the school the profile names as "Aranguez Government
   * Primary School" is offered as "Aranguez GPS". Review MAJOR-1: the previous ranking
   * counted shared tokens, so "government" + "primary" outscored "aranguez" and the
   * hint named three wrong schools. The hint must name the one option that shares a
   * distinctive token, and the count is a total because the window never changed.
   */
  it('names the live near-miss and claims a total only for a fixed list', async () => {
    const f = fakeVirtualizedQuestion({ options: LIVE_LIKE_SCHOOLS });
    const r = await selectVirtualizedRadioChoice(
      f.page as never, f.item as never, 'Aranguez Government Primary School', 1000,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/offers 80 option\(s\)/);
    expect(r.reason).toMatch(/closest offered: "Aranguez GPS"/);
    expect(r.reason).not.toMatch(/Arouca|Barataria|Carenage/);
    expect(f.clicked()).toEqual([]);
  });

  it('suppresses the hint when the target shares only generic tokens', async () => {
    const f = fakeVirtualizedQuestion({ options: LIVE_LIKE_SCHOOLS });
    const r = await selectVirtualizedRadioChoice(
      f.page as never, f.item as never, 'Sangre Grande Government Primary', 1000,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not offer "Sangre Grande Government Primary"/);
    expect(r.reason).not.toMatch(/closest offered/);
  });

  it('refuses an exactly duplicated option rather than guessing', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, duplicateTarget: SCHOOLS[5] });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[5], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous option \(2 labels match exactly\)/);
    expect(f.clicked()).toEqual([]);
  });

  it('fails when the question reports nothing selected after the click', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, verify: 'none' });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no option in this question reports selected/);
  });

  /**
   * Review lane B (MINOR-A): the read-back is re-resolved inside the question
   * scope, so a click that lands on the WRONG option is caught — the old probe
   * asked the clicked handle whether it was checked and could not see this.
   */
  it('fails when the question reports a different option selected', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, verify: 'wrong' });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reports a different selection/);
  });

  it('fails when more than one option reports selected', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, verify: 'multi' });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/2 options report selected/);
  });

  /** Review lane B MAJOR-2: an unverifiable selection must FAIL, not pass. */
  it('fails when the selection cannot be read back at all', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, verify: 'throw' });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be read back/);
  });

  /**
   * Review lane B MINOR-2 / NIT-A: an over-scoped question item is refused, not
   * guessed — but a question that legitimately renders several radiogroups, only
   * one of which offers this option, resolves to that group instead of failing.
   */
  it('refuses when several radiogroups offer the same option', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, radiogroupCount: 3, groupsOwningTarget: 2 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/3 radiogroups resolved, 2 offer this option/);
    expect(f.clicked()).toEqual([]);
  });

  it('refuses when no radiogroup in an over-scoped item offers the option', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, radiogroupCount: 3, groupsOwningTarget: 0 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/0 offer this option/);
  });

  it('uses the one radiogroup that offers the option when the item exposes several', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, radiogroupCount: 3, groupsOwningTarget: 1 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[3], 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([SCHOOLS[3]]);
  });

  it('scopes the option search to the single radiogroup when the question exposes one', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, radiogroupCount: 1 });
    const r = await selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[7], 1000);
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(f.clicked()).toEqual([SCHOOLS[7]]);
  });

  /** Review lane B MINOR-1: a throwing click must not leave the page scrolled. */
  it('restores the scroll position even when the click throws', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS, throwOnClick: true });
    await expect(selectVirtualizedRadioChoice(f.page as never, f.item as never, SCHOOLS[400], 1000)).rejects.toThrow(/click failed/);
    expect(f.finalScroll()).toBe(0);
  });

  it('refuses an empty target', async () => {
    const f = fakeVirtualizedQuestion({ options: SCHOOLS });
    expect((await selectVirtualizedRadioChoice(f.page as never, f.item as never, '   ', 1000)).ok).toBe(false);
  });
});
