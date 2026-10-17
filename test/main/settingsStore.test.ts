import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_FILE, createSettingsStore } from '../../src/main/settingsStore';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

/* hardening.3a: the store never overwrites a settings.json it could not read. */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lapidary-settings-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const noWait = (): Promise<void> => Promise.resolve();
const at = (): Date => new Date(2026, 9, 14, 9, 5, 7);

function busy(): Error {
  return Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
}

describe('createSettingsStore', () => {
  it('starts from the defaults when there is no file, and writes one on save', async () => {
    const dir = scratch();
    const store = createSettingsStore({ dir, sleep: noWait });
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    await store.save({ zoom: 1.25 });
    const onDisk = JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')) as { zoom: number };
    expect(onDisk.zoom).toBe(1.25);
  });

  it('parses a file that starts with a byte order mark', async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, SETTINGS_FILE), `\uFEFF${JSON.stringify({ manuscriptFolder: 'C:/Novel' })}`);
    const settings = await createSettingsStore({ dir, sleep: noWait }).load();
    expect(settings.manuscriptFolder).toBe('C:/Novel');
  });

  it('sets a corrupt file aside, and the copy survives a later save', async () => {
    const dir = scratch();
    const corrupt = '{ "manuscriptFolder": "C:/Novel", oops';
    writeFileSync(path.join(dir, SETTINGS_FILE), corrupt);
    const events: string[] = [];
    const store = createSettingsStore({
      dir,
      sleep: noWait,
      now: at,
      logger: (_l, event) => events.push(event)
    });
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(events).toContain('settings.unreadable');
    await store.save({ zoom: 1.5 });
    const copy = `${SETTINGS_FILE}.corrupt-20261014090507`;
    expect(readdirSync(dir).sort()).toEqual([SETTINGS_FILE, copy].sort());
    expect(readFileSync(path.join(dir, copy), 'utf8')).toBe(corrupt);
  });

  it('never replaces an earlier corrupt copy', async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, SETTINGS_FILE), 'not json');
    writeFileSync(path.join(dir, `${SETTINGS_FILE}.corrupt-20261014090507`), 'older copy');
    await createSettingsStore({ dir, sleep: noWait, now: at }).load();
    expect(readFileSync(path.join(dir, `${SETTINGS_FILE}.corrupt-20261014090507`), 'utf8')).toBe(
      'older copy'
    );
    expect(readFileSync(path.join(dir, `${SETTINGS_FILE}.corrupt-20261014090507-2`), 'utf8')).toBe(
      'not json'
    );
  });

  it('refuses to save over a file that stays locked, leaving it unchanged', async () => {
    const dir = scratch();
    const original = JSON.stringify({ manuscriptFolder: 'C:/Novel', zoom: 2 });
    writeFileSync(path.join(dir, SETTINGS_FILE), original);
    let reads = 0;
    let waits = 0;
    const store = createSettingsStore({
      dir,
      readFile: () => {
        reads += 1;
        return Promise.reject(busy());
      },
      sleep: () => {
        waits += 1;
        return Promise.resolve();
      }
    });
    const loaded = await store.load();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(reads).toBe(2);
    expect(waits).toBe(1);
    await expect(store.save({ zoom: 1 })).rejects.toMatchObject({ code: 'io' });
    expect(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).toBe(original);
  });

  it('recovers once the lock goes away, keeping what the file said', async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ manuscriptFolder: 'C:/Novel' }));
    let locked = true;
    const store = createSettingsStore({
      dir,
      readFile: (file) => (locked ? Promise.reject(busy()) : Promise.resolve(readFileSync(file, 'utf8'))),
      sleep: noWait
    });
    expect((await store.load()).manuscriptFolder).toBeNull();
    locked = false;
    const saved = await store.save({ zoom: 1.1 });
    expect(saved.manuscriptFolder).toBe('C:/Novel');
    expect(saved.zoom).toBe(1.1);
  });

  it('caches what it read until reset', async () => {
    const dir = scratch();
    writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ zoom: 1.25 }));
    let reads = 0;
    const store = createSettingsStore({
      dir,
      readFile: (file) => {
        reads += 1;
        return Promise.resolve(readFileSync(file, 'utf8'));
      },
      sleep: noWait
    });
    await store.load();
    await store.load();
    expect(reads).toBe(1);
    store.reset();
    await store.load();
    expect(reads).toBe(2);
  });
});
