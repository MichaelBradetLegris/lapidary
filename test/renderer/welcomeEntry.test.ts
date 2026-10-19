import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* setup.11: how the page shows the welcome guide, what its buttons call, and
   how Settings brings it back. Source checks, as the tests run without a DOM:
   the steps are tested in test/shared/welcome.test.ts, the screen as drawn
   in welcome.render.test.ts, and the window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const SINGLE = APP.slice(APP.indexOf('if (singleScreen) {'), APP.lastIndexOf('return ('));
const SCREEN = read('components/WelcomeScreen.tsx');

describe('when the guide shows (setup.11)', () => {
  it('shows while the settings say the guide is not done, in the layout the Setup screen has', () => {
    expect(APP).toContain('const welcomeOpen = welcomeShown(settings);');
    expect(APP).toContain('const singleScreen = setupOpen || welcomeOpen;');
    expect(APP.indexOf('if (singleScreen) {')).toBeGreaterThan(APP.indexOf('const inert = shellInert('));
  });

  it('draws Setup first, so Set up Claude opens it over the guide, and the guide under the cards', () => {
    expect(SINGLE).toMatch(
      /<NotificationCards onAction=\{onCardAction\} \/>\s*\{setupOpen \? \(\s*<SetupScreen[\s\S]*?\/>\s*\) : settings \? \(\s*<WelcomeScreen\s/
    );
  });

  it('hands the guide the checks, and its buttons to the calls the rest of the page uses', () => {
    const screen = SINGLE.slice(
      SINGLE.indexOf('<WelcomeScreen'),
      SINGLE.indexOf('/>', SINGLE.indexOf('<WelcomeScreen'))
    );
    for (const prop of [
      'settings={settings}',
      'claude={claudeRuntime}',
      'claudeLastFailure={ai.lastFailure}',
      'openai={ai.runtimes.openai ?? null}',
      'onSetUpClaude={openSetup}',
      'onUseProvider={chooseProvider}',
      'onOpenSettings={openSettings}',
      'onChooseFolder={chooseManuscriptFolder}',
      'onStart={finishWelcome}',
      'onSkip={finishWelcome}'
    ]) {
      expect(screen).toContain(prop);
    }
  });

  it('keeps the launch card off the guide, whose first step says the same', () => {
    expect(APP).toMatch(/provider: activeProvider,\s*setupOpen,\s*welcomeOpen\s*\}\);/);
  });
});

describe('Start, Skip and Show the welcome guide again', () => {
  it('Start and Skip put the guide away at once and write onboardingDone, a failure saying so', () => {
    const finish = APP.slice(APP.indexOf('const finishWelcome = '), APP.indexOf('const chooseProvider = '));
    expect(finish).toMatch(
      /const current = useApp\.getState\(\)\.settings;\s*if \(current\) setSettings\(\{ \.\.\.current, onboardingDone: true \}\);\s*void call\('settings:set', \{ onboardingDone: true \}\)\s*\.then\(setSettings\)\s*\.catch\(\(err: unknown\) => notify\('error', welcomeNotKept\(errorMessage\(err\)\)\)\);/
    );
  });

  it('Use OpenAI instead and Use Claude instead write the provider', () => {
    const choose = APP.slice(
      APP.indexOf('const chooseProvider = '),
      APP.indexOf('const showWelcomeAgain = ')
    );
    expect(choose).toContain("void call('settings:set', { provider }).then(setSettings).catch(fail);");
  });

  it('Settings brings the guide back, closing itself and Setup, which would cover it', () => {
    const again = APP.slice(
      APP.indexOf('const showWelcomeAgain = '),
      APP.indexOf('const refuseWhileEditing = ')
    );
    expect(again).toMatch(
      /setSettingsOpen\(false\);\s*setSetupOpen\(false\);\s*void call\('settings:set', \{ onboardingDone: false \}\)\.then\(setSettings\)\.catch\(fail\);/
    );
    expect(APP).toContain('onShowWelcome={showWelcomeAgain}');
    const settings = read('components/SettingsDialog.tsx');
    expect(settings).toMatch(
      /<button type="button" onClick=\{onShowWelcome\}>\s*\{SHOW_WELCOME_AGAIN\}\s*<\/button>/
    );
  });
});

describe('what the guide reads, and when', () => {
  it('reads where things are kept and the guidelines file as it opens and whenever the folder or the file changes', () => {
    expect(SCREEN).toMatch(
      /call\('settings:effective', undefined\)[\s\S]*?readGuidelines\(\);\s*\}, \[manuscriptFolder, guidelinesPath, reviewsFolder, readGuidelines\]\);/
    );
  });

  it('reads the guidelines file again whenever the window gets the focus back', () => {
    expect(SCREEN).toMatch(
      /window\.addEventListener\('focus', readGuidelines\);\s*return \(\) => window\.removeEventListener\('focus', readGuidelines\);/
    );
  });

  it('keeps only the newest answer of each read', () => {
    expect(SCREEN).toContain('const ticket = ++statusSeq.current;');
    expect(SCREEN).toContain('if (ticket !== statusSeq.current) return;');
    expect(SCREEN).toContain('const ticket = ++pathsSeq.current;');
  });

  it("opens the style sheet through Settings' calls, then reads it again", () => {
    expect(SCREEN).toMatch(
      /call\('guidelines:open', \{ via \}\)\.then\(\s*\(result\) => \{\s*setNote\(\{ tone: 'info', text: openedGuidelinesNote\(result, via\) \}\);\s*readGuidelines\(\);/
    );
    expect(SCREEN).toMatch(
      /call\('shell:reveal', \{ target: 'guidelines' \}\)\.then\(\s*\(\) => readGuidelines\(\),/
    );
    for (const [id, call] of [
      ['open-obsidian', "openGuidelines('obsidian')"],
      ['open-default', "openGuidelines('default')"],
      ['show-in-folder', 'showGuidelines()'],
      ['set-up-claude', 'onSetUpClaude()'],
      ['use-openai', "onUseProvider('openai')"],
      ['use-claude', "onUseProvider('claude')"],
      ['open-settings', 'onOpenSettings()'],
      ['choose-folder', 'onChooseFolder()']
    ] as const) {
      expect(SCREEN).toMatch(
        new RegExp(`case '${id}':\\s*${call.replace(/[()]/g, (c) => `\\${c}`)};\\s*break;`)
      );
    }
  });
});

describe('the page behind it', () => {
  it('counts the guide as covering the page, so the review keys and Ctrl+S do nothing there', () => {
    const store = read('state/store.ts');
    expect(store).toMatch(/state\.setupOpen \|\|\s*welcomeShown\(state\.settings\) \|\|/);
  });
});
