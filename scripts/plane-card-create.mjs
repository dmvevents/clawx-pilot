#!/usr/bin/env node
// plane-card-create.mjs — the ONLY sanctioned way to create cards on the CLWX
// Plane board from an agent session. Sibling of plane-comment-post.mjs and
// deliberately identical in its safety contract:
//
//   1. The project id comes from CLWX_PROJECT_ID or the hardcoded CLWX default.
//      PLANE_PROJECT is explicitly IGNORED — that variable is exported by
//      ~/issues-agent-runtime/plane/.agent-token and points at the GHIP project.
//      This Plane build ACCEPTS a cross-project write and then hides the row
//      from every CLWX read path (2026-09-06 incident, five lost comments).
//   2. Every create is READBACK-VERIFIED under the same project path: fetchable
//      by id AND present in the issue list, or the script reports it orphaned.
//   3. Titles are de-duplicated against the live board before writing, so
//      re-running a fold does not double-file. Duplicates are SKIPPED and named,
//      never silently merged.
//   4. Agents may file at most into an open state (default Backlog). The board
//      ceiling — cards move at most to Ready, only a human closes Done — is not
//      this script's business, but it will refuse to create anything directly in
//      a completed/cancelled state so a fold cannot fabricate closed work.
//
// Secrets: reads PLANE_API_KEY from the environment; never prints it.
//
// Usage:
//   set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a
//   node scripts/plane-card-create.mjs --file /tmp/cards.json [--dry-run]
//
// Payload: a JSON array (or {cards:[…]}) of objects:
//   { "name": "…", "description_html": "<p>…</p>",
//     "state": "Backlog", "priority": "medium" }
// `state` and `priority` are optional (default Backlog / none).
import { readFileSync } from 'node:fs';

const BASE = process.env.PLANE_BASE_URL || 'http://localhost:8090';
const WS = process.env.PLANE_WORKSPACE || 'issues-agent';
const KEY = process.env.PLANE_API_KEY;
// CLWX board. Deliberately NOT process.env.PLANE_PROJECT — see header.
const PROJ = process.env.CLWX_PROJECT_ID || '81a2ea23-e060-49b4-a344-1ab0339f46d5';
if (!KEY) { console.error('PLANE_API_KEY not set — source the token file first.'); process.exit(1); }
if (!/^[\x21-\x7E]+$/.test(KEY)) {
  console.error('PLANE_API_KEY is malformed (contains whitespace/control or non-ASCII characters) — refusing.');
  process.exit(1);
}
const scrub = (s) => String(s).split(KEY).join('[REDACTED]');
process.on('uncaughtException', (e) => { console.error('FAIL:', scrub(e?.message || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('FAIL:', scrub(e?.message || e)); process.exit(1); });
if (process.env.PLANE_PROJECT && process.env.PLANE_PROJECT !== PROJ) {
  console.error(`note: ignoring PLANE_PROJECT=${process.env.PLANE_PROJECT} (that is another agent's project); creating under ${PROJ}`);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`FAIL: ${name} requires a value`); process.exit(1); }
  return v;
};
const file = opt('--file');
const dryRun = args.includes('--dry-run');
if (!file) {
  console.error('usage: plane-card-create.mjs --file <cards.json> [--dry-run]');
  process.exit(1);
}

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low', 'none']);
let parsed;
try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch {
  console.error(`FAIL: ${file} is not valid JSON`);
  process.exit(1);
}
const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
if (!Array.isArray(cards) || cards.length === 0) {
  console.error(`FAIL: ${file} must be a JSON array of cards (or {"cards":[…]})`);
  process.exit(1);
}
cards.forEach((c, i) => {
  if (!c || typeof c.name !== 'string' || !c.name.trim()) {
    console.error(`FAIL: card[${i}] has no "name" string`);
    process.exit(1);
  }
  if (c.priority !== undefined && !PRIORITIES.has(String(c.priority))) {
    console.error(`FAIL: card[${i}] priority "${c.priority}" is not one of ${[...PRIORITIES].join('/')}`);
    process.exit(1);
  }
});

const api = `${BASE}/api/v1/workspaces/${WS}/projects/${PROJ}`;
const H = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
const req = async (url, init) => {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: H, ...init });
    if (r.ok) return r.status === 204 ? null : r.json();
    if (r.status === 429 && attempt < 6) {
      const retryAfter = Number(r.headers.get('retry-after')) || attempt * 15;
      await new Promise((res) => setTimeout(res, retryAfter * 1000));
      continue;
    }
    throw new Error(`${r.status} ${init?.method || 'GET'} ${url}`);
  }
};
const getAll = async (path) => {
  let url = `${api}/${path}${path.includes('?') ? '&' : '?'}per_page=100`, out = [];
  for (;;) {
    const j = await req(url);
    out.push(...(j.results || (Array.isArray(j) ? j : [])));
    if (j.next_page_results && j.next_cursor) {
      url = `${api}/${path}${path.includes('?') ? '&' : '?'}per_page=100&cursor=${j.next_cursor}`;
    } else break;
  }
  return out;
};

const project = await req(`${api}/`);
const states = await getAll('states/');
const existing = await getAll('issues/');
const titles = new Map(existing.map((i) => [i.name.trim().toLowerCase(), i.sequence_id]));

const resolveState = (wanted) => {
  const want = String(wanted || 'Backlog').trim().toLowerCase();
  const state = states.find((s) => s.name.trim().toLowerCase() === want);
  if (!state) {
    console.error(`FAIL: no state named "${wanted}" on this board (have: ${states.map((s) => s.name).join(', ')})`);
    process.exit(1);
  }
  // A fold must never fabricate finished work.
  if (['completed', 'cancelled'].includes(String(state.group))) {
    console.error(`FAIL: refusing to create a card directly in "${state.name}" (group ${state.group})`);
    process.exit(1);
  }
  return state;
};

let created = 0, skipped = 0;
for (const card of cards) {
  const key = card.name.trim().toLowerCase();
  if (titles.has(key)) {
    console.log(`SKIP (already on board as ${project.identifier}-${titles.get(key)}): ${card.name}`);
    skipped += 1;
    continue;
  }
  const state = resolveState(card.state);
  if (dryRun) {
    console.log(`DRY-RUN would create [${state.name}/${card.priority || 'none'}]: ${card.name}`);
    continue;
  }
  const body = {
    name: card.name.trim(),
    state: state.id,
    priority: String(card.priority || 'none'),
  };
  if (typeof card.description_html === 'string' && card.description_html.trim()) {
    body.description_html = card.description_html;
  }
  const issue = await req(`${api}/issues/`, { method: 'POST', body: JSON.stringify(body) });
  if (!issue?.id) { console.error(`FAIL: create returned no id for "${card.name}"`); process.exit(1); }
  let verified = false;
  try {
    const back = await req(`${api}/issues/${issue.id}/`);
    const listed = (await getAll('issues/')).some((i) => i.id === issue.id);
    verified = back?.id === issue.id && listed;
  } catch (e) {
    console.error(scrub(`FAIL: issue ${issue.id} was created but the readback errored (${e.message}) — verification INCONCLUSIVE. Check the board before re-running (a duplicate is possible).`));
    process.exit(1);
  }
  if (!verified) {
    console.error(`FAIL: issue ${issue.id} was created but is NOT readable under project ${PROJ} — it is ORPHANED. Investigate before re-running.`);
    process.exit(1);
  }
  titles.set(key, issue.sequence_id);
  created += 1;
  console.log(`OK ${project.identifier}-${issue.sequence_id} [${state.name}/${body.priority}] ${card.name} (readback verified)`);
}
console.log(`done: ${created} created, ${skipped} skipped as duplicates${dryRun ? ' (dry run)' : ''}`);
