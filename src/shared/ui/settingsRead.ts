import { APP_NAME } from '../branding';
import type { SettingsReadFailure } from '../ipc';

/**
 * The card shown in place of the whole page while settings.json cannot be
 * read (hardening.15, PLAN section 7 and C.86): main hands the page no
 * settings then, so it shows neither the welcome guide nor anything else
 * that would assume a first run, and writes nothing built from the defaults,
 * until Try again finds the file readable. Main says why, as a fixed word
 * (`SettingsReadFailure`), and each reason has its own advice: a file another
 * program may hold, and one that is not JSON and could not be copied aside,
 * which no closing of programs will mend (the hardening.15 review). Pure, so
 * the tests read the words the page shows.
 */

export const SETTINGS_UNREADABLE_TITLE = `${APP_NAME} could not read its settings`;

/** `refused`: the read itself failed, as when another program holds the file open. */
export const SETTINGS_HELD_LINES: readonly string[] = [
  'Another program may have settings.json open, such as a backup or sync tool, a virus scanner or an editor. Close it, then choose Try again.',
  `Until ${APP_NAME} can read the file it changes nothing in it, so your manuscript folder, your model and your other settings are kept as they are.`
];

/** `no-copy`: settings.json is not JSON, and the copy kept before starting afresh could not be made. */
export const SETTINGS_DAMAGED_LINES: readonly string[] = [
  `settings.json is damaged: it is not valid JSON. ${APP_NAME} keeps a copy of such a file before it starts afresh, and no copy could be made, so it has left the file as it is.`,
  'Mend the file, or move it out of its folder to start afresh, then choose Try again. Show diagnostics says why the copy could not be made.'
];

export const SETTINGS_TRY_AGAIN = 'Try again';

/** The button while a Try again reads the file; it does nothing until the answer is in. */
export const SETTINGS_READING = 'Reading…';

/** Shows settings.json selected in its folder (`shell:reveal`, target `settings`). */
export const SETTINGS_SHOW_FILE = 'Show in folder';

/** Opens Diagnostics, whose warnings say why the read or the copy failed. */
export const SETTINGS_SHOW_DIAGNOSTICS = 'Show diagnostics';

/** Under the lines once a Try again has found the file still unreadable, for each reason. */
export const SETTINGS_STILL_UNREADABLE = 'settings.json still could not be read.';
export const SETTINGS_STILL_DAMAGED =
  'settings.json is still not valid JSON, and no copy of it could be made.';

export interface SettingsUnreadableCard {
  title: string;
  lines: readonly string[];
  /** Try again's label */
  button: string;
  /** a line under the others, or null */
  status: string | null;
}

/**
 * What the card says for `reason`: `trying` while a Try again is under way,
 * `failedAgain` once one has found the file still unreadable. The first
 * read, as the page loads, is never "still".
 */
export function settingsUnreadableCard(
  reason: SettingsReadFailure,
  trying: boolean,
  failedAgain: boolean
): SettingsUnreadableCard {
  const damaged = reason === 'no-copy';
  return {
    title: SETTINGS_UNREADABLE_TITLE,
    lines: damaged ? SETTINGS_DAMAGED_LINES : SETTINGS_HELD_LINES,
    button: trying ? SETTINGS_READING : SETTINGS_TRY_AGAIN,
    status: !trying && failedAgain ? (damaged ? SETTINGS_STILL_DAMAGED : SETTINGS_STILL_UNREADABLE) : null
  };
}
