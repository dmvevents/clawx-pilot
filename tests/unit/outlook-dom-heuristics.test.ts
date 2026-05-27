import { afterEach, describe, expect, it } from 'vitest';
import { readOutlookDomState } from '@electron/services/outlook-browser-v2/dom-heuristics';

function markVisible(el: Element) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      width: 120,
      height: 32,
      top: 0,
      left: 0,
      right: 120,
      bottom: 32,
      toJSON: () => ({}),
    }),
  });
}

function visibleSelector(selector: string) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`missing test element: ${selector}`);
  markVisible(el);
}

describe('readOutlookDomState', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('detects the normal mailbox New mail control', () => {
    document.body.innerHTML = '<button aria-label="New mail">New mail</button>';
    visibleSelector('button');

    expect(readOutlookDomState()).toEqual({
      hasNewMailControl: true,
      hasOpenComposeSurface: false,
    });
  });

  it('detects an open compose surface when the New mail control is hidden', () => {
    document.body.innerHTML = `
      <div role="main" aria-label="Reading Pane">
        <div data-testid="ComposeSendButton">Send</div>
        <div role="textbox" aria-label="Message body" contenteditable="true">Draft text</div>
      </div>
    `;
    visibleSelector('[data-testid="ComposeSendButton"]');
    visibleSelector('[aria-label="Message body"]');

    expect(readOutlookDomState()).toEqual({
      hasNewMailControl: false,
      hasOpenComposeSurface: true,
    });
  });

  it('ignores hidden New mail controls', () => {
    document.body.innerHTML = '<button aria-label="New mail" style="display: none">New mail</button>';
    markVisible(document.querySelector('button') as Element);

    expect(readOutlookDomState().hasNewMailControl).toBe(false);
  });
});
