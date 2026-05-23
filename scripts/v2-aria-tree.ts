/**
 * Use Playwright's accessibility snapshot to introspect the real Outlook
 * inbox row structure. This is what assistive tech sees and what we should
 * parse, not the concatenated parent aria-label.
 */
import { writeFileSync } from 'fs';
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

async function main() {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  await driver.ensureBrowser();
  const page = await driver.ensureOutlookTab();

  // Use page.locator().ariaSnapshot() — newer Playwright API.
  const yaml = await page.locator('body').ariaSnapshot();
  writeFileSync('/tmp/outlook-a11y.yaml', yaml);
  console.log(`Wrote /tmp/outlook-a11y.yaml (${yaml.length} chars)`);

  // Also dump the inbox region with classed text via DOM, so we see the
  // shadow-elements Outlook uses for sender/subject/snippet/date.
  // Use page.evaluate with a string body to avoid tsx/esbuild's __name
  // helper injection (which fails in browser context).
  const rowDetails = await page.evaluate(`
    (() => {
      const rows = [];
      const els = document.querySelectorAll('[role="option"][aria-label], [role="row"][aria-label]');
      const slice = Array.from(els).slice(0, 5);
      for (const el of slice) {
        const allText = [];
        const walk = function(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            const t = (node.textContent || '').trim();
            if (t) allText.push(t);
          }
          for (const child of Array.from(node.childNodes)) walk(child);
        };
        walk(el);

        const childInfos = [];
        const descendants = Array.from(el.querySelectorAll('*')).slice(0, 30);
        for (const c of descendants) {
          const role = c.getAttribute('role');
          const ariaLabel = c.getAttribute('aria-label');
          const text = (c.textContent || '').trim().slice(0, 120);
          if (role || ariaLabel) {
            childInfos.push({ role: role, ariaLabel: ariaLabel, text: text });
          }
        }

        rows.push({
          ariaLabel: el.getAttribute('aria-label') || '',
          classNames: Array.from(el.classList).slice(0, 5),
          children: childInfos,
          allText: allText,
        });
      }
      return rows;
    })()
  `) as Array<{ ariaLabel: string; classNames: string[]; children: Array<{ role: string | null; ariaLabel: string | null; text: string }>; allText: string[] }>;

  writeFileSync('/tmp/outlook-row-details.json', JSON.stringify(rowDetails, null, 2));
  console.log(`Wrote /tmp/outlook-row-details.json with ${rowDetails.length} rows`);
  rowDetails.forEach((r, i) => {
    console.log(`\n[row ${i}] aria-label: ${r.ariaLabel.slice(0, 80)}...`);
    console.log(`  text nodes: ${JSON.stringify(r.allText)}`);
    if (r.children.length) {
      console.log(`  ${r.children.length} aria-tagged children`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
