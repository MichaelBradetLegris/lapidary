/**
 * What the app says about finding backups (apply.11, PLAN 6.5): Show backups
 * in the toolbar's Actions menu (`polish.7`), the save card's button of the
 * same name, the Backups row in Settings, and the card when a chapter has none
 * yet. Main builds that last card's text, so the words live here, where both
 * sides can import them.
 *
 * Pure (CLAUDE.md rule 4).
 */

/** The Actions menu's item and the save card's button, both of which open a chapter's backup folder. */
export const SHOW_BACKUPS = 'Show backups';

/** The Actions menu item's tooltip. */
export const SHOW_BACKUPS_TITLE =
  "Open the folder of this chapter's backups, with the newest selected: each is the version a Save to chapter replaced.";

/**
 * The button on the no-backups card, which shows the backups root (every
 * chapter's folder), as Settings' Show in folder does.
 */
export const SHOW_ALL_BACKUPS = 'Show all backups';

/**
 * The key of the card Show backups raises when it cannot open a chapter's
 * folder. A Show backups that works, and a Save to chapter that makes or finds
 * a backup, close it, so it never stays on screen saying there are none once
 * there are.
 */
export const SHOW_BACKUPS_CARD = 'show-backups';

/** The note under the Backups row in Settings, word for word from PLAN apply.11. */
export const BACKUPS_NOTE =
  'Before every Save to chapter, the version it replaces is copied here. The last 20 saves and the first save of each day for 30 days are kept. Backups stay on this computer.';

/**
 * The card when Show backups finds no folder for the chapter. A chapter's
 * folder is worked out from its full path, so there is none either before a
 * Save to chapter first changes the file, or after the chapter, its folder or
 * the whole vault was renamed or moved: the backups made before that stay in
 * the folder of the old path, which the card's Show all backups reaches.
 */
export function noBackupsYet(chapter: string): string {
  return `No backups of ${chapter} at this path yet. Save to chapter makes one each time it changes the file. If the chapter or its folder was renamed or moved, its earlier backups are in another folder, named after its old file name.`;
}
