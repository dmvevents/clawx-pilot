/**
 * CLWX-115 — deterministic person→fact ASSOCIATION checker for the RAJ-2
 * misinterpretation class ("meal-preferences email read back as shirt sizes",
 * reported 2026-06-21).
 *
 * Why membership is not enough: the standalone live probe
 * (scripts/raj2-reply-fidelity-check.ts) asserts word COVERAGE and entity
 * NON-INVENTION. Both are membership checks over unordered token sets, so a
 * summary that says "Keisha gets the chicken meal, Marcus gets the vegetarian
 * meal" against a source that says the opposite passes them: every word and
 * every entity is sourced — only the BINDING is wrong. Same blind spot for a
 * dropped negation: "Anil is attending" is a strict subset of "Anil is not
 * attending". This module asserts the bindings themselves.
 *
 * Contract (deterministic; no model, no network, no I/O — pinned by
 * tests/unit/raj2-association-fidelity.test.ts and driven by the gate runner
 * scripts/raj2-association-fidelity-gate.mjs):
 *
 *   - The output is segmented into sentences/lines. A fact value occurrence is
 *     ATTRIBUTED to the nearest person mention that PRECEDES it in the same
 *     segment; with no preceding mention it is unattributed and asserts
 *     nothing (aggregate recaps like "the vegetarian, chicken and fish meals"
 *     are recaps, not bindings).
 *   - association-missing      — no occurrence of the fact's value attributed
 *                                to the expected person.
 *   - association-misattributed— an expected value of an attribute attributed
 *                                to a person who does not hold that value.
 *   - attribute-cue-missing    — value found with the right person but none of
 *                                the fact's attribute cue words in the segment
 *                                (the literal RAJ-2 class: "small MEAL" where
 *                                the source said "small SHIRT").
 *   - negation-dropped         — a negated fact stated without a negation cue
 *                                in the window around the value.
 *   - negation-inverted        — a positive fact stated under a negation cue.
 *   - action-token-missing     — a required requested-action token absent from
 *                                the whole output.
 *
 * Windows are fixed constants, not tunables: fixtures are authored against
 * them and the mutation controls in the fixture keep them honest — if a
 * window change lets a swap or a dropped negation pass, the control case
 * flips to PASS and the runner goes RED.
 */

export const NEGATION_CUES = [
  'not', 'no', 'never', 'without', "won't", 'will not', "isn't", "doesn't",
  "can't", 'cannot', 'declined', 'opted out', 'excluding', 'except',
];

/** Chars scanned BEFORE a value for a negation cue (both rules). */
export const NEG_BEFORE_WINDOW = 24;
/** Chars scanned AFTER a value for a cue — negated facts only. The inverted
 * rule must NOT look ahead: in "an extra-large shirt with no peanuts" the
 * lookahead from "extra-large" reaches the legitimate "no" of the NEXT fact
 * and would fail a faithful summary. */
export const NEG_AFTER_WINDOW = 16;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word matcher; hyphen counts as a word char so "small" never matches
 * inside "x-small" and "extra-large" matches only as itself. */
function tokenRegex(token) {
  const body = escapeRe(token.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![A-Za-z0-9-])${body}(?![A-Za-z0-9-])`, 'gi');
}

/** Sentence/line segments with their offsets in the original text. */
export function segmentText(text) {
  const segments = [];
  const re = /[^.!?\n]+[.!?]?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (raw.trim().length === 0) continue;
    segments.push({ text: raw, start: m.index });
  }
  return segments;
}

function allMatches(re, text) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Person mentions in one segment; longer aliases claim their span first so
 * "Marcus" inside "Marcus Persad" is one mention of one person. */
export function findMentions(segmentText_, persons) {
  const mentions = [];
  const claimed = [];
  const aliases = persons
    .flatMap((p) => [p.name, ...(p.aliases ?? [])].map((alias) => ({ alias, person: p.name })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, person } of aliases) {
    for (const hit of allMatches(tokenRegex(alias), segmentText_)) {
      if (claimed.some((c) => hit.start < c.end && hit.end > c.start)) continue;
      claimed.push(hit);
      mentions.push({ person, start: hit.start, end: hit.end });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function hasCueInWindow(segment, valueStart, valueEnd, lookAfter) {
  const from = Math.max(0, valueStart - NEG_BEFORE_WINDOW);
  const to = lookAfter ? Math.min(segment.length, valueEnd + NEG_AFTER_WINDOW) : valueStart;
  const window = segment.slice(from, to);
  return NEGATION_CUES.some((cue) => tokenRegex(cue).test(window));
}

function factValues(fact) {
  return [fact.value, ...(fact.aliases ?? [])];
}

/**
 * Attributed occurrences of `values` across the output.
 * Returns [{ person|null, segment, start, end }].
 */
function attributedOccurrences(outputText, persons, values) {
  const occurrences = [];
  for (const segment of segmentText(outputText)) {
    const mentions = findMentions(segment.text, persons);
    for (const value of values) {
      for (const hit of allMatches(tokenRegex(value), segment.text)) {
        const preceding = mentions.filter((m) => m.end <= hit.start);
        const nearest = preceding.length ? preceding[preceding.length - 1] : null;
        occurrences.push({ person: nearest ? nearest.person : null, segment: segment.text, start: hit.start, end: hit.end });
      }
    }
  }
  return occurrences;
}

/**
 * Check one model output against the fixture expectations.
 * Returns { verdict: 'PASS'|'FAIL', failures: [{type, person, attribute, value, detail}] }.
 */
export function checkAssociationFidelity(outputText, expectations) {
  const failures = [];
  const persons = expectations.persons ?? [];
  const text = String(outputText ?? '');

  for (const person of persons) {
    for (const fact of person.facts ?? []) {
      const occs = attributedOccurrences(text, persons, factValues(fact));
      const mine = occs.filter((o) => o.person === person.name);
      if (mine.length === 0) {
        failures.push({ type: 'association-missing', person: person.name, attribute: fact.attribute, value: fact.value, detail: 'no occurrence of the value is attributed to this person' });
        continue;
      }
      const cues = fact.attributeCues ?? [];
      if (cues.length > 0 && !mine.some((o) => cues.some((cue) => tokenRegex(cue).test(o.segment)))) {
        failures.push({ type: 'attribute-cue-missing', person: person.name, attribute: fact.attribute, value: fact.value, detail: `value bound to the person but none of [${cues.join(', ')}] appears in any such segment` });
      }
      if (fact.negated) {
        for (const o of mine) {
          if (!hasCueInWindow(o.segment, o.start, o.end, true)) {
            failures.push({ type: 'negation-dropped', person: person.name, attribute: fact.attribute, value: fact.value, detail: 'negated fact stated without a negation cue' });
            break;
          }
        }
      } else {
        for (const o of mine) {
          if (hasCueInWindow(o.segment, o.start, o.end, false)) {
            failures.push({ type: 'negation-inverted', person: person.name, attribute: fact.attribute, value: fact.value, detail: 'positive fact stated under a negation cue' });
            break;
          }
        }
      }
    }
  }

  // Misattribution: any expected value of an attribute bound to a person who
  // does not hold that value for that attribute (includes persons holding NO
  // fact for it — a fact invented onto the wrong person is still a swap).
  const byAttribute = new Map();
  for (const person of persons) {
    for (const fact of person.facts ?? []) {
      const entry = byAttribute.get(fact.attribute) ?? { values: new Map() };
      for (const v of factValues(fact)) {
        const key = v.toLowerCase();
        const holders = entry.values.get(key) ?? new Set();
        holders.add(person.name);
        entry.values.set(key, holders);
      }
      byAttribute.set(fact.attribute, entry);
    }
  }
  for (const [attribute, entry] of byAttribute) {
    for (const [valueKey, holders] of entry.values) {
      for (const o of attributedOccurrences(text, persons, [valueKey])) {
        if (o.person !== null && !holders.has(o.person)) {
          failures.push({ type: 'association-misattributed', person: o.person, attribute, value: valueKey, detail: `value belongs to ${[...holders].join('/')} but is bound to ${o.person}` });
        }
      }
    }
  }

  for (const token of expectations.requiredActionTokens ?? []) {
    if (!tokenRegex(token).test(text)) {
      failures.push({ type: 'action-token-missing', person: null, attribute: 'requested-action', value: token, detail: 'required requested-action token absent from the output' });
    }
  }

  return { verdict: failures.length === 0 ? 'PASS' : 'FAIL', failures };
}

/** Mutation classes the fixture MUST carry as expected-FAIL controls; without
 * them a weakened checker could go green silently. */
export const REQUIRED_MUTATION_CLASSES = ['association-swap', 'attribute-swap', 'negation-drop'];

/**
 * Structural fail-closed validation of the fixture itself.
 * Returns an array of problems; empty means structurally sound.
 */
export function validateFixtureShape(fixture) {
  const problems = [];
  if (!fixture || typeof fixture !== 'object') return ['fixture is not an object'];
  const persons = fixture.expectations?.persons ?? [];
  if (persons.length < 2) problems.push('fixture needs at least two persons');
  const firstNames = persons.map((p) => String(p.name ?? '').split(/\s+/)[0].toLowerCase());
  if (new Set(firstNames).size === firstNames.length) {
    problems.push('fixture needs overlapping person names (two persons sharing a first name)');
  }
  const facts = persons.flatMap((p) => p.facts ?? []);
  if (!facts.some((f) => f.negated)) problems.push('fixture needs at least one negated fact');
  if (!facts.some((f) => /^\d+$/.test(String(f.value)))) problems.push('fixture needs at least one quantity fact');
  if (!(fixture.expectations?.requiredActionTokens ?? []).length) problems.push('fixture needs requiredActionTokens');
  const cases = fixture.cases ?? [];
  if (!cases.some((c) => c.expected === 'PASS')) problems.push('fixture needs at least one expected-PASS case');
  const classes = new Set(cases.filter((c) => c.expected === 'FAIL').map((c) => c.mutationClass));
  for (const required of REQUIRED_MUTATION_CLASSES) {
    if (!classes.has(required)) problems.push(`fixture is missing the required expected-FAIL mutation control: ${required}`);
  }
  for (const c of cases) {
    if (!c.id || !c.output || !['PASS', 'FAIL'].includes(c.expected)) {
      problems.push(`case ${c.id ?? '<missing id>'} needs id, output and expected PASS|FAIL`);
    }
  }
  return problems;
}

/**
 * Evaluate every fixture case; ok only when the fixture is structurally sound
 * AND every computed verdict equals the authored expectation (controls must
 * FAIL for the run to pass — that is the negative control, not a formality).
 */
export function evaluateFixture(fixture) {
  const problems = validateFixtureShape(fixture);
  if (problems.length > 0) return { ok: false, problems, results: [] };
  const results = (fixture.cases ?? []).map((c) => {
    const { verdict, failures } = checkAssociationFidelity(c.output, fixture.expectations);
    return { id: c.id, expected: c.expected, computed: verdict, matched: verdict === c.expected, mutationClass: c.mutationClass ?? null, failureTypes: [...new Set(failures.map((f) => f.type))], failures };
  });
  return { ok: results.every((r) => r.matched), problems: [], results };
}
