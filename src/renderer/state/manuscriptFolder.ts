import type { Settings } from '../../shared/types';
import { useApp } from './store';

/*
 * Choose folder, in the chapter list and in the welcome guide's first step
 * (PLAN section 7, 6.5). Main refuses a manuscript folder that is, or holds,
 * the backups folder chosen (`manuscriptHoldsBackups`, setup.18), and says so
 * in a card. The card has a key of its own, so that it goes once what it says
 * is no longer so: a later choice that main takes, or a settings save, from
 * Settings or the guide's folder rows, that changes the manuscript folder or
 * the backups folder (the setup.18 review: under no key it stayed above the
 * step that showed the same folder as chosen). A save that changes neither,
 * such as the theme or the reviews folder, leaves it.
 *
 * It reaches main through `ManuscriptFolderIo`, which App fills, so this
 * module needs no DOM and is tested in node.
 */

/** Main's words for a refusal (an `ApiError` is an `Error` with them as its message), as client.ts gives them. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The key of the card that says why a manuscript folder was not taken. */
export const MANUSCRIPT_FOLDER_CARD = 'manuscript-folder';

export interface ManuscriptFolderIo {
  /** `dialog:pick-folder`: the folder chosen, or null when the picker was cancelled */
  pickFolder: () => Promise<string | null>;
  /** `settings:set`: writes the patch and answers with the settings as saved */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

/**
 * The folder picker, then the setting. Resolves with the settings as saved,
 * or null when nothing was saved: the picker cancelled, which leaves a card
 * that is up, or a refusal or failure, whose card replaces it.
 */
export async function chooseManuscriptFolder(io: ManuscriptFolderIo): Promise<Settings | null> {
  try {
    const folder = await io.pickFolder();
    if (!folder) return null;
    const saved = await io.setSettings({ manuscriptFolder: folder });
    useApp.getState().dismissNotificationsByKey(MANUSCRIPT_FOLDER_CARD);
    useApp.getState().setSettings(saved);
    return saved;
  } catch (err) {
    useApp.getState().notify('error', errorMessage(err), MANUSCRIPT_FOLDER_CARD);
    return null;
  }
}

/**
 * The settings as main saved them after a change in Settings or in the guide's
 * folder rows: into the store, withdrawing the card when the save changed the
 * manuscript folder or the backups folder, either of which can remove its cause.
 */
export function noteSavedSettings(next: Settings): void {
  const { settings, setSettings, dismissNotificationsByKey } = useApp.getState();
  if (
    settings?.manuscriptFolder !== next.manuscriptFolder ||
    settings?.backupsFolder !== next.backupsFolder
  ) {
    dismissNotificationsByKey(MANUSCRIPT_FOLDER_CARD);
  }
  setSettings(next);
}
