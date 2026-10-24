import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../../src/renderer/state/store';
import { createReview } from '../../src/shared/review';
import { normalizeSettings } from '../../src/shared/settings';

/* setup.19: Done, Close and Escape on the Setup screen go back to where it
   was opened from. The rules are in src/shared/ui/setup.ts
   (test/shared/setupLeave.test.ts); here the store that applies them, and,
   as source checks, since the tests run without a DOM, the wiring in App and
   the components; the window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const SETUP_LAYOUT = APP.slice(APP.indexOf('if (singleScreen) {'), APP.lastIndexOf('return ('));

const state = useApp.getState;
const CHAPTER = createReview({
  sourcePath: 'C:/Novel/Chapter 01.md',
  base: { text: 'The river rose.\n\nShe waited.', hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
  hunks: [],
  generator: { kind: 'claude' }
});

describe('the store opens and leaves the Setup screen (setup.19)', () => {
  beforeEach(() => {
    useApp.setState({
      review: CHAPTER,
      settings: normalizeSettings({ manuscriptFolder: 'C:/Novel', onboardingDone: true }),
      welcomeClosed: false,
      aiBusyPath: null,
      setupOpen: false,
      setupFor: 'claude',
      setupFrom: 'elsewhere',
      setupLanding: null,
      reviewDialogOpen: false,
      settingsOpen: false
    });
  });

  it('opens Setup in place of Review with AI and Settings, noting the view and where from', () => {
    useApp.setState({ reviewDialogOpen: true, settingsOpen: true, setupLanding: { to: 'chapter' } });
    state().openSetupScreen('chatgpt', 'review-dialog');
    expect(state()).toMatchObject({
      setupOpen: true,
      setupFor: 'chatgpt',
      setupFrom: 'review-dialog',
      setupLanding: null,
      reviewDialogOpen: false,
      settingsOpen: false
    });
  });

  it('opens Review with AI again when its Open Setup led there, in either view', () => {
    for (const view of ['claude', 'chatgpt'] as const) {
      useApp.setState({ reviewDialogOpen: false, setupLanding: null });
      state().openSetupScreen(view, 'review-dialog');
      state().leaveSetup();
      expect(state()).toMatchObject({
        setupOpen: false,
        setupFrom: 'elsewhere',
        setupLanding: { to: 'review-dialog' },
        reviewDialogOpen: true
      });
    }
  });

  it('goes back to the welcome guide under it when the guide opened it, the dialog staying shut', () => {
    useApp.setState({ settings: normalizeSettings({ onboardingDone: false }) });
    state().openSetupScreen('chatgpt', 'welcome');
    state().leaveSetup();
    expect(state()).toMatchObject({
      setupOpen: false,
      setupLanding: { to: 'welcome', view: 'chatgpt' },
      reviewDialogOpen: false
    });
  });

  it('goes to the chapter from anywhere else, and from the dialog while a review runs', () => {
    state().openSetupScreen('claude', 'elsewhere');
    state().leaveSetup();
    expect(state()).toMatchObject({
      setupOpen: false,
      setupLanding: { to: 'chapter' },
      reviewDialogOpen: false
    });
    useApp.setState({ aiBusyPath: CHAPTER.sourcePath });
    state().openSetupScreen('claude', 'review-dialog');
    state().leaveSetup();
    expect(state()).toMatchObject({ setupLanding: { to: 'chapter' }, reviewDialogOpen: false });
  });

  it('forgets where it came from once left, so a later opening from elsewhere is not sent back', () => {
    state().openSetupScreen('claude', 'review-dialog');
    state().leaveSetup();
    expect(state().setupFrom).toBe('elsewhere');
  });

  it('does nothing when Setup is not open', () => {
    useApp.setState({ setupFrom: 'review-dialog' });
    state().leaveSetup();
    expect(state()).toMatchObject({ setupOpen: false, setupLanding: null, reviewDialogOpen: false });
  });
});

describe('App: where each way in is noted, and where leaving lands (setup.19)', () => {
  it('opens Setup through the store, noting where the focus was', () => {
    const show = APP.slice(APP.indexOf('const showSetup = '), APP.indexOf('const openSetup = '));
    expect(show).toContain(
      'setupOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;'
    );
    expect(show).toContain('openSetupScreen(view, from);');
    for (const [name, view, from] of [
      ['openSetup', 'claude', 'elsewhere'],
      ['openChatGptSetup', 'chatgpt', 'elsewhere'],
      ['openSetupFromDialog', 'claude', 'review-dialog'],
      ['openChatGptSetupFromDialog', 'chatgpt', 'review-dialog'],
      ['openSetupFromWelcome', 'claude', 'welcome'],
      ['openChatGptSetupFromWelcome', 'chatgpt', 'welcome']
    ] as const) {
      expect(APP).toContain(
        `const ${name} = useCallback(() => showSetup('${view}', '${from}'), [showSetup]);`
      );
    }
  });

  it("gives the dialog's Open Setup and the guide's Set up buttons their own way in", () => {
    expect(APP).toContain('onOpenSetup={openSetupFromDialog}');
    expect(APP).toContain('onOpenChatGptSetup={openChatGptSetupFromDialog}');
    expect(SETUP_LAYOUT).toContain('onSetUpClaude={openSetupFromWelcome}');
    expect(SETUP_LAYOUT).toContain('onSetUpChatGpt={openChatGptSetupFromWelcome}');
  });

  it('leaves both views through the store, and hands the landing to the dialog and the guide', () => {
    expect(APP).toContain('const leaveSetup = useApp((s) => s.leaveSetup);');
    expect(SETUP_LAYOUT.match(/onClose=\{leaveSetup\}/g)).toHaveLength(2);
    expect(APP).toContain("focusStart={setupLanding?.to === 'review-dialog'}");
    expect(SETUP_LAYOUT).toContain("landOn={setupLanding?.to === 'welcome' ? setupLanding.view : null}");
  });

  it('hands the focus back for a return to the chapter, then clears the landing', () => {
    expect(APP).toMatch(
      /useEffect\(\(\) => \{\s*if \(setupLanding === null\) return;\s*if \(setupLanding\.to === 'chapter'\) \{\s*focusReturnTarget\(setupOpener\.current, document\.body, null\)\?\.focus\(\{ preventScroll: true \}\);\s*\}\s*setupOpener\.current = null;\s*setSetupLanding\(null\);\s*\}, \[setupLanding, setSetupLanding\]\);/
    );
  });

  it('forgets the dialog as the way in when the Review menu opens the dialog over Setup', () => {
    const open = APP.slice(APP.indexOf('const openReviewFor = '), APP.indexOf('const openReviewDialog = '));
    expect(open).toMatch(/setSetupFrom\('elsewhere'\);\s*setReviewDialogOpen\(true\);/);
  });
});

describe('the screens: Done, Escape and the focus (setup.19)', () => {
  const claude = read('components/SetupScreen.tsx');
  const chatgpt = read('components/ChatGptSetup.tsx');

  it('gives both views Done at the foot, and Escape, all three leaving as Close does', () => {
    for (const screen of [claude, chatgpt]) {
      expect(screen).toContain('useSetupEscape(onClose);');
      expect(screen).toMatch(
        /<div className="setup__foot">\s*<button type="button" ref=\{doneRef\} className="primary" onClick=\{onClose\}>\s*\{SETUP_DONE\}\s*<\/button>\s*<\/div>\s*<p className="setup__footer">/
      );
      expect(screen).toMatch(
        /<h1>Set up (Claude|ChatGPT)<\/h1>\s*<button type="button" onClick=\{onClose\}>\s*Close/
      );
    }
  });

  it('hands the focus to Done once the check finds Claude ready, or the ChatGPT sign-in has succeeded', () => {
    expect(claude).toMatch(
      /useEffect\(\(\) => \{\s*if \(claudeSetupSucceeded\(lastView\.current, view\)\) doneRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*lastView\.current = view;\s*\}, \[view\]\);/
    );
    expect(chatgpt).toMatch(
      /useEffect\(\(\) => \{\s*if \(signInSucceeded\(wasSignedIn\.current, signedInNow\)\) doneRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*wasSignedIn\.current = signedInNow;\s*\}, \[signedInNow\]\);/
    );
    // After the wait's own hand-back, which would give the focus to Sign out.
    expect(chatgpt.indexOf('signInSucceeded(wasSignedIn.current')).toBeGreaterThan(
      chatgpt.indexOf('if (wasWaiting.current && !waiting')
    );
  });

  it('reads Escape on the window after the dialogs, leaving it to whatever is over the screen', () => {
    const escape = read('state/setupEscape.ts');
    expect(escape).toContain("window.addEventListener('keydown', onKeyDown);");
    expect(escape).not.toContain("addEventListener('keydown', onKeyDown, true)");
    expect(escape).toMatch(
      /dialog:\s*state\.newChapterOpen \|\|\s*state\.manualReviewOpen \|\|\s*state\.reviewDialogOpen \|\|\s*state\.settingsOpen \|\|\s*state\.diagnosticsOpen !== null \|\|\s*state\.aboutOpen,\s*question: state\.confirmSpec !== null,\s*overlay: state\.updateOverlay,\s*popup: popupTakesEscape\(\)/
    );
    expect(escape).toMatch(
      /if \(!setupTakesEscape\(event, over\)\) return;\s*event\.preventDefault\(\);\s*leave\.current\(\);/
    );
  });

  it('opens Review with AI again with the focus on Start once it can be pressed', () => {
    const dialog = read('components/ReviewDialog.tsx');
    expect(dialog).toContain('const wantsStart = useRef(focusStart);');
    expect(dialog).toMatch(
      /if \(active !== boxRef\.current && active !== document\.body && active !== start\) \{\s*wantsStart\.current = false;\s*return;\s*\}\s*if \(!startDisabled\) start\?\.focus\(\);\s*\}, \[startDisabled\]\);/
    );
    expect(dialog).toMatch(
      /ref=\{startRef\}\s*type="button"\s*className="primary"\s*disabled=\{startDisabled\}/
    );
    // After the dialog's own focus, which puts it on the box as the dialog opens.
    expect(dialog.indexOf('const wantsStart')).toBeGreaterThan(dialog.indexOf('useDialogFocus(boxRef'));
  });

  it("shows the welcome guide again with the focus on the step's Set up button", () => {
    const welcome = read('components/WelcomeScreen.tsx');
    expect(welcome).toContain(
      'const [landing] = useState(() => (landOn ? welcomeLandingAction(landOn, steps) : null));'
    );
    expect(welcome).toContain(
      'document.querySelector<HTMLElement>(`.welcome [data-action="${landing}"]`)?.focus();'
    );
    expect(welcome).toContain('data-action={action.id}');
  });
});

describe('Done at the foot of the page (setup.19)', () => {
  it("sits on the right, as the guide's Start does", () => {
    const css = withoutComments(readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8'));
    expect(css).toMatch(/\.setup__foot \{\s*display: flex;\s*justify-content: flex-end;/);
  });
});
