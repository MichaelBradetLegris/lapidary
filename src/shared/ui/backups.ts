/**
 * What the app says about finding backups (apply.11, PLAN 6.5): Show backups
 * in the toolbar's Actions menu (`polish.7`), the save card's button of the
 * same name, the Backups row in Settings, and the card when a chapter has none
 * yet. Main builds that last card's text, so the words live here, where both
 * sides can import them. So do main's words for a backups folder it refuses,
 * one inside the manuscript folder (setup.18).
 *
 * Pure (CLAUDE.md rule 4).
 */

import { APP_NAME } from '../branding';

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

/**
 * The Backups row's tooltip in Settings: apply.11's note, with the
 * 20-and-30-days rule, and since the folder can be chosen (setup.18), where
 * backups go when none is, where it may not be, and that a change leaves the
 * backups made so far where they are. "Backups stay on this computer" held
 * only while the data folder was the one place.
 */
export const BACKUPS_NOTE = `Before every Save to chapter, the version it replaces is copied here. The last 20 saves and the first save of each day for 30 days are kept. With no folder chosen, backups stay in ${APP_NAME}'s data folder, on this computer. The folder cannot be the manuscript folder or inside it, and choosing another leaves the backups made so far where they are.`;

/**
 * The card when Show backups finds no folder for the chapter. A chapter's
 * folder is worked out from its full path, so there is none either before a
 * Save to chapter first changes the file, or after the chapter, its folder or
 * the whole vault was renamed or moved: the backups made before that stay in
 * the folder of the old path, which the card's Show all backups reaches. A
 * backups folder chosen anew in Settings starts empty too (setup.18).
 */
export function noBackupsYet(chapter: string): string {
  return `No backups of ${chapter} at this path yet. Save to chapter makes one each time it changes the file. If the chapter or its folder was renamed or moved, its earlier backups are in another folder, named after its old file name, and if another backups folder was chosen since, they are still in the one before.`;
}

/**
 * Show backups when the backups folder chosen in Settings is not there
 * (setup.18): its drive is not connected, or the folder was deleted or never
 * made, in which case the next Save to chapter makes it.
 */
export function backupsFolderMissing(folder: string): string {
  return `The backups folder, ${folder}, is not there. If it is on a network, USB or cloud drive, check that the drive is connected. Otherwise the next Save to chapter makes it again.`;
}

/** Why backups never go in the manuscript folder, in the words of each refusal below. */
const WHY_NOT_THERE = 'backups there would be listed as chapters, indexed by Obsidian and synced';

/**
 * Main's refusal of a backups folder that is the manuscript folder or inside
 * it (setup.18, CLAUDE.md rule 1), in Settings and in the welcome guide.
 */
export function backupsFolderInManuscript(manuscript: string): string {
  return `The backups folder cannot be the manuscript folder, ${manuscript}, or a folder inside it: ${WHY_NOT_THERE}. Nothing was changed; choose another folder.`;
}

/**
 * Main's refusal of a manuscript folder that is, or holds, the backups folder
 * chosen in Settings (setup.18): the same rule, met from the other side.
 */
export function manuscriptHoldsBackups(manuscript: string, backups: string, same: boolean): string {
  const where = same ? `is the backups folder` : `holds the backups folder, ${backups}`;
  return `The manuscript folder cannot be ${manuscript}, because it ${where}, and ${WHY_NOT_THERE}. Nothing was changed; choose another manuscript folder, or choose another backups folder first.`;
}
