import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatGptSetup } from '../../src/renderer/components/ChatGptSetup';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { ChatGptOutcome } from '../../src/renderer/state/chatgpt';
import type { ChatGptStatus } from '../../src/shared/ipc';
import {
  CHATGPT_PRIVACY_FOOTER,
  DATA_SETTINGS_CHECKBOX,
  SIGNED_OUT_NOT_REVOKED,
  TRAINING_CHOICE_TEXT,
  TRAINING_WARNING_TEXT,
  TRAINING_WARNING_TITLE,
  dataSettingsNote
} from '../../src/shared/ui/chatgpt';
import { CHATGPT_ACCOUNT_TIP, helpButtonLabel } from '../../src/shared/ui/settingsDialog';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

/* codex.2: the Setup screen's ChatGPT view and Settings' ChatGPT account row,
   rendered with react-dom/server. The view says whether a sign-in is kept and
   its plan, offers Sign in with ChatGPT or Sign out, and always shows the
   training warning with its button and its box; nothing on it can show a
   token, since the page is never given one. Effects do not run here, so
   nothing is called. This file is type-checked with the renderer's project
   (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

/** Each button's label, with [primary], [held] or [disabled] after it. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs = '', inner = '']) => {
    const marks = [
      / class="[^"]*primary/.test(attrs) ? ' [primary]' : '',
      / aria-disabled="true"/.test(attrs) ? ' [held]' : '',
      / disabled=""/.test(attrs) ? ' [disabled]' : ''
    ].join('');
    return `${text(inner)}${marks}`;
  });
}

const SIGNED_OUT: ChatGptStatus = {
  signedIn: false,
  plan: null,
  dataSettingsConfirmed: false,
  signingIn: false,
  registered: false,
  encryptionAvailable: true
};
const SIGNED_IN: ChatGptStatus = { ...SIGNED_OUT, signedIn: true, plan: 'Plus', registered: true };

function render(
  status: ChatGptStatus | null,
  options: { waiting?: boolean; busy?: boolean; outcome?: ChatGptOutcome | null } = {}
): string {
  return renderToStaticMarkup(
    createElement(ChatGptSetup, {
      status,
      waiting: options.waiting ?? false,
      busy: options.busy ?? false,
      outcome: options.outcome ?? null,
      onSignIn: () => undefined,
      onCancelSignIn: () => undefined,
      onSignOut: () => undefined,
      onConfirmDataSettings: () => undefined,
      onOpenDataControls: () => undefined,
      onClose: () => undefined,
      version: '1.0.0'
    })
  );
}

/** The training warning's markup. */
function warning(html: string): string {
  const start = html.lastIndexOf('<section', html.indexOf('data-testid="chatgpt-training-warning"'));
  return html.slice(start, html.indexOf('</section>', start));
}

describe("the Setup screen's ChatGPT view (codex.2)", () => {
  it('signed out: Sign in with ChatGPT, the warning, and a box that waits for a sign-in', () => {
    const html = render(SIGNED_OUT);
    expect(html).toContain('<h1>Set up ChatGPT</h1>');
    expect(html).toContain('data-view="chatgpt-signed-out"');
    expect(text(html)).toContain('Not signed in to ChatGPT');
    expect(buttons(html)).toEqual(['Close', 'Sign in with ChatGPT [primary]', 'Open Data controls']);
    expect(html).toMatch(/<input type="checkbox" disabled="" aria-describedby="[^"]+"\/>/);
    expect(text(warning(html))).toContain(dataSettingsNote(SIGNED_OUT));
  });

  it('waiting: the sign-in button held, keeping the focus, and Cancel beside it', () => {
    const html = render(SIGNED_OUT, { waiting: true });
    expect(html).toContain('data-view="chatgpt-waiting"');
    expect(text(html)).toContain('Waiting for you to sign in');
    expect(buttons(html)).toEqual([
      'Close',
      'Sign in with ChatGPT [primary] [held]',
      'Cancel',
      'Open Data controls'
    ]);
  });

  it('signed in: the plan, Sign out, and the box, ticked once the account has confirmed', () => {
    const html = render(SIGNED_IN);
    expect(html).toContain('data-view="chatgpt-signed-in"');
    expect(html).toContain('setup__status--ok');
    expect(text(html)).toContain('Signed in to ChatGPT');
    expect(text(html)).toContain('Your ChatGPT account is on the Plus plan.');
    expect(buttons(html)).toEqual(['Close', 'Sign out', 'Open Data controls']);
    expect(html).toMatch(/<input type="checkbox" aria-describedby="[^"]+"\/>/);
    const confirmed = render({ ...SIGNED_IN, dataSettingsConfirmed: true });
    expect(confirmed).toMatch(/<input type="checkbox" aria-describedby="[^"]+" checked=""\/>/);
    // The warning stays as a reminder once the box is ticked.
    expect(text(warning(confirmed))).toContain(TRAINING_WARNING_TITLE);
    expect(text(warning(confirmed))).toContain('Kept for this account.');
    expect(buttons(render(SIGNED_IN, { busy: true }))).toContain('Sign out [held]');
  });

  it('offers Use another account while signed out with a registration kept', () => {
    expect(buttons(render({ ...SIGNED_OUT, registered: true }))).toEqual([
      'Close',
      'Sign in with ChatGPT [primary]',
      'Use another account',
      'Open Data controls'
    ]);
  });

  it('cannot sign in when Windows cannot encrypt, and says why', () => {
    const html = render({ ...SIGNED_OUT, encryptionAvailable: false, registered: true });
    expect(html).toContain('setup__status--warn');
    expect(buttons(html)).toEqual([
      'Close',
      'Sign in with ChatGPT [primary] [disabled]',
      'Open Data controls'
    ]);
  });

  it('holds the sign-in button until the status is read', () => {
    expect(buttons(render(null))).toContain('Sign in with ChatGPT [primary] [held]');
  });

  it('shows how the last sign-in or sign-out went under the buttons, in the card read out', () => {
    const html = render(SIGNED_OUT, { outcome: { tone: 'warn', text: SIGNED_OUT_NOT_REVOKED } });
    expect(html).toMatch(
      /<section class="setup__status setup__status--pending" role="status" aria-live="polite" aria-label="ChatGPT status">[\s\S]*<p class="setup__test-result setup__test-result--warn">/
    );
    expect(decode(html)).toContain(SIGNED_OUT_NOT_REVOKED);
  });

  it('shows the training warning whatever the state, as a note named by its title', () => {
    for (const html of [
      render(null),
      render(SIGNED_OUT),
      render(SIGNED_OUT, { waiting: true }),
      render(SIGNED_IN)
    ]) {
      const box = warning(html);
      expect(box).toMatch(/role="note" aria-labelledby="([^"]+)"[\s\S]*<h2 id="\1"/);
      expect(text(box)).toContain(TRAINING_WARNING_TITLE);
      expect(decode(box)).toContain(TRAINING_WARNING_TEXT);
      expect(decode(box)).toContain(TRAINING_CHOICE_TEXT);
      expect(text(box)).toContain(DATA_SETTINGS_CHECKBOX);
    }
  });

  it("ends with the privacy footer and the app's version", () => {
    const html = render(SIGNED_IN);
    expect(decode(html)).toContain(CHATGPT_PRIVACY_FOOTER);
    expect(html).toMatch(/<p class="setup__version">[^<]+ 1\.0\.0<\/p><\/div><\/div>$/);
  });
});

describe("Settings' ChatGPT account row (codex.2)", () => {
  function settings(chatgpt: ChatGptStatus | null, waiting = false): string {
    return decode(
      renderToStaticMarkup(
        createElement(SettingsDialog, {
          settings: { ...DEFAULT_SETTINGS, manuscriptFolder: 'C:\\Novel' }, // check-public: allow
          models: [],
          runtime: null,
          keyStatus: null,
          chatgpt,
          chatgptWaiting: waiting,
          onApply: () => undefined,
          onKeyChanged: () => undefined,
          onClose: () => undefined,
          onOpenSetup: () => undefined,
          onOpenChatGptSetup: () => undefined,
          onShowWelcome: () => undefined,
          onAbout: () => undefined
        })
      )
    );
  }

  /** The row's markup. */
  function row(html: string): string {
    const start = html.lastIndexOf('<div class="modal__row">', html.indexOf('<span>ChatGPT account</span>'));
    return html.slice(start, html.indexOf('</div>', start));
  }

  it('comes between the Claude account and the OpenAI key, with Setup and its (?)', () => {
    const html = settings(SIGNED_IN);
    const at = ['<span>Claude account</span>', '<span>ChatGPT account</span>', '<span>OpenAI API key'].map(
      (part) => html.indexOf(part)
    );
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const cells = row(html);
    expect(cells).toMatch(
      /<span class="modal__path" id="([^"]+)" data-testid="chatgpt-account-line">signed in \(Plus\)<\/span><span class="modal__buttons"><button type="button" aria-describedby="\1">Setup<\/button><\/span>/
    );
    expect(cells).toContain(`aria-label="${helpButtonLabel('the ChatGPT account')}"`);
    expect(cells).toContain(CHATGPT_ACCOUNT_TIP);
  });

  it('says not signed in, waiting, or not read yet', () => {
    expect(row(settings(SIGNED_OUT))).toContain('>not signed in<');
    expect(row(settings(SIGNED_OUT, true))).toContain('>waiting for the browser<');
    expect(row(settings(null))).toContain('>not read yet<');
  });
});
