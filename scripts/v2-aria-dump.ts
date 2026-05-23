/**
 * Dump real Outlook aria-labels so we can write a parser that matches what
 * Outlook actually emits, not what we think it emits. Run after sign-in.
 */
import { writeFileSync } from 'fs';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab();

  // Grab every plausible row + its constituent text nodes. The parser needs
  // to see both the parent aria-label AND the child text, because Outlook
  // sometimes splits sender/subject into separate inner elements that the
  // parent label concatenates.
  const dump = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    const els = document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]');
    for (const el of Array.from(els).slice(0, 8)) {
      const label = el.getAttribute('aria-label') ?? '';
      // Common Outlook row shape: child elements with semantic roles or
      // class hints. We don't depend on classes, but extracting innerText
      // of children gives us a structured fallback.
      const inner: Record<string, string> = {};
      const candidates: Array<[string, string]> = [
        ['headerName', '[role="heading"], [class*="senderName"], [class*="from"]'],
        ['subjectText', '[class*="subject"], [class*="Subject"]'],
        ['previewText', '[class*="preview"], [class*="snippet"]'],
        ['receivedText', '[class*="receivedTime"], time, [class*="time"]'],
      ];
      for (const [key, sel] of candidates) {
        const found = el.querySelector(sel);
        if (found) inner[key] = (found.textContent ?? '').trim().slice(0, 100);
      }
      out.push({
        ariaLabel: label,
        unreadFlag: /unread\b/i.test(label),
        inner,
        outerHtmlSnip: (el.outerHTML ?? '').slice(0, 400),
      });
    }
    return out;
  });

  const json = JSON.stringify(dump, null, 2);
  writeFileSync('/tmp/outlook-aria-rows.json', json);
  console.log(`Wrote ${dump.length} rows to /tmp/outlook-aria-rows.json`);
  for (const row of dump) {
    console.log('---');
    console.log('label:', row.ariaLabel);
    console.log('inner:', row.inner);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
