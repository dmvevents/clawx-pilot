import { afterEach, describe, expect, it } from 'vitest';
import { focusComposeRecipientField, readOutlookDomState } from '@electron/services/outlook-browser-v2/dom-heuristics';

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

describe('focusComposeRecipientField (CLWX-74 deterministic tier)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function markAllVisible() {
    document.body.querySelectorAll('*').forEach((el) => markVisible(el));
  }

  it('focuses the exact-labelled To well inside a compose root', () => {
    document.body.innerHTML = `
      <div>
        <input aria-label="To">
        <input aria-label="Add a subject">
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[aria-label="To"]'));
  });

  it('matches the rotated long-form label ("To recipients…") as a prefix', () => {
    document.body.innerHTML = `
      <div>
        <div role="combobox" tabindex="0" aria-label="To recipients. Press backspace to remove."></div>
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[role="combobox"]'));
  });

  it('prefers the exact label over a prefix match and separates Cc from Bcc', () => {
    document.body.innerHTML = `
      <div>
        <input aria-label="To do list title">
        <input aria-label="To">
        <input aria-label="Cc">
        <input aria-label="Bcc">
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('Cc')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Cc"]'));
    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[aria-label="To"]'));
  });

  it('refuses an editable outside a compose root (no Send button ancestor)', () => {
    document.body.innerHTML = '<div><input aria-label="To"></div>';
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(false);
  });

  it('never grabs a field whose label merely contains the word, or subject/search fields', () => {
    document.body.innerHTML = `
      <div>
        <input aria-label="Reply to thread">
        <input aria-label="Add a subject to your message">
        <input aria-label="Search for recipients to add">
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(false);
  });

  it('returns false on an empty mailbox view', () => {
    document.body.innerHTML = '<div><button aria-label="New mail">New mail</button></div>';
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(false);
  });
});

describe('focusComposeRecipientField anchor discrimination (review pins)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function markAllVisible() {
    document.body.querySelectorAll('*').forEach((el) => markVisible(el));
  }

  it('prefers the real well in the compose pane over an exact-labelled decoy under the shared app root', () => {
    document.body.innerHTML = `
      <div id="app">
        <div id="filters"><input id="datefilter" aria-label="To"></div>
        <div id="compose">
          <div id="well" role="combobox" tabindex="0" aria-label="To recipients. Press backspace to remove."></div>
          <button aria-label="Send">Send</button>
        </div>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('#well'));
  });

  it('never scores chip text — an unlabelled editable full of addresses is not a recipient well', () => {
    document.body.innerHTML = `
      <div id="compose">
        <div contenteditable="true" tabindex="0">to someone@example.invalid; cc another@example.invalid</div>
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(false);
  });

  it('anchors on an icon-only button labelled "Send (Ctrl+Enter)"', () => {
    document.body.innerHTML = `
      <div id="compose">
        <input aria-label="To">
        <button aria-label="Send (Ctrl+Enter)"></button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[aria-label="To"]'));
  });

  it('tolerates "search" deeper inside a long-form recipient label', () => {
    document.body.innerHTML = `
      <div id="compose">
        <input aria-label="To recipients. Type to search the directory.">
        <button aria-label="Send">Send</button>
      </div>`;
    markAllVisible();

    expect(focusComposeRecipientField('To')).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('input'));
  });
});
