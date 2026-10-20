/**
 * The welcome guide (setup.11, PLAN section 7), decided without React: when it
 * shows, what each of its three steps says and offers, and what Start says.
 *
 * A fresh install has no settings file, so `onboardingDone` is false and the
 * guide takes the place of the chapter list, the prose and the side panel, as
 * the Setup screen does. Start and Skip put it away for good; Settings has
 * Show the welcome guide again. Each step says where it stands from what the
 * app already knows, and so follows it as it changes: Claude's check, in the
 * Setup screen's own words (`setupStatus`, setup.7), the manuscript folder in
 * the settings, and the guidelines file's status (`guidelines:status`,
 * setup.10), which the screen reads again whenever the window gets the focus
 * back. The style sheet's buttons are setup.10b's, worded for a file that may
 * not be there yet.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { PRO_PRESELECT_HINT } from '../ai/claudeModels';
import {
  OPENAI_MATURITY,
  openAiMaturitySentence,
  openAiMaturityWord,
  type OpenAiMaturity
} from '../ai/openai';
import { APP_NAME } from '../branding';
import type { EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../ipc';
import type { Provider, Settings } from '../types';
import {
  OPEN_IN_OBSIDIAN,
  STYLE_SHEET_EMPTY,
  canOpenInObsidian,
  fileName,
  openGuidelinesTitle
} from './guidelines';
import { withHint } from './saveHint';
import { runtimeLabel, setupStatus, setupView, type LastFailure } from './setup';

/**
 * Whether the guide shows: once the settings are in, until Start or Skip.
 * Settings from before 1.0 count as done when they name a manuscript folder
 * (`normalizeSettings`, 11.3 d), so an existing install never sees it unasked.
 *
 * `closedThisSession` is Start or Skip pressed in this run (the store's
 * `welcomeClosed`). It keeps the guide away even while the settings still say
 * it is not done: when writing `onboardingDone` failed, every later settings
 * reply carries main's `false`, and the guide must not come back over the
 * chapter mid-session (`setup.11` review).
 */
export function welcomeShown(
  settings: Pick<Settings, 'onboardingDone'> | null | undefined,
  closedThisSession = false
): boolean {
  return settings !== null && settings !== undefined && !settings.onboardingDone && !closedThisSession;
}

/**
 * What Settings' Show the welcome guide again writes: the guide is not done,
 * and the Pro preselection (`proPreselection`, setup.1) counts as settled, in
 * the same write, so bringing the guide back never changes the model
 * (`setup.11` review). `dismissedHints` is the setting as it stands; the
 * array is not changed.
 */
export function welcomeAgainPatch(
  dismissedHints: readonly string[]
): Pick<Settings, 'onboardingDone' | 'dismissedHints'> {
  return { onboardingDone: false, dismissedHints: withHint(dismissedHints, PRO_PRESELECT_HINT) };
}

export const WELCOME_TITLE = `Welcome to ${APP_NAME}`;

/** Settings' button that brings the guide back, and the name the guide gives it. */
export const SHOW_WELCOME_AGAIN = 'Show the welcome guide again';

/** The note under it in Settings. */
export const WELCOME_GUIDE_NOTE =
  'The steps shown at the first start: Claude, the manuscript folder and the style sheet, each saying whether it is done.';

export const WELCOME_INTRO = `Three steps get ${APP_NAME} ready to review your chapters. Each one says when it is done, and you can do them in any order. Skip leaves the guide; Settings has ${SHOW_WELCOME_AGAIN}.`;

export const WELCOME_START = 'Start';
export const WELCOME_SKIP = 'Skip';
export const WELCOME_SKIP_TITLE = `Close the guide. Settings has ${SHOW_WELCOME_AGAIN}.`;

export const SET_UP_CLAUDE = 'Set up Claude';
/**
 * The button that makes OpenAI the provider: "Use OpenAI instead
 * (experimental, pay per use)" while `OPENAI_MATURITY` says so (hardening.11).
 */
export function openAiChoiceLabel(maturity: OpenAiMaturity = OPENAI_MATURITY): string {
  const word = openAiMaturityWord(maturity);
  return word ? `Use OpenAI instead (${word}, pay per use)` : 'Use OpenAI instead (pay per use)';
}

export const USE_OPENAI = openAiChoiceLabel();
export const USE_CLAUDE = 'Use Claude instead';

export type WelcomeStepId = 'claude' | 'folder' | 'style-sheet';

/** What a step's button does; the screen maps each to its call. */
export type WelcomeActionId =
  | 'set-up-claude'
  | 'use-openai'
  | 'use-claude'
  | 'open-settings'
  | 'choose-folder'
  | 'open-obsidian'
  | 'open-default'
  | 'show-in-folder';

export interface WelcomeAction {
  id: WelcomeActionId;
  label: string;
  /** the blue button: what the step still needs */
  primary?: boolean;
  disabled?: boolean;
  /** the tooltip */
  title?: string;
}

export interface WelcomeStep {
  id: WelcomeStepId;
  title: string;
  done: boolean;
  /** where the step stands, in a few words, as the app finds it now */
  status: string;
  /** one paragraph each */
  lines: string[];
  /** what the step means for the author's files, as a list under the lines */
  facts: string[];
  actions: WelcomeAction[];
}

export interface WelcomeInput {
  provider: Provider;
  /** Claude's last check, null until the first one answers */
  claude: RuntimeStatus | null;
  claudeLastFailure: LastFailure | null;
  /** OpenAI's runtime: ready once a key is stored or in the environment */
  openai: RuntimeStatus | null;
  manuscriptFolder: string | null;
  /** `Settings.guidelinesPath`: null for the usual GUIDELINES.md in the manuscript folder */
  guidelinesSetting: string | null;
  /** `settings:effective`, null until read */
  paths: EffectivePaths | null;
  /** `guidelines:status`, null until read or when it could not be */
  guidelines: GuidelinesStatus | null;
  /** why `guidelines:status` could not be read, in main's words, or null */
  guidelinesProblem?: string | null;
}

/* ---------------- 1. Connect Claude ---------------- */

export const CLAUDE_STEP_TITLE = 'Connect Claude';

export const CLAUDE_STEP_TEXT = `${APP_NAME} reviews your chapters with Claude through Claude Code, Anthropic's command-line tool, which you install and sign in to yourself, with your Claude plan or an API key. ${SET_UP_CLAUDE} shows how, and this step says when Claude is ready.`;

/** The step's text with OpenAI chosen; it says OpenAI is experimental while `OPENAI_MATURITY` does. */
export function openAiStepText(maturity: OpenAiMaturity = OPENAI_MATURITY): string {
  return [
    'Reviews go to OpenAI instead, billed per token to the account that owns the API key.',
    openAiMaturitySentence(maturity),
    'Paste a key in Settings to finish this step.'
  ]
    .filter((sentence) => sentence !== null)
    .join(' ');
}

export const OPENAI_STEP_TEXT = openAiStepText();

/**
 * Claude can review: signed in, on a plan that runs Claude Code. A usage limit
 * reached by the last review still counts, since it resets by itself.
 */
function claudeConnected(input: WelcomeInput): boolean {
  const view = setupView(input.claude, input.claudeLastFailure);
  const signedIn = view === 'ready' || view === 'api-key' || view === 'usage-limit';
  return signedIn && !input.claude?.planWarning;
}

function claudeStep(input: WelcomeInput): WelcomeStep {
  if (input.provider === 'openai') {
    const done = input.openai?.state === 'ready';
    return {
      id: 'claude',
      title: CLAUDE_STEP_TITLE,
      done,
      status: runtimeLabel(input.openai) ?? 'Checking OpenAI…',
      lines: [OPENAI_STEP_TEXT],
      facts: [],
      actions: [
        {
          id: 'open-settings',
          label: 'Open Settings',
          primary: !done,
          title: 'Paste an OpenAI API key in Settings.'
        },
        { id: 'use-claude', label: USE_CLAUDE }
      ]
    };
  }
  const done = claudeConnected(input);
  const view = setupView(input.claude, input.claudeLastFailure);
  return {
    id: 'claude',
    title: CLAUDE_STEP_TITLE,
    done,
    // The Setup screen's own title for what the last check found.
    status: setupStatus(view, input.claude, input.claudeLastFailure).title,
    lines: [CLAUDE_STEP_TEXT],
    facts: [],
    actions: [
      { id: 'set-up-claude', label: SET_UP_CLAUDE, primary: !done },
      { id: 'use-openai', label: USE_OPENAI }
    ]
  };
}

/* ---------------- 2. Choose your manuscript folder ---------------- */

export const FOLDER_STEP_TITLE = 'Choose your manuscript folder';

export const FOLDER_STEP_TEXT =
  'The folder that holds your chapters: your Obsidian vault, or a folder inside it.';

/**
 * What the chapter list holds, in one sentence. `listChapters` leaves out more
 * than this names (PLAN 6.1: folders named node_modules, out or dist, the
 * reviews folder when it lies inside, links and junctions), so it never says
 * every file is listed; it names what an author meets in a vault (files.23).
 */
export const FOLDER_LISTS = `${APP_NAME} lists the .md and .txt files in the folder and its subfolders as chapters, leaving out a few, among them the guidelines file, Excalidraw drawings and anything whose name starts with a dot, such as Obsidian's .obsidian and .trash folders.`;

export const FOLDER_SAVES = `It changes a chapter file only when you press Save to chapter, and first copies the version it replaces into a backup in ${APP_NAME}'s own data folder.`;

/** The third fact: the one file the app adds, or the guidelines file chosen in Settings. */
export function folderGuidelinesFact(guidelinesSetting: string | null): string {
  if (guidelinesSetting === null) {
    return `It adds one file of its own to the folder, GUIDELINES.md, from a template the first time it needs it: the guidelines the reviewer follows, with your style sheet (step 3). It never changes that file after that.`;
  }
  return `Its guidelines file is the one chosen in Settings, ${guidelinesSetting}. It creates that file from a template only if it is missing, and never changes it after that.`;
}

/** The fourth fact: where reviews are kept, as `settings:effective` says once read. */
export function folderReviewsFact(paths: EffectivePaths | null): string {
  if (paths === null) {
    return `Reviews are kept in the reviews folder Settings shows: ${APP_NAME}'s own data folder unless you choose another.`;
  }
  if (paths.reviewsFolderIsDefault) {
    return `Reviews are kept in ${APP_NAME}'s own data folder, ${paths.reviewsFolder}, not in the manuscript folder. You can choose another reviews folder in Settings.`;
  }
  return `Reviews are kept in ${paths.reviewsFolder}, the reviews folder chosen in Settings.`;
}

function folderStep(input: WelcomeInput): WelcomeStep {
  const folder = input.manuscriptFolder;
  return {
    id: 'folder',
    title: FOLDER_STEP_TITLE,
    done: folder !== null,
    status: folder ?? 'No folder chosen yet',
    lines: [FOLDER_STEP_TEXT],
    // The four things the author should know before choosing it (setup.11).
    facts: [
      FOLDER_LISTS,
      FOLDER_SAVES,
      folderGuidelinesFact(input.guidelinesSetting),
      folderReviewsFact(input.paths)
    ],
    actions: [
      {
        id: 'choose-folder',
        label: folder ? 'Choose another folder' : 'Choose folder',
        primary: folder === null
      }
    ]
  };
}

/* ---------------- 3. Fill in your style sheet ---------------- */

export const STYLE_SHEET_STEP_TITLE = 'Fill in your style sheet';

export const OPEN_WITH_DEFAULT_APP = 'Open with default app';
export const CREATE_AND_OPEN_IN_OBSIDIAN = 'Create and open in Obsidian';
export const SHOW_IN_FOLDER = 'Show in folder';

/** What the style sheet is for, in a step that has not said yet whether it is filled in. */
function styleSheetPurpose(name: string): string {
  return `Your style sheet is a section of ${name}, the guidelines the reviewer follows over its own defaults: the spelling variant you use, character names, invented words. Without it the reviewer may "fix" them.`;
}

interface StyleSheetState {
  done: boolean;
  status: string;
  lines: string[];
}

function styleSheetState(
  path: string | null,
  status: GuidelinesStatus | null,
  problem: string | null,
  configured: boolean
): StyleSheetState {
  const name = path ? fileName(path) : 'GUIDELINES.md';
  if (path === null) {
    // A folder just chosen has a guidelines path once settings:effective answers.
    return {
      done: false,
      status: configured ? 'Not checked yet' : 'Choose a manuscript folder first',
      lines: [styleSheetPurpose(name)]
    };
  }
  if (problem !== null) {
    return { done: false, status: `Could not read ${name}`, lines: [problem] };
  }
  if (status === null) {
    return { done: false, status: 'Not checked yet', lines: [styleSheetPurpose(name)] };
  }
  if (!status.exists) {
    return {
      done: false,
      status: `${name} is not there yet`,
      lines: [
        styleSheetPurpose(name),
        `Each button below creates it from a template first. Fill in its Style sheet section, save it, and come back: this step is done once the section holds something.`
      ]
    };
  }
  switch (status.styleSheet) {
    case 'filled':
      return {
        done: true,
        status: 'Filled in',
        lines: [
          `The reviewer follows your style sheet in ${name} over its own defaults. Keep it current as the book grows.`
        ]
      };
    case 'missing':
      return {
        done: false,
        status: 'No Style sheet section',
        lines: [
          `${name} has no "## Style sheet" section, so the reviewer has no list of your spelling variant, character names and invented words. Add one, with them under it.`
        ]
      };
    case 'blank':
      return {
        done: false,
        status: 'Still empty',
        lines: [
          STYLE_SHEET_EMPTY,
          `Fill in the Style sheet section of ${name}, save it, and come back: this step is done once the section holds something.`
        ]
      };
  }
}

function styleSheetStep(input: WelcomeInput): WelcomeStep {
  const path = input.guidelines?.path ?? input.paths?.guidelinesPath ?? null;
  const configured = input.manuscriptFolder !== null || input.guidelinesSetting !== null;
  const state = styleSheetState(path, input.guidelines, input.guidelinesProblem ?? null, configured);
  const missing = path !== null && input.guidelines !== null && !input.guidelines.exists;
  const obsidian = canOpenInObsidian(path);
  const name = path ? fileName(path) : null;
  return {
    id: 'style-sheet',
    title: STYLE_SHEET_STEP_TITLE,
    done: state.done,
    status: state.status,
    lines: state.lines,
    facts: [],
    actions: [
      {
        id: 'open-obsidian',
        label: missing ? CREATE_AND_OPEN_IN_OBSIDIAN : OPEN_IN_OBSIDIAN,
        primary: !state.done && obsidian,
        disabled: !obsidian,
        ...titled(openGuidelinesTitle(path, 'obsidian'))
      },
      {
        id: 'open-default',
        label: OPEN_WITH_DEFAULT_APP,
        primary: !state.done && path !== null && !obsidian,
        disabled: path === null,
        ...titled(openGuidelinesTitle(path, 'default'))
      },
      {
        id: 'show-in-folder',
        label: SHOW_IN_FOLDER,
        disabled: path === null,
        ...titled(
          name
            ? `Show ${name} in its folder${missing ? ', creating it from the template first' : ''}.`
            : undefined
        )
      }
    ]
  };
}

function titled(title: string | undefined): { title?: string } {
  return title === undefined ? {} : { title };
}

/* ---------------- the guide ---------------- */

/** The three steps, in order, each as the app finds it now. */
export function welcomeSteps(input: WelcomeInput): WelcomeStep[] {
  return [claudeStep(input), folderStep(input), styleSheetStep(input)];
}

export interface WelcomeStart {
  /** Start needs a manuscript folder: without one there is nothing to open */
  disabled: boolean;
  /** what is left, beside Start, or null when every step is done */
  note: string | null;
}

/** Start, and what is left to do, said beside it. */
export function welcomeStart(steps: readonly WelcomeStep[]): WelcomeStart {
  const folder = steps.find((step) => step.id === 'folder');
  if (folder && !folder.done) {
    return { disabled: true, note: 'Choose a manuscript folder to start, or skip the guide for now.' };
  }
  const left = steps.filter((step) => !step.done).map((step) => step.title);
  if (left.length === 0) return { disabled: false, note: null };
  const them = left.length === 1 ? 'it' : 'them';
  return {
    disabled: false,
    note: `Still to do: ${left.join(', ')}. You can start now and come back to ${them} with ${SHOW_WELCOME_AGAIN}, in Settings.`
  };
}

/** The card when Start or Skip could not be written: the guide goes for now and comes back at the next start. */
export function welcomeNotKept(reason: string): string {
  return `The welcome guide is closed for now, but that could not be saved, so it will show again at the next start: ${reason}`;
}
