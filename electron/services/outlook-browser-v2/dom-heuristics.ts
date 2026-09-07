export interface OutlookDomState {
  hasNewMailControl: boolean;
  hasOpenComposeSurface: boolean;
}

/**
 * Self-contained so Playwright can serialize it into the browser context via
 * page.evaluate(readOutlookDomState). Keep helper functions nested.
 */
export function readOutlookDomState(): OutlookDomState {
  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none';
  };

  const accessibleName = (el: Element) => [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-automation-id'),
    el.getAttribute('data-automationid'),
    el.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const candidateControls = Array.from(document.querySelectorAll([
    'button',
    '[role="button"]',
    '[role="menuitem"]',
    'a[role="button"]',
    '[aria-label]',
    '[title]',
    '[data-automation-id]',
    '[data-automationid]',
  ].join(',')));
  const hasNewMailControl = candidateControls.some((el) => {
    if (!isVisible(el)) return false;
    return /\bnew\s+(mail|message)\b/i.test(accessibleName(el));
  });

  const possibleComposeElements = Array.from(document.querySelectorAll([
    '[data-testid="ComposeSendButton"]',
    '[aria-label="Message body"]',
    '[role="textbox"][aria-label*="body" i]',
    '[contenteditable="true"][aria-label*="body" i]',
    '[aria-label*="Compose" i]',
  ].join(',')));
  const hasOpenComposeSurface = possibleComposeElements.some(isVisible);

  return { hasNewMailControl, hasOpenComposeSurface };
}

/**
 * Focus the To/Cc/Bcc recipient well inside the open compose surface without
 * visual (VLM) grounding — the deterministic tier for boxes that have no
 * cloud credentials (CLWX-74). Self-contained so Playwright can serialize it
 * via page.evaluate(focusComposeRecipientField, label).
 *
 * Matching uses NAMING attributes only (aria-label, placeholder, title, name,
 * data-automation-id) — recipient wells carry arbitrary chip text in
 * textContent, which would false-positive on a word as common as "to". The
 * candidate must sit inside a compose root (an ancestor containing a visible
 * Send button), mirroring the subject-field heuristic.
 *
 * Returns true when a matching editable element was focused; the caller then
 * types the value with real keystrokes so Outlook's recipient picker and chip
 * commit behave exactly as they do for a human.
 */
export function focusComposeRecipientField(label: string): boolean {
  const normalize = (value: string | undefined | null) => (value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const isVisible = (el: Element | null): boolean => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let current: Element | null = el;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      current = current.parentElement;
    }
    return true;
  };
  const hasSendButton = (root: Element) => Array.from(
    root.querySelectorAll('button, [role="button"], [aria-label], [title], [data-testid]'),
  ).some((el) => {
    if (!isVisible(el)) return false;
    const labels = [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-testid') || '',
      el.textContent || '',
    ].map(normalize).filter(Boolean);
    // Prefix form covers icon-only buttons labelled "Send (Ctrl+Enter)".
    return labels.some((entry) => /^send([^a-z]|$)/i.test(entry));
  });
  const composeRoot = (el: Element): Element | null => {
    let current: Element | null = el;
    for (let depth = 0; current && depth < 20; depth += 1) {
      if (current !== document.body && current !== document.documentElement && hasSendButton(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };
  // Under Outlook's single SPA root, EVERY element has some ancestor whose
  // subtree contains a Send button once any compose pane is open — so the
  // anchor only discriminates by HOW DEEP it sits. The real recipient well
  // anchors at its own pane; an impostor elsewhere only anchors at the shared
  // app root. Deeper anchor = closer to a real compose pane.
  const nodeDepth = (el: Element): number => {
    let depth = 0;
    let current: Element | null = el;
    while (current && current !== document.documentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  // Labels are plain words (To/Cc/Bcc) — safe to embed in a RegExp directly.
  const target = normalize(label).toLowerCase();
  if (!target || !/^[a-z]+$/.test(target)) return false;

  const nameAttrs = (el: Element) => [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('title'),
    el.getAttribute('name'),
    el.getAttribute('data-automation-id'),
    el.getAttribute('data-automationid'),
  ].map(normalize).filter(Boolean).map((value) => value.toLowerCase());

  // Exact and prefix forms only ("to", "to recipients…") — a bare word match
  // would let an unrelated editable whose label merely contains "to" steal
  // focus, and typing recipients into the wrong field is worse than the
  // readable VLM-unavailable error this tier exists to avoid. The prefix tier
  // excludes subject/body labels but tolerates words like "search" deeper in
  // the label ("To recipients. Type to search the directory." is a real well).
  const scoreFor = (el: Element): number => {
    const attrs = nameAttrs(el);
    if (attrs.length === 0) return 0;
    if (attrs.some((value) => value === target)) return 2;
    if (attrs.some((value) => (value.startsWith(`${target} `) || value.startsWith(`${target},`))
      && !/\b(subject|body)\b/.test(value))) return 1;
    return 0;
  };

  const best = Array.from(document.querySelectorAll(
    'input, textarea, [role="textbox"], [role="combobox"], [contenteditable="true"]',
  ))
    .filter((el) => isVisible(el))
    .map((el) => ({ el, score: scoreFor(el), root: composeRoot(el) }))
    .filter((item): item is { el: Element; score: number; root: Element } => item.score > 0 && Boolean(item.root))
    .map((item) => ({ ...item, anchorDepth: nodeDepth(item.root) }))
    // Deepest anchor first (nearest compose pane), label quality second.
    .sort((a, b) => (b.anchorDepth - a.anchorDepth) || (b.score - a.score))[0]?.el as HTMLElement | undefined;
  if (!best) return false;
  best.focus();
  best.click();
  const active = document.activeElement;
  return active === best || best.contains(active);
}
