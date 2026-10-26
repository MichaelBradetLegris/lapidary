import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';
import { manuscriptHoldsBackups } from '../../src/shared/ui/backups';
import {
  chooseManuscriptFolder,
  MANUSCRIPT_FOLDER_CARD,
  noteSavedSettings,
  type ManuscriptFolderIo
} from '../../src/renderer/state/manuscriptFolder';
import { useApp } from '../../src/renderer/state/store';

/* setup.18 review: the guide's Choose folder raised main's refusal of a
   manuscript folder that holds the backups folder with no key, so nothing
   withdrew it. In the window the author moved the backups folder elsewhere
   and chose the same manuscript folder again: it was taken, step 1 ticked,
   and the card still said it could not be, above the step showing it as
   chosen. The wiring in App is checked in welcomeEntry.test.ts; the window
   check is in PLAN (setup.18). */

const MS = 'C:/vault';
const INSIDE = 'C:/vault/Backups';
const ELSEWHERE = 'D:/backups';

/**
 * A stand-in for the folder picker and main's settings store: the picker
 * answers each folder given in turn (null for a cancel), and a save is refused
 * as `refuseBackupsInManuscript` refuses it when the backups folder would be
 * the manuscript folder or inside it.
 */
function main(initial: Settings) {
  let disk = initial;
  const answers: (string | null)[] = [];
  const patches: Partial<Settings>[] = [];
  const io: ManuscriptFolderIo = {
    pickFolder: () => Promise.resolve(answers.shift() ?? null),
    setSettings: (patch) => {
      patches.push(patch);
      const next = normalizeSettings({ ...disk, ...patch });
      const ms = next.manuscriptFolder;
      const bk = next.backupsFolder;
      if (ms && bk && (bk === ms || bk.startsWith(`${ms}/`))) {
        // As client.ts's ApiError reaches the page: an Error with main's words.
        return Promise.reject(
          Object.assign(new Error(manuscriptHoldsBackups(ms, bk, bk === ms)), { code: 'invalid-input' })
        );
      }
      disk = next;
      return Promise.resolve(disk);
    }
  };
  return {
    io,
    patches,
    disk: () => disk,
    pick: (...folders: (string | null)[]) => answers.push(...folders),
    /** a save from Settings or a guide row, whose answer the page takes as App's applySavedSettings does */
    apply: async (patch: Partial<Settings>) => {
      noteSavedSettings(await io.setSettings(patch));
    }
  };
}

const state = () => useApp.getState();
const folderCards = () => state().notifications.filter((n) => n.key === MANUSCRIPT_FOLDER_CARD);

/** The first welcome guide, with the backups folder chosen inside the folder the author is about to choose. */
const fresh = (): Settings => normalizeSettings({ onboardingDone: false, backupsFolder: INSIDE });

beforeEach(() => {
  state().clearNotifications();
  useApp.setState({ settings: fresh() });
});

describe("Choose folder's card (setup.18 review)", () => {
  it('says why a folder holding the backups folder was not taken, and keeps the settings', async () => {
    const m = main(fresh());
    m.pick(MS);
    expect(await chooseManuscriptFolder(m.io)).toBeNull();
    expect(folderCards()).toHaveLength(1);
    expect(folderCards()[0]?.tone).toBe('error');
    expect(folderCards()[0]?.text).toBe(manuscriptHoldsBackups(MS, INSIDE, false));
    expect(state().settings?.manuscriptFolder).toBeNull();
    expect(m.disk().manuscriptFolder).toBeNull();
  });

  it('goes once the same folder is taken, after the backups folder moved elsewhere in a guide row', async () => {
    const m = main(fresh());
    m.pick(MS);
    await chooseManuscriptFolder(m.io);
    expect(folderCards()).toHaveLength(1);
    // The row's Change: neither folder is the manuscript folder yet, so the
    // save is the backups folder alone, and it withdraws the card already.
    await m.apply({ backupsFolder: ELSEWHERE });
    expect(folderCards()).toHaveLength(0);
    m.pick(MS);
    const saved = await chooseManuscriptFolder(m.io);
    expect(saved?.manuscriptFolder).toBe(MS);
    expect(state().settings?.manuscriptFolder).toBe(MS);
    expect(folderCards()).toHaveLength(0);
  });

  it('goes when a later choice is taken, whichever folder it is', async () => {
    const m = main(fresh());
    m.pick(MS, 'C:/other');
    await chooseManuscriptFolder(m.io);
    expect(folderCards()).toHaveLength(1);
    const saved = await chooseManuscriptFolder(m.io);
    expect(saved?.manuscriptFolder).toBe('C:/other');
    expect(folderCards()).toHaveLength(0);
    expect(m.patches).toEqual([{ manuscriptFolder: MS }, { manuscriptFolder: 'C:/other' }]);
  });

  it('stays through a cancelled picker, which writes nothing', async () => {
    const m = main(fresh());
    m.pick(MS, null);
    await chooseManuscriptFolder(m.io);
    expect(await chooseManuscriptFolder(m.io)).toBeNull();
    expect(folderCards()).toHaveLength(1);
    expect(m.patches).toEqual([{ manuscriptFolder: MS }]);
  });

  it('is replaced, not added to, by a second refusal', async () => {
    const m = main(fresh());
    m.pick(MS, MS);
    await chooseManuscriptFolder(m.io);
    await chooseManuscriptFolder(m.io);
    expect(folderCards()).toHaveLength(1);
  });

  it('stays through a save that changes neither folder, such as the theme or the reviews folder', async () => {
    const m = main(fresh());
    m.pick(MS);
    await chooseManuscriptFolder(m.io);
    await m.apply({ theme: 'dark' });
    await m.apply({ reviewsFolder: 'D:/reviews' });
    expect(folderCards()).toHaveLength(1);
    expect(state().settings?.theme).toBe('dark');
    expect(state().settings?.reviewsFolder).toBe('D:/reviews');
  });

  it("goes when Settings' Change chooses another manuscript folder", async () => {
    const m = main(fresh());
    m.pick(MS);
    await chooseManuscriptFolder(m.io);
    await m.apply({ manuscriptFolder: 'C:/other' });
    expect(folderCards()).toHaveLength(0);
    expect(state().settings?.manuscriptFolder).toBe('C:/other');
  });

  it('leaves the other cards alone', async () => {
    const m = main(fresh());
    state().notify('info', 'Saved to the chapter file.', 'save');
    m.pick(MS, 'C:/other');
    await chooseManuscriptFolder(m.io);
    await chooseManuscriptFolder(m.io);
    expect(state().notifications.map((n) => n.key)).toEqual(['save']);
  });

  it('says why when the picker itself fails', async () => {
    const io: ManuscriptFolderIo = {
      pickFolder: () => Promise.reject(new Error('The folder picker could not open.')),
      setSettings: () => Promise.reject(new Error('not reached'))
    };
    expect(await chooseManuscriptFolder(io)).toBeNull();
    expect(folderCards().map((n) => n.text)).toEqual(['The folder picker could not open.']);
  });
});
