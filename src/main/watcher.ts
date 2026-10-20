import { watch as chokidarWatch, type ChokidarOptions } from 'chokidar';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loggableErrorFields } from '../shared/diagnostics/redact';
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
  /**
   * Watch this folder, or none. The folder already in hand changes nothing,
   * even when its start failed: Settings calls this, and only a list read
   * that works tries a failed start again (`ensure`, files.21).
   */
  start(folder: string | null): void;
  /**
   * The folder was just read: when it is the folder `start` was last given
   * and its start failed, start it again (files.21). Anything else changes
   * nothing, so a list read of another folder that ends after Settings
   * changed folder, or chose none, never moves the watcher (the files.21
   * review).
   */
  ensure(folder: string): void;
  /** true while a watcher on the folder is starting or running; false with none, or after its start failed */
  watching(): boolean;
  stop(): void;
  rememberHash(file: string, hash: string): void;
  forgetHash(file: string): void;
}

/**
 * Where the watcher is (files.21): `starting` until chokidar has read the
 * folder and says it is ready, then `running`; `failed` when the folder
 * itself could not be read before that, so nothing is watched.
 */
type WatchState = 'idle' | 'starting' | 'running' | 'failed';

/**
 * Watch the manuscript folder (PLAN 6.2, files.5). A change to a chapter is
 * reported as `file:changed` unless its bytes are ones this process wrote or
 * loaded; a chapter or folder appearing or disappearing refreshes the file
 * list, at most once per 300 ms. Only .md and .txt files count as chapters.
 * Obsidian saves on a debounce while the author types, so changes arrive
 * repeatedly; that is fine because rebase is idempotent.
 *
 * A folder another program holds when the watcher starts makes chokidar
 * report one error for the folder itself and never get ready, and it does
 * not try again once the folder is free. That watcher is closed, the page is
 * told (`files:watching-changed`), and the next list read of that folder
 * that works starts another (`ensure`, files.21). chokidar reports nothing
 * that happened before it was ready, so once it is, every file whose hash is
 * kept is read again, and one changed or gone while nothing watched is
 * reported as chokidar would have (`catchUp`, the files.21 review).
 */
export function createWatcher(deps: WatcherDeps): ManuscriptWatcher {
  let handle: WatchHandle | null = null;
  let watchedFolder: string | null = null;
  let state: WatchState = 'idle';
  /** what the page was last told; not watching to begin with, as `idle` is */
  let told = false;
  let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hashes this process is responsible for, by `pathKey`, each with the path
   * it was given, which `catchUp` reads and reports. A watcher event whose
   * hash is already in here is our own save echoing back, or the very file we
   * just loaded, and is dropped rather than shown to the author as an
   * external change.
   */
  const known = new Map<string, { file: string; hash: string }>();
  const keyOf = (file: string): string => pathKey(path.resolve(file), deps.ci);

  const watching = (): boolean => state === 'starting' || state === 'running';

  /** Tell the page whenever watching starts or stops, once per change (files.21). */
  function tell(): void {
    const now = watching();
    if (now === told) return;
    told = now;
    deps.broadcast('files:watching-changed', { watching: now });
  }

  function invalidate(folder: string): void {
    if (invalidateTimer) clearTimeout(invalidateTimer);
    invalidateTimer = setTimeout(() => {
      invalidateTimer = null;
      deps.broadcast('files:invalidated', { folder });
    }, INVALIDATE_DEBOUNCE_MS);
  }

  /** Report these bytes of `file` as a change, unless they are the ones kept for it. */
  function report(file: string, hash: string): void {
    const key = keyOf(file);
    if (known.get(key)?.hash === hash) return;
    known.set(key, { file, hash });
    deps.broadcast('file:changed', { path: file, hash, kind: 'change' });
  }

  /** A chapter deleted, renamed or moved: the page is told, and the list is read again. */
  function gone(file: string, folder: string): void {
    known.delete(keyOf(file));
    deps.broadcast('file:changed', { path: file, hash: '', kind: 'unlink' });
    invalidate(folder);
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
    report(file, hash);
  }

  /**
   * Once `watcher` is ready, read again every file whose hash is kept, and
   * report one whose bytes changed, or that is gone, while nothing watched it
   * (the files.21 review). chokidar starts with `ignoreInitial` and says
   * nothing of what happened before it was ready, so an edit made in Obsidian
   * to the open chapter while the folder refused the start would otherwise
   * never reach the page. Bytes that are the ones kept say nothing, and
   * nothing is reported once `watcher` has been closed or replaced.
   */
  async function catchUp(watcher: WatchHandle, folder: string): Promise<void> {
    await Promise.all(
      [...known.values()].map(async ({ file }) => {
        let hash: string;
        try {
          hash = hashBytes(await deps.readFile(file));
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (handle !== watcher) return;
          if (code === 'ENOENT' || code === 'ENOTDIR') gone(file, folder);
          else deps.log('debug', 'watcher.read-failed', { file, code });
          return;
        }
        if (handle === watcher) report(file, hash);
      })
    );
  }

  /** Close the chokidar watcher, if there is one, and drop its pending refresh. */
  function closeHandle(): void {
    if (handle) {
      const closing = handle;
      void closing.close().catch((err: unknown) => {
        deps.log('warn', 'watcher.close-failed', loggableErrorFields(err));
      });
    }
    if (invalidateTimer) clearTimeout(invalidateTimer);
    invalidateTimer = null;
    handle = null;
  }

  /** A new chokidar watcher on `folder`, in place of any other. */
  function begin(folder: string): void {
    closeHandle();
    watchedFolder = folder;
    state = 'starting';
    deps.log('info', 'watcher.start', { folder });
    const root = path.resolve(folder);
    const rootKey = keyOf(folder);
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

    // Whatever a watcher says once it has been closed or replaced is dropped.
    const on = (event: string, listener: (value: unknown) => void): void =>
      void watcher.on(event, (value: unknown) => {
        if (handle === watcher) listener(value);
      });
    const asPath = (value: unknown): string | null => (typeof value === 'string' ? value : null);
    on('ready', () => {
      state = 'running';
      deps.log('debug', 'watcher.ready', { folder });
      void catchUp(watcher, folder);
    });
    on('change', (value) => {
      const file = asPath(value);
      if (file && isChapterFile(file)) void changed(file);
    });
    on('add', (value) => {
      const file = asPath(value);
      if (!file || !isChapterFile(file)) return;
      invalidate(folder);
      // An editor that saves by replacing the file can look like a delete and
      // an add; if that file is the open chapter, this reloads it.
      void changed(file);
    });
    on('unlink', (value) => {
      const file = asPath(value);
      if (file && isChapterFile(file)) gone(file, folder);
    });
    on('addDir', () => invalidate(folder));
    on('unlinkDir', () => invalidate(folder));
    on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      // The folder itself refused before chokidar was ready: it watches
      // nothing and will not try again, so this start failed (files.21). An
      // error for a subfolder, or once it is running, is only logged.
      const failed = state === 'starting' && typeof e.path === 'string' && keyOf(e.path) === rootKey;
      // Through the error policy (hardening.3b): an errno error's code and syscall, never its path.
      deps.log('warn', 'watcher.error', {
        folder,
        ...loggableErrorFields(err),
        ...(failed ? { stopped: true } : {})
      });
      if (!failed) return;
      closeHandle();
      state = 'failed';
      tell();
    });
  }

  function start(folder: string | null): void {
    if (watchedFolder === folder) return;
    if (!folder) {
      stop();
      return;
    }
    known.clear();
    begin(folder);
    tell();
  }

  function ensure(folder: string): void {
    // Only the folder Settings holds is started again, and only once its
    // start has failed: a read of another folder may end after Settings
    // changed folder, or chose none (the files.21 review). The hashes of what
    // was loaded and saved meanwhile are kept, for `catchUp`.
    if (folder !== watchedFolder || watching()) return;
    begin(folder);
    tell();
  }

  function stop(): void {
    closeHandle();
    watchedFolder = null;
    state = 'idle';
    known.clear();
    tell();
  }

  return {
    start,
    ensure,
    watching,
    stop,
    rememberHash: (file, hash) => void known.set(keyOf(file), { file, hash }),
    forgetHash: (file) => void known.delete(keyOf(file))
  };
}

/**
 * Read the chapter list and, once that has worked, make sure the folder is
 * watched (files.21): the folder could be read just now, so a watcher whose
 * start it refused, as when another program held it at start-up, starts
 * again. A read that fails starts nothing, and so does a read of a folder
 * Settings no longer holds (`ensure`). `files:list` and `reviews:index` read
 * the list through this.
 */
export async function listAndWatch<T>(
  watcher: Pick<ManuscriptWatcher, 'ensure'>,
  folder: string,
  read: (folder: string) => Promise<T>
): Promise<T> {
  const list = await read(folder);
  watcher.ensure(folder);
  return list;
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
