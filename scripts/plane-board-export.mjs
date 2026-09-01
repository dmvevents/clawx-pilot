#!/usr/bin/env node
// plane-board-export.mjs — snapshot the CLWX Plane board into the repo.
//
// Produces two artifacts under docs/plane-board/:
//   - CLWX-board-export.json  : restore-grade raw dump (states + issues + comments)
//   - CLWX-board.md           : human-readable mirror, grouped by state
//
// Read-only against Plane. Secrets: reads PLANE_API_KEY from the environment
// (source ~/issues-agent-runtime/plane/.agent-token first); never prints it.
//
// Usage:
//   set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a
//   node scripts/plane-board-export.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PLANE_BASE_URL || 'http://localhost:8090';
const WS = process.env.PLANE_WORKSPACE || 'issues-agent';
const KEY = process.env.PLANE_API_KEY;
const PROJ = process.env.CLWX_PROJECT_ID || '81a2ea23-e060-49b4-a344-1ab0339f46d5';
if (!KEY) { console.error('PLANE_API_KEY not set — source the token file first.'); process.exit(1); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'plane-board');
mkdirSync(outDir, { recursive: true });

const api = `${BASE}/api/v1/workspaces/${WS}/projects/${PROJ}`;
const H = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
const get = async (url) => {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
// Paginate Plane's cursor list responses.
const getAll = async (path) => {
  let url = `${api}/${path}${path.includes('?') ? '&' : '?'}per_page=100`, out = [];
  for (;;) {
    const j = await get(url);
    out.push(...(j.results || (Array.isArray(j) ? j : [])));
    if (j.next_page_results && j.next_cursor) {
      url = `${api}/${path}${path.includes('?') ? '&' : '?'}per_page=100&cursor=${j.next_cursor}`;
    } else break;
  }
  return out;
};

const project = await get(`${api}/`);
const states = await getAll('states/');
const stateById = Object.fromEntries(states.map((s) => [s.id, s]));
const issues = await getAll('issues/');

// Enrich each issue with full detail + comments (small board — cheap).
for (const it of issues) {
  try {
    const detail = await get(`${api}/issues/${it.id}/`);
    it.description_stripped = detail.description_stripped ?? it.description_stripped;
    it.description_html = detail.description_html ?? it.description_html;
    it.comments = await getAll(`issues/${it.id}/comments/`);
  } catch (e) { it._enrich_error = String(e); }
}

const stamp = process.env.EXPORT_STAMP || new Date().toISOString().slice(0, 10);
const snapshot = {
  exported_at_date: stamp,
  source: { base: BASE, workspace: WS, project_id: PROJ },
  project: { id: project.id, name: project.name, identifier: project.identifier },
  states: states.map((s) => ({ id: s.id, name: s.name, group: s.group })),
  issues: issues.map((i) => ({
    id: i.id, sequence_id: i.sequence_id, name: i.name, priority: i.priority,
    state: stateById[i.state]?.name ?? i.state, state_id: i.state,
    description: i.description_stripped || '',
    comments: (i.comments || []).map((c) => ({ text: c.comment_stripped || '', created: c.created_at })),
  })),
};

writeFileSync(join(outDir, 'CLWX-board-export.json'), JSON.stringify(snapshot, null, 2));

// Markdown mirror, grouped by state group order.
const order = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const byGroup = {};
for (const i of snapshot.issues) {
  const st = states.find((s) => s.id === i.state_id);
  const g = st?.group || 'other';
  (byGroup[g] ||= []).push({ ...i, stateName: st?.name || i.state });
}
let md = `# CLWX Plane board — snapshot\n\n`;
md += `Exported ${stamp} from \`${BASE}\` (workspace \`${WS}\`, project \`${snapshot.project.name}\`).\n`;
md += `Restore-grade JSON: [\`CLWX-board-export.json\`](./CLWX-board-export.json). `;
md += `This markdown is the human-readable mirror; the JSON is authoritative.\n\n`;
md += `> The live board is source of truth for *what to work on*. This file is a\n`;
md += `> persisted backup so the plan survives on clone and history is versioned.\n\n`;
for (const g of order) {
  const rows = byGroup[g];
  if (!rows || !rows.length) continue;
  md += `## ${g[0].toUpperCase()}${g.slice(1)}\n\n`;
  for (const r of rows.sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0))) {
    md += `### CLWX-${r.sequence_id} — ${r.name}\n\n`;
    md += `- **State:** ${r.stateName}  |  **Priority:** ${r.priority || 'none'}\n\n`;
    if (r.description?.trim()) md += `${r.description.trim()}\n\n`;
    if (r.comments?.length) {
      md += `**Comments (${r.comments.length}):**\n\n`;
      for (const c of r.comments) md += `- ${(c.text || '').trim().replace(/\n+/g, ' ')}\n`;
      md += `\n`;
    }
  }
}
writeFileSync(join(outDir, 'CLWX-board.md'), md);
console.log(`OK: ${snapshot.issues.length} issues, ${states.length} states -> docs/plane-board/`);
