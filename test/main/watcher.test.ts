import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALIDATE_DEBOUNCE_MS,
  createWatcher,
  type WatchHandle,
  type WatcherDeps
} from '../../src/main/watcher';
import { hashBytes } from '../../src/main/files';

/* files.5: the manuscript watcher, driven by a stand-in for chokidar. */

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
let logged: [string, string][];
let files: Map<string, string>;

function make(overrides: Partial<WatcherDeps> = {}) {
  return createWatcher({
    watch: () => (fake = new FakeChokidar()),
    broadcast: (channel, payload) => void sent.push([channel, payload]),
    readFile: (file) => {
      const text = files.get(file);
      return text === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(Buffer.from(text));
    },
    log: (level, event) => void logged.push([level, event]),
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
  logged = [];
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
      ['warn', 'watcher.error'],
      ['debug', 'watcher.read-failed']
    ]);
    expect(sent).toEqual([]);
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
