import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManuscriptWatcher, type ManuscriptWatcher } from '../../src/main/watcher';

/* files.5: the real chokidar against a real folder. Timing-dependent, so these
   run only with `npm run test:slow`, never in `npm test`. */

let root: string;
let watcher: ManuscriptWatcher;
let sent: [string, unknown][];

/** chokidar needs a moment after start before it sees changes. */
const ready = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-watch-'));
  sent = [];
  watcher = createManuscriptWatcher((channel, payload) => void sent.push([channel, payload]));
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
  });
});
