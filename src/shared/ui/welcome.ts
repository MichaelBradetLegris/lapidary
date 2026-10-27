/**
 * The welcome guide (setup.11, PLAN section 7), decided without React: when it
 * shows, what each of its four steps says and offers, and what Start says.
 *
 * A fresh install has no settings file, so `onboardingDone` is false and the
 * guide takes the place of the chapter list, the prose and the side panel, as
 * the Setup screen does. Start and Skip put it away for good; Settings has
 * Show the welcome guide again. Since setup.18 the steps are: 1 the
 * manuscript folder, the one Start needs, with two optional rows under it,
 * where reviews and backups are kept; 2 the AI agents, optional, with a
 * section each for Claude and ChatGPT; 3 since setup.20, how the app looks,
 * Appearance and Focus mode, a choice that is never undone; 4 the style sheet,
 * optional too. Each says where it stands from what the app already knows,
 * and so follows it as it changes: the folders and the look in the settings
 * and `settings:effective`, Claude's check in the Setup screen's own words
 * (`setupStatus`, setup.7), the ChatGPT sign-in in its view's words
 * (`chatGptSetupStatus`, codex.2), and the guidelines file's status
 * (`guidelines:status`, setup.10), which the screen reads again whenever the
 * window gets the focus back. The style sheet's buttons are Review with AI's,
 * Open and Open folder (polish.3), worded for a file that may not be there
 * yet.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { PRO_PRESELECT_HINT } from '../ai/claudeModels';
import { APP_NAME } from '../branding';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../ipc';
import { DEFAULT_SETTINGS, type Provider, type Settings } from '../types';
import { SIGN_IN_BUTTON, chatGptSetupStatus } from './chatgpt';
import {
  OPEN_FOLDER,
  OPEN_GUIDELINES,
  STYLE_SHEET_EMPTY,
  fileName,
  openFolderTitle,
  openGuidelinesTitle
} from './guidelines';
import { withHint } from './saveHint';
import { setupStatus, setupView, type LastFailure, type SetupFor } from './setup';
import type { Theme } from './theme';

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

/** Its tooltip and description at the foot of Settings (polish.4; a note under its row before). */
export const WELCOME_GUIDE_NOTE =
  'The first-start steps: manuscript folder, AI agents, appearance and style sheet.';

export const WELCOME_INTRO = `Four steps get ${APP_NAME} ready to review your chapters, and only the first is needed to start. Each one says when it is done, and you can do them in any order. Skip leaves the guide; Settings has ${SHOW_WELCOME_AGAIN}.`;

export const WELCOME_START = 'Start';
export const WELCOME_SKIP = 'Skip';
export const WELCOME_SKIP_TITLE = `Close the guide. Settings has ${SHOW_WELCOME_AGAIN}.`;

/** Beside the title of each step Start does not wait for, and of step 1's two rows (setup.18). */
export const OPTIONAL = 'optional';

export const SET_UP_CLAUDE = 'Set up Claude';
/**
 * ChatGPT's button while signed in, while a sign-in waits, or when no sign-in
 * can be kept: it opens the Setup screen's ChatGPT view (codex.3) and starts
 * nothing; while signed out the button is Sign in with ChatGPT (setup.18).
 */
export const SET_UP_CHATGPT = 'Set up ChatGPT';

export type WelcomeStepId = 'folder' | 'agents' | 'look' | 'style-sheet';

/** What a button does; the screen maps each to its call. */
export type WelcomeActionId =
  | 'choose-folder'
  | 'change-reviews-folder'
  | 'change-backups-folder'
  | 'set-up-claude'
  | 'sign-in-chatgpt'
  | 'set-up-chatgpt'
  | 'open-guidelines'
  | 'open-guidelines-folder';

export interface WelcomeAction {
  id: WelcomeActionId;
  label: string;
  /** the blue button: what the step still needs */
  primary?: boolean;
  disabled?: boolean;
  /** the tooltip */
  title?: string;
}

/** Where a folder row keeps things: reviews or backups (setup.18). */
export type WelcomeFolderId = 'reviews' | 'backups';

/** One of step 1's two optional rows, under Choose folder (setup.18). */
export interface WelcomeFolderRow {
  id: WelcomeFolderId;
  label: string;
  /** where it is now, in a few words: in the app's data folder, or the folder chosen */
  value: string;
  /** the folder in use, for the tooltip, once known */
  path: string | null;
  /** what it holds, one line */
  note: string;
  actions: WelcomeAction[];
}

/**
 * Step 3's two rows as the settings stand (setup.20): Appearance, and Focus
 * mode with its hold time, the settings Settings' App section shows, which the
 * guide writes as Settings does.
 */
export type WelcomeLook = Pick<Settings, 'theme' | 'focusMode' | 'focusHoldSeconds'>;

/** One of step 2's two sections, an AI agent (setup.18). */
export interface WelcomeSection {
  id: SetupFor;
  title: string;
  /** it can review: Claude is ready, or the ChatGPT sign-in is kept */
  done: boolean;
  /** where it stands, in its Setup view's own words */
  status: string;
  lines: string[];
  actions: WelcomeAction[];
}

export interface WelcomeStep {
  id: WelcomeStepId;
  title: string;
  /** Start does not wait for it: every step but the manuscript folder's (setup.18) */
  optional: boolean;
  done: boolean;
  /** where the step stands, in a few words, as the app finds it now */
  status: string;
  /** one paragraph each */
  lines: string[];
  /** what the step means for the author's files, as a list under the lines */
  facts: string[];
  actions: WelcomeAction[];
  /** step 1's rows, the reviews folder and the backups folder; none elsewhere */
  rows: WelcomeFolderRow[];
  /** step 2's sections, Claude and ChatGPT; none elsewhere */
  sections: WelcomeSection[];
  /** step 3's settings, Appearance and Focus mode (setup.20); null elsewhere */
  look: WelcomeLook | null;
}

export interface WelcomeInput {
  /** the provider Review with AI starts with, which a section's button may change (`welcomeProviderFor`) */
  provider: Provider;
  /** Claude's last check, null until the first one answers */
  claude: RuntimeStatus | null;
  claudeLastFailure: LastFailure | null;
  /** the ChatGPT sign-in, null until read */
  chatgpt?: ChatGptStatus | null;
  /** a ChatGPT sign-in waits for the browser (`chatGptWaiting`), as the ChatGPT view shows it */
  chatgptWaiting?: boolean;
  manuscriptFolder: string | null;
  /** `Settings.reviewsFolder`: null for the folder in the app's data folder */
  reviewsSetting?: string | null;
  /** `Settings.backupsFolder`: null for the folder in the app's data folder (setup.18) */
  backupsSetting?: string | null;
  /** `Settings.guidelinesPath`: null for the usual GUIDELINES.md in the manuscript folder */
  guidelinesSetting: string | null;
  /** `settings:effective`, null until read */
  paths: EffectivePaths | null;
  /** `guidelines:status`, null until read or when it could not be */
  guidelines: GuidelinesStatus | null;
  /** why `guidelines:status` could not be read, in main's words, or null */
  guidelinesProblem?: string | null;
  /** the theme and focus mode settings, for step 3 (setup.20); a fresh install's when left out */
  look?: WelcomeLook;
}

/* ---------------- 1. Connect your manuscript folder ---------------- */

export const FOLDER_STEP_TITLE = 'Connect your manuscript folder';

export const FOLDER_STEP_TEXT =
  'The folder that holds your chapters: your Obsidian vault, or a folder inside it.';

/**
 * What the chapter list holds, in one sentence. `listChapters` leaves out more
 * than this names (PLAN 6.1: folders named node_modules, out or dist, the
 * reviews folder when it lies inside, links and junctions), so it never says
 * every file is listed; it names what an author meets in a vault (files.23).
 */
export const FOLDER_LISTS = `${APP_NAME} lists the .md and .txt files in the folder and its subfolders as chapters, leaving out a few, among them the guidelines file, Excalidraw drawings and anything whose name starts with a dot, such as Obsidian's .obsidian and .trash folders.`;

/** The second fact: Save to chapter, and the backup it makes first, in the folder of the row below (setup.18). */
export const FOLDER_SAVES = `It changes a chapter file only when you press Save to chapter, and first copies the version it replaces into the backups folder below.`;

/** The third fact: the one file the app adds, or the guidelines file chosen in Settings. */
export function folderGuidelinesFact(guidelinesSetting: string | null): string {
  if (guidelinesSetting === null) {
    return `It adds one file of its own to the folder, GUIDELINES.md, from a template the first time it needs it: the guidelines the reviewer follows, with your style sheet (step 4). It never changes that file after that.`;
  }
  return `Its guidelines file is the one chosen in Settings, ${guidelinesSetting}. It creates that file from a template only if it is missing, and never changes it after that.`;
}

/** A folder row's value while it is the folder in the app's data folder, as the task words it (setup.18). */
export const IN_DATA_FOLDER = `In ${APP_NAME}'s data folder`;

/** Each row's button, as in Settings. */
export const CHANGE_FOLDER = 'Change';

export const REVIEWS_ROW_LABEL = 'Reviews folder';
export const BACKUPS_ROW_LABEL = 'Backups folder';

export const WELCOME_REVIEWS_NOTE =
  'Where your reviews and decisions are kept. Each review holds the full text of its chapter.';
export const WELCOME_BACKUPS_NOTE =
  'Where Save to chapter copies the version it replaces. It cannot be the manuscript folder or a folder inside it.';

/** The folder picker's title for each row's Change, as Settings words it. */
export const FOLDER_PICKER_TITLES: Readonly<Record<WelcomeFolderId, string>> = {
  reviews: 'Choose the reviews folder',
  backups: 'Choose the backups folder'
};

/** The setting each row's Change writes. */
export const FOLDER_SETTINGS: Readonly<Record<WelcomeFolderId, 'reviewsFolder' | 'backupsFolder'>> = {
  reviews: 'reviewsFolder',
  backups: 'backupsFolder'
};

/**
 * A folder row: in the app's data folder while the setting is null, else the
 * folder chosen. `settings:effective` says so once read, and gives the folder
 * in use for the tooltip; until then the setting does.
 */
function folderRow(
  id: WelcomeFolderId,
  label: string,
  note: string,
  setting: string | null,
  inUse: { folder: string; isDefault: boolean } | null
): WelcomeFolderRow {
  const isDefault = inUse ? inUse.isDefault : setting === null;
  const path = inUse ? inUse.folder : setting;
  return {
    id,
    label,
    value: isDefault || path === null ? IN_DATA_FOLDER : path,
    path,
    note,
    actions: [{ id: `change-${id}-folder`, label: CHANGE_FOLDER, title: FOLDER_PICKER_TITLES[id] }]
  };
}

function folderStep(input: WelcomeInput): WelcomeStep {
  const folder = input.manuscriptFolder;
  const paths = input.paths;
  return {
    id: 'folder',
    title: FOLDER_STEP_TITLE,
    optional: false,
    done: folder !== null,
    status: folder ?? 'No folder chosen yet',
    lines: [FOLDER_STEP_TEXT],
    // What the author should know before choosing it (setup.11); where reviews
    // and backups are kept is said by the rows (setup.18).
    facts: [FOLDER_LISTS, FOLDER_SAVES, folderGuidelinesFact(input.guidelinesSetting)],
    actions: [
      {
        id: 'choose-folder',
        label: folder ? 'Choose another folder' : 'Choose folder',
        primary: folder === null
      }
    ],
    rows: [
      folderRow(
        'reviews',
        REVIEWS_ROW_LABEL,
        WELCOME_REVIEWS_NOTE,
        input.reviewsSetting ?? null,
        paths ? { folder: paths.reviewsFolder, isDefault: paths.reviewsFolderIsDefault } : null
      ),
      folderRow(
        'backups',
        BACKUPS_ROW_LABEL,
        WELCOME_BACKUPS_NOTE,
        input.backupsSetting ?? null,
        paths ? { folder: paths.backupsFolder, isDefault: paths.backupsFolderIsDefault } : null
      )
    ],
    sections: [],
    look: null
  };
}

/* ---------------- 2. Connect AI agents ---------------- */

export const AGENTS_STEP_TITLE = 'Connect AI agents';

export const AGENTS_STEP_TEXT = `Reviews with AI need Claude or ChatGPT, and either will do. You can start without them and set one up later, from Settings.`;

export const CLAUDE_SECTION_TITLE = 'Claude';
export const CHATGPT_SECTION_TITLE = 'ChatGPT';

export const CLAUDE_SECTION_TEXT = `Claude reviews through Claude Code, Anthropic's command-line tool, which you install and sign in to yourself, with your Claude plan or an API key. ${SET_UP_CLAUDE} shows how.`;

/**
 * ChatGPT's line while its button is Sign in with ChatGPT. It names that
 * button alone: until the setup.18 review it named the view by its heading,
 * Set up ChatGPT, which is also the label the button takes once signed in.
 */
export const CHATGPT_SECTION_TEXT = `ChatGPT reviews on your ChatGPT plan, with no API key. ${SIGN_IN_BUTTON} opens Setup's ChatGPT view, which says what to check in ChatGPT's data settings, and OpenAI's sign-in page in your browser.`;

/** ChatGPT's line while its button is Set up ChatGPT: signed in, waiting, or no sign-in can be kept. */
export const CHATGPT_SECTION_SET_UP_TEXT = `ChatGPT reviews on your ChatGPT plan, with no API key. ${SET_UP_CHATGPT} says where the sign-in stands and what to check in ChatGPT's data settings.`;

/**
 * Claude can review: signed in, on a plan that runs Claude Code. A usage limit
 * reached by the last review still counts, since it resets by itself.
 */
function claudeConnected(input: WelcomeInput): boolean {
  const view = setupView(input.claude, input.claudeLastFailure);
  const signedIn = view === 'ready' || view === 'api-key' || view === 'usage-limit';
  return signedIn && !input.claude?.planWarning;
}

/** ChatGPT can review: a sign-in is kept. */
function chatGptConnected(input: WelcomeInput): boolean {
  return input.chatgpt?.signedIn === true;
}

/** The step's own line under its title: which of the two can review. */
function agentsStatus(claude: boolean, chatgpt: boolean): string {
  if (claude && chatgpt) return 'Claude and ChatGPT are both connected';
  if (claude) return 'Claude is connected';
  if (chatgpt) return 'ChatGPT is connected';
  return 'Not connected yet';
}

function claudeSection(input: WelcomeInput, stepDone: boolean): WelcomeSection {
  const done = claudeConnected(input);
  const view = setupView(input.claude, input.claudeLastFailure);
  return {
    id: 'claude',
    title: CLAUDE_SECTION_TITLE,
    done,
    // The Setup screen's own title for what the last check found.
    status: setupStatus(view, input.claude, input.claudeLastFailure).title,
    lines: [CLAUDE_SECTION_TEXT],
    actions: [{ id: 'set-up-claude', label: SET_UP_CLAUDE, primary: !stepDone }]
  };
}

/**
 * ChatGPT's section. While signed out, Sign in with ChatGPT, which opens the
 * ChatGPT view and starts the sign-in there, as that view's own button does;
 * held until the status is read. Once signed in, while a sign-in waits for the
 * browser (the view has Cancel), and when Windows cannot encrypt a sign-in
 * (the view says why), Set up ChatGPT, which opens the view and starts nothing.
 */
function chatGptSection(input: WelcomeInput, stepDone: boolean): WelcomeSection {
  const status = input.chatgpt ?? null;
  const waiting = input.chatgptWaiting === true;
  const done = chatGptConnected(input);
  const signIn = !waiting && !done && status?.encryptionAvailable !== false;
  const blue = !stepDone && (signIn ? status !== null : waiting);
  return {
    id: 'chatgpt',
    title: CHATGPT_SECTION_TITLE,
    done,
    // The ChatGPT view's own title for where the sign-in stands.
    status: chatGptSetupStatus(status, waiting).title,
    lines: [signIn ? CHATGPT_SECTION_TEXT : CHATGPT_SECTION_SET_UP_TEXT],
    actions: [
      signIn
        ? { id: 'sign-in-chatgpt', label: SIGN_IN_BUTTON, primary: blue, disabled: status === null }
        : { id: 'set-up-chatgpt', label: SET_UP_CHATGPT, primary: blue }
    ]
  };
}

function agentsStep(input: WelcomeInput): WelcomeStep {
  const claude = claudeConnected(input);
  const chatgpt = chatGptConnected(input);
  const done = claude || chatgpt;
  return {
    id: 'agents',
    title: AGENTS_STEP_TITLE,
    optional: true,
    done,
    status: agentsStatus(claude, chatgpt),
    lines: [AGENTS_STEP_TEXT],
    facts: [],
    actions: [],
    rows: [],
    // Either will do, so the step's blue buttons go once one can review.
    sections: [claudeSection(input, done), chatGptSection(input, done)],
    look: null
  };
}

/**
 * The provider a section's button makes the one Review with AI starts with,
 * or null to leave it (setup.18): the section's own, when the provider is the
 * other one and that one cannot review. So an author who connects only
 * ChatGPT is not shown Claude's launch card and status, as Use ChatGPT
 * instead saw to until the two sections replaced it, and an author who can
 * already review with the provider keeps it; the Review menu still chooses
 * either for each review (5.8 item 8).
 */
export function welcomeProviderFor(section: SetupFor, input: WelcomeInput): Provider | null {
  if (input.provider === section) return null;
  const otherConnected = section === 'chatgpt' ? claudeConnected(input) : chatGptConnected(input);
  return otherConnected ? null : section;
}

/* ---------------- 3. Choose appearance and focus mode ---------------- */

export const LOOK_STEP_TITLE = 'Choose appearance and focus mode';

/**
 * The step's line. Turning the switch on changes nothing straight away: focus mode
 * starts only as the window goes full screen (section 7, Focus mode), so the
 * line says how to go full screen, as Settings' (?) does (the setup.20 review).
 */
export const LOOK_STEP_TEXT = `How ${APP_NAME} looks, and focus mode, which, once you go full screen with F11 or the arrows after Settings, keeps it there until you hold F11 or Esc. You can change both later in Settings, under App.`;

/** The theme as the step's own line says it, the first of its two sentences. */
const LOOK_THEME_WORDS: Readonly<Record<Theme, string>> = {
  system: 'Matching your system',
  light: 'Always light',
  dark: 'Always dark'
};

/**
 * Step 3's line under its title: what is chosen now, the theme, then focus
 * mode ("Matching your system. Focus mode off.", setup.20).
 */
export function lookStatus(look: WelcomeLook): string {
  const focus = look.focusMode
    ? `Focus mode on, with a ${look.focusHoldSeconds}-second hold`
    : 'Focus mode off';
  return `${LOOK_THEME_WORDS[look.theme]}. ${focus}.`;
}

/**
 * Step 3 (setup.20): a choice, not a job. Whatever is chosen will do, the
 * defaults included, so the step is never undone: it is done from the start,
 * with its tick, and Start's line never names it. Its rows are controls, not
 * buttons, so it has no blue button either.
 */
function lookStep(input: WelcomeInput): WelcomeStep {
  const { theme, focusMode, focusHoldSeconds } = input.look ?? DEFAULT_SETTINGS;
  const look: WelcomeLook = { theme, focusMode, focusHoldSeconds };
  return {
    id: 'look',
    title: LOOK_STEP_TITLE,
    optional: true,
    done: true,
    status: lookStatus(look),
    lines: [LOOK_STEP_TEXT],
    facts: [],
    actions: [],
    rows: [],
    sections: [],
    look
  };
}

/* ---------------- 4. Fill in your style sheet ---------------- */

export const STYLE_SHEET_STEP_TITLE = 'Fill in your style sheet';

/** Open, while the guidelines file is not there yet: it is made from the template first (polish.3). */
export const CREATE_AND_OPEN = 'Create and open';

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
        `Both buttons below create it from a template first. Fill in its Style sheet section, save it, and come back: this step is done once the section holds something.`
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
  return {
    id: 'style-sheet',
    title: STYLE_SHEET_STEP_TITLE,
    optional: true,
    done: state.done,
    status: state.status,
    lines: state.lines,
    facts: [],
    actions: [
      {
        id: 'open-guidelines',
        label: missing ? CREATE_AND_OPEN : OPEN_GUIDELINES,
        primary: !state.done && path !== null,
        disabled: path === null,
        ...titled(openGuidelinesTitle(path, missing))
      },
      {
        id: 'open-guidelines-folder',
        label: OPEN_FOLDER,
        disabled: path === null,
        ...titled(openFolderTitle(path, missing))
      }
    ],
    rows: [],
    sections: [],
    look: null
  };
}

function titled(title: string | undefined): { title?: string } {
  return title === undefined ? {} : { title };
}

/* ---------------- the guide ---------------- */

/** The four steps, in order, each as the app finds it now. */
export function welcomeSteps(input: WelcomeInput): WelcomeStep[] {
  return [folderStep(input), agentsStep(input), lookStep(input), styleSheetStep(input)];
}

/** Every button of a step, its own and its rows' and sections', in the order the guide draws them. */
export function stepActions(step: WelcomeStep): WelcomeAction[] {
  return [
    ...step.actions,
    ...step.rows.flatMap((row) => row.actions),
    ...step.sections.flatMap((section) => section.actions)
  ];
}

export interface WelcomeStart {
  /** Start needs a manuscript folder: without one there is nothing to open */
  disabled: boolean;
  /** what is left, beside Start, or null when every step is done */
  note: string | null;
}

/**
 * Start, and what is left to do, said beside it. Start needs the manuscript
 * folder alone (setup.18): what is left once it is chosen is optional.
 */
export function welcomeStart(steps: readonly WelcomeStep[]): WelcomeStart {
  const required = steps.filter((step) => !step.optional && !step.done);
  if (required.length > 0) {
    return { disabled: true, note: 'Choose a manuscript folder to start, or skip the guide for now.' };
  }
  const left = steps.filter((step) => !step.done).map((step) => step.title);
  if (left.length === 0) return { disabled: false, note: null };
  const [what, them] = left.length === 1 ? ['step', 'it'] : ['steps', 'them'];
  return {
    disabled: false,
    note: `Optional ${what} not done yet: ${left.join(', ')}. You can start now and come back to ${them} with ${SHOW_WELCOME_AGAIN}, in Settings.`
  };
}

/** The card when Start or Skip could not be written: the guide goes for now and comes back at the next start. */
export function welcomeNotKept(reason: string): string {
  return `The welcome guide is closed for now, but that could not be saved, so it will show again at the next start: ${reason}`;
}

/**
 * Where the focus goes when leaving the Setup screen lands on the guide
 * (setup.19): the button of the section for the view the author leaves, Set
 * up Claude, or ChatGPT's Sign in with ChatGPT or Set up ChatGPT, whichever it
 * shows now (setup.18); null when no step has that section, or its button
 * cannot take the focus.
 */
export function welcomeLandingAction(view: SetupFor, steps: readonly WelcomeStep[]): WelcomeActionId | null {
  const section = steps.flatMap((step) => step.sections).find((s) => s.id === view);
  return section?.actions.find((action) => action.disabled !== true)?.id ?? null;
}
