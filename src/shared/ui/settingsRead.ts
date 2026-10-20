import { APP_NAME } from '../branding';

/**
 * The card shown in place of the whole page while settings.json cannot be
 * read (hardening.15, PLAN section 7 and C.86): main hands the page no
 * settings then, so it shows neither the welcome guide nor anything else
 * that would assume a first run, and writes nothing built from the defaults,
 * until Try again finds the file readable. Pure, so the tests read the words
 * the page shows.
 */

export const SETTINGS_UNREADABLE_TITLE = `${APP_NAME} could not read its settings`;

export const SETTINGS_UNREADABLE_LINES: readonly string[] = [
  'Another program may have settings.json open, such as a backup or sync tool, a virus scanner or an editor. Close it, then choose Try again.',
  `Until ${APP_NAME} can read the file it changes nothing in it, so your manuscript folder, your model and your other settings are kept as they are.`
];

export const SETTINGS_TRY_AGAIN = 'Try again';

/** The button while a Try again reads the file; it does nothing until the answer is in. */
export const SETTINGS_READING = 'Reading…';

/** Under the lines once a Try again has found the file still unreadable. */
export const SETTINGS_STILL_UNREADABLE = 'settings.json still could not be read.';

export interface SettingsUnreadableCard {
  title: string;
  lines: readonly string[];
  /** Try again's label */
  button: string;
  /** a line under the others, or null */
  status: string | null;
}

/**
 * What the card says: `trying` while a Try again is under way, `failedAgain`
 * once one has found the file still unreadable. The first read, as the page
 * loads, is never "still".
 */
export function settingsUnreadableCard(trying: boolean, failedAgain: boolean): SettingsUnreadableCard {
  return {
    title: SETTINGS_UNREADABLE_TITLE,
    lines: SETTINGS_UNREADABLE_LINES,
    button: trying ? SETTINGS_READING : SETTINGS_TRY_AGAIN,
    status: !trying && failedAgain ? SETTINGS_STILL_UNREADABLE : null
  };
}
