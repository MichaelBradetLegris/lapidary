import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* codex.2 review: the page's side of Sign in with ChatGPT. Source checks, as
   the tests run without a DOM: what the hook shows is decided by the pure
   functions in src/shared/ui/chatgpt.ts, tested in test/shared/chatgpt.test.ts
   (`chatGptWaiting`, `pollsForSignIn`, `signInFailureOutcome`,
   `signOutOutcome`); these pin how `useChatGpt` uses them, the ticket that
   lets only the newest sign-in's answer count, and the keys that send the
   focus back to the account button when Cancel goes. The window checks are
   in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\}/g, '{}')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const HOOK = read('state/chatgpt.ts');

/** The source of one `const <name> = useCallback(...)` in the hook, up to the hook's next statement. */
function callback(name: string): string {
  const start = HOOK.indexOf(`  const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const rest = HOOK.slice(start + 1);
  const end = rest.search(/\n {2}(const |return \{)/);
  return rest.slice(0, end);
}

describe("the page's sign-in state (codex.2 review)", () => {
  it('shows the wait from chatGptWaiting, so a page reloaded while main waits shows it too', () => {
    expect(HOOK).toContain('waiting: chatGptWaiting(signingIn, status),');
  });

  it('asks main again every SIGN_IN_POLL_MS while pollsForSignIn says so, and stops when it ends', () => {
    expect(HOOK).toContain('const polling = pollsForSignIn(signingIn, status);');
    expect(HOOK).toMatch(
      /useEffect\(\(\) => \{\s*if \(!polling\) return;\s*const timer = window\.setInterval\(refresh, SIGN_IN_POLL_MS\);\s*return \(\) => window\.clearInterval\(timer\);\s*\}, \[polling, refresh\]\);/
    );
  });

  it("lets only the newest sign-in's answer count, in its status, its failure and the end of its wait", () => {
    const signIn = callback('signIn');
    expect(signIn).toContain('const mine = ++ticket.current;');
    expect(signIn).toMatch(
      /\.then\(\(next\) => \{\s*if \(mine === ticket\.current\) setStatus\(next\);\s*\}\)/
    );
    expect(signIn).toMatch(/\.catch\(\(err: unknown\) => \{\s*if \(mine !== ticket\.current\) return;/);
    expect(signIn).toMatch(
      /\.finally\(\(\) => \{\s*if \(mine === ticket\.current\) setSigningIn\(false\);\s*\}\)/
    );
  });

  it('says what signInFailureOutcome says for a failed sign-in, which is nothing for a cancelled one', () => {
    expect(callback('signIn')).toContain(
      'setOutcome(signInFailureOutcome(err instanceof ApiError ? err.code : null, errorMessage(err)));'
    );
  });

  it('says what signOutOutcome says for whether OpenAI confirmed the sign-out', () => {
    expect(callback('signOut')).toMatch(
      /\.then\(\(\{ status: next, revoked \}\) => \{\s*setStatus\(next\);\s*setOutcome\(signOutOutcome\(revoked\)\);\s*\}\)/
    );
    expect(HOOK).not.toContain('SIGNED_OUT_REVOKED');
    expect(HOOK).not.toContain('SIGNED_OUT_NOT_REVOKED');
  });

  it('clears the line under the buttons as each of the four starts, so no earlier failure is left there', () => {
    for (const name of ['signIn', 'signOut', 'setDataSettingsConfirmed', 'openDataControls']) {
      const source = callback(name);
      const cleared = source.indexOf('setOutcome(null);');
      expect(cleared, name).toBeGreaterThan(-1);
      expect(cleared, name).toBeLessThan(source.indexOf('call('));
    }
  });
});

describe("the ChatGPT view's buttons (codex.2 review)", () => {
  const VIEW = read('components/ChatGptSetup.tsx');
  const actions = VIEW.slice(
    VIEW.indexOf('<div className="setup__status-actions">'),
    VIEW.indexOf('{outcome ? (')
  );

  it('keeps Sign in and Sign out one element, under one key, so the focus stays on it', () => {
    expect(actions.match(/<button\s+key="account"/g)).toHaveLength(2);
    expect(actions.match(/ref=\{accountButton\}/g)).toHaveLength(2);
  });

  it('gives Cancel and Use another account keys of their own, so Cancel goes with the focus when the wait ends', () => {
    expect(actions).toMatch(
      /<button key="cancel" type="button" onClick=\{onCancelSignIn\}>\s*\{CANCEL_SIGN_IN_BUTTON\}/
    );
    expect(actions).toMatch(
      /<button key="another" type="button" onClick=\{\(\) => onSignIn\(true\)\}>\s*\{ANOTHER_ACCOUNT_BUTTON\}/
    );
    expect(actions.match(/<button/g)).toHaveLength(4);
  });

  it('hands a focus left on nothing to the account button when the wait ends', () => {
    expect(VIEW).toMatch(
      /if \(wasWaiting\.current && !waiting && document\.activeElement === document\.body\) \{\s*accountButton\.current\?\.focus\(\);\s*\}/
    );
  });
});
