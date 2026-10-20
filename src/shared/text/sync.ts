/**
 * Sync hygiene (files.11, PLAN 6.1). A vault kept in step by a sync tool, or
 * by git, can hold two kinds of leftovers from a clash: a conflict copy, a
 * second file the tool made beside the chapter, and merge markers, lines git
 * writes into the chapter itself around the two versions of a passage. The
 * app points at both and changes neither: a conflict copy is listed like any
 * other chapter, with a badge, and a chapter with merge markers opens as it
 * is, with a card. Nothing is hidden, moved or deleted.
 *
 * Only the names three tools are documented to give their copies are known
 * here, so a chapter whose title merely mentions a conflict is not marked:
 *
 * - Obsidian Sync, with its Conflict resolution setting on "Create conflict
 *   file" (Obsidian 1.9.7 and later): `Meeting notes (Conflicted copy
 *   MyMacBook2 202411281430).md`, the device's name and the time as
 *   YYYYMMDDHHMM.
 * - Dropbox: `Chapter 12 (Jane Doe's conflicted copy 2026-10-19).md`, the
 *   editor's name or computer and the date, and ` (1)` after the date for a
 *   second copy that day.
 * - Syncthing: `Chapter 12.sync-conflict-20261019-153045-ABCDEFG.md`, the time
 *   as YYYYMMDD-HHMMSS and the short ID of the device that made the change
 *   (no ID before Syncthing 0.14).
 *
 * Pure (CLAUDE.md rule 4), so every case has a test without a DOM.
 */

import { APP_NAME } from '../branding';

/** The sync tools whose conflict copies the chapter list marks. */
export type SyncTool = 'Obsidian Sync' | 'Dropbox' | 'Syncthing';

export interface ConflictCopy {
  tool: SyncTool;
  /** the file the copy was made from, as the copy's name gives it: "Chapter 12.md" */
  original: string;
}

/** The badge after a conflict copy's name in the chapter list. */
export const CONFLICT_COPY_BADGE = 'conflict copy';

/* Each pattern is anchored at both ends and takes the extension last, so the
   words must be the tool's own, in the tool's place in the name, and the name
   must have an extension, as every chapter has. The first group is what comes
   before the tool's words, the second the extension. */

/**
 * `<name>.sync-conflict-<YYYYMMDD>-<HHMMSS>[-<device>]<.ext>` (Syncthing's
 * `conflictName`). The device is a short ID, seven letters and digits, or `0`.
 */
const SYNCTHING = /^(.+)\.sync-conflict-\d{8}-\d{6}(?:-[A-Z0-9]{1,7})?(\.[^.\s]+)$/;

/**
 * `<name> (<who>'s conflicted copy <YYYY-MM-DD>[ (<n>)])<.ext>`; Dropbox writes
 * a straight apostrophe. The name takes as much as it can, so brackets in the
 * chapter's own name stay in it: `Chapter 1 (draft) (Jane Doe's ...)`.
 */
const DROPBOX = /^(.*\S) \(.+['’]s conflicted copy \d{4}-\d{2}-\d{2}(?: \(\d+\))?\)(\.[^.\s]+)$/i;

/** `<name> (Conflicted copy <device> <YYYYMMDDHHMM>)<.ext>` (Obsidian Help, Sync, Troubleshoot). */
const OBSIDIAN_SYNC = /^(.*\S) \(Conflicted copy \S(?:.*\S)? \d{12}\)(\.[^.\s]+)$/i;

/**
 * The tool that made `fileName` as a conflict copy, and the file it copied,
 * or null for any other name. `fileName` is a file's own name; a path is cut
 * to its last segment. A copy of a copy is named by the tool whose words come
 * last, the copy it is.
 */
export function conflictCopyOf(fileName: string): ConflictCopy | null {
  const name = lastSegment(fileName);
  const patterns: [SyncTool, RegExp][] = [
    ['Syncthing', SYNCTHING],
    ['Dropbox', DROPBOX],
    ['Obsidian Sync', OBSIDIAN_SYNC]
  ];
  for (const [tool, pattern] of patterns) {
    const match = pattern.exec(name);
    if (match) return { tool, original: `${match[1] ?? ''}${match[2] ?? ''}` };
  }
  return null;
}

/**
 * The badge's tooltip for a conflict copy, which says which tool made it,
 * from which chapter, and what to do; null when `fileName` is not one.
 */
export function conflictCopyLabel(fileName: string): string | null {
  const copy = conflictCopyOf(fileName);
  if (!copy) return null;
  return `${copy.tool} made this copy of ${copy.original} when the file was changed in two places at once. Compare the two and keep the words you want. ${APP_NAME} does not hide or delete either.`;
}

/* ------------------------------------------------------------------ */
/* Merge markers                                                       */
/* ------------------------------------------------------------------ */

/**
 * A line that starts with seven `<` or seven `>` and a space: where git, or a
 * tool that merges like it, opens and closes a passage it could not merge
 * (`<<<<<<< HEAD`, `>>>>>>> origin/main`). The `=======` between the two
 * versions is left out, since a line of equals signs under a line of prose is
 * a Markdown heading.
 */
const MERGE_MARKER = /^(?:<{7}|>{7}) /m;

/** Whether `text` holds a merge marker line. Lines end in LF or CRLF. */
export function hasMergeMarkers(text: string): boolean {
  return MERGE_MARKER.test(text);
}

/** The key of the merge markers card: one card at a time, replaced by the next. */
export const MERGE_MARKERS_CARD = 'merge-markers';

/**
 * The warning card for a chapter with merge markers. `chapter` is its path or
 * file name; the card names the file.
 */
export function mergeMarkersText(chapter: string): string {
  return `${lastSegment(chapter)} has merge markers: lines that start with <<<<<<< or >>>>>>>. Git or a sync tool leaves them where two versions of the file disagreed, with both versions between them. Keep the words you want and remove the markers in Obsidian before you review or save this chapter. ${APP_NAME} has not changed the file.`;
}

/**
 * What the merge markers card does when the chapter's text is read: `before`
 * is the text on screen until now, null when the chapter has just opened, and
 * `after` the text read. Opening a chapter with markers shows the card, and
 * one without closes a card left from another chapter. Reading the open
 * chapter again (a reload from disk, a review opened from History, Save to
 * chapter finding the file changed) shows it when markers have just appeared,
 * as when a pull in Obsidian Git left them, and closes it once they are gone;
 * markers still there leave the card as the author left it, so a card closed
 * with its X does not come back at every save in Obsidian.
 */
export function mergeMarkersCard(before: string | null, after: string): 'show' | 'close' | 'keep' {
  if (!hasMergeMarkers(after)) return 'close';
  if (before === null || !hasMergeMarkers(before)) return 'show';
  return 'keep';
}

function lastSegment(value: string): string {
  const segments = value.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}
