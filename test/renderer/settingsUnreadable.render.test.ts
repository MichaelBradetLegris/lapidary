import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsUnreadable } from '../../src/renderer/components/SettingsUnreadable';
import { APP_NAME } from '../../src/shared/branding';
import type { SettingsReadFailure } from '../../src/shared/ipc';
import { DIAGNOSTICS_LINK_SELECTOR } from '../../src/shared/ui/diagnostics';
import {
  SETTINGS_DAMAGED_LINES,
  SETTINGS_HELD_LINES,
  SETTINGS_STILL_DAMAGED,
  SETTINGS_STILL_UNREADABLE,
  SETTINGS_UNREADABLE_TITLE
} from '../../src/shared/ui/settingsRead';

/* hardening.15: the card the page shows while settings.json cannot be read,
   rendered with react-dom/server, for each reason main gives. What App does
   with it, and Try again's read, are tested in settingsRead.test.ts. This
   file is type-checked with the renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

const noop = (): void => undefined;

function card(trying: boolean, failedAgain: boolean, reason: SettingsReadFailure = 'refused'): string {
  return renderToStaticMarkup(
    createElement(SettingsUnreadable, {
      reason,
      trying,
      failedAgain,
      onTryAgain: noop,
      onShowFile: noop,
      onShowDiagnostics: noop
    })
  );
}

const BUTTONS =
  '<div class="setup__status-actions"><button type="button" class="primary">Try again</button><button type="button">Show in folder</button><button type="button" data-opens="diagnostics">Show diagnostics</button></div>';

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

  it('for a read refused, names settings.json, says to close the program holding it, and that nothing in it changes', () => {
    expect(text(html)).toBe(
      `${SETTINGS_UNREADABLE_TITLE} ${SETTINGS_HELD_LINES.join(' ')} Try again Show in folder Show diagnostics`
    );
    expect(text(html)).toContain('settings.json');
    expect(text(html)).toContain('Close it, then choose Try again.');
    expect(text(html)).toContain(`Until ${APP_NAME} can read the file it changes nothing in it`);
  });

  it('for a file that is not JSON with no copy made, says it is damaged and left as it is, never that a program holds it', () => {
    const damaged = card(false, false, 'no-copy');
    expect(text(damaged)).toBe(
      `${SETTINGS_UNREADABLE_TITLE} ${SETTINGS_DAMAGED_LINES.join(' ')} Try again Show in folder Show diagnostics`
    );
    expect(text(damaged)).toContain('settings.json is damaged: it is not valid JSON.');
    expect(text(damaged)).not.toContain('Another program');
    expect(damaged).toContain(BUTTONS);
    expect(card(false, true, 'no-copy')).toContain(
      `<p class="settings-unreadable__status" aria-live="polite">${SETTINGS_STILL_DAMAGED}</p>`
    );
  });

  it("has Try again, blue, Show in folder and Show diagnostics, marked as Setup's is, and an empty line read out once a Try again fails", () => {
    expect(html).toContain(BUTTONS);
    expect(html).toContain('<p class="settings-unreadable__status" aria-live="polite"></p>');
    expect(DIAGNOSTICS_LINK_SELECTOR).toBe('[data-opens="diagnostics"]');
  });

  it('holds Try again while it reads, keeping the focus, with no line under it, and leaves the other two as they are', () => {
    const reading = card(true, true);
    expect(reading).toContain(
      '<button type="button" class="primary" aria-disabled="true">Reading…</button><button type="button">Show in folder</button><button type="button" data-opens="diagnostics">Show diagnostics</button>'
    );
    expect(reading).toContain('<p class="settings-unreadable__status" aria-live="polite"></p>');
  });

  it('says the file still could not be read after a Try again that failed', () => {
    expect(card(false, true)).toContain(
      `<p class="settings-unreadable__status" aria-live="polite">${SETTINGS_STILL_UNREADABLE}</p>`
    );
  });

  it('calls onTryAgain from Try again, and nothing while it is held; Show in folder and Show diagnostics call theirs, held or not', () => {
    type Button = ReactElement<{ onClick?: () => void; children?: ReactNode }>;
    function buttons(node: ReactNode): Button[] {
      if (Array.isArray(node)) return node.flatMap(buttons);
      if (!isValidElement(node)) return [];
      const el = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
      return [...(el.type === 'button' ? [el as Button] : []), ...buttons(el.props.children)];
    }
    const presses = { tryAgain: 0, file: 0, diagnostics: 0 };
    const press = (trying: boolean, index: number): void => {
      const element = SettingsUnreadable({
        reason: 'no-copy',
        trying,
        failedAgain: false,
        onTryAgain: () => (presses.tryAgain += 1),
        onShowFile: () => (presses.file += 1),
        onShowDiagnostics: () => (presses.diagnostics += 1)
      });
      const found = buttons(element);
      expect(found).toHaveLength(3);
      found[index]?.props.onClick?.();
    };
    press(false, 0);
    expect(presses).toEqual({ tryAgain: 1, file: 0, diagnostics: 0 });
    press(true, 0);
    expect(presses).toEqual({ tryAgain: 1, file: 0, diagnostics: 0 });
    press(true, 1);
    press(false, 2);
    expect(presses).toEqual({ tryAgain: 1, file: 1, diagnostics: 1 });
  });
});
