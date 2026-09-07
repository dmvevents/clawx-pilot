#!/usr/bin/env node
// plane-comment-post.mjs — the ONLY sanctioned way to post a comment to the
// CLWX Plane board from an agent session.
//
// Why this exists (2026-09-06 incident): sessions source
// ~/issues-agent-runtime/plane/.agent-token for PLANE_API_KEY, and that file
// ALSO exports PLANE_PROJECT — which points at the GHIP (GitHub Issues & PRs)
// project, NOT the CLWX board. A posting one-liner that reused $PLANE_PROJECT
// created comments under the wrong project path; this Plane build accepts the
// cross-project create (201, row persisted with the URL's project_id) and then
// every CLWX read path (list, detail, export) filters them out. Five evidence
// comments silently vanished from the mirror. This script closes the class:
//   1. The project id comes from CLWX_PROJECT_ID or the hardcoded CLWX default.
//      PLANE_PROJECT is explicitly IGNORED (warned about if it differs).
//   2. The target issue is resolved/verified under that same project before
//      any write.
//   3. Every post is READBACK-VERIFIED: the new comment must be fetchable by
//      id AND present in the comment list under the same project path,
//      otherwise the script exits non-zero and says "orphaned".
//
// Read/write against Plane (one comment per invocation). Secrets: reads
// PLANE_API_KEY from the environment; never prints it.
//
// Usage:
//   set -a; . ~/issues-agent-runtime/plane/.agent-token; set +a
//   node scripts/plane-comment-post.mjs --card CLWX-83 --file /tmp/comment.json
//   echo '<p>evidence…</p>' | node scripts/plane-comment-post.mjs --card CLWX-83
//   node scripts/plane-comment-post.mjs --issue <uuid> --file body.html
//
// Payload: --file *.json must contain {"comment_html": "<p>…</p>"}; any other
// file (or stdin) is taken verbatim as the comment_html string.
import { readFileSync } from 'node:fs';

const BASE = process.env.PLANE_BASE_URL || 'http://localhost:8090';
const WS = process.env.PLANE_WORKSPACE || 'issues-agent';
const KEY = process.env.PLANE_API_KEY;
// CLWX board. Deliberately NOT process.env.PLANE_PROJECT — see header.
const PROJ = process.env.CLWX_PROJECT_ID || '81a2ea23-e060-49b4-a344-1ab0339f46d5';
if (!KEY) { console.error('PLANE_API_KEY not set — source the token file first.'); process.exit(1); }
// A key with whitespace/control chars makes fetch's Headers.append throw an
// error message CONTAINING the credential (Codex review finding, 2026-09-06).
// Reject it with a fixed diagnostic before it can reach any error path.
if (!/^[\x21-\x7E]+$/.test(KEY)) {
  console.error('PLANE_API_KEY is malformed (contains whitespace/control or non-ASCII characters) — refusing.');
  process.exit(1);
}
// Defense in depth: no dynamic error text reaches stderr with the key in it.
const scrub = (s) => String(s).split(KEY).join('[REDACTED]');
process.on('uncaughtException', (e) => { console.error('FAIL:', scrub(e?.message || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error('FAIL:', scrub(e?.message || e)); process.exit(1); });
if (process.env.PLANE_PROJECT && process.env.PLANE_PROJECT !== PROJ) {
  console.error(`note: ignoring PLANE_PROJECT=${process.env.PLANE_PROJECT} (that is another agent's project); posting to ${PROJ}`);
}

const args = process.argv.slice(2);
// A flag with a missing value must fail loudly, not fall through to another
// input mode (Claude-lens finding: a trailing `--file` silently switched to
// stdin — TTY hang or wrong payload).
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`FAIL: ${name} requires a value`);
    process.exit(1);
  }
  return v;
};
const card = opt('--card');
const issueArg = opt('--issue');
const file = opt('--file');
if (!card && !issueArg) {
  console.error('usage: plane-comment-post.mjs (--card CLWX-<n> | --issue <uuid>) [--file <payload>]  (or payload on stdin)');
  process.exit(1);
}
if (card && issueArg) {
  console.error('FAIL: pass either --card or --issue, not both (no cross-check is performed between them)');
  process.exit(1);
}
if (!file && process.stdin.isTTY) {
  console.error('FAIL: no --file given and stdin is a terminal — refusing to wait on interactive input');
  process.exit(1);
}

const api = `${BASE}/api/v1/workspaces/${WS}/projects/${PROJ}`;
const H = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
// Same 429 backoff contract as plane-board-export.mjs.
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

// ---- payload ----------------------------------------------------------------
const readStdin = () => new Promise((res, rej) => {
  // setEncoding makes Node's decoder handle multibyte chars split across
  // chunk boundaries; raw Buffer += stringifies each chunk independently and
  // corrupts them (Codex review finding, 2026-09-06).
  process.stdin.setEncoding('utf8');
  let d = '';
  process.stdin.on('data', (c) => { d += c; });
  process.stdin.on('end', () => res(d));
  process.stdin.on('error', rej);
});
let commentHtml;
if (file) {
  const raw = readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    // Parse errors must not echo payload text to stderr (Claude-lens finding).
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      console.error(`FAIL: ${file} is not valid JSON`);
      process.exit(1);
    }
    if (typeof parsed.comment_html !== 'string') {
      console.error(`FAIL: ${file} has no "comment_html" string key`);
      process.exit(1);
    }
    commentHtml = parsed.comment_html;
  } else {
    commentHtml = raw;
  }
} else {
  commentHtml = await readStdin();
}
if (!commentHtml || !commentHtml.trim()) { console.error('FAIL: empty comment payload'); process.exit(1); }

// ---- resolve the issue UNDER THE CLWX PROJECT PATH --------------------------
// The detail/list endpoints filter by the URL's project, so a successful
// resolve here proves the issue really belongs to the CLWX board.
// The project detail also yields the canonical identifier (e.g. "CLWX") so a
// pasted foreign card id like GHIP-83 cannot silently resolve to CLWX-83
// (Codex review finding, 2026-09-06).
const project = await req(`${api}/`);
let issue;
if (issueArg) {
  try {
    issue = await req(`${api}/issues/${issueArg}/`);
  } catch (e) {
    console.error(scrub(`FAIL: issue ${issueArg} not found under project ${PROJ} (${e.message}) — wrong board?`));
    process.exit(1);
  }
} else {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(card);
  if (!m) { console.error(`FAIL: --card must look like ${project.identifier || 'CLWX'}-83 (got "${card}")`); process.exit(1); }
  if (m[1].toUpperCase() !== String(project.identifier || '').toUpperCase()) {
    console.error(`FAIL: card prefix "${m[1]}" is not this board's identifier "${project.identifier}" — refusing to cross-post (got "${card}")`);
    process.exit(1);
  }
  const seq = Number(m[2]);
  const issues = await getAll('issues/');
  issue = issues.find((i) => i.sequence_id === seq);
  if (!issue) { console.error(`FAIL: no issue with sequence ${seq} on project ${PROJ}`); process.exit(1); }
}
// The project-scoped endpoints above should make this unreachable; assert it
// anyway so a server-side filtering regression fails closed instead of writing.
if (issue.project && issue.project !== PROJ) {
  console.error(`FAIL: resolved issue reports project ${issue.project}, expected ${PROJ} — refusing to write`);
  process.exit(1);
}

// ---- post + readback-verify --------------------------------------------------
const created = await req(`${api}/issues/${issue.id}/comments/`, {
  method: 'POST',
  body: JSON.stringify({ comment_html: commentHtml }),
});
if (!created?.id) { console.error('FAIL: create returned no id'); process.exit(1); }

// Distinguish a definitive orphan (server answered: not visible here) from a
// transient readback failure (429-exhaustion/transport) so a GOOD write is
// never mislabeled ORPHANED (Claude-lens finding).
let verified = false;
try {
  const back = await req(`${api}/issues/${issue.id}/comments/${created.id}/`);
  const listed = (await getAll(`issues/${issue.id}/comments/`)).some((c) => c.id === created.id);
  verified = back?.id === created.id && listed;
} catch (e) {
  console.error(scrub(`FAIL: comment ${created.id} was created but the readback errored (${e.message}) — verification INCONCLUSIVE, not proven orphaned. Re-check the card before re-posting (a duplicate is possible).`));
  process.exit(1);
}
if (!verified) {
  console.error(`FAIL: comment ${created.id} was created but is NOT readable under project ${PROJ} — it is ORPHANED (cross-project write or server fault). Do not trust the 201; investigate before re-posting.`);
  process.exit(1);
}
console.log(`OK ${project.identifier || 'CLWX'}-${issue.sequence_id} comment ${created.id} created ${created.created_at} (readback verified: detail + list)`);
