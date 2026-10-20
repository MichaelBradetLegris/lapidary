import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALIDATE_DEBOUNCE_MS,
  createWatcher,
  listAndWatch,
  type WatchHandle,
  type WatcherDeps
} from '../../src/main/watcher';
import { hashBytes } from '../../src/main/files';

/* files.5: the manuscript watcher, driven by a stand-in for chokidar.
   files.21: how it starts, fails and starts again, with the same stand-in;
   the real chokidar on a folder held from the test is in
   test/slow/watcher.slow.test.ts. */

class FakeChokidar implements WatchHandle {
  readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  closed = false;

  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

let fake: FakeChokidar;
let sent: [string, unknown][];
/** what the page was told about watching (`files:watching-changed`), kept apart from `sent` */
let told: boolean[];
let logged: [string, string][];
let logFields: Readonly<Record<string, unknown>>[];
let files: Map<string, string>;

function make(overrides: Partial<WatcherDeps> = {}) {
  return createWatcher({
    watch: () => (fake = new FakeChokidar()),
    broadcast: (channel, payload) => {
      if (channel === 'files:watching-changed') told.push((payload as { watching: boolean }).watching);
      else sent.push([channel, payload]);
    },
    readFile: (file) => {
      const text = files.get(file);
      return text === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(Buffer.from(text));
    },
    log: (level, event, fields = {}) => {
      logged.push([level, event]);
      logFields.push(fields);
    },
    ci: true,
    ...overrides
  });
}

/** Let the watcher's reads settle. */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  told = [];
  logged = [];
  logFields = [];
  files = new Map();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the manuscript watcher', () => {
  it('reports a change to a .md or .txt chapter, and nothing for other files', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    files.set('C:/Novel/Ch 1.md', 'one');
    files.set('C:/Novel/Ch 2.txt', 'two');
    files.set('C:/Novel/cover.png', 'png');
    fake.emit('change', 'C:/Novel/Ch 1.md');
    fake.emit('change', 'C:/Novel/Ch 2.txt');
    fake.emit('change', 'C:/Novel/cover.png');
    await settle();
    expect(sent).toEqual([
      ['file:changed', { path: 'C:/Novel/Ch 1.md', hash: hashBytes(Buffer.from('one')), kind: 'change' }],
      ['file:changed', { path: 'C:/Novel/Ch 2.txt', hash: hashBytes(Buffer.from('two')), kind: 'change' }]
    ]);
  });

  it('stays quiet about bytes it wrote or loaded itself, whatever the path s case', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    files.set('C:/Novel/Ch 1.md', 'saved');
    watcher.rememberHash('c:/novel/ch 1.md', hashBytes(Buffer.from('saved')));
    fake.emit('change', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent).toEqual([]);

    watcher.forgetHash('C:/Novel/Ch 1.md');
    fake.emit('change', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('reports a deleted chapter and refreshes the list once', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('unlink', 'C:/Novel/Ch 2.txt');
    fake.emit('unlink', 'C:/Novel/notes.json');
    expect(sent).toEqual([['file:changed', { path: 'C:/Novel/Ch 2.txt', hash: '', kind: 'unlink' }]]);
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS);
    expect(sent.slice(1)).toEqual([['files:invalidated', { folder: 'C:/Novel' }]]);
  });

  it('refreshes the list once for a burst of new chapters and folders, 300 ms after the last', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    for (let i = 0; i < 5; i += 1) {
      fake.emit('add', `C:/Novel/Part 2/Ch ${i}.md`);
      await vi.advanceTimersByTimeAsync(100);
    }
    fake.emit('addDir', 'C:/Novel/Part 3');
    fake.emit('add', 'C:/Novel/image.png');
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS - 1);
    expect(sent.filter(([channel]) => channel === 'files:invalidated')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.filter(([channel]) => channel === 'files:invalidated')).toEqual([
      ['files:invalidated', { folder: 'C:/Novel' }]
    ]);
  });

  it('ignores a new file that is not a chapter', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('add', 'C:/Novel/reviews/x.review.json');
    fake.emit('add', 'C:/Novel/image.png');
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS * 2);
    expect(sent).toEqual([]);
  });

  it('reloads the open chapter when an editor saves it by replacing the file', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    files.set('C:/Novel/Ch 1.md', 'before');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('before')));
    fake.emit('unlink', 'C:/Novel/Ch 1.md');
    files.set('C:/Novel/Ch 1.md', 'after');
    fake.emit('add', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent.map(([, payload]) => (payload as { kind?: string }).kind)).toEqual(['unlink', 'change']);
  });

  it('logs watcher errors and unreadable files instead of dropping them silently', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('error', Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' }));
    fake.emit('change', 'C:/Novel/locked.md');
    await settle();
    expect(logged).toEqual([
      ['info', 'watcher.start'],
      ['warn', 'watcher.error'],
      ['debug', 'watcher.read-failed']
    ]);
    expect(sent).toEqual([]);
    // An error that names no path is not the folder refusing: still watching (files.21).
    expect(watcher.watching()).toBe(true);
  });

  it('ignores dot folders and node_modules, but not a manuscript folder whose own name starts with a dot', () => {
    let ignored: ((target: string) => boolean) | undefined;
    const watcher = make({
      watch: (_folder, options) => {
        ignored = options.ignored as (target: string) => boolean;
        return (fake = new FakeChokidar());
      }
    });
    watcher.start('C:/.novel');
    expect(ignored?.('C:/.novel')).toBe(false);
    expect(ignored?.('C:/.novel/.obsidian')).toBe(true);
    expect(ignored?.('C:/.novel/node_modules')).toBe(true);
    expect(ignored?.('C:/.novel/Part 1/Ch 1.md')).toBe(false);
  });

  it('restarts on a new folder, closes the old watcher and forgets pending work', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    const first = fake;
    first.emit('add', 'C:/Novel/Ch 9.md');
    watcher.start('C:/Novel');
    expect(fake).toBe(first);
    watcher.start('D:/Other');
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS * 2);
    expect(sent.filter(([channel]) => channel === 'files:invalidated')).toEqual([]);
    watcher.stop();
    expect(fake.closed).toBe(true);
  });
});

/** An error as Node gives one for a folder another program holds. */
const busy = (target: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`EBUSY: resource busy or locked, scandir '${target}'`), {
    code: 'EBUSY',
    syscall: 'scandir',
    path: target
  });

describe('starting once the folder can be read (files.21)', () => {
  it('fails when the folder itself refuses before chokidar is ready: closed, logged once, the page told', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    const first = fake;
    expect(watcher.watching()).toBe(true);
    expect(told).toEqual([true]);
    // chokidar names the folder as Windows spells it; case and separators do not matter.
    first.emit('error', busy('c:\\novel'));
    expect(watcher.watching()).toBe(false);
    expect(first.closed).toBe(true);
    expect(told).toEqual([true, false]);
    expect(logged).toEqual([
      ['info', 'watcher.start'],
      ['warn', 'watcher.error']
    ]);
    expect(logFields[1]).toEqual({
      folder: 'C:/Novel',
      code: 'EBUSY',
      message: "EBUSY: resource busy or locked, scandir 'c:\\novel'",
      stopped: true
    });
    // Whatever the closed watcher says after that is dropped.
    files.set('C:/Novel/Ch 1.md', 'one');
    first.emit('error', busy('C:/Novel'));
    first.emit('ready');
    first.emit('change', 'C:/Novel/Ch 1.md');
    first.emit('add', 'C:/Novel/Ch 2.md');
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS * 2);
    expect(logged).toHaveLength(2);
    expect(sent).toEqual([]);
    expect(watcher.watching()).toBe(false);
  });

  it('is not tried again by Settings, only by a list read that works, and then reports changes', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    const first = fake;
    first.emit('error', busy('C:/Novel'));
    // settings:get and settings:set start the folder they hold: nothing new.
    watcher.start('C:/Novel');
    expect(fake).toBe(first);
    expect(watcher.watching()).toBe(false);
    // Try again: the list was read, so the folder can be.
    watcher.ensure('C:/Novel');
    expect(fake).not.toBe(first);
    expect(watcher.watching()).toBe(true);
    expect(told).toEqual([true, false, true]);
    expect(logged.map(([, event]) => event)).toEqual(['watcher.start', 'watcher.error', 'watcher.start']);
    fake.emit('ready');
    files.set('C:/Novel/Ch 1.md', 'from Obsidian');
    fake.emit('change', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent).toEqual([
      [
        'file:changed',
        { path: 'C:/Novel/Ch 1.md', hash: hashBytes(Buffer.from('from Obsidian')), kind: 'change' }
      ]
    ]);
  });

  it('changes nothing when the list is read while a watcher is starting or running', () => {
    const watcher = make();
    watcher.start('C:/Novel');
    const first = fake;
    watcher.ensure('C:/Novel');
    first.emit('ready');
    watcher.ensure('C:/Novel');
    expect(fake).toBe(first);
    expect(first.closed).toBe(false);
    expect(told).toEqual([true]);
    expect(logged).toEqual([
      ['info', 'watcher.start'],
      ['debug', 'watcher.ready']
    ]);
  });

  it('only fails for the folder itself, and only before chokidar is ready', () => {
    const watcher = make();
    watcher.start('C:/Novel');
    const first = fake;
    // A subfolder another program holds is skipped, as the list skips it.
    first.emit('error', busy('C:/Novel/Part 2'));
    // An error that names no path.
    first.emit('error', Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' }));
    expect(watcher.watching()).toBe(true);
    first.emit('ready');
    // Once running, the folder refusing a later read leaves chokidar's watch in place.
    first.emit('error', busy('C:/Novel'));
    expect(watcher.watching()).toBe(true);
    expect(first.closed).toBe(false);
    expect(told).toEqual([true]);
    expect(logFields.filter((fields) => 'stopped' in fields)).toEqual([]);
    expect(logged.filter(([, event]) => event === 'watcher.error')).toHaveLength(3);
  });

  it('keeps the hashes of what was loaded meanwhile when the same folder starts again', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('error', busy('C:/Novel'));
    // The chapter was opened while nothing watched the folder.
    files.set('C:/Novel/Ch 1.md', 'loaded');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('loaded')));
    watcher.ensure('C:/Novel');
    fake.emit('change', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent).toEqual([]);
  });

  it('never moves to another folder, so a list read that ends after Settings changed folder changes nothing', async () => {
    const folders: string[] = [];
    const watcher = make({
      watch: (folder) => {
        folders.push(folder);
        return (fake = new FakeChokidar());
      }
    });
    watcher.start('C:/Old');
    // The old folder's read is still going when Settings chooses another.
    let finishOld: (list: string[]) => void = () => undefined;
    const old = listAndWatch(
      watcher,
      'C:/Old',
      () => new Promise<string[]>((resolve) => (finishOld = resolve))
    );
    watcher.start('D:/New');
    const current = fake;
    await listAndWatch(watcher, 'D:/New', () => Promise.resolve(['D:/New/Ch 1.md']));
    finishOld(['C:/Old/Ch 1.md']);
    await old;
    expect(folders).toEqual(['C:/Old', 'D:/New']);
    expect(fake).toBe(current);
    expect(current.closed).toBe(false);
    expect(watcher.watching()).toBe(true);
    expect(told).toEqual([true]);
    // The new folder is still the one watched.
    files.set('D:/New/Ch 1.md', 'from Obsidian');
    current.emit('change', 'D:/New/Ch 1.md');
    await settle();
    expect(sent).toHaveLength(1);

    // Nor when the new folder's own start failed: that read is not of it.
    current.emit('error', busy('D:/New'));
    watcher.ensure('C:/Old');
    expect(folders).toEqual(['C:/Old', 'D:/New']);
    expect(watcher.watching()).toBe(false);
    // Nor after Settings chose no folder.
    watcher.start(null);
    watcher.ensure('D:/New');
    expect(folders).toEqual(['C:/Old', 'D:/New']);
    expect(watcher.watching()).toBe(false);
    expect(told).toEqual([true, false]);
  });

  it('reports, once ready, a change made while nothing watched to a chapter it loaded', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('error', busy('C:/Novel'));
    // The chapter was opened while nothing watched the folder, then edited in Obsidian.
    files.set('C:/Novel/Ch 1.md', 'loaded');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('loaded')));
    files.set('C:/Novel/Ch 1.md', 'edited in Obsidian');
    watcher.ensure('C:/Novel');
    await settle();
    // chokidar is not ready yet: nothing has been read again.
    expect(sent).toEqual([]);
    fake.emit('ready');
    await settle();
    // Reported once, under the path the app gave, as a change chokidar saw would be.
    const report: [string, unknown] = [
      'file:changed',
      { path: 'C:/Novel/Ch 1.md', hash: hashBytes(Buffer.from('edited in Obsidian')), kind: 'change' }
    ];
    expect(sent).toEqual([report]);
    // chokidar seeing the same bytes after that says nothing more.
    fake.emit('change', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent).toEqual([report]);
  });

  it('reports nothing once ready for a chapter whose bytes are the ones it loaded', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('error', busy('C:/Novel'));
    files.set('C:/Novel/Ch 1.md', 'loaded');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('loaded')));
    watcher.ensure('C:/Novel');
    fake.emit('ready');
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS * 2);
    expect(sent).toEqual([]);
    expect(logged.map(([, event]) => event)).toEqual([
      'watcher.start',
      'watcher.error',
      'watcher.start',
      'watcher.ready'
    ]);
  });

  it('reports, once ready, a chapter it loaded that was deleted while nothing watched', async () => {
    const watcher = make();
    watcher.start('C:/Novel');
    fake.emit('error', busy('C:/Novel'));
    files.set('C:/Novel/Ch 1.md', 'loaded');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('loaded')));
    files.delete('C:/Novel/Ch 1.md');
    watcher.ensure('C:/Novel');
    fake.emit('ready');
    await settle();
    expect(sent).toEqual([['file:changed', { path: 'C:/Novel/Ch 1.md', hash: '', kind: 'unlink' }]]);
    await vi.advanceTimersByTimeAsync(INVALIDATE_DEBOUNCE_MS);
    expect(sent.slice(1)).toEqual([['files:invalidated', { folder: 'C:/Novel' }]]);
    // Forgotten: the file coming back is a change.
    files.set('C:/Novel/Ch 1.md', 'loaded');
    fake.emit('add', 'C:/Novel/Ch 1.md');
    await settle();
    expect(sent.slice(2)).toEqual([
      ['file:changed', { path: 'C:/Novel/Ch 1.md', hash: hashBytes(Buffer.from('loaded')), kind: 'change' }]
    ]);
  });

  it('reports nothing it read again once that watcher was replaced or stopped', async () => {
    let finishRead: () => void = () => undefined;
    const watcher = make({
      readFile: (file) =>
        new Promise((resolve) => {
          finishRead = () => resolve(Buffer.from(files.get(file) ?? ''));
        })
    });
    watcher.start('C:/Novel');
    fake.emit('error', busy('C:/Novel'));
    files.set('C:/Novel/Ch 1.md', 'edited in Obsidian');
    watcher.rememberHash('C:/Novel/Ch 1.md', hashBytes(Buffer.from('loaded')));
    watcher.ensure('C:/Novel');
    fake.emit('ready');
    watcher.stop();
    finishRead();
    await settle();
    expect(sent).toEqual([]);
  });

  it('tells the page when it stops, and says nothing when there was nothing to stop', () => {
    const watcher = make();
    watcher.start(null);
    watcher.stop();
    expect(told).toEqual([]);
    watcher.start('C:/Novel');
    watcher.start(null);
    expect(watcher.watching()).toBe(false);
    expect(told).toEqual([true, false]);
  });
});

describe('the list read that starts the watcher (files.21)', () => {
  it('starts it once the read has worked, and not when the read fails', async () => {
    const ensure = vi.fn();
    const refused = busy('C:/Novel');
    await expect(listAndWatch({ ensure }, 'C:/Novel', () => Promise.reject(refused))).rejects.toBe(refused);
    expect(ensure).not.toHaveBeenCalled();
    const list = await listAndWatch({ ensure }, 'C:/Novel', (folder) => {
      expect(ensure).not.toHaveBeenCalled();
      return Promise.resolve([`${folder}/Ch 1.md`]);
    });
    expect(list).toEqual(['C:/Novel/Ch 1.md']);
    expect(ensure.mock.calls).toEqual([['C:/Novel']]);
  });

  it('is how main reads the list for files:list and reviews:index, and files:watching answers from the watcher', () => {
    const ipc = readFileSync(path.join(__dirname, '../../src/main/ipc.ts'), 'utf8');
    const current = ipc.slice(
      ipc.indexOf('async function currentChapters('),
      ipc.indexOf('function registerFileHandlers(')
    );
    expect(current).toMatch(
      /return listAndWatch\(watcher, settings\.manuscriptFolder, \(folder\) =>\s*listChapters\(folder, settings\.reviewsFolder,/
    );
    expect(ipc.match(/listChapters\(/g)).toHaveLength(1);
    expect(ipc).toContain("handle('files:list', currentChapters);");
    expect(ipc).toMatch(/reviewIndex\(\s*await reviewsFolder\(\),\s*\(await currentChapters\(\)\)/);
    expect(ipc).toContain(
      "handle('files:watching', () => Promise.resolve({ watching: watcher.watching() }));"
    );
    // Settings starts the folder it holds, as before, and never tries a failed start again.
    expect(ipc.match(/startWatching\(settings\.manuscriptFolder\);/g)).toHaveLength(2);
    expect(ipc).not.toMatch(/\.ensure\(/);
  });
});
