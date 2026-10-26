/**
 * The Settings dialog's words (`polish.4`). The dialog has four sections,
 * App, Review, Folders and Accounts, with the welcome guide and About at its
 * foot. App holds the settings of the app itself, Appearance for now; it went
 * above Review in `polish.22`, which until then held Appearance under Effort.
 * A row has at most one note under it, one short line. What a note used to
 * say at length is now the tooltip of the small (?) at the right end of the
 * row (`HelpTip`, polish.15), which is also what a screen reader gives as the
 * description of the row's control, or is in the README. Nothing a note said
 * that matters for the author's files or sign-ins was dropped: the tooltips
 * keep it.
 *
 * Pure (CLAUDE.md rule 4), tested in test/shared/settingsDialog.test.ts.
 */

import { APP_NAME } from '../branding';
import { BACKUPS_NOTE } from './backups';

/** The section headings, in the order the dialog shows them. */
export const SETTINGS_SECTIONS = ['App', 'Review', 'Folders', 'Accounts'] as const;

/**
 * The most characters a note under a row may have, so that it stays on one
 * line in the dialog at 100% (584 CSS px for text, about 6.5 px a character).
 */
export const SETTINGS_NOTE_MAX = 85;

/** The (?)'s name: "More about the reviews folder". */
export function helpButtonLabel(topic: string): string {
  return `More about ${topic}`;
}

/* ---------- App ---------- */

/** The note under Appearance (theme.7), unchanged. */
export const APPEARANCE_NOTE = "Match system follows your computer's light or dark setting.";

/* ---------- Review ---------- */

export const MODEL_TIP =
  "Default lets Claude Code use your account's own default model. Review with AI shows this same setting, and is where the ChatGPT model is chosen.";

export const EFFORT_TIP =
  "How much the model reasons before it answers, for Claude and ChatGPT alike. A higher effort takes longer and uses more of your plan's limits or your API credit.";

/* ---------- Folders ---------- */

export const MANUSCRIPT_TIP =
  'The folder that holds your chapters: your Obsidian vault, or a folder inside it. A chapter changes only when you press Save to chapter.';

/** The note under the reviews folder; it says when the folder is the default one. */
export function reviewsFolderNote(isDefault: boolean): string {
  const note = 'Your reviews and decisions are saved here as you go.';
  return isDefault ? `${note} This is the default folder.` : note;
}

export const REVIEWS_FOLDER_TIP = `A review is saved as soon as the model answers, and again after every decision. With no folder chosen, reviews go to ${APP_NAME}'s own data folder. Each review holds the full text of its chapter.`;

/**
 * The note under the backups folder; since the folder can be chosen
 * (setup.18), it says when it is the default one, as the reviews folder's
 * does. Until then it read "Copies of your chapters as they were before each
 * Save to chapter.", which with that sentence is longer than a note may be.
 */
export function backupsFolderNote(isDefault: boolean): string {
  const note = 'Copies of your chapters before each Save to chapter.';
  return isDefault ? `${note} This is the default folder.` : note;
}

/** The backups' tooltip: apply.11's note with the 20-and-30-days rule, and where the folder may be (setup.18). */
export const BACKUPS_TIP = BACKUPS_NOTE;

export const GUIDELINES_TIP = `Sent with every review: your style sheet, such as your spelling variant, character names and invented words. With none chosen, it is GUIDELINES.md in the manuscript folder. A missing file is made from a template; ${APP_NAME} never writes over one that is there.`;

/* ---------- Accounts ---------- */

export const CLAUDE_ACCOUNT_TIP = `Reviews with Claude run through Claude Code on this computer, signed in to your own account. ${APP_NAME} never sees your Claude password or sign-in token. Setup shows how to install Claude Code and sign in.`;

/** The ChatGPT account row's (?) (codex.2): what the sign-in is for, where it is kept, and Setup. */
export const CHATGPT_ACCOUNT_TIP = `Reviews with ChatGPT use your ChatGPT plan, with no API key, once you sign in with ChatGPT on Setup, where the note on ChatGPT's data settings is too. The sign-in is encrypted with your Windows login, kept beside the settings file and never shown; only ${APP_NAME}'s background process uses it. Sign out removes it.`;

/* ---------- The foot ---------- */

export const ABOUT_BUTTON_NOTE = 'The version, updates, licences and diagnostics.';
export const DONE_NOTE = 'Each setting is saved as soon as you change it.';
