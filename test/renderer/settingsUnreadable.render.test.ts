import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsUnreadable } from '../../src/renderer/components/SettingsUnreadable';
import { APP_NAME } from '../../src/shared/branding';
import {
  SETTINGS_STILL_UNREADABLE,
  SETTINGS_UNREADABLE_LINES,
  SETTINGS_UNREADABLE_TITLE
} from '../../src/shared/ui/settingsRead';

/* hardening.15: the card the page shows while settings.json cannot be read,
   rendered with react-dom/server. What App does with it, and Try again's
   read, are tested in settingsRead.test.ts. This file is type-checked with
   the renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

function card(trying: boolean, failedAgain: boolean): string {
  return renderToStaticMarkup(
    createElement(SettingsUnreadable, { trying, failedAgain, onTryAgain: () => undefined })
  );
}

describe('the card while settings.json cannot be read (hardening.15)', () => {
  const html = card(false, false);

  it("is one warning card in the Setup screen's scroller and column, its heading inside it", () => {
    expect(html).toMatch(
      /^<div class="setup settings-unreadable"><div class="setup__page"><section class="setup__status setup__status--warn" aria-labelledby="settings-unreadable-title"><div class="setup__status-text"><h1 id="settings-unreadable-title">/
    );
    expect(decode(html)).toContain(
      `<h1 id="settings-unreadable-title">${APP_NAME} could not read its settings</h1>`
    );
  });

  it('names settings.json, says to close the program holding it, and that nothing in it changes', () => {
    expect(text(html)).toBe(`${SETTINGS_UNREADABLE_TITLE} ${SETTINGS_UNREADABLE_LINES.join(' ')} Try again`);
    expect(text(html)).toContain('settings.json');
    expect(text(html)).toContain('Close it, then choose Try again.');
    expect(text(html)).toContain(`Until ${APP_NAME} can read the file it changes nothing in it`);
  });

  it('has Try again, blue, and an empty line read out once a Try again fails', () => {
    expect(html).toContain('<button type="button" class="primary">Try again</button>');
    expect(html).toContain('<p class="settings-unreadable__status" aria-live="polite"></p>');
  });

  it('holds Try again while it reads, keeping the focus, with no line under it', () => {
    const reading = card(true, true);
    expect(reading).toContain('<button type="button" class="primary" aria-disabled="true">Reading…</button>');
    expect(reading).toContain('<p class="settings-unreadable__status" aria-live="polite"></p>');
  });

  it('says the file still could not be read after a Try again that failed', () => {
    expect(card(false, true)).toContain(
      `<p class="settings-unreadable__status" aria-live="polite">${SETTINGS_STILL_UNREADABLE}</p>`
    );
  });

  it('calls onTryAgain from Try again, and nothing while it is held', () => {
    function buttons(node: ReactNode): ReactElement<{ onClick?: () => void }>[] {
      if (Array.isArray(node)) return node.flatMap(buttons);
      if (!isValidElement(node)) return [];
      const el = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
      return [...(el.type === 'button' ? [el] : []), ...buttons(el.props.children)];
    }
    let presses = 0;
    const press = (trying: boolean): void => {
      const element = SettingsUnreadable({ trying, failedAgain: false, onTryAgain: () => (presses += 1) });
      const found = buttons(element);
      expect(found).toHaveLength(1);
      found[0]?.props.onClick?.();
    };
    press(false);
    expect(presses).toBe(1);
    press(true);
    expect(presses).toBe(1);
  });
});
