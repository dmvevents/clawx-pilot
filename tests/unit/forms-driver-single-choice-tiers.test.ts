// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { FormsDriver } from '../../electron/services/forms-browser-v2/forms-driver';

vi.mock('playwright-core', () => ({ chromium: { connectOverCDP: vi.fn() } }));
vi.mock('../../electron/services/chrome-cdp', () => ({
  CHROME_CDP_ENDPOINT: 'http://127.0.0.1:18792',
  ensureChromeCdpReady: vi.fn(),
  verifyCdpEndpointOwnershipForAttach: vi.fn(async () => ({ allowed: true })),
}));

/**
 * Review lane B MINOR-4: the virtualized-choice cases all called the helper
 * directly, so removing its wiring from `fillField`'s single_choice branch would
 * not have failed anything. These cases go through `fillField` and therefore
 * fail if the tier order changes or the wiring is dropped.
 *
 * They also lock the ordering the review required: the virtualized walk is tier
 * 1 (it refuses duplicates and verifies the selection), so the old
 * label-click-and-assume tier cannot shadow it.
 */
// `page` and `findQuestionItem` are private on FormsDriver, so an intersection
// type collapses to never. Describe only the surface these cases touch.
type Driver = {
  page: unknown;
  findQuestionItem: (label: string) => Promise<unknown>;
  fillField: (label: string, value: string, type: 'single_choice') => Promise<{ ok: boolean; reason?: string; via?: string }>;
};

function driverWith(opts: {
  renderedOptions: string[];
  optionsAfterScroll?: string[];
  /** what the question reports as selected after the click */
  verify?: 'ok' | 'none' | 'throw';
  radiogroups?: number;
  ariaRadioMatches?: number;
}) {
  const clicked: string[] = [];
  let scrolled = false;
  let selected: string | null = null;
  const verify = opts.verify ?? 'ok';
  const options = () => (scrolled && opts.optionsAfterScroll ? opts.optionsAfterScroll : opts.renderedOptions);
  const labelLocator = (matcher?: RegExp) => ({
    count: async () => (matcher ? options().filter((t) => matcher.test(t)).length : options().length),
    filter: ({ hasText }: { hasText: RegExp }) => labelLocator(hasText),
    first: () => ({
      click: async () => {
        const hit = options().find((t) => matcher!.test(t)) ?? '<none>';
        clicked.push(hit);
        selected = hit;
      },
    }),
  });
  // Review lane B (MINOR-C): the fake must RUN the read-back callback, against a
  // DOM stub, or the verification logic is untested. This shape wraps the input
  // in its label; the sibling suite covers `for=` association (MINOR-D).
  const buildRoot = () => {
    const texts = options();
    const labels = texts.map((t) => ({ textContent: t, getAttribute: () => null }));
    const radios = texts.map((t, i) => ({
      checked: verify !== 'none' && selected === t,
      getAttribute: () => null,
      closest: (sel: string) => (sel === 'label' ? labels[i] : null),
      parentElement: null,
    }));
    return {
      querySelectorAll: (sel: string) => (sel === 'label' ? labels : sel.includes('radio') ? radios : []),
      querySelector: () => null,
    };
  };
  const scope = {
    locator: (sel: string) => (sel === 'label' ? labelLocator() : { count: async () => options().length }),
    evaluate: async (fn: (root: unknown) => unknown) => {
      if (verify === 'throw') throw new Error('evaluate failed');
      return fn(buildRoot());
    },
  };
  const item = {
    locator: (sel: string) => {
      if (sel === '[role="radiogroup"]') {
        const n = opts.radiogroups ?? 0;
        return { count: async () => n, first: () => scope, nth: () => scope };
      }
      if (sel === 'label') return labelLocator();
      if (sel.startsWith('[role="radio"][aria-label=')) {
        const n = opts.ariaRadioMatches ?? 0;
        return { count: async () => n, first: () => ({ click: async () => { clicked.push('<aria>'); }, getAttribute: async () => 'true' }) };
      }
      if (sel === 'select') return { first: () => ({ count: async () => 0 }) };
      if (sel.includes('combobox') || sel.includes('haspopup')) return { first: () => ({ count: async () => 0, click: async () => undefined, getAttribute: async () => null }) };
      if (sel.includes('radio')) return { count: async () => options().length };
      return { first: () => ({ count: async () => 0 }), count: async () => 0 };
    },
    evaluate: scope.evaluate,
    boundingBox: async () => ({ x: 0, y: 100, width: 600, height: 4000 }),
  };
  const page = {
    evaluate: async (fn: unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.includes('window.scrollY')) return 0;
      if (src.includes('window.innerHeight')) return 800;
      if (src.includes('scrollTo')) { if (Number(arg ?? 0) > 0) scrolled = true; return undefined; }
      return undefined;
    },
    waitForTimeout: async () => undefined,
    locator: () => ({ count: async () => 0, last: () => ({ count: async () => 0 }) }),
    keyboard: { press: async () => undefined },
  };
  const d = new FormsDriver({ cdpEndpoint: 'http://127.0.0.1:18792' }) as unknown as Driver;
  d.page = page;
  d.findQuestionItem = vi.fn(async () => item);
  return { driver: d, clicked: () => clicked, scrolledOnce: () => scrolled };
}

const SCHOOLS = Array.from({ length: 80 }, (_, i) => `School ${String(i).padStart(3, '0')}`);

describe('fillField single_choice tier order (CLWX-62)', () => {
  it('fills a rendered radio option through the verifying virtualized tier', async () => {
    const { driver, clicked } = driverWith({ renderedOptions: SCHOOLS });
    const r = await driver.fillField('Name of school', SCHOOLS[9], 'single_choice');
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(clicked()).toEqual([SCHOOLS[9]]);
  });

  it('scrolls to an option outside the rendered window instead of reporting not found', async () => {
    const { driver, clicked, scrolledOnce } = driverWith({
      renderedOptions: SCHOOLS,
      optionsAfterScroll: ['Sangre Grande Government Primary'],
    });
    const r = await driver.fillField('Name of school', 'Sangre Grande Government Primary', 'single_choice');
    expect(r.ok).toBe(true);
    expect(scrolledOnce()).toBe(true);
    expect(clicked()).toEqual(['Sangre Grande Government Primary']);
  });

  /**
   * The guarantee the deleted tier destroyed: a duplicated rendered option must
   * be refused. If a non-verifying label tier is reintroduced ahead of the walk,
   * this goes green with a click and the test fails.
   */
  it('refuses a duplicated rendered option rather than clicking the first match', async () => {
    const { driver, clicked } = driverWith({ renderedOptions: [...SCHOOLS, SCHOOLS[4]] });
    const r = await driver.fillField('Name of school', SCHOOLS[4], 'single_choice');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous option \(2 labels match exactly\)/);
    expect(clicked()).toEqual([]);
  });

  it('reports an unverifiable selection instead of assuming the click worked', async () => {
    const { driver } = driverWith({ renderedOptions: SCHOOLS, verify: 'throw' });
    const r = await driver.fillField('Name of school', SCHOOLS[2], 'single_choice');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/could not be read back/);
  });

  it('reports a selection the question does not confirm', async () => {
    const { driver } = driverWith({ renderedOptions: SCHOOLS, verify: 'none' });
    const r = await driver.fillField('Name of school', SCHOOLS[2], 'single_choice');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no option in this question reports selected/);
  });

  /**
   * Review lane B (NIT-B): nothing locked the ORDER when both tiers could match.
   * The walk must win, because it is the only tier that refuses duplicates and
   * verifies the resulting selection.
   */
  it('prefers the verifying walk over the aria tier when both match', async () => {
    const { driver, clicked } = driverWith({ renderedOptions: SCHOOLS, ariaRadioMatches: 1 });
    const r = await driver.fillField('Name of school', SCHOOLS[6], 'single_choice');
    expect(r).toEqual({ ok: true, via: 'virtualized-radio' });
    expect(clicked()).toEqual([SCHOOLS[6]]);
  });

  it('uses the aria-label radio tier only when the label walk finds nothing', async () => {
    const { driver, clicked } = driverWith({ renderedOptions: [], ariaRadioMatches: 1 });
    const r = await driver.fillField('Education district', 'North Eastern', 'single_choice');
    expect(r).toEqual({ ok: true });
    expect(clicked()).toEqual(['<aria>']);
  });

  it('refuses when the aria-label tier matches more than one radio', async () => {
    const { driver, clicked } = driverWith({ renderedOptions: [], ariaRadioMatches: 2 });
    const r = await driver.fillField('Education district', 'North Eastern', 'single_choice');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ambiguous option \(2 aria-label matches\)/);
    expect(clicked()).toEqual([]);
  });
});
