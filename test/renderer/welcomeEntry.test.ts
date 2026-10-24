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
    expect(APP).toContain('const welcomeClosed = useApp((s) => s.welcomeClosed);');
    expect(APP).toContain('const welcomeOpen = welcomeShown(settings, welcomeClosed);');
    expect(APP).toContain('const singleScreen = setupOpen || welcomeOpen;');
    expect(APP.indexOf('if (singleScreen) {')).toBeGreaterThan(APP.indexOf('const inert = shellInert('));
  });

  it('draws Setup first, so Set up Claude opens it over the guide, and the guide under the cards', () => {
    expect(SINGLE).toMatch(
      /<NotificationCards onAction=\{onCardAction\} \/>\s*\{setupOpen && setupFor === 'chatgpt' \? \(\s*<ChatGptSetup[\s\S]*?\/>\s*\) : setupOpen \? \(\s*<SetupScreen[\s\S]*?\/>\s*\) : settings \? \(\s*<WelcomeScreen\s/
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
      'chatgpt={chatgpt.status}',
      'chatgptWaiting={chatgpt.waiting}',
      'onSetUpClaude={openSetupFromWelcome}',
      'onSetUpChatGpt={openChatGptSetupFromWelcome}',
      // The ChatGPT section's sign-in, and the folder rows' settings (setup.18).
      'onSignInChatGpt={signInChatGptFromWelcome}',
      'onUseProvider={chooseProvider}',
      'onChooseFolder={chooseManuscriptFolder}',
      'onApply={applySavedSettings}',
      'onStart={finishWelcome}',
      'onSkip={finishWelcome}',
      // Back from Setup, the step's button takes the focus (setup.19).
      "landOn={setupLanding?.to === 'welcome' ? setupLanding.view : null}"
    ]) {
      expect(screen).toContain(prop);
    }
    // Nothing of the OpenAI API key's, which codex.6 took out.
    expect(screen).not.toMatch(/openai|onOpenSettings/i);
  });

  it('keeps the launch card off the guide, whose first step says the same', () => {
    expect(APP).toMatch(/provider: activeProvider,\s*setupOpen: claudeSetupOpen,\s*welcomeOpen\s*\}\);/);
  });
});

describe('Start, Skip and Show the welcome guide again', () => {
  it('Start and Skip put the guide away at once and write onboardingDone, a failure saying so', () => {
    // What closeWelcome does is tested in welcomeState.test.ts.
    const finish = APP.slice(APP.indexOf('const finishWelcome = '), APP.indexOf('const chooseProvider = '));
    expect(finish).toMatch(
      /void closeWelcome\(WELCOME_IO\)\.catch\(\(err: unknown\) =>\s*notify\('error', welcomeNotKept\(errorMessage\(err\)\)\)\s*\);/
    );
    expect(APP).toMatch(
      /const WELCOME_IO: WelcomeIo = \{\s*setSettings: \(patch\) => call\('settings:set', patch\)\s*\};/
    );
  });

  it('offers Sonnet on Pro only while the guide is open (setup.11 review)', () => {
    expect(APP).toContain(
      'const patch = proPreselection(settings, claudeRuntime.subscriptionType, welcomeOpen);'
    );
    expect(APP).toContain('}, [settings, claudeRuntime, welcomeOpen, setSettings]);');
    expect(APP.indexOf('const welcomeOpen = ')).toBeLessThan(APP.indexOf('proPreselection(settings'));
  });

  it("a section's button writes the provider when welcomeProviderFor says so (setup.18)", () => {
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
    // What reopenWelcome writes is tested in welcomeState.test.ts.
    expect(again).toMatch(
      /setSettingsOpen\(false\);\s*setSetupOpen\(false\);\s*void reopenWelcome\(WELCOME_IO\)\.catch\(fail\);/
    );
    expect(APP).toContain('onShowWelcome={showWelcomeAgain}');
    const settings = read('components/SettingsDialog.tsx');
    // At the foot since polish.4, with its note as its tooltip.
    expect(settings).toMatch(
      /<button type="button" title=\{WELCOME_GUIDE_NOTE\} onClick=\{onShowWelcome\}>\s*\{SHOW_WELCOME_AGAIN\}\s*<\/button>/
    );
  });
});

describe('what the guide reads, and when', () => {
  it('reads where things are kept and the guidelines file as it opens and whenever a folder or the file changes', () => {
    expect(SCREEN).toMatch(
      /call\('settings:effective', undefined\)[\s\S]*?readGuidelines\(\);\s*\}, \[manuscriptFolder, guidelinesPath, reviewsFolder, backupsFolder, readGuidelines\]\);/
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
      /call\('guidelines:open', undefined\)\.then\(\s*\(result\) => \{\s*setNote\(\{ tone: 'info', text: openedGuidelinesNote\(result\) \}\);\s*readGuidelines\(\);/
    );
    expect(SCREEN).toMatch(
      /call\('shell:reveal', \{ target: 'guidelines' \}\)\.then\(\s*\(\) => readGuidelines\(\),/
    );
    for (const [id, calls] of [
      ['open-guidelines', ['openGuidelines()']],
      ['open-guidelines-folder', ['showGuidelines()']],
      ['choose-folder', ['onChooseFolder()']],
      ['change-reviews-folder', ["changeFolder('reviews')"]],
      ['change-backups-folder', ["changeFolder('backups')"]],
      // Each section's button may make its agent the provider first (setup.18).
      ['set-up-claude', ["chooseFor('claude')", 'onSetUpClaude()']],
      ['sign-in-chatgpt', ["chooseFor('chatgpt')", 'onSignInChatGpt?.()']],
      ['set-up-chatgpt', ["chooseFor('chatgpt')", 'onSetUpChatGpt?.()']]
    ] as const) {
      const body = calls.map((call) => `${call.replace(/[().?]/g, (c) => `\\${c}`)};\\s*`).join('');
      expect(SCREEN).toMatch(new RegExp(`case '${id}':\\s*${body}break;`));
    }
    // Nothing of Use ChatGPT instead or Use Claude instead, which the two sections replaced.
    expect(SCREEN).not.toMatch(/use-chatgpt|use-claude/);
  });
});

describe('the new steps (setup.18)', () => {
  it('make the provider the one welcomeProviderFor names, before opening the Setup view', () => {
    expect(SCREEN).toMatch(
      /const chooseFor = \(section: SetupFor\): void => \{\s*const provider = welcomeProviderFor\(section, input\);\s*if \(provider\) onUseProvider\(provider\);\s*\};/
    );
  });

  it("Sign in with ChatGPT opens the ChatGPT view over the guide, then starts the view's own sign-in", () => {
    expect(APP).toContain('const { signIn: signInChatGpt } = chatgpt;');
    expect(APP).toMatch(
      /const signInChatGptFromWelcome = useCallback\(\(\) => \{\s*showSetup\('chatgpt', 'welcome'\);\s*signInChatGpt\(false\);\s*\}, \[showSetup, signInChatGpt\]\);/
    );
  });

  it("a folder row's Change picks a folder and saves it as Settings does, main's refusal staying under the row", () => {
    expect(SCREEN).toMatch(
      /const key = FOLDER_SETTINGS\[row\];\s*setRowNotes\(\(notes\) => \(\{ \.\.\.notes, \[row\]: undefined \}\)\);/
    );
    expect(SCREEN).toMatch(
      /call\('dialog:pick-folder', \{\s*title: FOLDER_PICKER_TITLES\[row\],\s*\.\.\.\(current \? \{ defaultPath: current \} : \{\}\)\s*\}\)\s*\.then\(\(folder\) => \(folder \? call\('settings:set', \{ \[key\]: folder \}\) : null\)\)\s*\.then\(\(next\) => \{\s*if \(next\) onApply\?\.\(next\);\s*\}\)\s*\.catch\(\(err: unknown\) => setRowNotes\(\(notes\) => \(\{ \.\.\.notes, \[row\]: errorMessage\(err\) \}\)\)\);/
    );
    expect(SCREEN).toContain('rowNotes={rowNotes}');
  });

  it('hands main the settings it saved, and reads the chapter list again, as Settings does', () => {
    // noteSavedSettings puts them in the store, and withdraws Choose folder's
    // card when either folder changed (setup.18 review, manuscriptFolder.test.ts).
    expect(APP).toMatch(
      /const applySavedSettings = useCallback\(\s*\(next: Settings\) => \{\s*noteSavedSettings\(next\);\s*refreshFiles\(\);\s*\},\s*\[refreshFiles\]\s*\);/
    );
    expect(APP).toContain('onApply={applySavedSettings}\n        onClose={() => setSettingsOpen(false)}');
  });

  it('Choose folder saves the folder through the module that keys its card, and reads the chapter list again (setup.18 review)', () => {
    expect(APP).toMatch(
      /const MANUSCRIPT_FOLDER_IO: ManuscriptFolderIo = \{\s*pickFolder: \(\) => call\('dialog:pick-folder', \{ title: 'Choose the manuscript folder' \}\),\s*setSettings: \(patch\) => call\('settings:set', patch\)\s*\};/
    );
    expect(APP).toMatch(
      /const chooseManuscriptFolder = useCallback\(\(\) => \{\s*void pickManuscriptFolder\(MANUSCRIPT_FOLDER_IO\)\.then\(\(next\) => \{\s*if \(next\) refreshFiles\(\);\s*\}\);\s*\}, \[refreshFiles\]\);/
    );
    // The chapter list's button and the guide's both use it.
    expect(APP.match(/onChooseFolder=\{chooseManuscriptFolder\}/g)).toHaveLength(2);
  });
});

describe('the page behind it', () => {
  it('counts the guide as covering the page, so the review keys and Ctrl+S do nothing there', () => {
    const store = read('state/store.ts');
    expect(store).toMatch(
      /state\.setupOpen \|\|\s*welcomeShown\(state\.settings, state\.welcomeClosed\) \|\|/
    );
  });
});
