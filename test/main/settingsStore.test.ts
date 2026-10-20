import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import { assertGuidelinesFile } from '../../src/main/guidelines';
import { SETTINGS_FILE, createSettingsStore } from '../../src/main/settingsStore';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

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

/* hardening.8 review: the normaliser drops a folder or guidelines file it
   cannot use from a settings.json read from disk, but a save that names one is
   refused, and what was chosen before stays. */
describe('a save naming a folder or guidelines file the app cannot use', () => {
  const NUL = '\u0000';
  const HOUSE = 'C:\\Vault\\Style\\house.md';
  const STORED = `${JSON.stringify(
    {
      manuscriptFolder: 'C:\\Novel',
      reviewsFolder: 'D:\\Reviews',
      guidelinesPath: HOUSE,
      onboardingDone: true
    },
    null,
    2
  )}\n`;

  /** A store over a settings.json naming a custom guidelines file, counting its reads and writes. */
  function custom(): {
    dir: string;
    store: ReturnType<typeof createSettingsStore>;
    reads: () => number;
    writes: () => number;
  } {
    const dir = scratch();
    writeFileSync(path.join(dir, SETTINGS_FILE), STORED);
    let reads = 0;
    let writes = 0;
    const store = createSettingsStore({
      dir,
      sleep: noWait,
      readFile: (file) => {
        reads += 1;
        return Promise.resolve(readFileSync(file, 'utf8'));
      },
      writeFile: (file, bytes) => {
        writes += 1;
        writeFileSync(file, bytes);
        return Promise.resolve();
      }
    });
    return { dir, store, reads: () => reads, writes: () => writes };
  }

  function assertionMessage(file: string): string {
    try {
      assertGuidelinesFile(file);
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error(`assertGuidelinesFile took ${file}`);
  }

  it('refuses a guidelines file that is not .md or .txt in the words opening it gives, keeping the one chosen before', async () => {
    const { dir, store, writes } = custom();
    expect((await store.load()).guidelinesPath).toBe(HOUSE);
    const docx = 'C:\\Novel\\rules.docx';
    await expect(store.save({ guidelinesPath: docx })).rejects.toMatchObject({
      code: 'invalid-input',
      message: assertionMessage(docx)
    });
    expect(assertionMessage(docx)).toContain('has to be a .md or .txt file');
    expect(writes()).toBe(0);
    expect(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).toBe(STORED);
    expect((await store.load()).guidelinesPath).toBe(HOUSE);
    store.reset();
    expect((await store.load()).guidelinesPath).toBe(HOUSE);
  });

  it('refuses before reading anything, and refuses the whole patch', async () => {
    const { dir, store, reads, writes } = custom();
    await expect(store.save({ zoom: 1.5, guidelinesPath: 'C:\\Novel\\style.pdf' })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    expect(reads()).toBe(0);
    expect(writes()).toBe(0);
    expect(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).toBe(STORED);
    expect((await store.load()).zoom).toBe(1);
  });

  it('refuses a folder that is not a full path, naming the setting and never the value', async () => {
    const cases: [Partial<Record<'manuscriptFolder' | 'reviewsFolder', unknown>>, string][] = [
      [{ manuscriptFolder: 'Novel' }, 'manuscript folder'],
      [{ manuscriptFolder: 42 }, 'manuscript folder'],
      [{ reviewsFolder: '.\\Hidden Reviews' }, 'reviews folder'],
      [{ reviewsFolder: '' }, 'reviews folder'],
      [{ reviewsFolder: `D:\\Hidden${NUL}Reviews` }, 'reviews folder']
    ];
    for (const [patch, name] of cases) {
      const { dir, store, writes } = custom();
      const err = await store.save(patch as Partial<Settings>).then(
        () => null,
        (e: unknown) => e as AppFailure
      );
      expect(err, JSON.stringify(patch)).toBeInstanceOf(AppFailure);
      expect(err?.code).toBe('invalid-input');
      expect(err?.message).toBe(
        `The ${name} has to be named by its full path, from a drive or a network share. Nothing was changed; choose it again in Settings.`
      );
      expect(err?.message).not.toContain('Hidden');
      expect(writes()).toBe(0);
      expect(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).toBe(STORED);
    }
  });

  it('refuses a guidelines file not named by its full path in words of its own', async () => {
    for (const file of ['GUIDELINES.md', '.\\Hidden.md', `C:\\Novel\\Hidden${NUL}.md`, 7]) {
      const { dir, store } = custom();
      await expect(
        store.save({ guidelinesPath: file } as Partial<Settings>),
        JSON.stringify(file)
      ).rejects.toMatchObject({
        code: 'invalid-input',
        message:
          'The guidelines file has to be a .md or .txt file named by its full path. Nothing was changed; choose another one in Settings.'
      });
      expect(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')).toBe(STORED);
    }
  });

  it('takes a full path, a .txt guidelines file and null, the usual folder or file', async () => {
    const { store } = custom();
    expect((await store.save({ guidelinesPath: 'C:\\Vault\\Style\\house.TXT' })).guidelinesPath).toBe(
      'C:\\Vault\\Style\\house.TXT'
    );
    expect((await store.save({ reviewsFolder: '\\\\srv\\share\\Reviews' })).reviewsFolder).toBe(
      '\\\\srv\\share\\Reviews'
    );
    const reset = await store.save({ reviewsFolder: null, guidelinesPath: null });
    expect(reset).toMatchObject({ manuscriptFolder: 'C:\\Novel', reviewsFolder: null, guidelinesPath: null });
  });

  it('still drops what a settings.json edited by hand names, and the next save writes null over it', async () => {
    const dir = scratch();
    writeFileSync(
      path.join(dir, SETTINGS_FILE),
      JSON.stringify({
        manuscriptFolder: 'C:\\Novel',
        reviewsFolder: 'Reviews',
        guidelinesPath: 'C:\\Novel\\style.pdf'
      })
    );
    const store = createSettingsStore({ dir, sleep: noWait });
    expect(await store.load()).toMatchObject({ reviewsFolder: null, guidelinesPath: null });
    await store.save({ zoom: 1.1 });
    const onDisk = JSON.parse(readFileSync(path.join(dir, SETTINGS_FILE), 'utf8')) as Record<string, unknown>;
    expect(onDisk).toMatchObject({
      manuscriptFolder: 'C:\\Novel',
      reviewsFolder: null,
      guidelinesPath: null
    });
  });
});
