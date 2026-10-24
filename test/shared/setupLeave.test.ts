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
  SET_UP_ACTIONS,
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
  const actions = (steps: readonly WelcomeStep[]): string[] =>
    steps.flatMap((step) => step.actions.map((action) => action.id));

  it("names the step's button for each view", () => {
    expect(SET_UP_ACTIONS).toEqual({ claude: 'set-up-claude', chatgpt: 'set-up-chatgpt' });
  });

  it('lands on the button that opened the view', () => {
    const claudeSteps = welcomeSteps(INPUT);
    expect(actions(claudeSteps)).toContain('set-up-claude');
    expect(welcomeLandingAction('claude', claudeSteps)).toBe('set-up-claude');
    const chatgptSteps = welcomeSteps({ ...INPUT, provider: 'chatgpt', chatgpt: SIGNED_OUT });
    expect(actions(chatgptSteps)).toContain('set-up-chatgpt');
    expect(welcomeLandingAction('chatgpt', chatgptSteps)).toBe('set-up-chatgpt');
  });

  it("lands on the other view's button when the step shows that one instead", () => {
    // The provider changed in Settings over Setup: the step shows the other button.
    const chatgptSteps = welcomeSteps({ ...INPUT, provider: 'chatgpt', chatgpt: SIGNED_OUT });
    expect(actions(chatgptSteps)).not.toContain('set-up-claude');
    expect(welcomeLandingAction('claude', chatgptSteps)).toBe('set-up-chatgpt');
    const claudeSteps = welcomeSteps(INPUT);
    expect(welcomeLandingAction('chatgpt', claudeSteps)).toBe('set-up-claude');
  });

  it('lands nowhere when no step has either', () => {
    expect(welcomeLandingAction('claude', [])).toBeNull();
  });
});
