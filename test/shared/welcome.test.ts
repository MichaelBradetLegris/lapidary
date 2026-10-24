import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PRO_PRESELECT_HINT } from '../../src/shared/ai/claudeModels';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../src/shared/ipc';
import { normalizeSettings } from '../../src/shared/settings';
import { STYLE_SHEET_EMPTY, openFolderTitle, openGuidelinesTitle } from '../../src/shared/ui/guidelines';
import { setupStatus, setupView, type LastFailure } from '../../src/shared/ui/setup';
import {
  CHATGPT_STEP_TEXT,
  CLAUDE_STEP_TEXT,
  CREATE_AND_OPEN,
  FOLDER_LISTS,
  FOLDER_SAVES,
  SHOW_WELCOME_AGAIN,
  USE_CHATGPT,
  folderGuidelinesFact,
  folderReviewsFact,
  welcomeAgainPatch,
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

  /* setup.11 review: when writing Start or Skip failed, every later settings
     reply carries main's false, which brought the guide back mid-session. */
  it('keeps it closed for the run once Start or Skip was pressed, whatever the settings say', () => {
    expect(welcomeShown(normalizeSettings({}), true)).toBe(false);
    expect(welcomeShown(normalizeSettings({ manuscriptFolder: FOLDER, onboardingDone: false }), true)).toBe(
      false
    );
    expect(welcomeShown(normalizeSettings({}), false)).toBe(true);
    expect(welcomeShown(null, false)).toBe(false);
  });
});

describe('welcomeAgainPatch (setup.11 review)', () => {
  it('says the guide is not done and settles the Pro preselection in the same write', () => {
    expect(welcomeAgainPatch([])).toEqual({ onboardingDone: false, dismissedHints: [PRO_PRESELECT_HINT] });
  });

  it('keeps the hints already put away, adds its own once, and leaves the array alone', () => {
    const hints = Object.freeze(['save-to-chapter']);
    expect(welcomeAgainPatch(hints).dismissedHints).toEqual(['save-to-chapter', PRO_PRESELECT_HINT]);
    expect(hints).toEqual(['save-to-chapter']);
    expect(welcomeAgainPatch([PRO_PRESELECT_HINT, 'save-to-chapter']).dismissedHints).toEqual([
      PRO_PRESELECT_HINT,
      'save-to-chapter'
    ]);
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
      expect(buttons(s)).toEqual([done ? 'Set up Claude' : 'Set up Claude [blue]', 'Use ChatGPT instead']);
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

  it('offers ChatGPT, in the place "Use OpenAI instead" held until codex.6', () => {
    expect(USE_CHATGPT).toBe('Use ChatGPT instead');
    expect(step(FRESH, 'claude').actions.map((a) => a.id)).toEqual(['set-up-claude', 'use-chatgpt']);
    expect(CLAUDE_STEP_TEXT).toContain(`${APP_NAME} reviews your chapters with Claude through Claude Code`);
  });

  it("shows Claude's step for settings from before codex.6 that chose the OpenAI API key", () => {
    const settings = normalizeSettings({ provider: 'openai', openaiModel: 'gpt-5-mini' });
    expect(settings.provider).toBe('claude');
    const s = step({ ...FRESH, provider: settings.provider }, 'claude');
    expect(s.lines).toEqual([CLAUDE_STEP_TEXT]);
    expect(s.actions.map((a) => a.label)).toEqual(['Set up Claude', 'Use ChatGPT instead']);
    for (const action of s.actions) expect(action.label).not.toMatch(/OpenAI|key/i);
  });
});

describe('2. Choose your manuscript folder', () => {
  it('says the four things the task lists, whether or not a folder is chosen', () => {
    for (const input of [FRESH, READY]) {
      const facts = step(input, 'folder').facts;
      expect(facts).toHaveLength(4);
      // What the app lists.
      expect(facts[0]).toBe(FOLDER_LISTS);
      // That it changes a chapter only on Save to chapter.
      expect(facts[1]).toBe(FOLDER_SAVES);
      expect(FOLDER_SAVES).toContain('only when you press Save to chapter');
      // That it adds GUIDELINES.md.
      expect(facts[2]).toContain('GUIDELINES.md');
      // Where reviews live.
      expect(facts[3]).toMatch(/^Reviews are kept in /);
    }
  });

  it('says what the chapter list leaves out that an author meets, never that every file is listed (files.23)', () => {
    expect(FOLDER_LISTS).toBe(
      `${APP_NAME} lists the .md and .txt files in the folder and its subfolders as chapters, leaving out a few, among them the guidelines file, Excalidraw drawings and anything whose name starts with a dot, such as Obsidian's .obsidian and .trash folders.`
    );
    // listChapters leaves out more than the line names (PLAN 6.1), so the line may not claim all.
    expect(FOLDER_LISTS).not.toMatch(/\bevery\b|\ball\b/i);
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
    expect(buttons(s)).toEqual(['Open [disabled]', 'Open folder [disabled]']);
  });

  it('offers to create a missing file and open it, with the default app (polish.3)', () => {
    const s = at({ guidelines: { path: GUIDELINES, exists: false, styleSheet: 'missing' } });
    expect(s.done).toBe(false);
    expect(s.status).toBe('GUIDELINES.md is not there yet');
    expect(s.lines.join(' ')).toContain('Both buttons below create it from a template first.');
    expect(CREATE_AND_OPEN).toBe('Create and open');
    expect(buttons(s)).toEqual(['Create and open [blue]', 'Open folder']);
    expect(s.actions.map((a) => a.title)).toEqual([
      'Create GUIDELINES.md from the template, then open it in the app this computer uses for .md files.',
      'Create GUIDELINES.md from the template, then open its folder with the file selected.'
    ]);
    expect(s.actions.map((a) => a.id)).toEqual(['open-guidelines', 'open-guidelines-folder']);
  });

  it("says a blank style sheet is still empty, in Review with AI's words", () => {
    const s = at({ guidelines: sheet('blank') });
    expect(s.done).toBe(false);
    expect(s.status).toBe('Still empty');
    expect(s.lines[0]).toBe(STYLE_SHEET_EMPTY);
    expect(buttons(s)).toEqual(['Open [blue]', 'Open folder']);
    expect(s.actions.map((a) => a.title)).toEqual([
      openGuidelinesTitle(GUIDELINES),
      openFolderTitle(GUIDELINES)
    ]);
  });

  it('is done once the style sheet is filled in, and only then', () => {
    const s = at({ guidelines: sheet('filled') });
    expect(s.done).toBe(true);
    expect(s.status).toBe('Filled in');
    expect(buttons(s)).toEqual(['Open', 'Open folder']);
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

  it('offers the same two buttons for a .txt guidelines file, Open for its own app', () => {
    const txt = 'C:\\Novel\\GUIDELINES.txt'; // check-public: allow
    const s = at({ guidelines: { path: txt, exists: true, styleSheet: 'blank' } });
    expect(buttons(s)).toEqual(['Open [blue]', 'Open folder']);
    expect(s.actions[0]?.title).toBe('Open GUIDELINES.txt in the app this computer uses for .txt files.');
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
    expect(s.actions[0]?.title).toBe(openGuidelinesTitle(GUIDELINES));
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
  const chatgptArb: fc.Arbitrary<ChatGptStatus | null> = fc.option(
    fc.record({
      signedIn: fc.boolean(),
      plan: fc.constantFrom('Plus', null),
      dataSettingsConfirmed: fc.boolean(),
      signingIn: fc.boolean(),
      registered: fc.boolean(),
      encryptionAvailable: fc.boolean()
    }),
    { nil: null }
  );
  const inputArb: fc.Arbitrary<WelcomeInput> = fc.record({
    provider: fc.constantFrom('claude', 'chatgpt'),
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
    chatgpt: chatgptArb,
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
        // The first step offers the other provider, and never an OpenAI key (codex.6).
        expect(steps[0]?.lines).toEqual([
          input.provider === 'chatgpt' ? CHATGPT_STEP_TEXT : CLAUDE_STEP_TEXT
        ]);
        for (const action of steps[0]?.actions ?? []) expect(action.label).not.toMatch(/OpenAI|key/i);
        expect(welcomeStart(steps).disabled).toBe(input.manuscriptFolder === null);
        for (const s of steps) {
          const blue = s.actions.filter((a) => a.primary);
          // At most one blue button a step, none once it is done, and never a disabled one.
          expect(blue.length).toBeLessThanOrEqual(1);
          if (s.done) expect(blue).toEqual([]);
          expect(blue.every((a) => !a.disabled)).toBe(true);
          expect(s.status.length).toBeGreaterThan(0);
          for (const action of s.actions) expect(action.label).not.toMatch(SIGN_IN_LIKE);
          // No button opens Obsidian by name: Open is the system's app (polish.3).
          for (const action of s.actions) expect(action.label).not.toMatch(/obsidian/i);
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
