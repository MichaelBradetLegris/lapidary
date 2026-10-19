/**
 * What Review with AI and Settings say about the guidelines file (setup.10b,
 * PLAN 5.5 and section 7): the note when its style sheet is still empty, the
 * two ways to open it and what each does.
 *
 * The reviewer follows the style sheet over its own defaults. Left as the
 * template has it, the reviewer may "fix" the author's spelling variant,
 * character names and invented words, so Review with AI says so until the
 * style sheet holds something.
 *
 * Pure (CLAUDE.md rule 4).
 */

import type { GuidelinesStatus, OpenGuidelinesVia } from '../ipc';
import { obsidianOpensFile } from '../obsidian';

/** The note under Review with AI's Guidelines row, in the words of `setup.10b`. */
export const STYLE_SHEET_EMPTY =
  'Your style sheet is still empty: spelling variant, character names, invented words. Without it the reviewer may "fix" them.';

/** The button that opens the guidelines file in Obsidian, in Review with AI and Settings. */
export const OPEN_IN_OBSIDIAN = 'Open in Obsidian';

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

/** Whether Open in Obsidian is offered for this file: it needs one, and a `.md` one. */
export function canOpenInObsidian(file: string | null): boolean {
  return file !== null && obsidianOpensFile(file);
}

/** The tooltip of Open in Obsidian, or of the button that opens the file in the system's app. */
export function openGuidelinesTitle(file: string | null, via: OpenGuidelinesVia): string | undefined {
  if (file === null) return undefined;
  const name = fileName(file);
  if (via === 'obsidian') {
    return canOpenInObsidian(file)
      ? `Open ${name} in Obsidian, in the vault that holds it.`
      : `Obsidian opens .md files, and ${name} is not one.`;
  }
  const ext = extension(file);
  return ext
    ? `Open ${name} in the app this computer uses for ${ext} files.`
    : `Open ${name} in the app this computer uses for it.`;
}

/** What Settings says once the file was handed over: `path` and `created` are `guidelines:open`'s answer. */
export function openedGuidelinesNote(
  result: { path: string; created: boolean },
  via: OpenGuidelinesVia
): string {
  if (via === 'obsidian') {
    return result.created
      ? `Created ${result.path} from the template and asked Obsidian to open it.`
      : `Asked Obsidian to open ${result.path}.`;
  }
  return result.created ? `Created ${result.path} from the template.` : `Opened ${result.path}.`;
}
