import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PRO_PRESELECT_HINT } from '../../src/shared/ai/claudeModels';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../src/shared/ipc';
import { normalizeSettings } from '../../src/shared/settings';
import { SIGN_IN_BUTTON, chatGptSetupStatus } from '../../src/shared/ui/chatgpt';
import { STYLE_SHEET_EMPTY, openFolderTitle, openGuidelinesTitle } from '../../src/shared/ui/guidelines';
import { setupStatus, setupView, type LastFailure } from '../../src/shared/ui/setup';
import {
  AGENTS_STEP_TEXT,
  CHATGPT_SECTION_SET_UP_TEXT,
  CHATGPT_SECTION_TEXT,
  CLAUDE_SECTION_TEXT,
  CREATE_AND_OPEN,
  FOLDER_LISTS,
  FOLDER_SAVES,
  IN_DATA_FOLDER,
  SET_UP_CHATGPT,
  SHOW_WELCOME_AGAIN,
  WELCOME_BACKUPS_NOTE,
  WELCOME_INTRO,
  WELCOME_REVIEWS_NOTE,
  folderGuidelinesFact,
  stepActions,
  welcomeAgainPatch,
  welcomeNotKept,
  welcomeProviderFor,
  welcomeShown,
  welcomeStart,
  welcomeSteps,
  type WelcomeInput,
  type WelcomeSection,
  type WelcomeStep
} from '../../src/shared/ui/welcome';

/* setup.11, and setup.18's new order: the welcome guide's three steps, the
   manuscript folder with its two optional folder rows, the AI agents with a
   section each for Claude and ChatGPT, and the style sheet; what each says
   and offers, and when Start can be pressed. The screen draws exactly these
   (test/renderer/welcome.render.test.ts). */

const FOLDER = 'C:\\Novel'; // check-public: allow
const GUIDELINES = 'C:\\Novel\\GUIDELINES.md'; // check-public: allow
const REVIEWS = 'C:\\Data\\ai-grammar-checker\\reviews'; // check-public: allow
const BACKUPS = 'C:\\Data\\ai-grammar-checker\\backups'; // check-public: allow

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return { provider: 'claude', state: 'ready', cliVersion: '2.1.302', ...patch };
}

const paths = (patch: Partial<EffectivePaths> = {}): EffectivePaths => ({
  manuscriptFolder: FOLDER,
  reviewsFolder: REVIEWS,
  reviewsFolderIsDefault: true,
  guidelinesPath: GUIDELINES,
  backupsFolder: BACKUPS,
  backupsFolderIsDefault: true,
  ...patch
});

const sheet = (styleSheet: GuidelinesStatus['styleSheet'], exists = true): GuidelinesStatus => ({
  path: GUIDELINES,
  exists,
  styleSheet
});

const SIGNED_OUT: ChatGptStatus = {
  signedIn: false,
  plan: null,
  dataSettingsConfirmed: false,
  signingIn: false,
  registered: false,
  encryptionAvailable: true
};
const SIGNED_IN: ChatGptStatus = { ...SIGNED_OUT, signedIn: true, plan: 'Plus', registered: true };

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

/** Everything done: a folder, Claude ready, a filled style sheet. */
const READY: WelcomeInput = {
  ...FRESH,
  claude: claude({ credential: 'subscription', email: 'ann@example.com' }),
  chatgpt: SIGNED_OUT,
  manuscriptFolder: FOLDER,
  paths: paths(),
  guidelines: sheet('filled')
};

const step = (input: WelcomeInput, id: WelcomeStep['id']): WelcomeStep => {
  const found = welcomeSteps(input).find((s) => s.id === id);
  if (!found) throw new Error(`no ${id} step`);
  return found;
};

const section = (input: WelcomeInput, id: WelcomeSection['id']): WelcomeSection => {
  const found = step(input, 'agents').sections.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id} section`);
  return found;
};

/** Each button as `label [blue] [disabled]`. */
const buttons = (actions: WelcomeStep['actions']): string[] =>
  actions.map((a) => `${a.label}${a.primary ? ' [blue]' : ''}${a.disabled ? ' [disabled]' : ''}`);

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

describe('the three steps (setup.18)', () => {
  it('come in the order of the task: the folder, then the AI agents and the style sheet, both optional', () => {
    expect(welcomeSteps(FRESH).map((s) => [s.id, s.title, s.optional])).toEqual([
      ['folder', 'Connect your manuscript folder', false],
      ['agents', 'Connect AI agents', true],
      ['style-sheet', 'Fill in your style sheet', true]
    ]);
  });

  it('say in the intro that only the first is needed to start', () => {
    expect(WELCOME_INTRO).toBe(
      `Three steps get ${APP_NAME} ready to review your chapters, and only the first is needed to start. Each one says when it is done, and you can do them in any order. Skip leaves the guide; Settings has ${SHOW_WELCOME_AGAIN}.`
    );
  });

  it('give the folder step its rows, the agents step its sections, and no other step either', () => {
    const [folder, agents, styleSheet] = welcomeSteps(READY);
    expect(folder?.rows.map((r) => r.id)).toEqual(['reviews', 'backups']);
    expect(folder?.sections).toEqual([]);
    expect(agents?.rows).toEqual([]);
    expect(agents?.sections.map((s) => s.id)).toEqual(['claude', 'chatgpt']);
    expect(agents?.actions).toEqual([]);
    expect(styleSheet?.rows).toEqual([]);
    expect(styleSheet?.sections).toEqual([]);
  });
});

describe('1. Connect your manuscript folder', () => {
  it('says three things before the rows, whether or not a folder is chosen', () => {
    for (const input of [FRESH, READY]) {
      const facts = step(input, 'folder').facts;
      expect(facts).toHaveLength(3);
      // What the app lists.
      expect(facts[0]).toBe(FOLDER_LISTS);
      // That it changes a chapter only on Save to chapter, after a backup in the row below.
      expect(facts[1]).toBe(FOLDER_SAVES);
      expect(FOLDER_SAVES).toBe(
        'It changes a chapter file only when you press Save to chapter, and first copies the version it replaces into the backups folder below.'
      );
      // That it adds GUIDELINES.md.
      expect(facts[2]).toContain('GUIDELINES.md');
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
    expect(buttons(none.actions)).toEqual(['Choose folder [blue]']);
    const chosen = step(READY, 'folder');
    expect(chosen.done).toBe(true);
    expect(chosen.status).toBe(FOLDER);
    expect(buttons(chosen.actions)).toEqual(['Choose another folder']);
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

  describe('the two optional rows under it (setup.18)', () => {
    it('are the reviews folder and the backups folder, each in the data folder by default, with Change', () => {
      for (const input of [FRESH, READY]) {
        const rows = step(input, 'folder').rows;
        expect(rows.map((r) => [r.id, r.label, r.value, r.note])).toEqual([
          ['reviews', 'Reviews folder', IN_DATA_FOLDER, WELCOME_REVIEWS_NOTE],
          ['backups', 'Backups folder', IN_DATA_FOLDER, WELCOME_BACKUPS_NOTE]
        ]);
        expect(rows.map((r) => r.actions)).toEqual([
          [{ id: 'change-reviews-folder', label: 'Change', title: 'Choose the reviews folder' }],
          [{ id: 'change-backups-folder', label: 'Change', title: 'Choose the backups folder' }]
        ]);
      }
      expect(IN_DATA_FOLDER).toBe(`In ${APP_NAME}'s data folder`);
    });

    it('say what each holds, and that the backups folder cannot be in the manuscript folder', () => {
      expect(WELCOME_REVIEWS_NOTE).toBe(
        'Where your reviews and decisions are kept. Each review holds the full text of its chapter.'
      );
      expect(WELCOME_BACKUPS_NOTE).toBe(
        'Where Save to chapter copies the version it replaces. It cannot be the manuscript folder or a folder inside it.'
      );
    });

    it('give the folder in use as the tooltip once settings:effective has said, and none before', () => {
      expect(step(FRESH, 'folder').rows.map((r) => r.path)).toEqual([null, null]);
      expect(step(READY, 'folder').rows.map((r) => r.path)).toEqual([REVIEWS, BACKUPS]);
    });

    it('show a folder chosen in Settings by its path, from the setting until settings:effective says', () => {
      const reviews = 'D:\\Reviews'; // check-public: allow
      const backups = 'E:\\Backups'; // check-public: allow
      const before = step({ ...FRESH, reviewsSetting: reviews, backupsSetting: backups }, 'folder').rows;
      expect(before.map((r) => [r.value, r.path])).toEqual([
        [reviews, reviews],
        [backups, backups]
      ]);
      const after = step(
        {
          ...READY,
          reviewsSetting: reviews,
          backupsSetting: backups,
          paths: paths({
            reviewsFolder: reviews,
            reviewsFolderIsDefault: false,
            backupsFolder: backups,
            backupsFolderIsDefault: false
          })
        },
        'folder'
      ).rows;
      expect(after.map((r) => [r.value, r.path])).toEqual([
        [reviews, reviews],
        [backups, backups]
      ]);
    });

    it('never need a folder chosen to be done, nor make the step wait for them', () => {
      expect(step({ ...READY, reviewsSetting: null, backupsSetting: null }, 'folder').done).toBe(true);
      expect(step({ ...FRESH, reviewsSetting: 'D:\\Reviews' }, 'folder').done).toBe(false);
      // No row's button is blue: neither is needed.
      for (const input of [FRESH, READY]) {
        for (const row of step(input, 'folder').rows) expect(row.actions.some((a) => a.primary)).toBe(false);
      }
    });
  });
});

describe('2. Connect AI agents (setup.18)', () => {
  it('says what the agents are for, and that the guide can be left without them', () => {
    expect(step(FRESH, 'agents').lines).toEqual([AGENTS_STEP_TEXT]);
    expect(AGENTS_STEP_TEXT).toBe(
      'Reviews with AI need Claude or ChatGPT, and either will do. You can start without them and set one up later, from Settings.'
    );
  });

  describe('Claude', () => {
    const cases: ReadonlyArray<[string, RuntimeStatus | null, LastFailure | null, boolean]> = [
      ['no check yet', null, null, false],
      ['not installed', claude({ state: 'missing-binary' }), null, false],
      ['signed out', claude({ state: 'not-signed-in' }), null, false],
      ['sign-in ended', claude(), { code: 'claude-login-expired' }, false],
      ['could not check', claude({ state: 'error', message: 'Claude Code did not answer.' }), null, false],
      [
        'out of date',
        claude({ state: 'error', cliVersion: '2.1.200', minCliVersion: '2.1.266' }),
        null,
        false
      ],
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
        const input = { ...FRESH, chatgpt: SIGNED_OUT, claude: runtime, claudeLastFailure: last };
        const s = section(input, 'claude');
        expect(s.title).toBe('Claude');
        expect(s.status).toBe(setupStatus(setupView(runtime, last), runtime, last).title);
        expect(s.done).toBe(done);
        expect(s.lines).toEqual([CLAUDE_SECTION_TEXT]);
        // Set up Claude is blue while neither agent can review.
        expect(buttons(s.actions)).toEqual([done ? 'Set up Claude' : 'Set up Claude [blue]']);
        expect(step(input, 'agents').done).toBe(done);
      });
    }

    it('follows each check: the same section reads differently as the runtime changes', () => {
      const labels = [
        null,
        claude({ state: 'missing-binary' }),
        claude({ state: 'not-signed-in' }),
        claude()
      ].map((runtime) => section({ ...FRESH, claude: runtime }, 'claude').status);
      expect(labels).toEqual([
        'Checking Claude Code…',
        'Claude Code is not installed',
        'Claude Code is not signed in',
        'Claude is ready'
      ]);
    });

    it('says what Claude needs, through the Claude Code the author installs', () => {
      expect(CLAUDE_SECTION_TEXT).toBe(
        "Claude reviews through Claude Code, Anthropic's command-line tool, which you install and sign in to yourself, with your Claude plan or an API key. Set up Claude shows how."
      );
    });
  });

  describe('ChatGPT', () => {
    const at = (chatgpt: ChatGptStatus | null, waiting = false): WelcomeSection =>
      section(
        { ...FRESH, claude: claude({ state: 'missing-binary' }), chatgpt, chatgptWaiting: waiting },
        'chatgpt'
      );

    it('offers Sign in with ChatGPT, blue, while signed out', () => {
      const s = at(SIGNED_OUT);
      expect(s.title).toBe('ChatGPT');
      expect(s.done).toBe(false);
      expect(s.status).toBe('Not signed in to ChatGPT');
      expect(s.lines).toEqual([CHATGPT_SECTION_TEXT]);
      expect(s.actions).toEqual([
        { id: 'sign-in-chatgpt', label: SIGN_IN_BUTTON, primary: true, disabled: false }
      ]);
      expect(SIGN_IN_BUTTON).toBe('Sign in with ChatGPT');
    });

    it('holds it, not blue, until the sign-in has been read', () => {
      const s = at(null);
      expect(s.status).toBe('Reading the ChatGPT sign-in…');
      expect(buttons(s.actions)).toEqual(['Sign in with ChatGPT [disabled]']);
    });

    it('offers Set up ChatGPT, blue, while a sign-in waits for the browser, so its Cancel is a click away', () => {
      for (const status of [SIGNED_OUT, { ...SIGNED_OUT, signingIn: true }]) {
        const s = at(status, true);
        expect(s.status).toBe('Waiting for you to sign in');
        expect(s.actions).toEqual([{ id: 'set-up-chatgpt', label: SET_UP_CHATGPT, primary: true }]);
      }
    });

    it('is done once signed in, with Set up ChatGPT, not blue, and the step done with it', () => {
      const s = at(SIGNED_IN);
      expect(s.done).toBe(true);
      expect(s.status).toBe('Signed in to ChatGPT');
      expect(buttons(s.actions)).toEqual(['Set up ChatGPT']);
      const agents = step(
        { ...FRESH, claude: claude({ state: 'missing-binary' }), chatgpt: SIGNED_IN },
        'agents'
      );
      expect(agents.done).toBe(true);
      // Neither section's button is blue once one agent can review.
      expect(agents.sections.flatMap((x) => x.actions).filter((a) => a.primary)).toEqual([]);
    });

    it('offers Set up ChatGPT, not blue, when Windows cannot encrypt a sign-in: the view says why', () => {
      const s = at({ ...SIGNED_OUT, encryptionAvailable: false });
      expect(s.status).toBe(`${APP_NAME} cannot keep a sign-in here`);
      expect(buttons(s.actions)).toEqual(['Set up ChatGPT']);
    });

    it("says where the sign-in stands in the ChatGPT view's own words", () => {
      for (const [status, waiting] of [
        [null, false],
        [SIGNED_OUT, false],
        [SIGNED_OUT, true],
        [SIGNED_IN, false],
        [{ ...SIGNED_OUT, encryptionAvailable: false }, false]
      ] as const) {
        expect(at(status, waiting).status).toBe(chatGptSetupStatus(status, waiting).title);
      }
    });

    it('says what ChatGPT needs, and what its button opens, naming the button it shows', () => {
      expect(CHATGPT_SECTION_TEXT).toBe(
        "ChatGPT reviews on your ChatGPT plan, with no API key. Sign in with ChatGPT opens OpenAI's sign-in page in your browser, and Set up ChatGPT, which says what to check in ChatGPT's data settings."
      );
      expect(CHATGPT_SECTION_SET_UP_TEXT).toBe(
        "ChatGPT reviews on your ChatGPT plan, with no API key. Set up ChatGPT says where the sign-in stands and what to check in ChatGPT's data settings."
      );
      for (const [status, waiting] of [
        [null, false],
        [SIGNED_OUT, false],
        [SIGNED_OUT, true],
        [SIGNED_IN, false],
        [{ ...SIGNED_OUT, encryptionAvailable: false }, false]
      ] as const) {
        const s = at(status, waiting);
        const signIn = s.actions[0]?.id === 'sign-in-chatgpt';
        expect(s.lines).toEqual([signIn ? CHATGPT_SECTION_TEXT : CHATGPT_SECTION_SET_UP_TEXT]);
      }
    });
  });

  it('is done once either agent can review, and says which', () => {
    const ready = claude({ credential: 'subscription' });
    const missing = claude({ state: 'missing-binary' });
    const cases: ReadonlyArray<[RuntimeStatus, ChatGptStatus, boolean, string]> = [
      [missing, SIGNED_OUT, false, 'Not connected yet'],
      [ready, SIGNED_OUT, true, 'Claude is connected'],
      [missing, SIGNED_IN, true, 'ChatGPT is connected'],
      [ready, SIGNED_IN, true, 'Claude and ChatGPT are both connected']
    ];
    for (const [runtime, chatgpt, done, status] of cases) {
      const s = step({ ...FRESH, claude: runtime, chatgpt }, 'agents');
      expect([s.done, s.status]).toEqual([done, status]);
    }
  });

  it('shows both sections whichever provider is chosen, without Use ChatGPT instead or Use Claude instead', () => {
    for (const provider of ['claude', 'chatgpt'] as const) {
      const agents = step({ ...READY, provider }, 'agents');
      expect(agents.sections.map((s) => s.id)).toEqual(['claude', 'chatgpt']);
      for (const action of stepActions(agents)) expect(action.label).not.toMatch(/^Use /);
    }
  });

  it("shows Claude's section for settings from before codex.6 that chose the OpenAI API key", () => {
    const settings = normalizeSettings({ provider: 'openai', openaiModel: 'gpt-5-mini' });
    expect(settings.provider).toBe('claude');
    const agents = step({ ...FRESH, provider: settings.provider }, 'agents');
    expect(agents.sections.map((s) => s.title)).toEqual(['Claude', 'ChatGPT']);
    for (const action of stepActions(agents)) expect(action.label).not.toMatch(/OpenAI|key/i);
  });
});

describe('welcomeProviderFor (setup.18)', () => {
  const missing = claude({ state: 'missing-binary' });
  const ready = claude({ credential: 'subscription' });

  it('makes ChatGPT the provider when its button is pressed and Claude cannot review', () => {
    expect(welcomeProviderFor('chatgpt', { ...FRESH, claude: missing, chatgpt: SIGNED_OUT })).toBe('chatgpt');
    // Before Claude's first check has answered, as far as the guide knows, Claude cannot review.
    expect(welcomeProviderFor('chatgpt', { ...FRESH, claude: null, chatgpt: SIGNED_OUT })).toBe('chatgpt');
  });

  it('leaves Claude the provider when Claude can review', () => {
    expect(welcomeProviderFor('chatgpt', { ...FRESH, claude: ready, chatgpt: SIGNED_OUT })).toBeNull();
    expect(welcomeProviderFor('chatgpt', { ...FRESH, claude: ready, chatgpt: SIGNED_IN })).toBeNull();
  });

  it('makes Claude the provider again when its button is pressed and ChatGPT cannot review', () => {
    const chatgptChosen: WelcomeInput = { ...FRESH, provider: 'chatgpt', claude: missing };
    expect(welcomeProviderFor('claude', { ...chatgptChosen, chatgpt: SIGNED_OUT })).toBe('claude');
    expect(welcomeProviderFor('claude', { ...chatgptChosen, chatgpt: null })).toBe('claude');
    expect(welcomeProviderFor('claude', { ...chatgptChosen, chatgpt: SIGNED_IN })).toBeNull();
  });

  it('changes nothing when the section is the provider already', () => {
    expect(welcomeProviderFor('claude', { ...FRESH, claude: missing })).toBeNull();
    expect(welcomeProviderFor('chatgpt', { ...FRESH, provider: 'chatgpt', claude: missing })).toBeNull();
  });
});

describe('3. Fill in your style sheet', () => {
  const at = (patch: Partial<WelcomeInput>): WelcomeStep =>
    step({ ...READY, guidelines: null, ...patch }, 'style-sheet');

  it('is optional, as the agents are (setup.18)', () => {
    expect(at({}).optional).toBe(true);
  });

  it('waits for a manuscript folder, its buttons disabled', () => {
    const s = step(FRESH, 'style-sheet');
    expect(s.done).toBe(false);
    expect(s.status).toBe('Choose a manuscript folder first');
    expect(buttons(s.actions)).toEqual(['Open [disabled]', 'Open folder [disabled]']);
  });

  it('offers to create a missing file and open it, with the default app (polish.3)', () => {
    const s = at({ guidelines: { path: GUIDELINES, exists: false, styleSheet: 'missing' } });
    expect(s.done).toBe(false);
    expect(s.status).toBe('GUIDELINES.md is not there yet');
    expect(s.lines.join(' ')).toContain('Both buttons below create it from a template first.');
    expect(CREATE_AND_OPEN).toBe('Create and open');
    expect(buttons(s.actions)).toEqual(['Create and open [blue]', 'Open folder']);
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
    expect(buttons(s.actions)).toEqual(['Open [blue]', 'Open folder']);
    expect(s.actions.map((a) => a.title)).toEqual([
      openGuidelinesTitle(GUIDELINES),
      openFolderTitle(GUIDELINES)
    ]);
  });

  it('is done once the style sheet is filled in, and only then', () => {
    const s = at({ guidelines: sheet('filled') });
    expect(s.done).toBe(true);
    expect(s.status).toBe('Filled in');
    expect(buttons(s.actions)).toEqual(['Open', 'Open folder']);
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
    expect(buttons(s.actions)).toEqual(['Open [blue]', 'Open folder']);
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

  it('needs the manuscript folder alone: with neither agent nor a style sheet it can be pressed (setup.18)', () => {
    const steps = welcomeSteps({
      ...FRESH,
      manuscriptFolder: FOLDER,
      claude: claude({ state: 'missing-binary' })
    });
    expect(steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(welcomeStart(steps)).toEqual({
      disabled: false,
      note: `Optional steps not done yet: Connect AI agents, Fill in your style sheet. You can start now and come back to them with ${SHOW_WELCOME_AGAIN}, in Settings.`
    });
  });

  it('names one optional step left as one', () => {
    expect(welcomeStart(welcomeSteps({ ...READY, claude: claude({ state: 'missing-binary' }) }))).toEqual({
      disabled: false,
      note: `Optional step not done yet: Connect AI agents. You can start now and come back to it with ${SHOW_WELCOME_AGAIN}, in Settings.`
    });
    expect(welcomeStart(welcomeSteps({ ...READY, guidelines: sheet('blank') })).note).toBe(
      `Optional step not done yet: Fill in your style sheet. You can start now and come back to it with ${SHOW_WELCOME_AGAIN}, in Settings.`
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

/* "Connect", as in "Connect AI agents", reads like a sign-in
   (setupScreen.render.test.ts): a step may be titled so, but no button may
   say it. The guide's one sign-in is ChatGPT's own, Sign in with ChatGPT, as
   on its Setup view (5.6 item 7, setup.18); nothing reads like a sign-in to
   Claude. */
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
    chatgptWaiting: fc.boolean(),
    manuscriptFolder: fc.option(fc.constant(FOLDER), { nil: null }),
    reviewsSetting: fc.option(fc.constant('D:\\Reviews'), { nil: null }),
    backupsSetting: fc.option(fc.constant('E:\\Backups'), { nil: null }),
    guidelinesSetting: fc.option(fc.constantFrom('D:\\Notes\\style.md', 'D:\\Notes\\style.txt'), {
      nil: null
    }),
    paths: fc.option(
      fc
        .record({
          reviewsFolderIsDefault: fc.boolean(),
          backupsFolderIsDefault: fc.boolean()
        })
        .map((flags) => paths(flags)),
      { nil: null }
    ),
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

  it('gives three steps, Start with the folder alone, blue buttons only for what is left, and no sign-in to Claude', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const steps = welcomeSteps(input);
        expect(steps.map((s) => s.id)).toEqual(['folder', 'agents', 'style-sheet']);
        expect(steps.map((s) => s.optional)).toEqual([false, true, true]);
        // Start needs the folder alone (setup.18).
        expect(welcomeStart(steps).disabled).toBe(input.manuscriptFolder === null);
        // Both agents, whichever is the provider, and never an OpenAI key (codex.6).
        expect(steps[1]?.sections.map((s) => s.id)).toEqual(['claude', 'chatgpt']);
        for (const s of steps) {
          // At most one blue button in a step's own buttons, a row or a section;
          // none once the step is done; never a disabled one.
          for (const group of [
            s.actions,
            ...s.rows.map((r) => r.actions),
            ...s.sections.map((x) => x.actions)
          ]) {
            expect(group.filter((a) => a.primary).length).toBeLessThanOrEqual(1);
          }
          const blue = stepActions(s).filter((a) => a.primary);
          if (s.done) expect(blue).toEqual([]);
          expect(blue.every((a) => !a.disabled)).toBe(true);
          expect(s.status.length).toBeGreaterThan(0);
          for (const x of s.sections) expect(x.status.length).toBeGreaterThan(0);
          for (const action of stepActions(s)) {
            // The one label like a sign-in is ChatGPT's own button, in its own section.
            if (SIGN_IN_LIKE.test(action.label)) {
              expect(action.label).toBe(SIGN_IN_BUTTON);
              expect(action.id).toBe('sign-in-chatgpt');
            }
            expect(action.label).not.toMatch(/OpenAI|key/i);
            // No button opens Obsidian by name: Open is the system's app (polish.3).
            expect(action.label).not.toMatch(/obsidian/i);
          }
        }
        const claudeSection = steps[1]?.sections[0];
        for (const action of claudeSection?.actions ?? []) expect(action.label).not.toMatch(SIGN_IN_LIKE);
        // The rows are always the two, never blue, never disabled.
        expect(
          steps[0]?.rows.map((r) => r.actions.map((a) => [a.id, a.primary ?? false, a.disabled ?? false]))
        ).toEqual([[['change-reviews-folder', false, false]], [['change-backups-folder', false, false]]]);
        // The style sheet is done exactly when the file is there and its style sheet filled in.
        const sheetStep = steps[2];
        const path = input.guidelines?.path ?? input.paths?.guidelinesPath ?? null;
        expect(sheetStep?.done).toBe(
          path !== null &&
            !input.guidelinesProblem &&
            input.guidelines?.exists === true &&
            input.guidelines.styleSheet === 'filled'
        );
        // The agents step is done exactly when one of them can review.
        expect(steps[1]?.done).toBe(steps[1]?.sections.some((x) => x.done));
      })
    );
  });
});
