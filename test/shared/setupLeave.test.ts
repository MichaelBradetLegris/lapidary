import { describe, expect, it } from 'vitest';
import type { ChatGptStatus } from '../../src/shared/ipc';
import { signInSucceeded } from '../../src/shared/ui/chatgpt';
import {
  SETUP_DONE,
  claudeSetupSucceeded,
  needsSetup,
  setupLeave,
  setupTakesEscape,
  type OverSetup,
  type SetupFor,
  type SetupFrom,
  type SetupKey,
  type SetupViewId
} from '../../src/shared/ui/setup';
import {
  stepActions,
  welcomeLandingAction,
  welcomeSteps,
  type WelcomeInput,
  type WelcomeStep
} from '../../src/shared/ui/welcome';

/* setup.19: where Done, Close and Escape on the Setup screen go, when Escape
   is the screen's, and when the focus goes to Done. The screens, the store
   and App apply these (test/renderer/setupLeave.test.ts); the window checks
   are in PLAN. */

const FROM: readonly SetupFrom[] = ['review-dialog', 'welcome', 'elsewhere'];
const VIEWS: readonly SetupFor[] = ['claude', 'chatgpt'];
const PAGE = { chapterOpen: true, reviewRunning: false, welcomeShown: false };

describe('setupLeave', () => {
  it('goes back to Review with AI when its Open Setup led to Setup, in either view', () => {
    for (const view of VIEWS) {
      expect(setupLeave('review-dialog', view, PAGE)).toEqual({ to: 'review-dialog' });
    }
  });

  it('goes back to the welcome guide, naming the view, when the guide opened Setup', () => {
    for (const view of VIEWS) {
      expect(setupLeave('welcome', view, { ...PAGE, welcomeShown: true })).toEqual({ to: 'welcome', view });
    }
  });

  it('goes to the chapter from anywhere else, the welcome guide under Setup included', () => {
    for (const view of VIEWS) {
      expect(setupLeave('elsewhere', view, PAGE)).toEqual({ to: 'chapter' });
      expect(setupLeave('elsewhere', view, { ...PAGE, welcomeShown: true })).toEqual({ to: 'chapter' });
    }
  });

  it('does not open the dialog without a chapter, or while a review runs, which the Review menu waits for', () => {
    expect(setupLeave('review-dialog', 'chatgpt', { ...PAGE, chapterOpen: false })).toEqual({
      to: 'chapter'
    });
    expect(setupLeave('review-dialog', 'claude', { ...PAGE, reviewRunning: true })).toEqual({
      to: 'chapter'
    });
  });

  it('does not land on a guide that is no longer under Setup', () => {
    expect(setupLeave('welcome', 'claude', { ...PAGE, welcomeShown: false })).toEqual({ to: 'chapter' });
  });

  it('lands somewhere for every way in, view and page', () => {
    for (const from of FROM) {
      for (const view of VIEWS) {
        for (const chapterOpen of [true, false]) {
          for (const reviewRunning of [true, false]) {
            for (const welcomeShown of [true, false]) {
              const landing = setupLeave(from, view, { chapterOpen, reviewRunning, welcomeShown });
              // Only the way in can send it back to the dialog or the guide.
              if (landing.to === 'review-dialog') expect(from).toBe('review-dialog');
              if (landing.to === 'welcome') expect([from, welcomeShown]).toEqual(['welcome', true]);
            }
          }
        }
      }
    }
  });
});

describe('setupTakesEscape', () => {
  const ESCAPE: SetupKey = { key: 'Escape', isComposing: false, defaultPrevented: false };
  const NOTHING: OverSetup = { dialog: false, question: false, overlay: false, popup: false };

  it('leaves on Escape with nothing over the screen', () => {
    expect(setupTakesEscape(ESCAPE, NOTHING)).toBe(true);
  });

  it('leaves the key to a dialog, a question, the overlay, a menu or the legend', () => {
    for (const over of ['dialog', 'question', 'overlay', 'popup'] as const) {
      expect(setupTakesEscape(ESCAPE, { ...NOTHING, [over]: true })).toBe(false);
    }
  });

  it('ignores other keys, an Escape already answered and one that ends a composition', () => {
    expect(setupTakesEscape({ ...ESCAPE, key: 'Enter' }, NOTHING)).toBe(false);
    expect(setupTakesEscape({ ...ESCAPE, defaultPrevented: true }, NOTHING)).toBe(false);
    expect(setupTakesEscape({ ...ESCAPE, isComposing: true }, NOTHING)).toBe(false);
  });
});

describe('the focus goes to Done once setup has succeeded', () => {
  const VIEW_IDS: readonly SetupViewId[] = [
    'checking',
    'not-installed',
    'signed-out',
    'expired',
    'could-not-check',
    'outdated',
    'usage-limit',
    'api-key',
    'ready'
  ];

  it('is labelled Done', () => {
    expect(SETUP_DONE).toBe('Done');
  });

  it('for Claude, when a check finds it ready after Setup had something to do', () => {
    for (const before of VIEW_IDS) {
      for (const after of VIEW_IDS) {
        const expected = needsSetup(before) && (after === 'ready' || after === 'api-key');
        expect([before, after, claudeSetupSucceeded(before, after)]).toEqual([before, after, expected]);
      }
    }
    expect(claudeSetupSucceeded('signed-out', 'ready')).toBe(true);
    expect(claudeSetupSucceeded('not-installed', 'api-key')).toBe(true);
    // The first check, a view that was ready already and a usage limit that reset are not.
    expect(claudeSetupSucceeded('checking', 'ready')).toBe(false);
    expect(claudeSetupSucceeded('ready', 'ready')).toBe(false);
    expect(claudeSetupSucceeded('usage-limit', 'ready')).toBe(false);
  });

  it('for ChatGPT, when main says there is a sign-in where it said there was none', () => {
    expect(signInSucceeded(false, true)).toBe(true);
    // Read for the first time, kept, ended or still out: not a sign-in that succeeded.
    expect(signInSucceeded(null, true)).toBe(false);
    expect(signInSucceeded(true, true)).toBe(false);
    expect(signInSucceeded(true, false)).toBe(false);
    expect(signInSucceeded(false, false)).toBe(false);
    expect(signInSucceeded(false, null)).toBe(false);
  });
});

describe('welcomeLandingAction', () => {
  const INPUT: WelcomeInput = {
    provider: 'claude',
    claude: null,
    claudeLastFailure: null,
    manuscriptFolder: null,
    guidelinesSetting: null,
    paths: null,
    guidelines: null
  };
  const SIGNED_OUT: ChatGptStatus = {
    signedIn: false,
    plan: null,
    dataSettingsConfirmed: false,
    signingIn: false,
    registered: false,
    encryptionAvailable: true
  };
  const SIGNED_IN: ChatGptStatus = { ...SIGNED_OUT, signedIn: true, plan: 'Plus', registered: true };
  const actions = (steps: readonly WelcomeStep[]): string[] =>
    steps.flatMap((step) => stepActions(step).map((action) => action.id));

  it("lands on Set up Claude, the button of Claude's section, whichever provider is chosen", () => {
    for (const provider of ['claude', 'chatgpt'] as const) {
      const steps = welcomeSteps({ ...INPUT, provider, chatgpt: SIGNED_OUT });
      expect(actions(steps)).toContain('set-up-claude');
      expect(welcomeLandingAction('claude', steps)).toBe('set-up-claude');
    }
  });

  /* setup.18: ChatGPT's section shows Sign in with ChatGPT while signed out,
     and Set up ChatGPT once signed in or while a sign-in waits, so the focus
     goes to whichever it shows as the guide comes back. */
  it("lands on the button ChatGPT's section shows now: Sign in with ChatGPT, or Set up ChatGPT", () => {
    const signedOut = welcomeSteps({ ...INPUT, chatgpt: SIGNED_OUT });
    expect(welcomeLandingAction('chatgpt', signedOut)).toBe('sign-in-chatgpt');
    expect(actions(signedOut)).not.toContain('set-up-chatgpt');
    const signedIn = welcomeSteps({ ...INPUT, chatgpt: SIGNED_IN });
    expect(welcomeLandingAction('chatgpt', signedIn)).toBe('set-up-chatgpt');
    expect(actions(signedIn)).not.toContain('sign-in-chatgpt');
    const waiting = welcomeSteps({ ...INPUT, chatgpt: SIGNED_OUT, chatgptWaiting: true });
    expect(welcomeLandingAction('chatgpt', waiting)).toBe('set-up-chatgpt');
  });

  it('lands nowhere on a button that cannot take the focus, nor when no step has the section', () => {
    // Sign in with ChatGPT is held until the sign-in has been read.
    expect(welcomeLandingAction('chatgpt', welcomeSteps({ ...INPUT, chatgpt: null }))).toBeNull();
    expect(welcomeLandingAction('claude', [])).toBeNull();
  });
});
