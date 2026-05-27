/**
 * Clone the Primary School Daily Report into the signed-in test.fac Forms
 * account through the user's Chrome CDP session.
 *
 * This creates a demo response form from the captured VLM schema and writes
 * its responder URL to:
 *   extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt
 *
 * The clone intentionally makes branch-only fields optional. The real MoE form
 * hides those fields through Microsoft Forms branching; our browser fill action
 * skips them when the controlling answer makes them irrelevant.
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA_PATH = join(process.cwd(), 'extensions/moe-principal-assistant/forms/daily-report-schema.vlm.json');
const URL_OUT = join(process.cwd(), 'extensions/moe-principal-assistant/forms/daily-report-test-fac-url.txt');
const CDP = process.env.CLAWX_CDP_ENDPOINT ?? 'http://127.0.0.1:18792';

// Captured for the test.fac tenant. This is the same account used by the
// existing suspensions clone helpers.
const TENANT_ID = '9590bb09-ce2c-40e2-8181-fad0a7edebfe';
const USER_ID = '0e48d4db-698a-44ca-ba0b-ae905cd07817';

const CONDITIONAL_FIELD_IDS = new Set([
  'reason_no_school',
  'received_nsdsl_breakfasts',
  'breakfasts_delivered',
  'breakfasts_left_after_distribution',
  'breakfast_portion_size_rating',
  'children_satisfied_with_breakfast',
  'students_fell_ill_after_nsdsl_breakfast',
  'received_nsdsl_lunches',
  'lunches_delivered',
  'lunches_left_after_distribution',
  'lunch_portion_size_rating',
  'children_satisfied_with_lunch',
  'students_fell_ill_after_nsdsl_lunch',
  'number_of_students_suspended',
  'suspension_recorded_on_form',
  'ptsc_approved_routes_count',
  'ptsc_morning_trips_count',
  'students_absent_entire_term',
  'total_students_absent_entire_term',
  'first_year_students_absent_entire_term',
  'second_year_students_absent_entire_term',
  'standard_1_students_absent_entire_term',
  'standard_2_students_absent_entire_term',
  'standard_3_students_absent_entire_term',
  'standard_4_students_absent_entire_term',
  'standard_5_students_absent_entire_term',
]);

const SCHOOL_OPTIONS_TO_KEEP = [
  'Arouca Government Primary',
  "St. Mary's Government Primary",
  'Belmont Government Primary School',
  "Diego Martin Gov't Primary",
];

const DESIGN_PAGE_RE = /forms\.(?:office\.com|cloud\.microsoft)\/Pages\/DesignPageV2/i;

interface VlmField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'single_choice' | 'multi_choice';
  required?: boolean;
  options?: string[];
}

interface VlmSchema {
  title: string;
  description?: string;
  fields: VlmField[];
}

interface FormsApiResult {
  status: number;
  text: string;
  json: unknown;
}

interface FormsQuestionList {
  value?: Array<{ id: string }>;
}

function clientId(): string {
  return 'r' + randomBytes(16).toString('hex');
}

function choiceOptions(field: VlmField): string[] {
  const source = field.options && field.options.length > 0 ? field.options : ['Yes', 'No'];
  const maxOptions = 80;
  if (source.length <= maxOptions) return source;

  if (field.id === 'name_of_school') {
    const keep = SCHOOL_OPTIONS_TO_KEEP.filter((value) => source.includes(value));
    const rest = source.filter((value) => !keep.includes(value));
    return [...keep, ...rest].slice(0, maxOptions);
  }

  return source.slice(0, maxOptions - 1).concat(['Other']);
}

function buildQuestionBody(field: VlmField, order: number): Record<string, unknown> {
  const required = field.required === true && field.id !== 'principal_name' && !CONDITIONAL_FIELD_IDS.has(field.id);
  const base: Record<string, unknown> = {
    title: field.label.slice(0, 4000),
    id: clientId(),
    order,
    isQuiz: false,
    required,
  };

  if (field.type === 'date') {
    base.type = 'Question.DateTime';
    base.questionInfo = '{}';
    return base;
  }

  if (field.type === 'single_choice' || field.type === 'multi_choice') {
    base.type = 'Question.Choice';
    base.questionInfo = JSON.stringify({
      Choices: choiceOptions(field).map((option) => ({
        Description: option.slice(0, 250),
        IsGenerated: false,
      })),
      ChoiceType: field.type === 'multi_choice' ? 2 : 1,
      AllowOtherAnswer: false,
      OptionDisplayStyle: 'ListAll',
      ChoiceRestrictionType: 'None',
      ShuffleOptions: false,
      ShowRatingLabel: false,
    });
    return base;
  }

  base.type = 'Question.TextField';
  base.questionInfo = JSON.stringify({
    Multiline: false,
    ShuffleOptions: false,
    ShowRatingLabel: false,
  });
  return base;
}

async function openNewDesignPage(browser: Browser): Promise<Page> {
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('Chrome CDP exposed no browser context');

  const page = await ctx.newPage();
  await page.goto('https://forms.cloud.microsoft/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => null);
  await page.waitForTimeout(2_000);

  if (/login\.microsoftonline\.com/i.test(page.url())) {
    throw new Error('Forms opened a Microsoft login page; sign into test.fac in the CDP Chrome window and retry');
  }

  const candidates = [
    page.getByRole('button', { name: /new form/i }),
    page.getByRole('link', { name: /new form/i }),
    page.getByRole('button', { name: /blank form/i }),
    page.getByRole('link', { name: /blank form/i }),
    page.locator('button:has-text("New Form")'),
    page.locator('a:has-text("New Form")'),
    page.locator('button:has-text("Blank form")'),
    page.locator('a:has-text("Blank form")'),
  ];

  await page.keyboard.press('Escape').catch(() => null);
  await page.waitForTimeout(500);

  let clicked = false;
  for (const candidate of candidates) {
    if ((await candidate.count().catch(() => 0)) === 0) continue;
    const first = candidate.first();
    await first.click({ timeout: 5_000 }).catch(async () => {
      await first.click({ timeout: 5_000, force: true }).catch(async () => {
        await first.evaluate((element: HTMLElement) => element.click());
      });
    });
    clicked = true;
    break;
  }
  if (!clicked) throw new Error('Could not find a Microsoft Forms New Form button');

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const design = pages.find((p) => DESIGN_PAGE_RE.test(p.url()) && /[?&]id=/.test(p.url()));
    if (design) {
      await design.bringToFront().catch(() => null);
      await design.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => null);
      await design.waitForTimeout(1_500);
      return design;
    }
    await page.waitForTimeout(500);
  }

  throw new Error('Could not create a new Microsoft Forms design page');
}

async function formApi(page: Page, base: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<FormsApiResult> {
  return page.evaluate(
    async ({ url, method, body }) => {
      const ofi = (window as Window & { OfficeFormServerInfo?: { antiForgeryToken?: string } }).OfficeFormServerInfo ?? {};
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
      };
      if (ofi.antiForgeryToken) headers.__requestverificationtoken = ofi.antiForgeryToken;
      const response = await fetch(url, {
        method: method ?? 'GET',
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const json: unknown = (() => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })();
      return { status: response.status, text: text.slice(0, 500), json };
    },
    { url: `${base}${path}`, method: init.method, body: init.body },
  );
}

async function main() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as VlmSchema;
  if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
    throw new Error(`No fields found in ${SCHEMA_PATH}`);
  }

  console.log(`Creating daily report clone with ${schema.fields.length} fields through ${CDP}`);
  const browser = await chromium.connectOverCDP(CDP);
  try {
    const page = await openNewDesignPage(browser);
    const formId = new URL(page.url()).searchParams.get('id');
    if (!formId) throw new Error('Design page did not expose a form id');
    const apiOrigin = new URL(page.url()).origin;
    const base = `${apiOrigin}/formapi/api/${TENANT_ID}/users/${USER_ID}/forms('${formId}')`;

    const patch = await formApi(page, base, '', {
      method: 'PATCH',
      body: {
        title: schema.title,
        description: schema.description ?? '',
      },
    });
    if (![200, 204].includes(patch.status)) {
      console.log(`Title PATCH returned ${patch.status}; continuing with question creation`);
    }

    const existing = await formApi(page, base, '/questions');
    const existingQuestions = ((existing.json as FormsQuestionList | null)?.value ?? []);
    for (const question of existingQuestions) {
      await formApi(page, base, `/questions('${question.id}')`, { method: 'DELETE' });
    }

    let order = 5_000_000;
    let ok = 0;
    let fail = 0;
    for (const [index, field] of schema.fields.entries()) {
      order += 1_000_000 + Math.floor(Math.random() * 500);
      const body = buildQuestionBody(field, order);
      const result = await formApi(page, base, '/questions', { method: 'POST', body });
      if (result.status === 201) {
        ok++;
      } else {
        fail++;
        console.log(`  [${index + 1}] ${field.id} failed with ${result.status}: ${result.text}`);
      }
      await page.waitForTimeout(120);
    }

    const meta = await formApi(page, base, '');
    const metaJson = (meta.json ?? {}) as Record<string, unknown>;
    const fallbackUrl = `${apiOrigin}/Pages/ResponsePage.aspx?id=${encodeURIComponent(formId)}`;
    const responseUrl = String(metaJson.responderUrl || metaJson.responderShortUrl || fallbackUrl);
    if (!existsSync(dirname(URL_OUT))) mkdirSync(dirname(URL_OUT), { recursive: true });
    writeFileSync(URL_OUT, responseUrl + '\n');

    console.log(`Clone complete: ${ok} created, ${fail} failed`);
    console.log(`URL file written: ${URL_OUT}`);
  } finally {
    await browser.close().catch(() => null);
  }
}

main().catch((err) => {
  console.error('CRASH:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
