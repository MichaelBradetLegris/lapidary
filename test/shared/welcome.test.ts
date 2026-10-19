import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import type { EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../src/shared/ipc';
import { normalizeSettings } from '../../src/shared/settings';
import { STYLE_SHEET_EMPTY, openGuidelinesTitle } from '../../src/shared/ui/guidelines';
import { setupStatus, setupView, type LastFailure } from '../../src/shared/ui/setup';
import {
  CLAUDE_STEP_TEXT,
  CREATE_AND_OPEN_IN_OBSIDIAN,
  FOLDER_LISTS,
  FOLDER_SAVES,
  OPENAI_STEP_TEXT,
  SHOW_WELCOME_AGAIN,
  USE_OPENAI,
  folderGuidelinesFact,
  folderReviewsFact,
  welcomeNotKept,
  welcomeShown,
  welcomeStart,
  welcomeSteps,
  type WelcomeInput,
  type WelcomeStep
} from '../../src/shared/ui/welcome';

/* setup.11: the welcome guide's three steps, what each says and offers, and
   when Start can be pressed. The screen draws exactly these
   (test/renderer/welcome.render.test.ts). */

const FOLDER = 'C:\\Novel'; // check-public: allow
const GUIDELINES = 'C:\\Novel\\GUIDELINES.md'; // check-public: allow
const REVIEWS = 'C:\\Data\\ai-grammar-checker\\reviews'; // check-public: allow

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return { provider: 'claude', state: 'ready', cliVersion: '2.1.302', ...patch };
}

const paths = (patch: Partial<EffectivePaths> = {}): EffectivePaths => ({
  manuscriptFolder: FOLDER,
  reviewsFolder: REVIEWS,
  reviewsFolderIsDefault: true,
  guidelinesPath: GUIDELINES,
  backupsFolder: 'C:\\Data\\ai-grammar-checker\\backups', // check-public: allow
  ...patch
});

const sheet = (styleSheet: GuidelinesStatus['styleSheet'], exists = true): GuidelinesStatus => ({
  path: GUIDELINES,
  exists,
  styleSheet
});

/** A fresh install: nothing chosen, nothing checked yet. */
const FRESH: WelcomeInput = {
  provider: 'claude',
  claude: null,
  claudeLastFailure: null,
  openai: null,
  manuscriptFolder: null,
  guidelinesSetting: null,
  paths: null,
  guidelines: null
};

/** Everything done: Claude ready, a folder, a filled style sheet. */
const READY: WelcomeInput = {
  ...FRESH,
  claude: claude({ credential: 'subscription', email: 'ann@example.com' }),
  manuscriptFolder: FOLDER,
  paths: paths(),
  guidelines: sheet('filled')
};

const step = (input: WelcomeInput, id: WelcomeStep['id']): WelcomeStep => {
  const found = welcomeSteps(input).find((s) => s.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
};

/** Each button as `label [blue] [disabled]`. */
const buttons = (s: WelcomeStep): string[] =>
  s.actions.map((a) => `${a.label}${a.primary ? ' [blue]' : ''}${a.disabled ? ' [disabled]' : ''}`);

describe('welcomeShown', () => {
  it('shows the guide on a fresh install, once the settings are in, until Start or Skip', () => {
    expect(welcomeShown(null)).toBe(false);
    expect(welcomeShown(undefined)).toBe(false);
    // No settings file at all: what --user-data-fresh gives.
    expect(welcomeShown(normalizeSettings({}))).toBe(true);
    expect(welcomeShown(normalizeSettings({ onboardingDone: true }))).toBe(false);
  });

  it('does not show it for settings from before 1.0 that name a folder, unless asked for again', () => {
    expect(welcomeShown(normalizeSettings({ manuscriptFolder: FOLDER }))).toBe(false);
    expect(welcomeShown(normalizeSettings({ manuscriptFolder: FOLDER, onboardingDone: false }))).toBe(true);
  });
});

describe('the three steps', () => {
  it('come in the order of the task, each with its title', () => {
    expect(welcomeSteps(FRESH).map((s) => [s.id, s.title])).toEqual([
      ['claude', 'Connect Claude'],
      ['folder', 'Choose your manuscript folder'],
      ['style-sheet', 'Fill in your style sheet']
    ]);
  });
});

describe('1. Connect Claude', () => {
  const cases: ReadonlyArray<[string, RuntimeStatus | null, LastFailure | null, boolean]> = [
    ['no check yet', null, null, false],
    ['not installed', claude({ state: 'missing-binary' }), null, false],
    ['signed out', claude({ state: 'not-signed-in' }), null, false],
    ['sign-in ended', claude(), { code: 'claude-login-expired' }, false],
    ['could not check', claude({ state: 'error', message: 'Claude Code did not answer.' }), null, false],
    ['out of date', claude({ state: 'error', cliVersion: '2.1.200', minCliVersion: '2.1.266' }), null, false],
    ['ready on a plan', claude({ credential: 'subscription', email: 'ann@example.com' }), null, true],
    [
      'ready with an API key',
      claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }),
      null,
      true
    ],
    ['a usage limit, which resets by itself', claude(), { code: 'claude-usage-limit' }, true],
    ['signed in on a plan that cannot run Claude Code', claude({ planWarning: 'Free plan.' }), null, false]
  ];

  for (const [name, runtime, last, done] of cases) {
    it(`${name}: the Setup screen's own title as the live label, ${done ? 'done' : 'to do'}`, () => {
      const s = step({ ...FRESH, claude: runtime, claudeLastFailure: last }, 'claude');
      expect(s.status).toBe(setupStatus(setupView(runtime, last), runtime, last).title);
      expect(s.done).toBe(done);
      expect(s.lines).toEqual([CLAUDE_STEP_TEXT]);
      expect(buttons(s)).toEqual([
        done ? 'Set up Claude' : 'Set up Claude [blue]',
        'Use OpenAI instead (experimental, pay per use)'
      ]);
    });
  }

  it('follows each check: the same step reads differently as the runtime changes', () => {
    const labels = [
      null,
      claude({ state: 'missing-binary' }),
      claude({ state: 'not-signed-in' }),
      claude()
    ].map((runtime) => step({ ...FRESH, claude: runtime }, 'claude').status);
    expect(labels).toEqual([
      'Checking Claude Code…',
      'Claude Code is not installed',
      'Claude Code is not signed in',
      'Claude is ready'
    ]);
  });

  it('offers OpenAI in the words of the task', () => {
    expect(USE_OPENAI).toBe('Use OpenAI instead (experimental, pay per use)');
    expect(CLAUDE_STEP_TEXT).toContain(`${APP_NAME} reviews your chapters with Claude through Claude Code`);
  });

  it('with OpenAI chosen: its key, Open Settings while there is none, and the way back to Claude', () => {
    const none = step(
      { ...FRESH, provider: 'openai', openai: { provider: 'openai', state: 'not-signed-in' } },
      'claude'
    );
    expect(none.done).toBe(false);
    expect(none.status).toBe('OpenAI: no API key');
    expect(none.lines).toEqual([OPENAI_STEP_TEXT]);
    expect(OPENAI_STEP_TEXT).toContain('experimental');
    expect(buttons(none)).toEqual(['Open Settings [blue]', 'Use Claude instead']);

    const keyed = step(
      { ...FRESH, provider: 'openai', openai: { provider: 'openai', state: 'ready', keyLast4: 'abcd' } },
      'claude'
    );
    expect(keyed.done).toBe(true);
    expect(keyed.status).toBe('OpenAI ready (key ends abcd)');
    expect(buttons(keyed)).toEqual(['Open Settings', 'Use Claude instead']);

    expect(step({ ...FRESH, provider: 'openai' }, 'claude').status).toBe('Checking OpenAI…');
  });
});

describe('2. Choose your manuscript folder', () => {
  it('says the four things the task lists, whether or not a folder is chosen', () => {
    for (const input of [FRESH, READY]) {
      const facts = step(input, 'folder').facts;
      expect(facts).toHaveLength(4);
      // What the app lists.
      expect(facts[0]).toBe(FOLDER_LISTS);
      expect(FOLDER_LISTS).toContain('.md and .txt');
      // That it changes a chapter only on Save to chapter.
      expect(facts[1]).toBe(FOLDER_SAVES);
      expect(FOLDER_SAVES).toContain('only when you press Save to chapter');
      // That it adds GUIDELINES.md.
      expect(facts[2]).toContain('GUIDELINES.md');
      // Where reviews live.
      expect(facts[3]).toMatch(/^Reviews are kept in /);
    }
  });

  it('is to do with no folder, with Choose folder in blue, and done with one, naming it', () => {
    const none = step(FRESH, 'folder');
    expect(none.done).toBe(false);
    expect(none.status).toBe('No folder chosen yet');
    expect(buttons(none)).toEqual(['Choose folder [blue]']);
    const chosen = step(READY, 'folder');
    expect(chosen.done).toBe(true);
    expect(chosen.status).toBe(FOLDER);
    expect(buttons(chosen)).toEqual(['Choose another folder']);
  });

  it('names the guidelines file chosen in Settings in place of the one it adds', () => {
    expect(folderGuidelinesFact(null)).toBe(
      'It adds one file of its own to the folder, GUIDELINES.md, from a template the first time it needs it: the guidelines the reviewer follows, with your style sheet (step 3). It never changes that file after that.'
    );
    const own = 'D:\\Notes\\style.md'; // check-public: allow
    expect(folderGuidelinesFact(own)).toBe(
      `Its guidelines file is the one chosen in Settings, ${own}. It creates that file from a template only if it is missing, and never changes it after that.`
    );
    expect(step({ ...READY, guidelinesSetting: own }, 'folder').facts[2]).toBe(folderGuidelinesFact(own));
  });

  it('says where reviews are kept: the data folder by its path, or the folder chosen in Settings', () => {
    expect(folderReviewsFact(null)).toBe(
      `Reviews are kept in the reviews folder Settings shows: ${APP_NAME}'s own data folder unless you choose another.`
    );
    expect(folderReviewsFact(paths())).toBe(
      `Reviews are kept in ${APP_NAME}'s own data folder, ${REVIEWS}, not in the manuscript folder. You can choose another reviews folder in Settings.`
    );
    const chosen = 'D:\\Reviews'; // check-public: allow
    expect(folderReviewsFact(paths({ reviewsFolder: chosen, reviewsFolderIsDefault: false }))).toBe(
      `Reviews are kept in ${chosen}, the reviews folder chosen in Settings.`
    );
  });
});

describe('3. Fill in your style sheet', () => {
  const at = (patch: Partial<WelcomeInput>): WelcomeStep =>
    step({ ...READY, guidelines: null, ...patch }, 'style-sheet');

  it('waits for a manuscript folder, its buttons disabled', () => {
    const s = step(FRESH, 'style-sheet');
    expect(s.done).toBe(false);
    expect(s.status).toBe('Choose a manuscript folder first');
    expect(buttons(s)).toEqual([
      'Open in Obsidian [disabled]',
      'Open with default app [disabled]',
      'Show in folder [disabled]'
    ]);
  });

  it('offers to create a missing file, in Obsidian first', () => {
    const s = at({ guidelines: { path: GUIDELINES, exists: false, styleSheet: 'missing' } });
    expect(s.done).toBe(false);
    expect(s.status).toBe('GUIDELINES.md is not there yet');
    expect(s.lines.join(' ')).toContain('creates it from a template first');
    expect(buttons(s)).toEqual([
      `${CREATE_AND_OPEN_IN_OBSIDIAN} [blue]`,
      'Open with default app',
      'Show in folder'
    ]);
    expect(s.actions.map((a) => a.title)).toEqual([
      openGuidelinesTitle(GUIDELINES, 'obsidian'),
      openGuidelinesTitle(GUIDELINES, 'default'),
      'Show GUIDELINES.md in its folder, creating it from the template first.'
    ]);
  });

  it("says a blank style sheet is still empty, in Review with AI's words", () => {
    const s = at({ guidelines: sheet('blank') });
    expect(s.done).toBe(false);
    expect(s.status).toBe('Still empty');
    expect(s.lines[0]).toBe(STYLE_SHEET_EMPTY);
    expect(buttons(s)).toEqual(['Open in Obsidian [blue]', 'Open with default app', 'Show in folder']);
    expect(s.actions[2]?.title).toBe('Show GUIDELINES.md in its folder.');
  });

  it('is done once the style sheet is filled in, and only then', () => {
    const s = at({ guidelines: sheet('filled') });
    expect(s.done).toBe(true);
    expect(s.status).toBe('Filled in');
    expect(buttons(s)).toEqual(['Open in Obsidian', 'Open with default app', 'Show in folder']);
    expect(at({ guidelines: sheet('missing') }).done).toBe(false);
    expect(at({ guidelines: sheet('missing') }).status).toBe('No Style sheet section');
  });

  it('has not checked before the status is read, and says why when it cannot be', () => {
    expect(at({}).status).toBe('Not checked yet');
    const s = at({ guidelinesProblem: 'Windows would not let Lapidary read GUIDELINES.md.' });
    expect(s.status).toBe('Could not read GUIDELINES.md');
    expect(s.lines).toEqual(['Windows would not let Lapidary read GUIDELINES.md.']);
    expect(s.done).toBe(false);
  });

  it('does not offer Obsidian for a .txt guidelines file, which it does not open', () => {
    const txt = 'C:\\Novel\\GUIDELINES.txt'; // check-public: allow
    const s = at({ guidelines: { path: txt, exists: true, styleSheet: 'blank' } });
    expect(buttons(s)).toEqual([
      'Open in Obsidian [disabled]',
      'Open with default app [blue]',
      'Show in folder'
    ]);
    expect(s.actions[0]?.title).toBe(openGuidelinesTitle(txt, 'obsidian'));
  });

  it('has not checked a folder just chosen, before settings:effective names its guidelines file', () => {
    const s = step({ ...READY, paths: null, guidelines: null }, 'style-sheet');
    expect(s.status).toBe('Not checked yet');
    expect(s.actions.every((a) => a.disabled === true)).toBe(true);
    expect(step({ ...FRESH, guidelinesSetting: 'D:\\Notes\\style.md' }, 'style-sheet').status).toBe(
      'Not checked yet'
    );
  });

  it('takes the path from settings:effective until the status is in', () => {
    const s = at({ guidelines: null });
    expect(s.actions[1]?.title).toBe(openGuidelinesTitle(GUIDELINES, 'default'));
    expect(s.actions.every((a) => !a.disabled)).toBe(true);
  });
});

describe('Start', () => {
  it('needs a manuscript folder, and says so', () => {
    expect(welcomeStart(welcomeSteps(FRESH))).toEqual({
      disabled: true,
      note: 'Choose a manuscript folder to start, or skip the guide for now.'
    });
  });

  it('can be pressed with steps left, and names them', () => {
    expect(welcomeStart(welcomeSteps({ ...READY, claude: claude({ state: 'missing-binary' }) }))).toEqual({
      disabled: false,
      note: `Still to do: Connect Claude. You can start now and come back to it with ${SHOW_WELCOME_AGAIN}, in Settings.`
    });
    expect(welcomeStart(welcomeSteps({ ...READY, claude: null, guidelines: sheet('blank') })).note).toBe(
      `Still to do: Connect Claude, Fill in your style sheet. You can start now and come back to them with ${SHOW_WELCOME_AGAIN}, in Settings.`
    );
  });

  it('says nothing more once every step is done', () => {
    expect(welcomeSteps(READY).every((s) => s.done)).toBe(true);
    expect(welcomeStart(welcomeSteps(READY))).toEqual({ disabled: false, note: null });
  });

  it('says the guide comes back when Start or Skip cannot be saved', () => {
    expect(welcomeNotKept('The disk is full.')).toBe(
      'The welcome guide is closed for now, but that could not be saved, so it will show again at the next start: The disk is full.'
    );
  });
});

/* "Connect", as in "Connect Claude", reads like a sign-in (setupScreen.render.test.ts):
   the step may be titled so, but no button may say it. */
const SIGN_IN_LIKE = /sign[\s-]*in|sign[\s-]*on|log[\s-]*in|log[\s-]*on|authori[sz]e|connect(?!ion)/i;

describe('whatever the app finds', () => {
  const runtimeArb = fc.option(
    fc.record({
      provider: fc.constant<'claude'>('claude'),
      state: fc.constantFrom('ready', 'missing-binary', 'not-signed-in', 'error'),
      credential: fc.constantFrom('subscription', 'api-key', 'cloud'),
      planWarning: fc.option(fc.constant('Free plan.'), { nil: undefined })
    }),
    { nil: null }
  );
  const inputArb: fc.Arbitrary<WelcomeInput> = fc.record({
    provider: fc.constantFrom('claude', 'openai'),
    claude: runtimeArb,
    claudeLastFailure: fc.option(
      fc.constantFrom<LastFailure>(
        { code: 'claude-login-expired' },
        { code: 'claude-not-signed-in' },
        { code: 'claude-usage-limit' },
        { code: 'claude-outdated' }
      ),
      { nil: null }
    ),
    openai: fc.option(
      fc.constantFrom<RuntimeStatus>(
        { provider: 'openai', state: 'ready', keyLast4: 'abcd' },
        { provider: 'openai', state: 'not-signed-in' }
      ),
      { nil: null }
    ),
    manuscriptFolder: fc.option(fc.constant(FOLDER), { nil: null }),
    guidelinesSetting: fc.option(fc.constantFrom('D:\\Notes\\style.md', 'D:\\Notes\\style.txt'), {
      nil: null
    }),
    paths: fc.option(fc.constant(paths()), { nil: null }),
    guidelines: fc.option(
      fc.record({
        path: fc.option(fc.constantFrom(GUIDELINES, 'C:\\Novel\\GUIDELINES.txt'), { nil: null }),
        exists: fc.boolean(),
        styleSheet: fc.constantFrom('blank', 'filled', 'missing')
      }),
      { nil: null }
    ),
    guidelinesProblem: fc.option(fc.constant('Could not read it.'), { nil: null })
  });

  it('gives three steps, Start only with a folder, blue buttons only for what is left, and no sign-in', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const steps = welcomeSteps(input);
        expect(steps.map((s) => s.id)).toEqual(['claude', 'folder', 'style-sheet']);
        expect(welcomeStart(steps).disabled).toBe(input.manuscriptFolder === null);
        for (const s of steps) {
          const blue = s.actions.filter((a) => a.primary);
          // At most one blue button a step, none once it is done, and never a disabled one.
          expect(blue.length).toBeLessThanOrEqual(1);
          if (s.done) expect(blue).toEqual([]);
          expect(blue.every((a) => !a.disabled)).toBe(true);
          expect(s.status.length).toBeGreaterThan(0);
          for (const action of s.actions) expect(action.label).not.toMatch(SIGN_IN_LIKE);
        }
        // The style sheet is done exactly when the file is there and its style sheet filled in.
        const sheetStep = steps[2];
        const path = input.guidelines?.path ?? input.paths?.guidelinesPath ?? null;
        expect(sheetStep?.done).toBe(
          path !== null &&
            !input.guidelinesProblem &&
            input.guidelines?.exists === true &&
            input.guidelines.styleSheet === 'filled'
        );
      })
    );
  });
});
