import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

/* setup.17 (d): Settings' Claude account row, rendered with react-dom/server.
   The check keeps the `none` a Claude Code may give as the API key's source
   for a plan's sign-in (test/main/claudeRuntime.test.ts), and the row printed
   whatever it held, so a Max sign-in read "ann@example.com (Claude Max) key
   from none". It names the key's source only when there is one, as Setup's
   API key view does. Effects do not run here, so nothing is called. This
   file is type-checked with the renderer's project (tsconfig.web.json). */

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    provider: 'claude',
    state: 'ready',
    executablePath: PATH,
    cliVersion: '2.1.302',
    minCliVersion: '2.1.266',
    checkedAt: '2026-10-19T09:00:00.000Z',
    ...patch
  };
}

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The Claude account row as it renders: its label, its line and its button. */
function accountRow(runtime: RuntimeStatus | null): string {
  const html = decode(
    renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        models: [],
        runtime,
        onApply: () => undefined,
        onClose: () => undefined,
        onOpenSetup: () => undefined,
        chatgpt: null,
        chatgptWaiting: false,
        onOpenChatGptSetup: () => undefined,
        onShowWelcome: () => undefined,
        onAbout: () => undefined
      })
    )
  );
  // The row ends with its (?) since polish.4, at its right end since polish.15 (settingsDialog.render.test.ts).
  const row = /<div class="modal__row"><span>Claude account<\/span>[\s\S]*?<\/div>/.exec(html)?.[0];
  expect(row).toBeDefined();
  return row ?? '';
}

/** The line, after its id, which the Setup button names as its description (polish.4). */
const line = (text: string): string => `data-testid="claude-account-line">${text}</span>`;

describe("Settings' Claude account row (setup.17)", () => {
  it('names the account and its plan, and no key, for a plan s sign-in', () => {
    const plan = claude({
      credential: 'subscription',
      authMethod: 'claude.ai',
      email: 'ann@example.com',
      subscriptionType: 'Claude Max'
    });
    // As claudeRuntime.ts keeps it from an initialize reply that says none, and as 2.1.302 gives it, with no source.
    for (const runtime of [{ ...plan, apiKeySource: 'none' }, plan]) {
      const row = accountRow(runtime);
      expect(row).toContain(line('ann@example.com (Claude Max)'));
      expect(row).not.toMatch(/key from|none/);
      expect(row).toMatch(/<button type="button" aria-describedby="[^"]+">Setup<\/button>/);
    }
  });

  it("names an API key's source", () => {
    expect(
      accountRow(claude({ credential: 'api-key', authMethod: 'api_key', apiKeySource: 'ANTHROPIC_API_KEY' }))
    ).toContain(line('signed in, API key from ANTHROPIC_API_KEY'));
  });

  it('names the token in ANTHROPIC_AUTH_TOKEN, which outranks a key beside it', () => {
    expect(
      accountRow(
        claude({ credential: 'auth-token', authMethod: 'oauth_token', apiKeySource: 'ANTHROPIC_API_KEY' })
      )
    ).toContain(line('signed in, token from ANTHROPIC_AUTH_TOKEN'));
  });

  it("gives the check's words when Claude is not ready, and says when nothing was checked", () => {
    expect(
      accountRow(
        claude({
          state: 'not-signed-in',
          message: 'Claude Code is not signed in. Open Setup for instructions.'
        })
      )
    ).toContain(line('Claude Code is not signed in. Open Setup for instructions.'));
    expect(accountRow(null)).toContain(line('not checked'));
  });
});
