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
// The Plane instance rate-limits (429) and this export makes ~2N+3 requests
// for N issues; back off and retry instead of dying mid-snapshot.
const get = async (url) => {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: H });
    if (r.ok) return r.json();
    if (r.status === 429 && attempt < 6) {
      const retryAfter = Number(r.headers.get('retry-after')) || attempt * 15;
      await new Promise((res) => setTimeout(res, retryAfter * 1000));
      continue;
    }
    throw new Error(`${r.status} ${url}`);
  }
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

// No-secrets floor: card bodies are authored by humans and have already been
// caught carrying a live credential (CLWX-18's comments quoted the leaked
// test password verbatim). Every body field passes through this before it
// can reach the repo. Patterns cover known-leaked literals and generic
// credential shapes; extend the list when a new leak class appears.
const REDACT_PATTERNS = [
  /Education@2000/g,                              // leaked test.fac password (CLWX-18)
  /sk-clawx[A-Za-z0-9_-]{8,}/g,                   // key VALUES only; the bare name may appear
  /(password|passwd|pwd)\s*[:=]\s*\S+/gi,         // generic password assignments
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,                // bearer tokens
];
const redact = (text) => REDACT_PATTERNS.reduce(
  (t, re) => t.replace(re, '[REDACTED]'), text ?? '',
);

// This Plane build returns empty *_stripped fields and populates only the
// *_html variants, which silently produced a titles-only mirror (CLWX-35).
// Convert HTML to text ourselves as the fallback.
const htmlToText = (html) => {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<(li)[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ol|ul|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const stamp = process.env.EXPORT_STAMP || new Date().toISOString().slice(0, 10);
const snapshot = {
  exported_at_date: stamp,
  source: { base: BASE, workspace: WS, project_id: PROJ },
  project: { id: project.id, name: project.name, identifier: project.identifier },
  states: states.map((s) => ({ id: s.id, name: s.name, group: s.group })),
  issues: issues.map((i) => ({
    id: i.id, sequence_id: i.sequence_id, name: redact(i.name), priority: i.priority,
    state: stateById[i.state]?.name ?? i.state, state_id: i.state,
    description: redact(i.description_stripped || htmlToText(i.description_html)),
    comments: (i.comments || []).map((c) => ({
      text: redact(c.comment_stripped || htmlToText(c.comment_html)),
      created: c.created_at,
    })),
  })),
};

// Filenames + sequence-id prefix derive from the project identifier so one
// script mirrors any board (CLWX, TOOL, ...) without clobbering another's file.
const ID = project.identifier || 'BOARD';
writeFileSync(join(outDir, `${ID}-board-export.json`), JSON.stringify(snapshot, null, 2));

// Markdown mirror, grouped by state group order.
const order = ['backlog', 'unstarted', 'started', 'completed', 'cancelled'];
const byGroup = {};
for (const i of snapshot.issues) {
  const st = states.find((s) => s.id === i.state_id);
  const g = st?.group || 'other';
  (byGroup[g] ||= []).push({ ...i, stateName: st?.name || i.state });
}
let md = `# ${ID} Plane board — snapshot\n\n`;
md += `Exported ${stamp} from \`${BASE}\` (workspace \`${WS}\`, project \`${snapshot.project.name}\`).\n`;
md += `Restore-grade JSON: [\`${ID}-board-export.json\`](./${ID}-board-export.json). `;
md += `This markdown is the human-readable mirror; the JSON is authoritative.\n\n`;
md += `> The live board is source of truth for *what to work on*. This file is a\n`;
md += `> persisted backup so the plan survives on clone and history is versioned.\n\n`;
for (const g of order) {
  const rows = byGroup[g];
  if (!rows || !rows.length) continue;
  md += `## ${g[0].toUpperCase()}${g.slice(1)}\n\n`;
  for (const r of rows.sort((a, b) => (a.sequence_id || 0) - (b.sequence_id || 0))) {
    md += `### ${ID}-${r.sequence_id} — ${r.name}\n\n`;
    md += `- **State:** ${r.stateName}  |  **Priority:** ${r.priority || 'none'}\n\n`;
    if (r.description?.trim()) md += `${r.description.trim()}\n\n`;
    if (r.comments?.length) {
      md += `**Comments (${r.comments.length}):**\n\n`;
      for (const c of r.comments) md += `- ${(c.text || '').trim().replace(/\n+/g, ' ')}\n`;
      md += `\n`;
    }
  }
}
writeFileSync(join(outDir, `${ID}-board.md`), md);
console.log(`OK: ${snapshot.issues.length} issues, ${states.length} states -> docs/plane-board/`);
