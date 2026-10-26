import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '../shared/branding';
import type { SettingsAnswer, SettingsReadFailure } from '../shared/ipc';
import { hasNul, isAbsolutePath } from '../shared/paths';
import { droppedPathSetting, normalizeSettings, type PathSettingKey } from '../shared/settings';
import type { Settings } from '../shared/types';
import { atomicWriteFile } from './atomic';
import { assertBackupsFolderSetting } from './backups';
import { fail } from './errors';
import { caseInsensitiveFs } from './files';
import { assertGuidelinesFile } from './guidelines';
import type { LogLevel } from './log';

/**
 * settings.json on disk (PLAN 11.3 d). The file names the author's manuscript
 * folder, so losing it is a real cost, and the rules below make sure the app
 * never overwrites one it could not read:
 *
 * - missing (ENOENT): first run; the defaults are used and cached;
 * - unparseable JSON: the file is copied aside as
 *   `settings.json.corrupt-<yyyymmddhhmmss>` (never over an existing copy), the
 *   event is logged, and the defaults are cached. The next save writes a fresh
 *   file, and the copy survives for the author to look at. When no copy can be
 *   made, the file is treated as one that could not be read (below), so it is
 *   never written over with no copy kept (hardening.15);
 * - any other read error (a lock, a permission problem): one retry after 200 ms,
 *   then the defaults are used but NOT cached. A save then reads again and
 *   refuses to write if it still cannot, leaving the file as it was.
 *
 * `loadChecked` says when a read failed, and why: `refused` for a read error,
 * `no-copy` for unparseable JSON with no copy made. `settingsAnswer` turns
 * that into `settings:get`'s answer, which then hands the page no settings at
 * all, only that fixed reason, never the error: a
 * page holding the defaults would show the welcome guide and write lists
 * built from them, which a save then puts over the file once it can be read
 * (hardening.15, PLAN C.86).
 *
 * A folder or guidelines file the normaliser cannot use is dropped to null
 * when settings.json is read, but a save that names one is refused before
 * anything is read or written (`refuseDroppedPath`), so what was chosen
 * before stays (hardening.8 review). So is a save that names the backups
 * folder or the manuscript folder and would leave the backups folder the
 * manuscript folder or inside it (`refuseBackupsInManuscript`, setup.18).
 *
 * No electron import: the folder, the reads and the clock are passed in.
 */

export interface SettingsStoreDeps {
  /** the folder holding settings.json (userData) */
  dir: string;
  /** whether the file system ignores case when it compares paths; the platform's by default */
  ci?: boolean;
  logger?: (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
  readFile?: (file: string) => Promise<string>;
  writeFile?: (file: string, bytes: Buffer) => Promise<void>;
  copyFile?: (from: string, to: string, mode: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

/**
 * What a load found: the settings in use, the defaults, not cached, when
 * `readFailed`; and whether settings.json could not be read, with why: the
 * read was `refused`, or the file is not JSON and could not be copied aside
 * (`no-copy`). Either way a save would be refused.
 */
export type SettingsRead =
  | { settings: Settings; readFailed: false }
  | { settings: Settings; readFailed: true; reason: SettingsReadFailure };

export interface SettingsStore {
  load(): Promise<Settings>;
  /** as `load`, and says whether settings.json could be read (hardening.15) */
  loadChecked(): Promise<SettingsRead>;
  save(patch: Partial<Settings>): Promise<Settings>;
  /** forget the cached copy, so the next load reads the file */
  reset(): void;
}

export const SETTINGS_FILE = 'settings.json';

/** How many names a copy of a settings.json that is not JSON may try: the stamp, then `-2` to `-20`. */
const COPY_NAMES = 20;

type ReadOutcome =
  | { kind: 'ok'; settings: Settings }
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'unreadable'; code: string };

function errnoCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * `settings:get`'s answer for a load (hardening.15): the settings, or, when
 * settings.json could not be read, none, only the flag and its fixed reason,
 * never the error.
 */
export function settingsAnswer(read: SettingsRead): SettingsAnswer {
  return read.readFailed
    ? { readFailed: true, reason: read.reason, settings: null }
    : { readFailed: false, settings: read.settings };
}

/** How the refusal names each folder setting, as the Settings rows do. */
const FOLDER_NAMES: Record<Exclude<PathSettingKey, 'guidelinesPath'>, string> = {
  manuscriptFolder: 'manuscript folder',
  reviewsFolder: 'reviews folder',
  backupsFolder: 'backups folder'
};

/**
 * Throws an `invalid-input` failure when `patch` names a folder or guidelines
 * file that `normalizeSettings` would drop to null: a guidelines file that is
 * not .md or .txt in `assertGuidelinesFile`'s words, anything else as a
 * setting that has to be a full path. The words name the setting, never the
 * path. Null, the usual folder or file, is taken.
 */
function refuseDroppedPath(patch: Partial<Settings>): void {
  const key = droppedPathSetting(patch);
  if (key === null) return;
  if (key === 'guidelinesPath') {
    const file: unknown = patch.guidelinesPath;
    if (typeof file === 'string' && isAbsolutePath(file) && !hasNul(file)) assertGuidelinesFile(file);
    throw fail(
      'invalid-input',
      'The guidelines file has to be a .md or .txt file named by its full path. Nothing was changed; choose another one in Settings.'
    );
  }
  throw fail(
    'invalid-input',
    `The ${FOLDER_NAMES[key]} has to be named by its full path, from a drive or a network share. Nothing was changed; choose it again in Settings.`
  );
}

/**
 * Throws an `invalid-input` failure, in `assertBackupsFolderSetting`'s words,
 * when `patch` names a backups folder or a manuscript folder and `next`, the
 * settings it would leave, has the backups folder the manuscript folder or
 * inside it (setup.18, CLAUDE.md rule 1). A patch that names neither is not
 * looked at, so a settings.json edited by hand to break the rule never stops
 * the theme or a hint being saved; its Save to chapter refuses instead
 * (`assertOutside`). Null, the usual folder, never is refused.
 */
function refuseBackupsInManuscript(patch: Partial<Settings>, next: Settings, ci: boolean): void {
  const named = (key: 'backupsFolder' | 'manuscriptFolder'): boolean =>
    patch[key] !== undefined && patch[key] !== null;
  if (named('backupsFolder')) assertBackupsFolderSetting(next, 'backupsFolder', ci);
  else if (named('manuscriptFolder')) assertBackupsFolderSetting(next, 'manuscriptFolder', ci);
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const file = path.join(deps.dir, SETTINGS_FILE);
  const ci = deps.ci ?? caseInsensitiveFs();
  const logger = deps.logger ?? ((): void => undefined);
  const readFile = deps.readFile ?? ((f: string): Promise<string> => fs.readFile(f, 'utf8'));
  const writeFile = deps.writeFile ?? atomicWriteFile;
  const copyFile =
    deps.copyFile ?? ((from: string, to: string, mode: number): Promise<void> => fs.copyFile(from, to, mode));
  const sleep =
    deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? ((): Date => new Date());

  let cached: Settings | null = null;

  async function readOnce(): Promise<ReadOutcome> {
    let text: string;
    try {
      text = await readFile(file);
    } catch (err) {
      const code = errnoCode(err);
      return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', code };
    }
    try {
      // Tolerate a BOM: an editor or a PowerShell redirect may have added one.
      return { kind: 'ok', settings: normalizeSettings(JSON.parse(text.replace(/^\uFEFF/, ''))) };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  /** Read, retrying once after 200 ms when the file exists but cannot be read. */
  async function read(): Promise<ReadOutcome> {
    const first = await readOnce();
    if (first.kind !== 'unreadable') return first;
    await sleep(200);
    return readOnce();
  }

  /**
   * Copy a settings.json that is not JSON beside itself, under the first of
   * twenty names not taken. Answers whether a copy was made; when none could
   * be, because the copy failed or every name was taken, that is logged and
   * the file must not be written over (hardening.15).
   */
  async function setAside(): Promise<boolean> {
    const base = `${file}.corrupt-${stamp(now())}`;
    for (let n = 1; n <= COPY_NAMES; n += 1) {
      const target = n === 1 ? base : `${base}-${n}`;
      try {
        await copyFile(file, target, fsConstants.COPYFILE_EXCL);
        logger('warn', 'settings.unreadable', { kept: path.basename(target) });
        return true;
      } catch (err) {
        if (errnoCode(err) !== 'EEXIST') {
          logger('warn', 'settings.unreadable', { kept: 'none', code: errnoCode(err) });
          return false;
        }
      }
    }
    logger('warn', 'settings.unreadable', { kept: 'none', code: 'EEXIST', names: COPY_NAMES });
    return false;
  }

  async function loadChecked(): Promise<SettingsRead> {
    if (cached) return { settings: cached, readFailed: false };
    const outcome = await read();
    switch (outcome.kind) {
      case 'ok':
        cached = outcome.settings;
        return { settings: cached, readFailed: false };
      case 'missing':
        cached = normalizeSettings({});
        return { settings: cached, readFailed: false };
      case 'corrupt':
        // With no copy kept, as a read that failed: nothing cached, so the
        // next load tries again and a save is refused (hardening.15).
        if (!(await setAside()))
          return { settings: normalizeSettings({}), readFailed: true, reason: 'no-copy' };
        cached = normalizeSettings({});
        return { settings: cached, readFailed: false };
      case 'unreadable':
        logger('warn', 'settings.read-failed', { code: outcome.code });
        return { settings: normalizeSettings({}), readFailed: true, reason: 'refused' };
    }
  }

  async function save(patch: Partial<Settings>): Promise<Settings> {
    refuseDroppedPath(patch);
    let current = cached;
    if (!current) {
      // Either nothing has been read yet, or the last read failed. Read again,
      // and never write over a file this could not read.
      const outcome = await read();
      if (outcome.kind === 'unreadable') {
        logger('warn', 'settings.save-refused', { code: outcome.code });
        throw fail(
          'io',
          'Settings could not be saved, because settings.json could not be read and might be overwritten. Close any program that has it open and try again.'
        );
      }
      if (outcome.kind === 'corrupt' && !(await setAside())) {
        logger('warn', 'settings.save-refused', { kept: 'none' });
        throw fail(
          'io',
          `Settings could not be saved, because settings.json could not be read and no copy of it could be made, so saving would lose what it holds. ${APP_NAME}'s log says why the copy failed.`
        );
      }
      current = outcome.kind === 'ok' ? outcome.settings : normalizeSettings({});
    }
    const next = normalizeSettings({ ...current, ...patch });
    refuseBackupsInManuscript(patch, next, ci);
    await fs.mkdir(deps.dir, { recursive: true });
    await writeFile(file, Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'));
    cached = next;
    return next;
  }

  return {
    load: async () => (await loadChecked()).settings,
    loadChecked,
    save,
    reset: () => {
      cached = null;
    }
  };
}
