import { closeSync, constants, openSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listChapters } from '../../src/main/files';
import { log } from '../../src/main/log';
import { createManuscriptWatcher, listAndWatch, type ManuscriptWatcher } from '../../src/main/watcher';

/* files.5: the real chokidar against a real folder. Timing-dependent, so these
   run only with `npm run test:slow`, never in `npm test`. files.21 adds a
   manuscript folder another program holds when the watcher starts. */

vi.mock('../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  log: vi.fn()
}));

let root: string;
let watcher: ManuscriptWatcher;
let sent: [string, unknown][];
/** what the page was told about watching (`files:watching-changed`), kept apart from `sent` */
let told: boolean[];

/** chokidar needs a moment after start before it sees changes. */
const ready = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-watch-'));
  sent = [];
  told = [];
  vi.mocked(log).mockClear();
  watcher = createManuscriptWatcher((channel, payload) => {
    if (channel === 'files:watching-changed') told.push((payload as { watching: boolean }).watching);
    else sent.push([channel, payload]);
  });
});

afterEach(async () => {
  watcher.stop();
  await fs.rm(root, { recursive: true, force: true });
});

const kinds = (file: string): string[] =>
  sent
    .filter(([channel, payload]) => channel === 'file:changed' && (payload as { path: string }).path === file)
    .map(([, payload]) => (payload as { kind: string }).kind);

const invalidations = (): number => sent.filter(([channel]) => channel === 'files:invalidated').length;

/** The watcher's lines in the app log, in order. */
const logged = (): string[] =>
  vi
    .mocked(log)
    .mock.calls.map(([, event]) => event)
    .filter((event) => event.startsWith('watcher.'));

describe('watching a real folder', () => {
  it('sees a .txt chapter edited outside the app', async () => {
    const file = path.join(root, 'Chapter 2.txt');
    await fs.writeFile(file, 'one\n');
    watcher.start(root);
    await ready();
    await fs.writeFile(file, 'two\n');
    await vi.waitFor(() => expect(kinds(file)).toContain('change'), { timeout: 5000, interval: 50 });
  });

  it('stays quiet about its own save', async () => {
    const file = path.join(root, 'Chapter 1.md');
    await fs.writeFile(file, 'one\n');
    watcher.start(root);
    await ready();
    const { createHash } = await import('node:crypto');
    watcher.rememberHash(file, createHash('sha256').update('two\n').digest('hex'));
    await fs.writeFile(file, 'two\n');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(kinds(file)).toEqual([]);
  });

  it('drops a deleted .txt chapter from the list and adds a new one', async () => {
    const file = path.join(root, 'Chapter 3.txt');
    await fs.writeFile(file, 'three\n');
    watcher.start(root);
    await ready();
    await fs.rm(file);
    await vi.waitFor(() => expect(kinds(file)).toEqual(['unlink']), { timeout: 5000, interval: 50 });
    await vi.waitFor(() => expect(invalidations()).toBe(1), { timeout: 5000, interval: 50 });
    await fs.writeFile(path.join(root, 'Chapter 4.md'), 'four\n');
    await vi.waitFor(() => expect(invalidations()).toBe(2), { timeout: 5000, interval: 50 });
  });

  it('ignores files that are not chapters', async () => {
    watcher.start(root);
    await ready();
    await fs.writeFile(path.join(root, 'cover.png'), 'png');
    await fs.mkdir(path.join(root, '.obsidian'));
    await fs.writeFile(path.join(root, '.obsidian', 'workspace.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(sent).toEqual([]);
    expect(told).toEqual([true]);
  });
});

/**
 * libuv's flag for opening with no sharing (`UV_FS_O_EXLOCK`, Windows only),
 * which Node does not name in `fs.constants`. A folder opened so refuses every
 * other open, as when a sync or antivirus tool holds it: Node's `readdir` of
 * it fails with EBUSY.
 */
const NO_SHARING = 0x10000000;

describe('a manuscript folder held when the watcher starts (files.21)', () => {
  it.runIf(process.platform === 'win32')(
    'starts watching once Try again reads the folder, and then sees a chapter written from outside',
    async () => {
      const file = path.join(root, 'Chapter 1.md');
      await fs.writeFile(file, 'one\n');
      const read = (folder: string) => listChapters(folder, null);

      const held = openSync(root, constants.O_RDONLY | NO_SHARING);
      try {
        // Start-up: settings:get starts the watcher, then the list is read.
        watcher.start(root);
        await expect(listAndWatch(watcher, root, read)).rejects.toThrow(
          /would not let Lapidary read the manuscript folder/
        );
        await vi.waitFor(() => expect(watcher.watching()).toBe(false), { timeout: 5000, interval: 50 });
        // Try again while the folder is still held: still not read, still not watching.
        await expect(listAndWatch(watcher, root, read)).rejects.toThrow(/would not let/);
        expect(watcher.watching()).toBe(false);
      } finally {
        closeSync(held);
      }

      // Released: Try again reads the folder, and that starts the watcher.
      const list = await listAndWatch(watcher, root, read);
      expect(list.map((chapter) => chapter.name)).toEqual(['Chapter 1.md']);
      expect(watcher.watching()).toBe(true);
      await vi.waitFor(() => expect(logged()).toContain('watcher.ready'), { timeout: 5000, interval: 50 });

      await fs.writeFile(file, 'two\n');
      await vi.waitFor(() => expect(kinds(file)).toEqual(['change']), { timeout: 5000, interval: 50 });

      // One error, for the folder itself, and then the start.
      expect(logged()).toEqual(['watcher.start', 'watcher.error', 'watcher.start', 'watcher.ready']);
      const error = vi.mocked(log).mock.calls.find(([, event]) => event === 'watcher.error');
      expect(error?.[0]).toBe('warn');
      expect(error?.[2]).toMatchObject({ folder: root, code: 'EBUSY', stopped: true });
      expect(told).toEqual([true, false, true]);
    }
  );
});
