/**
 * RAJ-2 reproduce-or-refute: "assistant's reply feature misinterpreted email
 * content" (a meal-preferences email was read back as shirt sizes, reported
 * 2026-06-21). The tool layer was verified faithful; this script isolates the
 * MODEL layer: read a real inbox email over the live CDP lane, run a live LLM
 * summarise + draft-reply turn (same Bedrock client as v2-chatbot-e2e.ts),
 * then assert content fidelity deterministically.
 *
 * Assertions (both must hold for PASS):
 *   COVERAGE     — the summary must contain >= 50% of the top-8 distinctive
 *                  content words of the source body (frequency-ranked, ties
 *                  broken by length then alphabetically).
 *   NO-INVENTION — every mid-sentence capitalised proper noun, weekday/month
 *                  name, and number in the summary + draft must literally
 *                  appear in the source (subject + sender + recipients +
 *                  body). Recipient/sender name tokens and today's date words
 *                  are allowed. Any invented entity fails — this is exactly
 *                  the shirt-sizes-for-meal-prefs class.
 *
 * Hard limits, sandbox lane only:
 *   - Nothing is sent; confirm:true is never set; NO compose pane is opened.
 *     The draft-reply exists only as TEXT returned by the model.
 *   - No email body content is printed. Output carries subjects truncated to
 *     120 chars, extracted keyword lists, entity lists, and verdicts only.
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 lane/fatal, 3 BLOCKED-SEEDING, 4 BLOCKED-INFRA.
 *
 * Run:
 *   pnpm exec tsx scripts/raj2-reply-fidelity-check.ts
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';
import { VlmGrounder } from '../electron/services/outlook-browser-v2/vlm-grounder.ts';
import { OutlookActions } from '../electron/services/outlook-browser-v2/outlook-actions.ts';

const MODEL_ID = process.env.CLAWX_AGENT_EVAL_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const REGION = process.env.AWS_REGION ?? 'us-east-2';

const MIN_CONTENT_WORDS = 40;
const TOP_N = 8;
const COVERAGE_FLOOR = 0.5;
const CANDIDATE_TOP = 10;

// ── deterministic text machinery ─────────────────────────────────────────────

const STOPWORDS = new Set([
  // function words (length >= 4 — shorter tokens never survive tokenisation)
  'about', 'above', 'after', 'again', 'against', 'along', 'also', 'always',
  'another', 'anyone', 'anything', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'cannot', 'could', 'does', 'doing', 'down',
  'during', 'each', 'either', 'else', 'ever', 'every', 'everyone', 'from',
  'further', 'have', 'having', 'here', 'hers', 'herself', 'himself', 'into',
  'itself', 'just', 'like', 'made', 'make', 'many', 'might', 'more', 'most',
  'much', 'must', 'myself', 'need', 'needs', 'neither', 'once', 'only',
  'onto', 'other', 'ours', 'ourselves', 'over', 'same', 'shall', 'should',
  'since', 'some', 'someone', 'something', 'soon', 'still', 'such', 'take',
  'than', 'that', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'until', 'upon',
  'very', 'want', 'well', 'were', 'what', 'when', 'where', 'which', 'while',
  'whom', 'will', 'with', 'within', 'without', 'would', 'your', 'yours',
  'yourself', 'yourselves',
  // contractions the tokeniser keeps
  "i'll", "i've", "i'm", "i'd", "it's", "we'll", "we're", "we've", "that's",
  "there's", "let's", "don't", "can't", "won't", "didn't", "doesn't",
  "isn't", "aren't", "haven't", "hasn't", "couldn't", "wouldn't",
  "shouldn't", "you're", "you'll", "you've",
  // email boilerplate / greetings
  'dear', 'hello', 'greetings', 'good', 'morning', 'afternoon', 'evening',
  'regards', 'thanks', 'thank', 'sincerely', 'best', 'kind', 'kindly',
  'please', 'email', 'e-mail', 'mail', 'message', 'sent', 'subject', 'wrote',
  'forwarded', 'reply', 'warm', 'wishes',
]);

/**
 * Legal/confidentiality footers dominate frequency ranking ("intended
 * recipient", "transmission", "sender", ...) and are not what the email asks
 * of the recipient. Truncate the body at the first disclaimer marker for
 * SCORING purposes only — the model still receives, and the invention check
 * still sources from, the full body.
 */
const DISCLAIMER_MARKER = new RegExp(
  [
    'confidentiality notice',
    'the information (contained|transmitted) in this',
    'this e-?mail( and any attachments?)? (is|are|may be) (intended|confidential|privileged)',
    'if you are not the intended recipient',
    'if you (have )?received this (e-?mail|message|transmission) in error',
    'intended solely for',
    'may contain (confidential|privileged)',
  ].join('|'),
  'i',
);

function stripDisclaimer(body: string): string {
  const m = DISCLAIMER_MARKER.exec(body);
  if (m && m.index >= 200) return body.slice(0, m.index);
  return body;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
];

/** Opaque identifiers (tracking tokens, URL fragments) are not content words. */
function isOpaqueToken(t: string): boolean {
  if (t.length < 12) return false;
  const vowels = (t.match(/[aeiouy]/g) ?? []).length;
  return vowels / t.length < 0.25;
}

/** Lowercase content tokens: length >= 4, apostrophes/hyphens kept, stopwords out. */
function contentTokens(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
  return raw.filter((t) => !STOPWORDS.has(t) && !isOpaqueToken(t));
}

/** Crude deterministic stem: fold trailing plural/verb endings for matching. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Frequency-ranked distinctive words; surface variants folded by stem so
 * "coach"/"coaches" count once; ties by length desc, then alpha. Stems in
 * `exclude` (sender/recipient name tokens) never rank — words identifying
 * the correspondents are not "what the email asks".
 */
function topDistinctive(tokens: string[], n: number, exclude: Set<string>): string[] {
  const bySt = new Map<string, { count: number; surfaces: Map<string, number> }>();
  for (const t of tokens) {
    const s = stem(t);
    if (exclude.has(s)) continue;
    const entry = bySt.get(s) ?? { count: 0, surfaces: new Map<string, number>() };
    entry.count += 1;
    entry.surfaces.set(t, (entry.surfaces.get(t) ?? 0) + 1);
    bySt.set(s, entry);
  }
  const represent = (e: { surfaces: Map<string, number> }): string =>
    [...e.surfaces.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return [...bySt.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([, e]) => represent(e));
}

/** Digit runs in a text ("3:45pm, 32 fields" -> ["3","45","32"]). */
function digitRuns(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/**
 * Mid-sentence capitalised words + ALL-CAPS acronyms from model output.
 * Sentence-initial tokens are skipped (they are capitalised by grammar, not
 * because they name an entity).
 */
function properNounCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Z][a-z'’-]+|[A-Z]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).replace(/["'“”‘’([]+$/, '');
    const sentenceInitial = /(^|[.!?:;\n]\s*|^\s*[-*]\s*)$/.test(before);
    if (!sentenceInitial) out.push(m[0]);
  }
  return out;
}

const ACRONYM_ALLOW = new Set(['RE', 'FW', 'FWD', 'AM', 'PM', 'SUMMARY', 'REPLY']);

// ── LLM turn (same mechanism as scripts/v2-chatbot-e2e.ts) ──────────────────

const FIDELITY_SYSTEM_PROMPT = `You are an AI assistant for a primary-school principal in Trinidad & Tobago.
The user forwards you an email. Summarise what this email asks of the recipient, then draft a short reply addressing it.
Format your answer EXACTLY as:

SUMMARY:
<2-4 sentence summary of what the email asks>

REPLY:
<short reply draft>

No other sections, no preamble.`;

async function callBedrock(
  client: BedrockRuntimeClient,
  userText: string,
): Promise<{ text: string; latencyMs: number }> {
  const t0 = Date.now();
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: FIDELITY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
  };
  const cmd = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(body)),
  });
  const resp = await client.send(cmd);
  const decoded = new TextDecoder().decode(resp.body!);
  const parsed = JSON.parse(decoded) as { content?: Array<{ type?: string; text?: string }> };
  const block = parsed.content?.find((c) => c.type === 'text');
  return { text: block?.text ?? '', latencyMs: Date.now() - t0 };
}

function splitSummaryReply(text: string): { summary: string; reply: string; parsed: boolean } {
  const sm = /SUMMARY:\s*([\s\S]*?)\n\s*REPLY:/i.exec(text);
  const rm = /REPLY:\s*([\s\S]*)$/i.exec(text);
  if (sm && rm) return { summary: sm[1].trim(), reply: rm[1].trim(), parsed: true };
  // Format drift is not a fidelity failure; assert against the whole output.
  return { summary: text.trim(), reply: text.trim(), parsed: false };
}

// ── candidate selection ──────────────────────────────────────────────────────

const CORRESPONDENCE_HINT = /\b(meeting|report|request|parent|teacher|student|school|term|deadline|submit|leave|attendance|circular|minutes|agenda|budget|training|workshop|form|suspension|invoice|schedule)\b/i;
const BARE_TEST_SUBJECT = /^\s*(\[draft\]|test\b|e2e\b|eval\b|smoke\b|draft\b|probe\b|raj-?\d)/i;

interface Candidate {
  id: string;
  subject: string;
  sender: string;
  bodyChars: number;
  totalTokens: number;
  distinctWords: number;
  correspondence: boolean;
  bareTest: boolean;
  body: string; // held in memory only; never printed or written to disk
  recipients: string;
}

function candidateRank(a: Candidate, b: Candidate): number {
  if (a.correspondence !== b.correspondence) return a.correspondence ? -1 : 1;
  if (a.bareTest !== b.bareTest) return a.bareTest ? 1 : -1;
  return b.distinctWords - a.distinctWords;
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('=== RAJ-2 reply-fidelity check (model layer) ===');
  console.log(`model=${MODEL_ID} region=${REGION}`);
  console.log('No compose pane will be opened; nothing will be sent.\n');

  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const grounder = new VlmGrounder();
  const actions = new OutlookActions(driver, grounder);

  // Warmup hygiene (same as v2-eval.ts): dismiss leftovers, land on Inbox.
  try {
    await driver.ensureBrowser();
    const page = await driver.ensureOutlookTab();
    await driver.pressKey('Escape').catch(() => null);
    await driver.sleep(300);
    const inboxLink = page.getByRole('treeitem', { name: /^inbox/i }).first();
    if ((await inboxLink.count().catch(() => 0)) > 0) {
      await inboxLink.click({ timeout: 3_000 }).catch(() => null);
      await driver.sleep(500);
    }
  } catch { /* best effort */ }

  console.log(`Step 1: read inbox (top ${CANDIDATE_TOP})`);
  const inbox = await actions.readInbox(CANDIDATE_TOP);
  if (inbox.status !== 'ok' || !inbox.messages.length) {
    console.error(`FATAL: could not read inbox: status=${inbox.status}`);
    await driver.close().catch(() => {});
    process.exit(2);
  }
  console.log(`  ${inbox.messages.length} rows visible`);

  console.log('\nStep 2: read each candidate body and score by content-word count');
  const candidates: Candidate[] = [];
  for (const row of inbox.messages) {
    const r = await actions.readEmail({ id: row.id });
    if (r.status !== 'ok' || !r.body) {
      console.log(`  - "${(row.subject ?? '').slice(0, 120)}" read failed (status=${r.status}); skipping`);
      continue;
    }
    // Prefer the inbox row subject: readEmail's heading heuristic can grab a
    // UI pane heading ("Navigation pane") instead of the message subject.
    const subject = (row.subject || r.subject || '').trim();
    const scored = stripDisclaimer(r.body);
    const tokens = contentTokens(scored);
    const distinct = new Set(tokens).size;
    const c: Candidate = {
      id: row.id,
      subject,
      sender: r.sender ?? row.sender ?? '',
      bodyChars: r.body.length,
      totalTokens: tokens.length,
      distinctWords: distinct,
      correspondence: CORRESPONDENCE_HINT.test(`${subject} ${scored}`),
      bareTest: BARE_TEST_SUBJECT.test(subject),
      body: r.body,
      recipients: [...(r.recipients?.to ?? []), ...(r.recipients?.cc ?? [])].join(' '),
    };
    candidates.push(c);
    console.log(
      `  - "${subject.slice(0, 120)}" — ${c.distinctWords} distinct content words`
      + ` (tokens=${c.totalTokens}, chars=${c.bodyChars},`
      + ` correspondence=${c.correspondence}, bareTest=${c.bareTest})`,
    );
  }

  const eligible = candidates.filter((c) => c.distinctWords >= MIN_CONTENT_WORDS).sort(candidateRank);
  if (!eligible.length) {
    console.log(`\nVERDICT: BLOCKED-SEEDING — no inbox message has >= ${MIN_CONTENT_WORDS} distinct content words.`);
    console.log('Inbox survey (subject <= 120 chars, distinct content words):');
    for (const c of candidates) {
      console.log(`  - "${c.subject.slice(0, 120)}" — ${c.distinctWords}`);
    }
    console.log('Owner ask: authorize one self-addressed sandbox seed email with structured content,'
      + ' or forward any real circular to the sandbox inbox.');
    await driver.close().catch(() => {});
    process.exit(3);
  }

  const chosen = eligible[0];
  console.log(`\nStep 3: chosen "${chosen.subject.slice(0, 120)}"`);
  console.log(`  source stats: chars=${chosen.bodyChars} tokens=${chosen.totalTokens} distinct=${chosen.distinctWords}`);

  console.log('\nStep 4: live LLM summarise + draft-reply turn');
  const client = new BedrockRuntimeClient({ region: REGION });
  let llmText = '';
  let llmMs = 0;
  try {
    const turn = await callBedrock(
      client,
      `Subject: ${chosen.subject}\nFrom: ${chosen.sender}\n\n${chosen.body}`,
    );
    llmText = turn.text;
    llmMs = turn.latencyMs;
  } catch (err) {
    console.error(`VERDICT: BLOCKED-INFRA — model call failed: ${err instanceof Error ? err.message : String(err)}`);
    await driver.close().catch(() => {});
    process.exit(4);
  }
  if (!llmText.trim()) {
    console.error('VERDICT: BLOCKED-INFRA — model returned an empty text block.');
    await driver.close().catch(() => {});
    process.exit(4);
  }
  const { summary, reply, parsed } = splitSummaryReply(llmText);
  console.log(`  LLM (${llmMs}ms): summary=${summary.length} chars, reply=${reply.length} chars, formatParsed=${parsed}`);

  console.log('\nStep 5: deterministic fidelity assertions');

  const nameAllow = new Set(
    `${chosen.sender} ${chosen.recipients} test.fac fac.edu.tt`
      .toLowerCase()
      .match(/[a-z][a-z'’.-]+/g) ?? [],
  );
  const nameStems = new Set([...nameAllow].map(stem));

  // COVERAGE — top-N distinctive source words must appear in the summary.
  // Scored against the disclaimer-stripped body: legal footers are not what
  // the email asks of the recipient. Sender/recipient name tokens never rank.
  const topWords = topDistinctive(contentTokens(stripDisclaimer(chosen.body)), TOP_N, nameStems);
  const summaryStems = new Set(contentTokens(summary).map(stem));
  const covered = topWords.filter((w) => summaryStems.has(stem(w)));
  const coverage = topWords.length ? covered.length / topWords.length : 0;
  console.log(`  top-${topWords.length} distinctive source words: ${topWords.join(', ')}`);
  console.log(`  covered by summary: ${covered.join(', ') || '<none>'}`);
  console.log(`  coverage: ${covered.length}/${topWords.length} = ${(coverage * 100).toFixed(0)}% (floor ${COVERAGE_FLOOR * 100}%)`);
  const coverageOk = coverage >= COVERAGE_FLOOR;

  // NO-INVENTION — entities in the model output must exist in the source.
  // The system prompt is also legitimate context: the persona line names
  // Trinidad & Tobago, so those words are not inventions of email content.
  const sourceText = `${chosen.subject}\n${chosen.sender}\n${chosen.recipients}\n${chosen.body}`;
  const sourceLower = `${sourceText}\n${FIDELITY_SYSTEM_PROMPT}`.toLowerCase();
  const sourceDigits = digitRuns(sourceText);
  const now = new Date();
  const todayAllow = new Set([
    String(now.getFullYear()),
    String(now.getMonth() + 1),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()),
    String(now.getDate()).padStart(2, '0'),
  ]);
  const todayWords = new Set([
    WEEKDAYS[(now.getDay() + 6) % 7],
    MONTHS[now.getMonth()],
  ]);

  // Template placeholders like "[Your Name]" or "[Principal's Name]" are
  // fill-in slots, not invented content — drop bracketed segments before
  // entity extraction.
  const modelOut = `${summary}\n${reply}`.replace(/\[[^\]\n]{0,60}\]/g, ' ');
  const invented = new Set<string>();

  for (const cand of properNounCandidates(modelOut)) {
    const lower = cand.toLowerCase();
    // Possessive of a sourced entity is not invention ("Tobago's" vs "Tobago").
    const base = lower.replace(/['’]s$/, '');
    if (/^[A-Z]{2,}$/.test(cand)) {
      if (!ACRONYM_ALLOW.has(cand) && !sourceLower.includes(lower) && !sourceLower.includes(base)) {
        invented.add(cand);
      }
      continue;
    }
    if (STOPWORDS.has(lower)) continue;
    if (nameAllow.has(lower) || nameAllow.has(base)) continue;
    if ((WEEKDAYS.includes(lower) || MONTHS.includes(lower)) && todayWords.has(lower)) continue;
    if (!sourceLower.includes(lower) && !sourceLower.includes(base)) invented.add(cand);
  }
  // Weekday/month names in any casing (mid-sentence or not) must be sourced.
  for (const word of [...WEEKDAYS, ...MONTHS]) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(modelOut) && !re.test(sourceText) && !todayWords.has(word)) {
      invented.add(word);
    }
  }
  // Numbers: every digit run in the output must exist in the source.
  for (const run of digitRuns(modelOut)) {
    if (!sourceDigits.has(run) && !todayAllow.has(run)) invented.add(run);
  }

  const inventedList = [...invented].sort();
  console.log(`  invented entities: ${inventedList.length ? inventedList.join(', ') : '<none>'}`);
  const inventionOk = inventedList.length === 0;

  console.log('\n=== verdict ===');
  console.log(`  subject:   "${chosen.subject.slice(0, 120)}"`);
  console.log(`  source:    chars=${chosen.bodyChars} tokens=${chosen.totalTokens} distinct=${chosen.distinctWords}`);
  console.log(`  coverage:  ${covered.length}/${topWords.length} (${(coverage * 100).toFixed(0)}%) — ${coverageOk ? 'ok' : 'BELOW FLOOR'}`);
  console.log(`  invention: ${inventedList.length ? inventedList.join(', ') : 'none'} — ${inventionOk ? 'ok' : 'INVENTED ENTITIES'}`);
  console.log(`  compose pane opened: no; emails sent: none`);
  const pass = coverageOk && inventionOk;
  console.log(pass
    ? 'RAJ-2 VERDICT: PASS — model summary+draft are faithful to the source email on current code.'
    : 'RAJ-2 VERDICT: FAIL — model output diverges from the source email (misinterpretation class reproduced).');

  await driver.close().catch(() => {});
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(2);
});
