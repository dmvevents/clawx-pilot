/**
 * Read-only diagnostic: what does the compose-state detector actually SEE?
 *
 * Why this exists. `draftEmail` refuses with `status=failed, draftLeftOpen=true`
 * whenever `hasAnyVisibleOpenDraft` is true and `recoverComposeState` declines
 * to clear it, and the principal is then told to "review, send, or close that
 * draft". On 2026-09-07 the live eval hit that refusal on three consecutive runs
 * (W4.1) on a lane where reply and forward composes opened fine — so either a
 * draft really is wedged, or the detector is matching something that is not a
 * draft at all. Those two have opposite fixes, and the register's own rule is to
 * attribute from evidence before filing.
 *
 * The detector keys `hasCompose` off EITHER a subject input OR a visible
 * `[contenteditable][role=textbox]`, so this prints both legs separately, plus
 * enough shape (tag/role/aria-label/text LENGTH) to tell a compose pane from an
 * inline reply box or any other rich-text surface.
 *
 * Privacy: never prints body text or recipients, and truncates the subject to
 * 120 chars (hard rule). Text content is reported as a LENGTH only.
 *
 * Run: pnpm exec tsx scripts/outlook-compose-state-probe.ts
 * Exit: 0 always — this is a diagnostic, not a gate.
 */
import { PlaywrightDriver } from '../electron/services/outlook-browser-v2/playwright-driver.ts';

interface ProbeHit {
  tag: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  textLength: number;
  valueLength: number;
  rect: string;
}

interface ProbeOut {
  url: string;
  dialogWithDiscard: boolean;
  subjectInputs: ProbeHit[];
  subjectValue: string;
  richTextBoxes: ProbeHit[];
  discardControls: string[];
}

async function main(): Promise<void> {
  const driver = new PlaywrightDriver({ cdpEndpoint: 'http://127.0.0.1:18792' });
  const page = await driver.ensureOutlookTab();
  const out = (await page.evaluate(`(() => {
    const vis = function (el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const shape = function (el) {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        textLength: (el.textContent || '').replace(/\\s+/g, '').length,
        valueLength: String(el.value || '').length,
        rect: Math.round(r.width) + 'x' + Math.round(r.height),
      };
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(vis);
    let dialogWithDiscard = false;
    for (const d of dialogs) {
      if ((d.textContent || '').toLowerCase().indexOf('discard') !== -1) { dialogWithDiscard = true; break; }
    }
    const subjects = Array.from(document.querySelectorAll('input[aria-label*="subject" i], input[placeholder*="subject" i]')).filter(vis);
    const boxes = Array.from(document.querySelectorAll('[aria-label="Message body" i][contenteditable="true"], [contenteditable="true"][role="textbox"]')).filter(vis);
    const discards = Array.from(document.querySelectorAll('button')).filter(vis).filter(function (b) {
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
      return label.indexOf('discard') !== -1;
    }).map(function (b) { return (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 60); });
    return {
      url: location.href,
      dialogWithDiscard: dialogWithDiscard,
      subjectInputs: subjects.map(shape),
      subjectValue: subjects.length ? String(subjects[0].value || '').slice(0, 120) : '',
      richTextBoxes: boxes.map(shape),
      discardControls: discards,
    };
  })()`)) as ProbeOut;

  console.log(`url: ${out.url}`);
  console.log(`dialog mentioning "discard": ${out.dialogWithDiscard}`);
  console.log(`subject inputs (visible): ${out.subjectInputs.length}`);
  for (const s of out.subjectInputs) {
    console.log(`  - <${s.tag}> role="${s.role}" aria="${s.ariaLabel}" ph="${s.placeholder}" ${s.rect} valueLen=${s.valueLength}`);
  }
  if (out.subjectInputs.length > 0) console.log(`  subject (<=120 chars): "${out.subjectValue}"`);
  console.log(`rich-text boxes matching the detector (visible): ${out.richTextBoxes.length}`);
  for (const b of out.richTextBoxes) {
    console.log(`  - <${b.tag}> role="${b.role}" aria="${b.ariaLabel}" ${b.rect} textLen=${b.textLength}`);
  }
  console.log(`visible discard controls: ${out.discardControls.length}${out.discardControls.length ? ` (${out.discardControls.join(' | ')})` : ''}`);

  // The detector's own conclusion, restated from the parts above so the
  // attribution is readable without re-deriving it.
  const hasCompose = out.subjectInputs.length > 0 || out.richTextBoxes.length > 0;
  const bodyEmpty = out.richTextBoxes.length === 0 || out.richTextBoxes[0].textLength === 0;
  console.log(
    `\ndetector would report: hasCompose=${hasCompose} subject=${out.subjectInputs.length > 0 ? 'present' : 'ABSENT'} bodyEmpty=${bodyEmpty} hasDiscard=${out.discardControls.length > 0}`,
  );
  if (hasCompose && out.subjectInputs.length === 0) {
    console.log(
      'NOTE: hasCompose is true with NO subject input — the match came from a rich-text box alone. If that box is not a compose pane, draft_email will refuse forever and tell the principal to close a draft that does not exist.',
    );
  }
  await driver.close?.();
}

main().catch((err) => {
  console.error('PROBE FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(0);
});
