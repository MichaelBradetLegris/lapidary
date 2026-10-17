import { watch as chokidarWatch, type ChokidarOptions } from 'chokidar';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ApiEventMap, EventChannel } from '../shared/ipc';
import { pathKey } from '../shared/paths';
import { caseInsensitiveFs, hashBytes, isChapterFile } from './files';
import { log, type LogLevel } from './log';

/** Several files appearing at once (a folder pasted in, a sync) refresh the list once. */
export const INVALIDATE_DEBOUNCE_MS = 300;

/** The part of a chokidar watcher used here. */
export interface WatchHandle {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close(): Promise<void>;
}

export interface WatcherDeps {
  watch: (folder: string, options: ChokidarOptions) => WatchHandle;
  broadcast: <E extends EventChannel>(channel: E, payload: ApiEventMap[E]) => void;
  readFile: (file: string) => Promise<Buffer>;
  log: (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;
  ci: boolean;
}

export interface ManuscriptWatcher {
  start(folder: string | null): void;
  stop(): void;
  rememberHash(file: string, hash: string): void;
  forgetHash(file: string): void;
}

/**
 * Watch the manuscript folder (PLAN 6.2, files.5). A change to a chapter is
 * reported as `file:changed` unless its bytes are ones this process wrote or
 * loaded; a chapter or folder appearing or disappearing refreshes the file
 * list, at most once per 300 ms. Only .md and .txt files count as chapters.
 * Obsidian saves on a debounce while the author types, so changes arrive
 * repeatedly; that is fine because rebase is idempotent.
 */
export function createWatcher(deps: WatcherDeps): ManuscriptWatcher {
  let handle: WatchHandle | null = null;
  let watchedFolder: string | null = null;
  let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hashes this process is responsible for. A watcher event whose hash is
   * already in here is our own save echoing back, or the very file we just
   * loaded, and is dropped rather than shown to the author as an external change.
   */
  const known = new Map<string, string>();
  const keyOf = (file: string): string => pathKey(path.resolve(file), deps.ci);

  function invalidate(folder: string): void {
    if (invalidateTimer) clearTimeout(invalidateTimer);
    invalidateTimer = setTimeout(() => {
      invalidateTimer = null;
      deps.broadcast('files:invalidated', { folder });
    }, INVALIDATE_DEBOUNCE_MS);
  }

  async function changed(file: string): Promise<void> {
    let hash: string;
    try {
      hash = hashBytes(await deps.readFile(file));
    } catch (err) {
      // Locked or gone again already; the next event will say what happened.
      deps.log('debug', 'watcher.read-failed', { file, code: (err as NodeJS.ErrnoException).code });
      return;
    }
    const key = keyOf(file);
    if (known.get(key) === hash) return;
    known.set(key, hash);
    deps.broadcast('file:changed', { path: file, hash, kind: 'change' });
  }

  function start(folder: string | null): void {
    if (watchedFolder === folder) return;
    stop();
    if (!folder) return;

    watchedFolder = folder;
    const root = path.resolve(folder);
    const watcher = deps.watch(folder, {
      ignoreInitial: true,
      depth: 12,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: (target: string) => {
        if (path.resolve(target) === root) return false;
        const base = path.basename(target);
        return base.startsWith('.') || base === 'node_modules';
      }
    });
    handle = watcher;

    const asPath = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    watcher.on('change', (value) => {
      const file = asPath(value);
      if (file && isChapterFile(file)) void changed(file);
    });
    watcher.on('add', (value) => {
      const file = asPath(value);
      if (!file || !isChapterFile(file)) return;
      invalidate(folder);
      // An editor that saves by replacing the file can look like a delete and
      // an add; if that file is the open chapter, this reloads it.
      void changed(file);
    });
    watcher.on('unlink', (value) => {
      const file = asPath(value);
      if (!file || !isChapterFile(file)) return;
      known.delete(keyOf(file));
      deps.broadcast('file:changed', { path: file, hash: '', kind: 'unlink' });
      invalidate(folder);
    });
    watcher.on('addDir', () => invalidate(folder));
    watcher.on('unlinkDir', () => invalidate(folder));
    watcher.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      deps.log('warn', 'watcher.error', { folder, code: e.code, message: e.message });
    });
  }

  function stop(): void {
    if (handle) {
      const closing = handle;
      void closing.close().catch((err: unknown) => {
        deps.log('warn', 'watcher.close-failed', { message: (err as Error).message });
      });
    }
    if (invalidateTimer) clearTimeout(invalidateTimer);
    invalidateTimer = null;
    handle = null;
    watchedFolder = null;
    known.clear();
  }

  return {
    start,
    stop,
    rememberHash: (file, hash) => void known.set(keyOf(file), hash),
    forgetHash: (file) => void known.delete(keyOf(file))
  };
}

/** The real watcher: chokidar, the file system and the app log. ipc.ts supplies `broadcast`. */
export function createManuscriptWatcher(send: WatcherDeps['broadcast']): ManuscriptWatcher {
  return createWatcher({
    watch: (folder, options) => chokidarWatch(folder, options),
    broadcast: send,
    readFile: (file) => fs.readFile(file),
    log: (level, event, fields) => log(level, event, fields),
    ci: caseInsensitiveFs()
  });
}
