/**
 * What the app says about finding backups (apply.11, PLAN 6.5): the side
 * panel's Show backups, the save card's button of the same name, the Backups
 * row in Settings, and the card when a chapter has none yet. Main builds that
 * last card's text, so the words live here, where both sides can import them.
 *
 * Pure (CLAUDE.md rule 4).
 */

/** The side panel's button and the save card's, both of which open a chapter's backup folder. */
export const SHOW_BACKUPS = 'Show backups';

/** The side panel button's tooltip. */
export const SHOW_BACKUPS_TITLE =
  "Open the folder of this chapter's backups, with the newest selected: each is the version a Save to chapter replaced.";

/** The note under the Backups row in Settings, word for word from PLAN apply.11. */
export const BACKUPS_NOTE =
  'Before every Save to chapter, the version it replaces is copied here. The last 20 saves and the first save of each day for 30 days are kept. Backups stay on this computer.';

/**
 * The card when Show backups finds no folder for the chapter: it has not been
 * changed by a Save to chapter yet, so nothing has been copied.
 */
export function noBackupsYet(chapter: string): string {
  return `${chapter} has no backups yet. Save to chapter makes one each time it changes the file.`;
}
