#!/usr/bin/env node
// report-bug.mjs — file a bug to the CLWX Plane board with a consistent shape.
//
// Every bug lands in Backlog with a templated body (repro / expected / actual /
// evidence / environment) and a severity-mapped priority, so triage is uniform
// and nothing gets lost in chat. Read the board via scripts/plane-board-export.mjs.
//
// Secrets: reads PLANE_API_KEY from the environment; never prints it.
//   set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a
//
// Usage:
//   node scripts/report-bug.mjs \
//     --title "Outlook send stalls on ambiguous draft" \
//     --severity high \                 # critical|high|medium|low  -> urgent|high|medium|low
//     --area outlook \                  # outlook|forms|gateway|windows|offline|model|ui|packaging|other
//     --repro "1. open compose\n2. ..." \
//     --expected "hard-confirm gate fires" \
//     --actual  "spinner forever" \
//     --evidence "skills/laptop/evidence/2026-09-01-.../log.txt" \
//     --env "moe.11 / Windows 11 24H2 / gemini-2.5-pro"
//
// Omitted fields are left as TODO markers in the body (a bug with unknown repro
// is still worth filing — the TODO makes the gap explicit for triage).
import process from 'node:process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i] ?? '';
}
const BASE = process.env.PLANE_BASE_URL || 'http://localhost:8090';
const WS = process.env.PLANE_WORKSPACE || 'issues-agent';
const KEY = process.env.PLANE_API_KEY;
const PROJ = process.env.CLWX_PROJECT_ID || '81a2ea23-e060-49b4-a344-1ab0339f46d5';
const BACKLOG = process.env.CLWX_BACKLOG_STATE || '90af3385-b6b9-450e-9ffe-e482feb7a5bf';
if (!KEY) { console.error('PLANE_API_KEY not set — source the token file first.'); process.exit(1); }
if (!args.title) { console.error('--title is required.'); process.exit(1); }

const SEV = { critical: 'urgent', high: 'high', medium: 'medium', low: 'low' };
const priority = SEV[(args.severity || 'medium').toLowerCase()] || 'medium';
const area = (args.area || 'other').toLowerCase();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const field = (v, todo) => (v ? esc(v).replace(/\\n/g, '<br>') : `<i>TODO: ${todo}</i>`);

const body = [
  `<p><b>Area:</b> ${esc(area)} &nbsp; <b>Severity:</b> ${esc(args.severity || 'medium')} (priority ${priority})</p>`,
  `<p><b>Steps to reproduce</b><br>${field(args.repro, 'exact steps')}</p>`,
  `<p><b>Expected</b><br>${field(args.expected, 'what should happen')}</p>`,
  `<p><b>Actual</b><br>${field(args.actual, 'what happens instead')}</p>`,
  `<p><b>Evidence</b><br>${field(args.evidence, 'log path / screenshot / trace id')}</p>`,
  `<p><b>Environment</b><br>${field(args.env, 'build / OS / model')}</p>`,
  `<p><b>Regression class?</b> ${esc(args.regression || 'unknown — check the *-auditor agents (config-coherence, dependency-class, dom-selector, state-idempotency)')}</p>`,
].join('\n');

const api = `${BASE}/api/v1/workspaces/${WS}/projects/${PROJ}`;
const r = await fetch(`${api}/issues/`, {
  method: 'POST',
  headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `[bug/${area}] ${args.title}`, description_html: body, state: BACKLOG, priority }),
});
if (!r.ok) { console.error(`Plane ${r.status}: ${await r.text()}`); process.exit(1); }
const issue = await r.json();
console.log(`Filed CLWX-${issue.sequence_id} (${priority}) in Backlog: ${args.title}`);
console.log(`Refresh the repo backup: node scripts/plane-board-export.mjs`);
