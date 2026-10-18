import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* setup.7: how the page reaches the Setup screen and what it draws there.
   Source checks, as the tests run without a DOM: the pure rules are tested in
   test/shared/setup.test.ts, the screen itself in setupScreen.render.test.ts,
   and the window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const SETUP = APP.slice(APP.indexOf('if (setupOpen) {'), APP.lastIndexOf('return ('));
const MAIN = APP.slice(APP.lastIndexOf('return ('));

describe('every layout has the cards, the dialogs and the question (setup.7)', () => {
  it('finds the Setup layout before the main one', () => {
    expect(SETUP).toContain('<SetupScreen');
    expect(MAIN).toContain('<ReviewPane');
    expect(APP.indexOf('if (setupOpen) {')).toBeGreaterThan(APP.indexOf('const inert = shellInert('));
  });

  for (const [name, layout] of [
    ['Setup', SETUP],
    ['main', MAIN]
  ] as const) {
    it(`${name}: cards with their buttons, Settings and the other dialogs, the question last`, () => {
      expect(layout).toContain('<NotificationCards onAction={onCardAction} />');
      expect(layout).toContain('<div className="app-shell__page" inert={inert.page}>');
      expect(layout).toMatch(
        // (each `{}` is a JSX comment with its text taken out)
        /<div className="app-shell__dialogs" inert=\{inert\.dialogs\}>\s*\{newChapterDialog\}\s*\{manualReviewDialog\}\s*\{reviewDialog\}\s*\{settingsDialog\}\s*<\/div>\s*(\{\s*\}\s*)?<ConfirmDialog \/>\s*<\/div>\s*\);/
      );
      expect(layout).toContain(
        '<StatusBar review={review} {...statusRuntime} rateLimit={ai.rateLimit?.message} />'
      );
    });
  }

  it('shows Setup whenever it is open, the first check still running included', () => {
    expect(SETUP).toMatch(/<SetupScreen\s+runtime=\{claudeRuntime\}\s+lastFailure=\{ai\.lastFailure\}/);
    expect(APP).not.toContain('setupOpen && claudeRuntime');
  });

  it('offers "Try the review anyway" with a chapter open and nothing the check found in the way', () => {
    expect(SETUP).toContain(
      '{...(review?.sourcePath && canTryReviewAnyway(claudeRuntime, ai.lastFailure)\n                ? { onTryAnyway: tryReviewAnyway }\n                : {})}'
    );
    const tryAnyway = APP.slice(
      APP.indexOf('const tryReviewAnyway = '),
      APP.indexOf('const activeRuntime = ')
    );
    expect(tryAnyway).toMatch(/setSetupOpen\(false\);\s*openReviewDialog\(\);/);
  });
});

describe('gating and entry points (setup.7)', () => {
  it('opens Setup from Review with AI only when reviewGate says so', () => {
    const open = APP.slice(APP.indexOf('const openReviewDialog = '), APP.indexOf('const startReview = '));
    expect(open).toMatch(
      /if \(provider === 'claude' && reviewGate\(claudeRuntime\) === 'setup'\) \{\s*openSetup\(\);\s*return;\s*\}/
    );
    expect(open).not.toContain("state !== 'ready'");
  });

  it('opens Setup from the card, the status bar, Settings and the dialog, and withdraws the launch card', () => {
    const openSetup = APP.slice(
      APP.indexOf('const openSetup = '),
      APP.indexOf('const refuseWhileEditing = ')
    );
    expect(openSetup).toContain('dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);');
    expect(openSetup).toContain('setSetupOpen(true);');
    expect(APP).toMatch(/case 'open-setup':\s*openSetup\(\);/);
    expect(APP).toContain("onRuntime: activeProvider === 'claude' ? openSetup : openSettings,");
    expect(APP).toContain('runtimeTitle: runtimeButtonTitle(activeProvider)');
    expect(APP.match(/onOpenSetup=\{openSetup\}/g)).toHaveLength(2);
  });

  it('raises the launch card under its key with Open Setup, and withdraws it by the key', () => {
    const card = APP.slice(
      APP.indexOf('const runtimeCardRaised = '),
      APP.indexOf('const { recheckOnFocus } = ai;')
    );
    expect(card).toContain('const card = runtimeCard(claudeView, claudeRuntime);');
    expect(card).toMatch(/if \(!card\) \{\s*dismissNotificationsByKey\(CLAUDE_RUNTIME_CARD\);/);
    expect(card).toContain("upsertNotification(CLAUDE_RUNTIME_CARD, card.tone, card.text, 'open-setup');");
    // Raised once, at launch, for Claude; kept current only while it is up.
    expect(card).toContain(
      "if (showing || (!runtimeCardRaised.current && activeProvider === 'claude' && !onSetup)) {"
    );
  });

  it('checks again as the window comes back to the front, through focusRecheckDue', () => {
    expect(APP).toMatch(
      /const onFocus = \(\): void => recheckOnFocus\(claudeInUse, claudeView\);\s*window\.addEventListener\('focus', onFocus\);\s*return \(\) => window\.removeEventListener\('focus', onFocus\);/
    );
    expect(APP).toContain("const claudeInUse = activeProvider === 'claude' || setupOpen;");
    const ai = read('state/useAi.ts');
    const recheck = ai.slice(ai.indexOf('const recheckOnFocus = '), ai.indexOf('const refreshKeyStatus = '));
    expect(recheck).toContain('inFlight: claudeChecking.current > 0,');
    expect(recheck).toContain('lastCheckAt: claudeCheckAt.current,');
    expect(recheck).toContain("if (due) check('claude');");
    // Every check of Claude counts, the one at launch included.
    expect(ai.match(/claudeCheckAt\.current = Date\.now\(\);/g)).toHaveLength(2);
    expect(ai.match(/claudeChecking\.current \+= 1;/g)).toHaveLength(2);
    expect(ai.match(/claudeChecking\.current -= 1;/g)).toHaveLength(2);
  });

  it('tells the review dialog the last failure, for its warning, and how to open Setup', () => {
    expect(APP).toMatch(/claudeLastFailure=\{ai\.lastFailure\}\s*onOpenSetup=\{openSetup\}/);
    const dialog = read('components/ReviewDialog.tsx');
    expect(dialog).toContain(
      'const claudeWarning = isOpenAi ? null : reviewDialogWarning(runtime, claudeLastFailure);'
    );
  });
});

describe('Copy says when it fails (setup.7)', () => {
  const command = read('components/Command.tsx');

  it('reports a refused copy on the button and in a line of its own', () => {
    expect(command).toContain(".catch(() => setState('failed'));");
    expect(command).toContain("state === 'failed' ? 'Copy failed'");
    expect(command).toMatch(/<span className="cmd__failed" role="alert">\s*\{COPY_FAILED_TEXT\}\s*<\/span>/);
    expect(command).not.toContain('.catch(() => undefined)');
  });

  it('lets a click select the whole command for copying by hand', () => {
    const css = withoutComments(readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8'));
    expect(css).toMatch(/\.cmd code \{[^}]*user-select: all;/);
  });
});
