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
