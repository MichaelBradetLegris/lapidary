import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeSettings } from '../shared/settings';
import type { Settings } from '../shared/types';
import { atomicWriteFile } from './atomic';
import { fail } from './errors';
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
 *   file, and the copy survives for the author to look at;
 * - any other read error (a lock, a permission problem): one retry after 200 ms,
 *   then the defaults are used but NOT cached. A save then reads again and
 *   refuses to write if it still cannot, leaving the file as it was.
 *
 * No electron import: the folder, the reads and the clock are passed in.
 */

export interface SettingsStoreDeps {
  /** the folder holding settings.json (userData) */
  dir: string;
  logger?: (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
  readFile?: (file: string) => Promise<string>;
  writeFile?: (file: string, bytes: Buffer) => Promise<void>;
  copyFile?: (from: string, to: string, mode: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(patch: Partial<Settings>): Promise<Settings>;
  /** forget the cached copy, so the next load reads the file */
  reset(): void;
}

export const SETTINGS_FILE = 'settings.json';

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

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const file = path.join(deps.dir, SETTINGS_FILE);
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

  async function setAside(): Promise<void> {
    const base = `${file}.corrupt-${stamp(now())}`;
    for (let n = 1; n <= 20; n += 1) {
      const target = n === 1 ? base : `${base}-${n}`;
      try {
        await copyFile(file, target, fsConstants.COPYFILE_EXCL);
        logger('warn', 'settings.unreadable', { kept: path.basename(target) });
        return;
      } catch (err) {
        if (errnoCode(err) !== 'EEXIST') {
          logger('warn', 'settings.unreadable', { kept: 'none', code: errnoCode(err) });
          return;
        }
      }
    }
  }

  async function load(): Promise<Settings> {
    if (cached) return cached;
    const outcome = await read();
    switch (outcome.kind) {
      case 'ok':
        cached = outcome.settings;
        return cached;
      case 'missing':
        cached = normalizeSettings({});
        return cached;
      case 'corrupt':
        await setAside();
        cached = normalizeSettings({});
        return cached;
      case 'unreadable':
        logger('warn', 'settings.read-failed', { code: outcome.code });
        return normalizeSettings({});
    }
  }

  async function save(patch: Partial<Settings>): Promise<Settings> {
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
      if (outcome.kind === 'corrupt') await setAside();
      current = outcome.kind === 'ok' ? outcome.settings : normalizeSettings({});
    }
    const next = normalizeSettings({ ...current, ...patch });
    await fs.mkdir(deps.dir, { recursive: true });
    await writeFile(file, Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'));
    cached = next;
    return next;
  }

  return {
    load,
    save,
    reset: () => {
      cached = null;
    }
  };
}
