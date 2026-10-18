import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFTS_DIRNAME,
  SET_ASIDE_DIRNAME,
  draftFileFor,
  draftsRootFor,
  loadDrafts,
  saveDrafts,
  setAsideDrafts,
  setAsideFile,
  setAsideFolderFor
} from '../../src/main/drafts';
import { AppFailure, explainReadError, explainWriteError } from '../../src/main/errors';
import { APP_NAME } from '../../src/shared/branding';
import type { StoredDraft } from '../../src/shared/ipc';
import { pathKey } from '../../src/shared/paths';
import { setAsideFailedCardText } from '../../src/shared/ui/drafts';

/* apply.16: the drafts file of a chapter, written whole and deleted when
   empty, the set-aside .txt files, and the names Show the text may open
   (PLAN 11.3 j). */

let root: string;
let draftsRoot: string;
let chapter: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-drafts-'));
  draftsRoot = draftsRootFor(path.join(root, 'userData'));
  chapter = path.join(root, 'vault', 'Chapter 01.md');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const box = (key: number, text = 'typed', initial = 'as it was'): StoredDraft => ({
  key,
  paragraphs: [key],
  initial,
  text
});

type Logged = [string, string, Readonly<Record<string, unknown>> | undefined];
function logger(): {
  lines: Logged[];
  log: (level: string, event: string, fields?: Readonly<Record<string, unknown>>) => void;
} {
  const lines: Logged[] = [];
  return { lines, log: (level, event, fields) => void lines.push([level, event, fields]) };
}

async function failure(promise: Promise<unknown>): Promise<AppFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppFailure) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('where drafts go', () => {
  it('is <userData>/drafts, with set-aside text in drafts/set-aside', () => {
    expect(DRAFTS_DIRNAME).toBe('drafts');
    expect(SET_ASIDE_DIRNAME).toBe('set-aside');
    expect(draftsRoot).toBe(path.join(root, 'userData', 'drafts'));
    expect(setAsideFolderFor(draftsRoot)).toBe(path.join(root, 'userData', 'drafts', 'set-aside'));
  });

  it('names a chapter file by the first 16 hex of the SHA-256 of its path key', () => {
    const file = draftFileFor(draftsRoot, chapter, true);
    const hash = createHash('sha256')
      .update(pathKey(path.resolve(chapter), true), 'utf8')
      .digest('hex');
    expect(file).toBe(path.join(draftsRoot, `${hash.slice(0, 16)}.json`));
    expect(path.basename(file)).toMatch(/^[0-9a-f]{16}\.json$/);
    // Case counts only where the file system says so.
    expect(draftFileFor(draftsRoot, chapter.toUpperCase(), true)).toBe(file);
    expect(draftFileFor(draftsRoot, chapter.toUpperCase(), false)).not.toBe(
      draftFileFor(draftsRoot, chapter, false)
    );
    expect(draftFileFor(draftsRoot, path.join(root, 'vault', 'Chapter 02.md'), true)).not.toBe(file);
  });
});

describe('saving and loading', () => {
  it('writes the boxes whole and reads them back', async () => {
    const now = new Date('2026-10-17T10:00:00.000Z');
    await saveDrafts(
      draftsRoot,
      { sourcePath: chapter, reviewId: 'r1', drafts: [box(2), box(5)] },
      true,
      now
    );
    const file = draftFileFor(draftsRoot, chapter, true);
    const written = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    expect(written).toEqual({
      version: 1,
      sourcePath: path.resolve(chapter),
      reviewId: 'r1',
      savedAt: '2026-10-17T10:00:00.000Z',
      drafts: [box(2), box(5)]
    });
    expect(await loadDrafts(draftsRoot, chapter, true)).toEqual(written);
    // No temp file is left beside it.
    expect(await fs.readdir(draftsRoot)).toEqual([path.basename(file)]);
  });

  it('replaces the set on every save, and deletes the file when none is open', async () => {
    await saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r1', drafts: [box(2)] }, true);
    await saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r2', drafts: [box(3, 'other')] }, true);
    expect((await loadDrafts(draftsRoot, chapter, true))?.drafts).toEqual([box(3, 'other')]);
    await saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r2', drafts: [] }, true);
    expect(await loadDrafts(draftsRoot, chapter, true)).toBeNull();
    await expect(fs.stat(draftFileFor(draftsRoot, chapter, true))).rejects.toThrow();
    // An empty set with no file is nothing to do.
    await saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r2', drafts: [] }, true);
  });

  it('keeps chapters apart', async () => {
    const other = path.join(root, 'vault', 'Chapter 02.md');
    await saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r1', drafts: [box(1)] }, true);
    await saveDrafts(draftsRoot, { sourcePath: other, reviewId: 'r2', drafts: [box(4)] }, true);
    expect((await loadDrafts(draftsRoot, chapter, true))?.drafts).toEqual([box(1)]);
    expect((await loadDrafts(draftsRoot, other, true))?.drafts).toEqual([box(4)]);
  });

  it('refuses what it would not write, and writes nothing then', async () => {
    const many = Array.from({ length: 201 }, (_, i) => box(i));
    expect(
      (await failure(saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r', drafts: many }, true)))
        .message
    ).toMatch(/^Only 200 open paragraphs/);
    const big = box(1, 'é'.repeat(600_000));
    expect(
      (await failure(saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r', drafts: [big] }, true)))
        .code
    ).toBe('invalid-input');
    const broken = { key: 1, paragraphs: [2], initial: '', text: '' };
    await failure(saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r', drafts: [broken] }, true));
    await failure(saveDrafts(draftsRoot, { sourcePath: '', reviewId: 'r', drafts: [] }, true));
    await failure(
      saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 7 as unknown as string, drafts: [] }, true)
    );
    await failure(saveDrafts(draftsRoot, null as unknown as never, true));
    await expect(fs.stat(draftsRoot)).rejects.toThrow();
  });

  it('answers null when nothing is kept', async () => {
    expect(await loadDrafts(draftsRoot, chapter, true)).toBeNull();
    await expect(loadDrafts(draftsRoot, '', true)).rejects.toThrow(AppFailure);
  });

  it('moves an unreadable file aside rather than let the next save replace it', async () => {
    const file = draftFileFor(draftsRoot, chapter, true);
    await fs.mkdir(draftsRoot, { recursive: true });
    for (const content of ['{"version": 1, "sourcePath": ', JSON.stringify({ version: 2, drafts: [] })]) {
      await fs.writeFile(file, content);
      const { lines, log } = logger();
      expect(
        await loadDrafts(draftsRoot, chapter, true, { now: new Date(2026, 9, 17, 9, 5, 7), log })
      ).toBeNull();
      expect(lines).toEqual([['warn', 'drafts.unreadable', {}]]);
      await expect(fs.stat(file)).rejects.toThrow();
      const aside = path.join(
        draftsRoot,
        `${path.basename(file, '.json')}.unreadable-2026-10-17_09.05.07.json`
      );
      expect(await fs.readFile(aside, 'utf8')).toBe(content);
      await fs.rm(aside);
    }
  });

  it('fails with the read words when the file cannot be read at all, and leaves it there', async () => {
    // A folder where the file should be: reading it fails, as a locked file does.
    const file = draftFileFor(draftsRoot, chapter, true);
    await fs.mkdir(file, { recursive: true });
    const { lines, log } = logger();
    const err = await failure(loadDrafts(draftsRoot, chapter, true, { log }));
    expect(err.code).toBe('io');
    const code = lines[0]?.[2]?.code;
    expect(code).toMatch(/^E[A-Z]+$/);
    // The shared read words (apply.24), naming no path: the file's own name is a hash.
    expect(err.message).toBe(explainReadError({ code }, 'the file they are kept in', process.platform));
    expect(err.message.startsWith(`${APP_NAME} could not read the file they are kept in`)).toBe(true);
    expect(err.message).not.toMatch(/replace|save again|Nothing was written/);
    expect(err.message).not.toContain(path.basename(file, '.json'));
    expect(lines).toEqual([['warn', 'drafts.read-failed', { code }]]);
    expect((await fs.stat(file)).isDirectory()).toBe(true);
    expect(await fs.readdir(draftsRoot)).toEqual([path.basename(file)]);
  });

  it('says another program may hold a locked file', async () => {
    const file = draftFileFor(draftsRoot, chapter, true);
    await fs.mkdir(draftsRoot, { recursive: true });
    await fs.writeFile(file, '{}');
    const busy = Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    const { lines, log } = logger();
    const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy);
    try {
      const err = await failure(loadDrafts(draftsRoot, chapter, true, { log }));
      expect(err.code).toBe('io');
      expect(err.message).toBe(explainReadError(busy, 'the file they are kept in', process.platform));
      expect(err.message).toMatch(/ read the file they are kept in\. /);
      expect(err.message.endsWith(`${APP_NAME} has not changed anything.`)).toBe(true);
      expect(err.message).not.toMatch(/replace|save again|Nothing was written|Controlled folder access/);
      expect(err.message).not.toContain(path.basename(file, '.json'));
      expect(lines).toEqual([['warn', 'drafts.read-failed', { code: 'EBUSY' }]]);
    } finally {
      read.mockRestore();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('{}');
  });

  it('leaves alone a file that names another chapter', async () => {
    const file = draftFileFor(draftsRoot, chapter, true);
    await fs.mkdir(draftsRoot, { recursive: true });
    const foreign = {
      version: 1,
      sourcePath: path.join(root, 'elsewhere.md'),
      reviewId: 'r',
      savedAt: 't',
      drafts: [box(1)]
    };
    await fs.writeFile(file, JSON.stringify(foreign));
    expect(await loadDrafts(draftsRoot, chapter, true)).toBeNull();
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(foreign);
  });
});

/* apply.25: the folders and the set-aside file are made, never retried and
   never replacing anything, so a refusal says what was being made and to try
   again, never "save again". */
describe('a folder or file that cannot be made (apply.25)', () => {
  const at = new Date(2026, 9, 17, 9, 5, 7);
  const NOT_A_RENAME = /replace|save again|second and a half|even after|the file is as it was/;
  const refused = (code: string, syscall: string, at: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: refused, ${syscall} '${at}'`), { code, syscall, path: at });

  it('setting aside: the set-aside file, named as the card names it', async () => {
    const name = 'Chapter 01 2026-10-17 09.05.07.txt';
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      const err = refused(code, 'open', path.join(setAsideFolderFor(draftsRoot), name));
      const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(err);
      try {
        const shown = await failure(
          setAsideDrafts(draftsRoot, { sourcePath: chapter, drafts: [box(1)] }, { now: at })
        );
        expect(shown.message).toBe(explainWriteError(err, name, process.platform, 'create'));
        expect(shown.message).toMatch(/ create Chapter 01 2026-10-17 09\.05\.07\.txt\. .*try again\. /);
        expect(shown.message).not.toMatch(NOT_A_RENAME);
        // The card puts the words after "could not be set aside:".
        expect(setAsideFailedCardText([box(1)], shown.message)).toContain(
          `what you typed could not be set aside: ${shown.message} It is still kept`
        );
      } finally {
        write.mockRestore();
      }
    }
    expect(await fs.readdir(setAsideFolderFor(draftsRoot))).toEqual([]);
  });

  it('setting aside: the folder for set-aside text', async () => {
    const err = refused('EPERM', 'mkdir', setAsideFolderFor(draftsRoot));
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(err);
    try {
      const shown = await failure(
        setAsideDrafts(draftsRoot, { sourcePath: chapter, drafts: [box(1)] }, { now: at })
      );
      expect(shown.message).toBe(
        explainWriteError(err, 'the folder for set-aside text', process.platform, 'folder')
      );
      expect(shown.message).not.toMatch(NOT_A_RENAME);
    } finally {
      mkdir.mockRestore();
    }
    await expect(fs.stat(setAsideFolderFor(draftsRoot))).rejects.toThrow();
  });

  it('keeping boxes: the folder they are kept in', async () => {
    const err = refused('EACCES', 'mkdir', draftsRoot);
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(err);
    try {
      const shown = await failure(
        saveDrafts(draftsRoot, { sourcePath: chapter, reviewId: 'r1', drafts: [box(1)] }, true)
      );
      expect(shown.message).toBe(
        explainWriteError(err, 'the folder they are kept in', process.platform, 'folder')
      );
      expect(shown.message).toMatch(
        / create the folder they are kept in\. .*try again\. .*Nothing was written\.$/
      );
      expect(shown.message).not.toMatch(NOT_A_RENAME);
    } finally {
      mkdir.mockRestore();
    }
    await expect(fs.stat(draftsRoot)).rejects.toThrow();
  });
});

describe('setting aside', () => {
  const at = new Date(2026, 9, 17, 9, 5, 7);

  it('writes a new .txt named by the chapter and the time, with the platform line endings', async () => {
    const { lines, log } = logger();
    const result = await setAsideDrafts(
      draftsRoot,
      { sourcePath: chapter, drafts: [box(11, 'What I typed.', 'What it read.')] },
      { now: at, platform: 'win32', log }
    );
    expect(result.name).toBe('Chapter 01 2026-10-17 09.05.07.txt');
    expect(result.file).toBe(path.join(draftsRoot, 'set-aside', result.name));
    const text = await fs.readFile(result.file, 'utf8');
    expect(text).toContain('What I typed.\r\n');
    expect(text).toContain('What it read.\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    // The log says how many boxes, never what they hold or which chapter.
    expect(lines).toEqual([['info', 'drafts.set-aside', { boxes: 1 }]]);

    const posix = await setAsideDrafts(
      draftsRoot,
      { sourcePath: chapter, drafts: [box(1)] },
      { now: at, platform: 'linux', log }
    );
    expect(await fs.readFile(posix.file, 'utf8')).not.toContain('\r');
  });

  it('never writes over a file: a second in the same second is -2, a third -3', async () => {
    const names: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      names.push(
        (
          await setAsideDrafts(
            draftsRoot,
            { sourcePath: chapter, drafts: [box(i, `text ${i}`)] },
            { now: at }
          )
        ).name
      );
    }
    expect(names).toEqual([
      'Chapter 01 2026-10-17 09.05.07.txt',
      'Chapter 01 2026-10-17 09.05.07-2.txt',
      'Chapter 01 2026-10-17 09.05.07-3.txt'
    ]);
    const first = await fs.readFile(path.join(setAsideFolderFor(draftsRoot), names[0] ?? ''), 'utf8');
    expect(first).toContain('text 0');
  });

  it('refuses nothing to set aside, or a broken box', async () => {
    await failure(setAsideDrafts(draftsRoot, { sourcePath: chapter, drafts: [] }, { now: at }));
    await failure(
      setAsideDrafts(
        draftsRoot,
        { sourcePath: chapter, drafts: [{ key: 1 } as unknown as StoredDraft] },
        { now: at }
      )
    );
    await failure(setAsideDrafts(draftsRoot, { sourcePath: '  ', drafts: [box(1)] }, { now: at }));
    await expect(fs.stat(setAsideFolderFor(draftsRoot))).rejects.toThrow();
  });

  it('opens only a bare name of a .txt in the set-aside folder', async () => {
    const { name, file } = await setAsideDrafts(
      draftsRoot,
      { sourcePath: chapter, drafts: [box(1)] },
      { now: at }
    );
    expect(await setAsideFile(draftsRoot, name)).toBe(file);
    await fs.mkdir(path.join(setAsideFolderFor(draftsRoot), 'folder.txt'));
    await fs.writeFile(path.join(draftsRoot, 'outside.txt'), 'x');
    for (const bad of [
      '../outside.txt',
      '..\\outside.txt',
      `sub/${name}`,
      'missing.txt',
      'folder.txt',
      name.replace('.txt', '.json'),
      '..',
      '',
      7,
      null
    ]) {
      expect(await setAsideFile(draftsRoot, bad)).toBeNull();
    }
  });
});
