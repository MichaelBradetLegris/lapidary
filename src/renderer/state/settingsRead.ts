import { create } from 'zustand';
import type { SettingsAnswer, SettingsReadFailure } from '../../shared/ipc';
import { useApp } from './store';

/*
 * The settings as the page gets them from main (hardening.15, PLAN C.86).
 *
 * While settings.json cannot be read, because another program holds it open
 * or it is not JSON and no copy of it can be made, `settings:get` answers
 * with no settings, `readFailed` and which of the two it is, for the card's
 * words (`settingsUnreadableCard`). The store then keeps no settings, so the
 * welcome guide, which shows only once settings are in, stays away; the Pro
 * preselection, a hint put away, the split and Show the welcome guide again
 * all write nothing without settings; and App shows the card that says the
 * file could not be read, with Try again, in place of everything else. Handed
 * the defaults instead, the page showed the welcome guide as on a first run,
 * and a list built from them, saved once the file could be read again, went
 * over the author's model and the hints they had put away.
 *
 * It reaches main through `SettingsReadIo`, which App fills with
 * `settings:get`, so this module needs no DOM and is tested in node.
 */

export interface SettingsReadIo {
  /** `settings:get` */
  getSettings: () => Promise<SettingsAnswer>;
}

export interface SettingsReadState {
  /**
   * why main said settings.json could not be read, at its latest answer, or
   * null before the first answer and once a read has worked
   */
  failed: SettingsReadFailure | null;
  /** a Try again is reading the file */
  trying: boolean;
  /** the last Try again found the file still unreadable */
  failedAgain: boolean;
}

export const useSettingsRead = create<SettingsReadState>(() => ({
  failed: null,
  trying: false,
  failedAgain: false
}));

/**
 * Ask main for the settings: as the page loads, and with `again` from the
 * card's Try again. Resolves true once the settings are in the store, false
 * when main could not read settings.json, which leaves the store's settings
 * as they are, none at either call. Rejects with the request's error, which
 * changes nothing here.
 */
export async function readSettings(io: SettingsReadIo, again = false): Promise<boolean> {
  if (again) useSettingsRead.setState({ trying: true });
  try {
    const answer = await io.getSettings();
    if (answer.readFailed) {
      useSettingsRead.setState({ failed: answer.reason, failedAgain: again });
      return false;
    }
    useApp.getState().setSettings(answer.settings);
    useSettingsRead.setState({ failed: null, failedAgain: false });
    return true;
  } finally {
    if (again) useSettingsRead.setState({ trying: false });
  }
}
