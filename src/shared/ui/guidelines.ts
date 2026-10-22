/**
 * What Review with AI, Settings and the welcome guide say about the
 * guidelines file (setup.10b, polish.3, PLAN 5.5 and section 7): the note
 * when its style sheet is still empty, and its two buttons, Open and Open
 * folder, and what each does.
 *
 * The reviewer follows the style sheet over its own defaults. Left as the
 * template has it, the reviewer may "fix" the author's spelling variant,
 * character names and invented words, so Review with AI says so until the
 * style sheet holds something.
 *
 * Pure (CLAUDE.md rule 4).
 */

import type { GuidelinesStatus } from '../ipc';

/** The note under Review with AI's Guidelines row, in the words of `setup.10b`. */
export const STYLE_SHEET_EMPTY =
  'Your style sheet is still empty: spelling variant, character names, invented words. Without it the reviewer may "fix" them.';

/** The button that opens the guidelines file in the system's app for it (`guidelines:open`, polish.3). */
export const OPEN_GUIDELINES = 'Open';

/** The button that shows the guidelines file in its folder (`shell:reveal`, polish.3). */
export const OPEN_FOLDER = 'Open folder';

/**
 * The note, while the style sheet is `blank`. A guidelines file that does not
 * exist yet counts as blank, since the review creates it from the template,
 * whose style sheet is. `missing` (a file of the author's own with no "Style
 * sheet" heading) and `filled` get none, nor does a dialog with no
 * manuscript folder or whose status could not be read.
 */
export function styleSheetNote(status: GuidelinesStatus | null): string | null {
  if (status === null || status.path === null) return null;
  if (!status.exists || status.styleSheet === 'blank') return STYLE_SHEET_EMPTY;
  return null;
}

/** The last part of a path, whichever slash the system uses. */
export function fileName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

/** `.md`, `.txt`: the extension in lower case, or '' when there is none. */
function extension(file: string): string {
  return /(\.[^.\\/]+)$/.exec(fileName(file))?.[1]?.toLowerCase() ?? '';
}

/**
 * Open's tooltip: the system's app for the file's type, which is Obsidian
 * when the author has made it the app for .md files. `missing` says that the
 * file is made from the template first, as the welcome guide knows.
 */
export function openGuidelinesTitle(file: string | null, missing = false): string | undefined {
  if (file === null) return undefined;
  const name = fileName(file);
  const ext = extension(file);
  const app = ext ? `the app this computer uses for ${ext} files` : 'the app this computer uses for it';
  return missing ? `Create ${name} from the template, then open it in ${app}.` : `Open ${name} in ${app}.`;
}

/** Open folder's tooltip: the folder opens with the file selected. */
export function openFolderTitle(file: string | null, missing = false): string | undefined {
  if (file === null) return undefined;
  const name = fileName(file);
  return missing
    ? `Create ${name} from the template, then open its folder with the file selected.`
    : `Open the folder that holds ${name}, with the file selected.`;
}

/** What Settings and the welcome guide say once Open has handed the file over: `guidelines:open`'s answer. */
export function openedGuidelinesNote(result: { path: string; created: boolean }): string {
  return result.created
    ? `Created ${result.path} from the template and opened it.`
    : `Opened ${result.path}.`;
}
