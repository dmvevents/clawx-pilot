/**
 * CLWX-143 — Outlook Web inbox row parsing shared by the Node side (unit
 * tests, classifier) and the browser side (page.evaluate in outlook-actions).
 *
 * Why one module: `readInbox` (extraction) and `openMessageById` (locate)
 * used to carry two hand-copied inline parsers. Any drift between them made a
 * row id returned by read unresolvable by reply ("not_in_list"). Both now
 * evaluate `INBOX_ROW_PARSER_BROWSER_SOURCE`, which is the `.toString()` of the
 * very functions exercised by the unit tests, so the fingerprint is provably
 * the same code on both sides.
 *
 * Row text model (DOM order of the visible text nodes of one list row):
 *   [avatar initials] [state tokens: "[Draft]", "Unread", "Has attachments",
 *   "Collapsed", ...] <sender> <subject...> <received> <preview...>
 *
 * Rules fixed here (reproduced on the installed moe.35, 2026-09-11):
 *   - a leading "[Draft]" marks a conversation that HOLDS a saved reply draft;
 *     it is the principal's real incoming mail and must not be dropped, and
 *     the marker must never be mistaken for the sender;
 *   - day-first dates ("21 Jun 2026", "16 Jun") and numeric dates are
 *     received-time tokens, not subject text;
 *   - the row id keeps sender, subject AND received time even for long
 *     subjects (the old 96-char total slice dropped the time part).
 *
 * Keep every function below closure-free and free of TypeScript-only runtime
 * syntax: they are serialized with Function.prototype.toString() and executed
 * inside the Outlook tab. `prepareFunctionEvaluate` in outlook-actions defines
 * `window.__name` for bundles that keep function names.
 */

export type ParsedInboxRow = {
  sender: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  hasDraft: boolean;
  unread: boolean;
};

/** Received-time tokens as Outlook Web renders them in the list. */
export function isInboxDateLike(s: string): boolean {
  if (!s) return false;
  if (s.length > 30) return false;
  if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Yesterday|Today|Tomorrow)\b/i.test(s)) return true;
  if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(s)) return true;
  if (/^\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{2,4})?$/i.test(s)) return true;
  if (/^\d{1,2}[:/.-]\d{1,2}(?:[/.-]\d{2,4})?(?:\s*(?:AM|PM))?$/i.test(s)) return true;
  if (/^\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/i.test(s)) return true;
  return false;
}

/** Row-state words Outlook Web emits as their own text nodes before the sender. */
export function isInboxStateToken(s: string): boolean {
  return /^(?:unread|read|has attachments?|attachment|collapsed|expanded|flagged|pinned|important|high importance|mentioned|selected)$/i.test(s.trim());
}

/** "[Draft]" / "Draft" marker: the conversation holds a saved (unsent) draft. */
export function isInboxDraftMarker(s: string): boolean {
  return /^\[?draft\]?$/i.test(s.trim());
}

/**
 * Parse the visible text nodes of one inbox row. Pure; identical on Node and
 * in the browser (see INBOX_ROW_PARSER_BROWSER_SOURCE).
 */
export function parseInboxRowTexts(texts: string[], ariaLabel: string): ParsedInboxRow {
  var sender = '';
  var subject = '';
  var receivedAt = '';
  var hasDraft = false;
  var snippetParts: string[] = [];
  var phase = 'sender';
  for (var i = 0; i < texts.length; i++) {
    var t = (texts[i] || '').trim();
    if (!t) continue;
    if (phase === 'sender') {
      if (isInboxDraftMarker(t)) { hasDraft = true; continue; }
      if (isInboxStateToken(t)) continue;
      if (t.length < 3) continue; // avatar initials
      sender = t;
      phase = 'subject';
      continue;
    }
    if (phase === 'subject') {
      if (isInboxDraftMarker(t)) { hasDraft = true; continue; }
      if (isInboxDateLike(t)) { receivedAt = t; phase = 'snippet'; continue; }
      if (t.length < 3 && !subject) continue;
      subject = subject ? subject + ' ' + t : t;
      continue;
    }
    snippetParts.push(t);
  }
  if (!receivedAt && snippetParts.length) {
    for (var j = snippetParts.length - 1; j >= 0; j--) {
      if (isInboxDateLike(snippetParts[j])) { receivedAt = snippetParts.splice(j, 1)[0]; break; }
    }
  }
  var label = ariaLabel || '';
  if (!hasDraft && /(^|\s)\[draft\](\s|$)/i.test(label)) hasDraft = true;
  return {
    sender: sender,
    subject: subject,
    receivedAt: receivedAt,
    snippet: snippetParts.join(' ').slice(0, 200),
    hasDraft: hasDraft,
    unread: /\bunread\b/i.test(label),
  };
}

/**
 * Stable row identity: sender|subject|received, each part bounded on its own
 * so a long subject can no longer push the received time out of the id.
 */
export function inboxRowId(sender: string, subject: string, receivedAt: string): string {
  var s = (sender || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  var j = (subject || '').replace(/\s+/g, ' ').trim().slice(0, 72);
  var r = (receivedAt || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!s && !j) return '';
  return s + '|' + j + '|' + r;
}

/** Sender/subject/time parts of an id produced by inboxRowId. */
export function splitInboxRowId(id: string): { sender: string; subject: string; receivedAt: string } {
  var parts = (id || '').split('|');
  return { sender: (parts[0] || '').trim(), subject: (parts[1] || '').trim(), receivedAt: (parts[2] || '').trim() };
}

/**
 * Browser-side source: defines isInboxDateLike, isInboxStateToken,
 * isInboxDraftMarker, parseInboxRowTexts, inboxRowId and two DOM helpers
 * (walkRowTexts, inboxRowFingerprint) in the evaluate scope.
 */
export const INBOX_ROW_PARSER_BROWSER_SOURCE: string = [
  isInboxDateLike.toString(),
  isInboxStateToken.toString(),
  isInboxDraftMarker.toString(),
  parseInboxRowTexts.toString(),
  inboxRowId.toString(),
  // DOM helpers are written as plain strings: they need `document`/nodes.
  'function walkRowTexts(el) {' +
  '  var texts = [];' +
  '  var walk = function (n) {' +
  '    if (n.nodeType === 3) { var t = (n.textContent || "").trim(); if (t) texts.push(t); }' +
  '    else if (n.nodeType === 1) { var cs = n.childNodes; for (var k = 0; k < cs.length; k++) walk(cs[k]); }' +
  '  };' +
  '  walk(el);' +
  '  return texts;' +
  '}',
  'function inboxRowFingerprint(el) {' +
  '  var label = el.getAttribute("aria-label") || "";' +
  '  var p = parseInboxRowTexts(walkRowTexts(el), label);' +
  '  return inboxRowId(p.sender, p.subject, p.receivedAt);' +
  '}',
  // Fingerprint plus the draft marker, so a locator can prefer the real message
  // row over an open-compose pseudo row that carries the same id.
  'function inboxRowFingerprintDetail(el) {' +
  '  var label = el.getAttribute("aria-label") || "";' +
  '  var p = parseInboxRowTexts(walkRowTexts(el), label);' +
  '  return { fp: inboxRowId(p.sender, p.subject, p.receivedAt), hasDraft: p.hasDraft };' +
  '}',
].join('\n');
