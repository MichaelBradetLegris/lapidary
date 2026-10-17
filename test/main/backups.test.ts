import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUPS_DIRNAME,
  CHAPTER_INFO_FILE,
  assertChapterBackupFolder,
  assertOutside,
  backupFolderFor,
  backupsRootFor,
  chapterBackupHooks,
  chapterBackups,
  listBackups,
  pruneBackups,
  writeBackup
} from '../../src/main/backups';
import { AppFailure } from '../../src/main/errors';
import { backupFileName } from '../../src/shared/backups';
import { pathKey } from '../../src/shared/paths';

/* apply.10: the backup folder, exact copies, duplicates, retention on disk and
   the refusal to back up into the manuscript folder (PLAN 6.5, 11.3 h). */

let root: string;
let backupsRoot: string;
let vault: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-backups-'));
  backupsRoot = backupsRootFor(path.join(root, 'userData'));
  vault = path.join(root, 'vault');
  await fs.mkdir(vault, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A local time, month counted from 1. */
function at(year: number, month: number, day: number, hour = 12, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second);
}

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function readInfo(folder: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(folder, CHAPTER_INFO_FILE), 'utf8')) as unknown;
}

async function chapter(relative: string, bytes: Buffer): Promise<string> {
  const file = path.join(vault, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return file;
}

describe('where backups go', () => {
  it('is <userData>/backups', () => {
    expect(BACKUPS_DIRNAME).toBe('backups');
    expect(backupsRootFor(path.join(root, 'userData'))).toBe(path.join(root, 'userData', 'backups'));
  });

  it('names the folder by the chapter slug and the first 8 hex of the path key hash', () => {
    const file = path.join(vault, 'Chapter 12.md');
    const hash = sha(Buffer.from(pathKey(path.resolve(file), true), 'utf8')).slice(0, 8);
    expect(backupFolderFor(backupsRoot, file, true)).toBe(path.join(backupsRoot, `chapter-12-${hash}`));
  });

  it('gives same-named chapters in different folders two folders', () => {
    const a = backupFolderFor(backupsRoot, path.join(vault, 'Part 1', 'Chapter 01.md'), true);
    const b = backupFolderFor(backupsRoot, path.join(vault, 'Part 2', 'Chapter 01.md'), true);
    expect(a).not.toBe(b);
    expect(path.basename(a).startsWith('chapter-01-')).toBe(true);
    expect(path.basename(b).startsWith('chapter-01-')).toBe(true);
  });

  it('keeps .md and .txt of the same name apart', () => {
    const md = backupFolderFor(backupsRoot, path.join(vault, 'Notes.md'), true);
    const txt = backupFolderFor(backupsRoot, path.join(vault, 'Notes.txt'), true);
    expect(path.basename(md).startsWith('notes-')).toBe(true);
    expect(path.basename(txt).startsWith('notes-txt-')).toBe(true);
  });

  it('treats a path that differs only in case as the same chapter only where the file system does', () => {
    const lower = path.join(vault, 'chapter 12.md');
    const upper = path.join(vault, 'Chapter 12.md');
    expect(backupFolderFor(backupsRoot, lower, true)).toBe(backupFolderFor(backupsRoot, upper, true));
    expect(backupFolderFor(backupsRoot, lower, false)).not.toBe(backupFolderFor(backupsRoot, upper, false));
  });
});

describe('assertOutside', () => {
  it('refuses a backups root inside the manuscript folder or equal to it', () => {
    expect(() => assertOutside(path.join(vault, 'data', 'backups'), [vault], true)).toThrow(
      /the backups folder, .*, lies inside .*, which holds your chapters/
    );
    expect(() => assertOutside(vault, [vault], true)).toThrow(AppFailure);
  });

  it('compares as the file system does', () => {
    const inside = path.join(vault.toUpperCase(), 'backups');
    expect(() => assertOutside(inside, [vault], true)).toThrow(AppFailure);
  });

  it('accepts a root beside the manuscript folder, even one whose name starts the same', () => {
    expect(() => assertOutside(backupsRoot, [vault], true)).not.toThrow();
    expect(() => assertOutside(`${vault}let${path.sep}backups`, [vault], true)).not.toThrow();
    expect(() => assertOutside(backupsRoot, [null, undefined], true)).not.toThrow();
  });

  it('checks every folder given', () => {
    const other = path.join(root, 'old vault');
    expect(() => assertOutside(path.join(other, 'backups'), [vault, other], true)).toThrow(AppFailure);
  });
});

describe('writeBackup', () => {
  it('copies BOM and CRLF bytes exactly, named by the time and the chapter', async () => {
    const bytes = Buffer.from('﻿The river had began to climb.\r\n\r\nSecond line.\r\n', 'utf8');
    const file = await chapter('Chapter 01.md', bytes);
    const result = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes,
      now: at(2026, 10, 14, 16, 4, 33),
      ci: true
    });
    expect(result).toEqual({
      folder: backupFolderFor(backupsRoot, file, true),
      file: path.join(backupFolderFor(backupsRoot, file, true), '2026-10-14 16.04.33 Chapter 01.md'),
      name: '2026-10-14 16.04.33 Chapter 01.md',
      created: true
    });
    const copy = await fs.readFile(result.file);
    expect(copy.equals(bytes)).toBe(true);
    expect(sha(copy)).toBe(sha(await fs.readFile(file)));
  });

  it('copies bytes that are not UTF-8 exactly too (Latin-1)', async () => {
    const bytes = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x6f, 0xeb, 0x6c, 0x0d, 0x0a, 0xff, 0x00]);
    const file = await chapter('Latin.txt', bytes);
    const result = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes,
      now: at(2026, 10, 14),
      ci: true
    });
    expect((await fs.readFile(result.file)).equals(bytes)).toBe(true);
    expect(result.name).toBe('2026-10-14 12.00.00 Latin.txt');
  });

  it('writes chapter.json once, with the source path, and never replaces it', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const first = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 14, 9),
      ci: true
    });
    const info = path.join(first.folder, CHAPTER_INFO_FILE);
    expect(await readInfo(first.folder)).toEqual({ sourcePath: path.resolve(file) });
    await fs.writeFile(info, '{"sourcePath":"kept as it was"}');
    await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('two\n'),
      now: at(2026, 10, 14, 10),
      ci: true
    });
    expect(await fs.readFile(info, 'utf8')).toBe('{"sourcePath":"kept as it was"}');
  });

  it('adds nothing when the newest backup already holds these bytes', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const first = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 14, 9),
      ci: true
    });
    const again = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 14, 10),
      ci: true
    });
    expect(again).toEqual({ ...first, created: false });
    expect((await listBackups(first.folder)).map((b) => b.name)).toEqual([first.name]);
  });

  it('compares with the newest only: going back to older bytes makes a new copy', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const opts = { backupsRoot, sourcePath: file, ci: true };
    await writeBackup({ ...opts, bytes: Buffer.from('one\n'), now: at(2026, 10, 14, 9) });
    await writeBackup({ ...opts, bytes: Buffer.from('two\n'), now: at(2026, 10, 14, 10) });
    const third = await writeBackup({ ...opts, bytes: Buffer.from('one\n'), now: at(2026, 10, 14, 11) });
    expect(third.created).toBe(true);
    expect((await listBackups(third.folder)).map((b) => b.name)).toEqual([
      '2026-10-14 11.00.00 Chapter 01.md',
      '2026-10-14 10.00.00 Chapter 01.md',
      '2026-10-14 09.00.00 Chapter 01.md'
    ]);
  });

  it('never reuses a name: a second backup in the same second gets -2, a third -3', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const now = at(2026, 10, 14, 16, 4, 33);
    const names: string[] = [];
    for (const text of ['one\n', 'two\n', 'three\n']) {
      names.push(
        (await writeBackup({ backupsRoot, sourcePath: file, bytes: Buffer.from(text), now, ci: true })).name
      );
    }
    expect(names).toEqual([
      '2026-10-14 16.04.33 Chapter 01.md',
      '2026-10-14 16.04.33-2 Chapter 01.md',
      '2026-10-14 16.04.33-3 Chapter 01.md'
    ]);
    const folder = backupFolderFor(backupsRoot, file, true);
    expect(await fs.readFile(path.join(folder, names[0]!), 'utf8')).toBe('one\n');
    expect(await fs.readFile(path.join(folder, names[2]!), 'utf8')).toBe('three\n');
  });

  it('keeps same-named chapters in two folders, each with its own chapter.json', async () => {
    const a = await chapter(path.join('Part 1', 'Chapter 01.md'), Buffer.from('part one\n'));
    const b = await chapter(path.join('Part 2', 'Chapter 01.md'), Buffer.from('part two\n'));
    const now = at(2026, 10, 14, 9);
    const first = await writeBackup({
      backupsRoot,
      sourcePath: a,
      bytes: await fs.readFile(a),
      now,
      ci: true
    });
    const second = await writeBackup({
      backupsRoot,
      sourcePath: b,
      bytes: await fs.readFile(b),
      now,
      ci: true
    });
    expect(first.folder).not.toBe(second.folder);
    expect(second.created).toBe(true);
    expect(await fs.readFile(first.file, 'utf8')).toBe('part one\n');
    expect(await fs.readFile(second.file, 'utf8')).toBe('part two\n');
    expect(await readInfo(first.folder)).toEqual({ sourcePath: a });
    expect(await readInfo(second.folder)).toEqual({ sourcePath: b });
    expect((await fs.readdir(backupsRoot)).sort()).toEqual(
      [path.basename(first.folder), path.basename(second.folder)].sort()
    );
  });

  it('fails with a plain reason when the folder cannot be made', async () => {
    await fs.mkdir(path.dirname(backupsRoot), { recursive: true });
    await fs.writeFile(backupsRoot, 'a file where the backups folder should be');
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const err = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      ci: true
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppFailure);
    expect((err as AppFailure).code).toBe('io');
    expect((err as AppFailure).message).toMatch(
      /cannot be made, because a file stands where a folder should be\.$/
    );
  });
});

describe('listBackups', () => {
  it('lists backups newest first and leaves out everything else', async () => {
    const folder = path.join(backupsRoot, 'chapter-01-12345678');
    await fs.mkdir(path.join(folder, 'a folder'), { recursive: true });
    const names = [
      backupFileName(at(2026, 10, 14, 9), 'Chapter 01.md'),
      backupFileName(at(2026, 10, 14, 9), 'Chapter 01.md', 2),
      backupFileName(at(2026, 10, 13, 9), 'Chapter 01.md')
    ];
    for (const name of [...names, CHAPTER_INFO_FILE, 'notes.txt'])
      await fs.writeFile(path.join(folder, name), 'x');
    const listed = await listBackups(folder);
    expect(listed.map((b) => b.name)).toEqual([names[1], names[0], names[2]]);
    expect(listed[0]!.file).toBe(path.join(folder, names[1]!));
  });

  it('is empty for a chapter never backed up', async () => {
    expect(await listBackups(path.join(backupsRoot, 'nothing-here'))).toEqual([]);
  });
});

describe('pruneBackups', () => {
  it('keeps 21 of 25 backups made in a day, and every file that is not a backup', async () => {
    const folder = path.join(backupsRoot, 'chapter-01-12345678');
    await fs.mkdir(folder, { recursive: true });
    const names = Array.from({ length: 25 }, (_, i) =>
      backupFileName(at(2026, 10, 14, 9, i), 'Chapter 01.md')
    );
    for (const name of [...names, CHAPTER_INFO_FILE, 'notes.txt'])
      await fs.writeFile(path.join(folder, name), 'x');
    const removed = await pruneBackups(folder, at(2026, 10, 14, 18));
    expect(removed).toEqual(names.slice(1, 5));
    const left = (await fs.readdir(folder)).sort();
    expect(left).toEqual([...names.slice(0, 1), ...names.slice(5), CHAPTER_INFO_FILE, 'notes.txt'].sort());
  });

  it('does nothing in a folder that is not there', async () => {
    expect(await pruneBackups(path.join(backupsRoot, 'nothing-here'), at(2026, 10, 14))).toEqual([]);
  });
});

describe('chapterBackupHooks', () => {
  const quiet = (): void => undefined;

  it('backs up before the replace and prunes after the write', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('old\n'));
    const logged: string[] = [];
    let clock = at(2026, 10, 14, 9);
    const hooks = chapterBackupHooks({
      backupsRoot,
      manuscriptFolder: vault,
      ci: true,
      now: () => clock,
      log: (_level, event) => logged.push(event)
    });
    const folder = backupFolderFor(backupsRoot, file, true);
    await fs.mkdir(folder, { recursive: true });
    const old = Array.from({ length: 22 }, (_, i) => backupFileName(at(2025, 1, 1, 9, i), 'Chapter 01.md'));
    for (const name of old) await fs.writeFile(path.join(folder, name), 'older\n');

    expect(await hooks.beforeReplace(file, Buffer.from('old\n'))).toEqual({
      name: '2026-10-14 09.00.00 Chapter 01.md',
      created: true
    });
    clock = at(2026, 10, 14, 9, 0, 1);
    await hooks.afterWrite(file);
    const left = await listBackups(folder);
    expect(left).toHaveLength(20);
    expect(left[0]!.name).toBe('2026-10-14 09.00.00 Chapter 01.md');
    expect(logged).toEqual([]);
  });

  it('refuses, and writes nothing, when the backups root is inside the manuscript folder', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('old\n'));
    const inside = path.join(vault, '.lapidary', 'backups');
    const logged: string[] = [];
    const hooks = chapterBackupHooks({
      backupsRoot: inside,
      manuscriptFolder: vault,
      ci: true,
      log: (_level, event) => logged.push(event)
    });
    await expect(hooks.beforeReplace(file, Buffer.from('old\n'))).rejects.toThrow(/lies inside/);
    await expect(fs.access(path.join(vault, '.lapidary'))).rejects.toThrow();
    expect(logged).toEqual(['backups.failed']);
  });

  it("refuses a root inside the chapter's own folder when no manuscript folder is set", async () => {
    const file = await chapter(path.join('Old', 'Chapter 01.md'), Buffer.from('old\n'));
    const hooks = chapterBackupHooks({
      backupsRoot: path.join(vault, 'Old', 'backups'),
      manuscriptFolder: null,
      ci: true,
      log: quiet
    });
    await expect(hooks.beforeReplace(file, Buffer.from('old\n'))).rejects.toThrow(AppFailure);
  });

  it('logs a failed prune and lets the save stand', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('old\n'));
    const folder = backupFolderFor(backupsRoot, file, true);
    await fs.mkdir(path.dirname(folder), { recursive: true });
    await fs.writeFile(folder, 'not a folder');
    const logged: Array<[string, Readonly<Record<string, unknown>> | undefined]> = [];
    const hooks = chapterBackupHooks({
      backupsRoot,
      manuscriptFolder: vault,
      ci: true,
      log: (_level, event, fields) => logged.push([event, fields])
    });
    await expect(hooks.afterWrite(file)).resolves.toBeUndefined();
    expect(logged.map(([event]) => event)).toEqual(['backups.prune-failed']);
    // Neither the chapter's name nor its folder's lower-case slug, `chapter-01-<hash>`.
    expect(JSON.stringify(logged)).not.toMatch(/chapter/i);
  });
});

/* apply.11: what Show backups opens for a chapter, worked out in main from the
   chapter's path, never outside the backups root (PLAN 6.5). */
describe('chapterBackups', () => {
  it('finds nothing for a chapter never backed up, and makes no folder looking', async () => {
    const file = await chapter('Chapter 03.md', Buffer.from('new\n'));
    expect(await chapterBackups(backupsRoot, file, true)).toBeNull();
    await expect(fs.stat(backupsRoot)).rejects.toThrow();
  });

  it("gives the chapter's own folder and its newest backup", async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 17, 9),
      ci: true
    });
    await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('two\n'),
      now: at(2026, 10, 17, 10),
      ci: true
    });
    const folder = backupFolderFor(backupsRoot, file, true);
    expect(await chapterBackups(backupsRoot, file, true)).toEqual({
      folder,
      newest: path.join(folder, backupFileName(at(2026, 10, 17, 10), 'Chapter 01.md'))
    });
  });

  it('finds the folder whatever the case of the path, where the file system ignores case', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 17),
      ci: true
    });
    const shown = await chapterBackups(backupsRoot, file.toUpperCase(), true);
    expect(shown?.folder).toBe(backupFolderFor(backupsRoot, file, true));
    expect(shown?.newest).not.toBeNull();
  });

  it("does not show one chapter's backups for a same-named chapter in another folder", async () => {
    const a = await chapter(path.join('Part 1', 'Chapter 01.md'), Buffer.from('a\n'));
    const b = await chapter(path.join('Part 2', 'Chapter 01.md'), Buffer.from('b\n'));
    await writeBackup({
      backupsRoot,
      sourcePath: a,
      bytes: Buffer.from('a\n'),
      now: at(2026, 10, 17),
      ci: true
    });
    expect(await chapterBackups(backupsRoot, a, true)).not.toBeNull();
    expect(await chapterBackups(backupsRoot, b, true)).toBeNull();
  });

  it('opens a folder whose backups were deleted by hand, with nothing to select', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const { file: copy, folder } = await writeBackup({
      backupsRoot,
      sourcePath: file,
      bytes: Buffer.from('one\n'),
      now: at(2026, 10, 17),
      ci: true
    });
    await fs.rm(copy);
    await fs.writeFile(path.join(folder, 'my notes.txt'), 'kept by hand\n');
    expect(await chapterBackups(backupsRoot, file, true)).toEqual({ folder, newest: null });
  });

  it('finds nothing where a file stands in place of the folder', async () => {
    const file = await chapter('Chapter 01.md', Buffer.from('one\n'));
    const folder = backupFolderFor(backupsRoot, file, true);
    await fs.mkdir(backupsRoot, { recursive: true });
    await fs.writeFile(folder, 'not a folder');
    expect(await chapterBackups(backupsRoot, file, true)).toBeNull();
  });

  it('refuses a path that is not a full path', async () => {
    await expect(chapterBackups(backupsRoot, 'Chapter 01.md', true)).rejects.toThrow(AppFailure);
    await expect(chapterBackups(backupsRoot, '', true)).rejects.toThrow(AppFailure);
    await expect(chapterBackups(backupsRoot, path.join('..', 'Chapter 01.md'), true)).rejects.toThrow(
      AppFailure
    );
  });
});

describe('assertChapterBackupFolder', () => {
  it("accepts a chapter's folder as backupFolderFor makes it", () => {
    const folder = backupFolderFor(backupsRoot, path.join(vault, 'Chapter 01.md'), true);
    expect(() => assertChapterBackupFolder(backupsRoot, folder, true)).not.toThrow();
  });

  it('refuses the root itself, anything above or beside it, and anything deeper', () => {
    for (const folder of [
      backupsRoot,
      path.dirname(backupsRoot),
      path.join(backupsRoot, '..'),
      path.join(backupsRoot, 'chapter-01-12345678', '..', '..', 'drafts'),
      `${backupsRoot}-old`,
      path.join(`${backupsRoot}-old`, 'chapter-01-12345678'),
      path.join(backupsRoot, 'chapter-01-12345678', 'inner'),
      vault
    ]) {
      expect(() => assertChapterBackupFolder(backupsRoot, folder, true), folder).toThrow(AppFailure);
    }
  });

  it('compares as the file system does', () => {
    const folder = path.join(backupsRoot.toUpperCase(), 'chapter-01-12345678');
    expect(() => assertChapterBackupFolder(backupsRoot, folder, true)).not.toThrow();
    expect(() => assertChapterBackupFolder(backupsRoot, folder, false)).toThrow(AppFailure);
  });
});
