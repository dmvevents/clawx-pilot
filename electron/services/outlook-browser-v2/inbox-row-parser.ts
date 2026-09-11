/**
 * CLWX-143 — Outlook Web inbox row parsing shared by the Node side (unit
 * tests, classifier) and the browser side (page.evaluate in outlook-actions).
 *
 * Why one module: `readInbox` (extraction) and `openMessageById` (locate)
 * used to carry two hand-copied inline parsers. Any drift between them made a
 * row id returned by read unresolvable by reply ("not_in_list").
 *
 * Single source of truth: `INBOX_ROW_PARSER_BROWSER_SOURCE` is a plain string
 * of self-contained ES5 function declarations. It is injected verbatim into
 * both page.evaluate sites, and the Node-side exports below are CREATED FROM
 * THE SAME STRING at module load (`new Function`), so the unit tests exercise
 * exactly the code the browser runs. A string literal survives bundling and
 * minification unchanged — unlike `Function.prototype.toString()` of module
 * functions, whose declarations the production `vite build` renames (review
 * lane A, 2026-09-11: `parseInboxRowTexts` → `v`, breaking the injected
 * payload on the installed build).
 *
 * Row text model (DOM order of the visible text nodes of one list row):
 *   [avatar initials] [state tokens: "[Draft]", "Unread", "Has attachments",
 *   "Collapsed", ...] <sender> <subject...> <received> <preview...>
 *
 * Rules (reproduced on the installed moe.35, 2026-09-11):
 *   - a leading "[Draft]" marks a conversation that HOLDS a saved reply draft;
 *     it is the principal's real incoming mail and must not be dropped, and
 *     the marker must never be mistaken for the sender;
 *   - received-time tokens: weekday forms ("Tue 2:15 PM", "Mon 7 Sep"),
 *     month-first WITH a day ("Sep 7", "Jun 21, 2026"), day-first
 *     ("21 Jun 2026", "16 Jun"), numeric dates and clock times. A bare word
 *     that merely starts with a month abbreviation ("Decision", "Marketing")
 *     is subject text, not a date;
 *   - the row id keeps sender, subject AND received time even for long
 *     subjects (the old 96-char total slice dropped the time part).
 */

export type ParsedInboxRow = {
  sender: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  hasDraft: boolean;
  unread: boolean;
  /**
   * The row looks like the pseudo row Outlook renders for an OPEN compose
   * rather than a conversation: it carries the draft marker and has fewer than
   * two text tokens before the received time, so its sender/subject split
   * cannot be trusted — consuming the marker shifts every later field, which
   * would surface the draft body as a subject. Such a row is never returned as
   * a message and is never opened (review lane A, 2026-09-11).
   */
  pseudoCompose: boolean;
};

/**
 * Browser-side source. Keep it ES5, closure-free and free of any reference to
 * module scope; it runs inside the Outlook tab and inside `new Function`.
 */
export const INBOX_ROW_PARSER_BROWSER_SOURCE = String.raw`
function isInboxDateLike(s) {
  if (!s) return false;
  s = String(s).trim();
  if (s.length > 30) return false;
  var MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
  var TIME = '\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM))?';
  // Weekday alone, or weekday followed ONLY by a time, a day+month, a month+day or a numeric date.
  var WEEKDAY = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?';
  if (new RegExp('^' + WEEKDAY + '(?:\\s+(?:' + TIME + '|\\d{1,2}\\s+' + MON + '(?:\\s+\\d{2,4})?|' + MON + '\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?|\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]\\d{2,4})?))?$', 'i').test(s)) return true;
  if (new RegExp('^(?:Yesterday|Today|Tomorrow)(?:\\s+' + TIME + ')?$', 'i').test(s)) return true;
  if (new RegExp('^' + MON + '\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?(?:\\s+\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM))?)?$', 'i').test(s)) return true;
  if (new RegExp('^\\d{1,2}\\s+' + MON + '(?:,?\\s+\\d{2,4})?(?:\\s+\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM))?)?$', 'i').test(s)) return true;
  if (/^\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?(?:\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?$/i.test(s)) return true;
  if (/^\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/i.test(s)) return true;
  return false;
}
function isInboxStateToken(s) {
  return /^(?:unread|read|has attachments?|attachment|collapsed|expanded|flagged|pinned|important|high importance|mentioned|selected)$/i.test(String(s).trim());
}
function isInboxDraftMarker(s) {
  return /^\[?draft\]?$/i.test(String(s).trim());
}
function parseInboxRowTexts(texts, ariaLabel) {
  var sender = '';
  var subject = '';
  var receivedAt = '';
  var hasDraft = false;
  var snippetParts = [];
  var phase = 'sender';
  var preDateTokens = 0;
  for (var i = 0; i < texts.length; i++) {
    var t = String(texts[i] || '').trim();
    if (!t) continue;
    if (phase === 'sender') {
      if (isInboxDraftMarker(t)) { hasDraft = true; continue; }
      if (isInboxStateToken(t)) continue;
      if (t.length < 3) continue;
      sender = t;
      preDateTokens++;
      phase = 'subject';
      continue;
    }
    if (phase === 'subject') {
      if (isInboxDraftMarker(t)) { hasDraft = true; continue; }
      if (isInboxDateLike(t)) { receivedAt = t; phase = 'snippet'; continue; }
      if (t.length < 3 && !subject) continue;
      subject = subject ? subject + ' ' + t : t;
      preDateTokens++;
      continue;
    }
    snippetParts.push(t);
  }
  if (!receivedAt && snippetParts.length) {
    for (var j = snippetParts.length - 1; j >= 0; j--) {
      if (isInboxDateLike(snippetParts[j])) { receivedAt = snippetParts.splice(j, 1)[0]; break; }
    }
  }
  var label = String(ariaLabel || '');
  if (!hasDraft && /(^|\s)\[?draft\]?(\s|$)/i.test(label)) hasDraft = true;
  return {
    sender: sender,
    subject: subject,
    receivedAt: receivedAt,
    snippet: snippetParts.join(' ').slice(0, 200),
    hasDraft: hasDraft,
    unread: /\bunread\b/i.test(label),
    pseudoCompose: hasDraft && preDateTokens < 2
  };
}
function inboxRowId(sender, subject, receivedAt) {
  var s = String(sender || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  var j = String(subject || '').replace(/\s+/g, ' ').trim().slice(0, 72);
  var r = String(receivedAt || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!s && !j) return '';
  return s + '|' + j + '|' + r;
}
function splitInboxRowId(id) {
  var parts = String(id || '').split('|');
  return { sender: (parts[0] || '').trim(), subject: (parts[1] || '').trim(), receivedAt: (parts[2] || '').trim() };
}
function walkRowTexts(el) {
  var texts = [];
  var walk = function (n) {
    if (n.nodeType === 3) { var t = String(n.textContent || '').trim(); if (t) texts.push(t); }
    else if (n.nodeType === 1) { var cs = n.childNodes; for (var k = 0; k < cs.length; k++) walk(cs[k]); }
  };
  walk(el);
  return texts;
}
function inboxRowFingerprintDetail(el) {
  var label = el.getAttribute('aria-label') || '';
  var p = parseInboxRowTexts(walkRowTexts(el), label);
  return { fp: inboxRowId(p.sender, p.subject, p.receivedAt), hasDraft: p.hasDraft, pseudoCompose: p.pseudoCompose };
}
function inboxRowFingerprint(el) {
  return inboxRowFingerprintDetail(el).fp;
}
`;

type ParserApi = {
  isInboxDateLike: (s: string) => boolean;
  isInboxStateToken: (s: string) => boolean;
  isInboxDraftMarker: (s: string) => boolean;
  parseInboxRowTexts: (texts: string[], ariaLabel: string) => ParsedInboxRow;
  inboxRowId: (sender: string, subject: string, receivedAt: string) => string;
  splitInboxRowId: (id: string) => { sender: string; subject: string; receivedAt: string };
};

// Node-side bindings created from the SAME source string the browser runs.
const api = new Function(
  `${INBOX_ROW_PARSER_BROWSER_SOURCE}\nreturn { isInboxDateLike, isInboxStateToken, isInboxDraftMarker, parseInboxRowTexts, inboxRowId, splitInboxRowId };`,
)() as ParserApi;

/** Received-time tokens as Outlook Web renders them in the list. */
export const isInboxDateLike = api.isInboxDateLike;
/** Row-state words Outlook Web emits as their own text nodes before the sender. */
export const isInboxStateToken = api.isInboxStateToken;
/** "[Draft]" / "Draft" marker: the conversation holds a saved (unsent) draft. */
export const isInboxDraftMarker = api.isInboxDraftMarker;
/** Parse the visible text nodes of one inbox row. */
export const parseInboxRowTexts = api.parseInboxRowTexts;
/** Stable row identity: sender|subject|received, each part bounded on its own. */
export const inboxRowId = api.inboxRowId;
/** Sender/subject/time parts of an id produced by inboxRowId. */
export const splitInboxRowId = api.splitInboxRowId;
