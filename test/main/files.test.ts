import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { explainReadError, toAppError } from '../../src/main/errors';
import { APP_NAME } from '../../src/shared/branding';
import {
  OpenedChapters,
  assertSavableChapter,
  bytesFor,
  caseInsensitiveFs,
  checkChapterName,
  checkChapterNameOnDisk,
  createChapter,
  decodeText,
  hashBytes,
  listChapters,
  readChapter,
  readTextFile,
  writeChapter,
  type WriteHooks
} from '../../src/main/files';
import { backupFolderFor, backupsRootFor, chapterBackupHooks, listBackups } from '../../src/main/backups';
import type { SaveResponse } from '../../src/shared/ipc';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-files-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Words that belong to a write and must never explain a read (apply.24). */
const WRITE_WORDS = /replace|save again|Nothing was written|Controlled folder access|second and a half/;

async function put(relative: string, contents: string | Buffer): Promise<string> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}

describe('listChapters', () => {
  it('finds markdown and plain text recursively and ignores other extensions', async () => {
    await put('Chapter 1.md', 'a');
    await put('book/Chapter 2.md', 'b');
    await put('book/notes.txt', 'c');
    await put('cover.png', 'd');
    const files = await listChapters(root, null);
    expect([...files.map((f) => f.relativePath)].sort()).toEqual([
      'Chapter 1.md',
      'book/Chapter 2.md',
      'book/notes.txt'
    ]);
  });

  it('sorts case-insensitively with natural number order', async () => {
    await put('Chapter 10.md', 'a');
    await put('Chapter 2.md', 'b');
    await put('apple.md', 'c');
    const files = await listChapters(root, null);
    expect(files.map((f) => f.relativePath)).toEqual(['apple.md', 'Chapter 2.md', 'Chapter 10.md']);
  });

  it('skips dot folders, dot files and node_modules', async () => {
    await put('Chapter 1.md', 'a');
    await put('.obsidian/plugin.md', 'x');
    await put('node_modules/pkg/readme.md', 'x');
    await put('.hidden.md', 'x');
    const files = await listChapters(root, null);
    expect(files.map((f) => f.relativePath)).toEqual(['Chapter 1.md']);
  });

  it('skips a reviews folder nested inside the manuscript folder', async () => {
    await put('Chapter 1.md', 'a');
    await put('reviews/chapter-1/x.md', 'x');
    const files = await listChapters(root, path.join(root, 'reviews'));
    expect(files.map((f) => f.relativePath)).toEqual(['Chapter 1.md']);
  });

  it('returns nothing for a folder that is not there', async () => {
    expect(await listChapters(path.join(root, 'nope'), null)).toEqual([]);
  });
});

describe('readChapter', () => {
  it('captures LF text plus the shape of the file on disk', async () => {
    const file = await put('c.md', Buffer.from('﻿one\r\ntwo\r\n', 'utf8'));
    const content = await readChapter(file);
    expect(content.text).toBe('one\ntwo');
    expect(content).toMatchObject({ eol: 'crlf', bom: true, trailingNewline: true });
    expect(content.hash).toHaveLength(64);
  });

  it('hashes the bytes, not the normalized text', async () => {
    const lf = await readChapter(await put('lf.md', 'one\ntwo\n'));
    const crlf = await readChapter(await put('crlf.md', 'one\r\ntwo\r\n'));
    expect(lf.text).toBe(crlf.text);
    expect(lf.hash).not.toBe(crlf.hash);
  });
});

describe('writeChapter', () => {
  it('is byte-identical when nothing changed, CRLF and BOM included', async () => {
    const original = Buffer.from('﻿one\r\ntwo\r\n', 'utf8');
    const file = await put('c.md', original);
    const content = await readChapter(file);
    const result = await writeChapter({
      path: file,
      text: content.text,
      eol: content.eol,
      bom: content.bom,
      trailingNewline: content.trailingNewline,
      expectedHash: content.hash
    });
    expect(result.status).toBe('written');
    expect(await fs.readFile(file)).toEqual(original);
  });

  it('writes nothing when the new bytes are the ones on disk, so the modified time stays (apply.3)', async () => {
    const original = Buffer.from('﻿one\r\ntwo\r\n', 'utf8');
    const file = await put('c.md', original);
    const old = new Date('2026-01-02T03:04:05.000Z');
    await fs.utimes(file, old, old);
    const content = await readChapter(file);
    const renames: string[] = [];
    const seen: string[] = [];
    const result = await writeChapter(
      {
        path: file,
        text: content.text,
        eol: content.eol,
        bom: content.bom,
        trailingNewline: content.trailingNewline,
        expectedHash: content.hash
      },
      {
        onWritten: (_file, hash) => seen.push(hash),
        atomic: {
          rename: (from) => {
            renames.push(from);
            return Promise.resolve();
          }
        }
      }
    );
    expect(result).toEqual({ status: 'written', hash: content.hash, unchanged: true });
    expect(renames).toEqual([]);
    expect(seen).toEqual([]);
    expect((await fs.stat(file)).mtime.getTime()).toBe(old.getTime());
    expect(await fs.readFile(file)).toEqual(original);
    expect(await fs.readdir(root)).toEqual(['c.md']);
  });

  it('still writes when only the shape differs, such as the final newline', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const result = await writeChapter({
      path: file,
      text: content.text,
      eol: content.eol,
      bom: content.bom,
      trailingNewline: false,
      expectedHash: content.hash
    });
    expect(result).toEqual({ status: 'written', hash: hashBytes(Buffer.from('one')) });
    expect(await fs.readFile(file, 'utf8')).toBe('one');
  });

  it('keeps CRLF and the BOM when the text does change', async () => {
    const file = await put('c.md', Buffer.from('﻿the river had began\r\n', 'utf8'));
    const content = await readChapter(file);
    await writeChapter({
      path: file,
      text: 'the river had begun',
      eol: content.eol,
      bom: content.bom,
      trailingNewline: content.trailingNewline,
      expectedHash: content.hash
    });
    expect(await fs.readFile(file)).toEqual(Buffer.from('﻿the river had begun\r\n', 'utf8'));
  });

  it('refuses to write when the file changed underneath and hands back the disk copy', async () => {
    const file = await put('c.md', 'original\n');
    const content = await readChapter(file);
    await fs.writeFile(file, 'someone else edited this\n');

    const result = await writeChapter({
      path: file,
      text: 'my version',
      eol: content.eol,
      bom: content.bom,
      trailingNewline: content.trailingNewline,
      expectedHash: content.hash
    });

    expect(result.status).toBe('stale');
    if (result.status === 'stale') expect(result.disk.text).toBe('someone else edited this');
    expect(await fs.readFile(file, 'utf8')).toBe('someone else edited this\n');
  });

  it('reports a missing chapter rather than creating one', async () => {
    await expect(
      writeChapter({
        path: path.join(root, 'gone.md'),
        text: 'x',
        eol: 'lf',
        bom: false,
        trailingNewline: true,
        expectedHash: 'whatever'
      })
    ).rejects.toThrow(/no longer at .*gone\.md\. If you renamed or moved it in Obsidian, open it again/);
    await expect(fs.access(path.join(root, 'gone.md'))).rejects.toThrow();
  });

  it('leaves no temp files behind', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    await writeChapter({
      path: file,
      text: 'two',
      eol: content.eol,
      bom: content.bom,
      trailingNewline: content.trailingNewline,
      expectedHash: content.hash
    });
    expect(await fs.readdir(root)).toEqual(['c.md']);
  });

  it('returns the hash of what it wrote, so the watcher can ignore the echo', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const seen: Array<[string, string]> = [];
    const result = await writeChapter(
      {
        path: file,
        text: 'two',
        eol: content.eol,
        bom: content.bom,
        trailingNewline: content.trailingNewline,
        expectedHash: content.hash
      },
      { onWritten: (f, h) => seen.push([f, h]) }
    );
    const expected = hashBytes(bytesFor({ text: 'two', eol: 'lf', bom: false, trailingNewline: true }));
    expect(result).toEqual({ status: 'written', hash: expected });
    expect(seen).toEqual([[file, expected]]);
    expect((await readChapter(file)).hash).toBe(expected);
  });
});

describe('a refused read is explained as a read (apply.24)', () => {
  const refused = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: refused`), { code, path: path.join(root, 'c.md') });

  /** What the page is shown: the IPC bridge's words, which take an unexplained error as a write's. */
  async function shown(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      return toAppError(err).message;
    }
    throw new Error('expected a failure');
  }

  it('opening a chapter another program holds or will not let the app read', async () => {
    const file = await put('c.md', 'one\n');
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused(code));
      try {
        const message = await shown(readChapter(file));
        expect(message).toBe(explainReadError(refused(code), 'c.md', process.platform));
        expect(message).toMatch(/ read c\.md\. .*try again\. \S+ has not changed anything\.$/);
        expect(message).not.toMatch(WRITE_WORDS);
      } finally {
        read.mockRestore();
      }
    }
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
  });

  it('opening a chapter that is gone, or is a folder', async () => {
    const gone = await shown(readChapter(path.join(root, 'gone.md')));
    expect(gone).toBe(
      `${APP_NAME} could not find gone.md. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${APP_NAME} has not changed anything.`
    );
    await fs.mkdir(path.join(root, 'folder.md'));
    const folder = await shown(readChapter(path.join(root, 'folder.md')));
    expect(folder).toBe(
      `${APP_NAME} could not read folder.md, because it is a folder, not a file. ${APP_NAME} has not changed anything.`
    );
    for (const message of [gone, folder]) expect(message).not.toMatch(WRITE_WORDS);
  });

  it('keeps a refusal already in words, such as a file that is not UTF-8', async () => {
    const file = await put('latin.md', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    await expect(readChapter(file)).rejects.toMatchObject({ code: 'not-utf8' });
  });

  it('a save whose first read is refused says so as a read and writes nothing', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused('EBUSY'));
    try {
      const message = await shown(
        writeChapter({
          path: file,
          text: 'two',
          eol: 'lf',
          bom: false,
          trailingNewline: true,
          expectedHash: content.hash
        })
      );
      expect(message).toBe(explainReadError(refused('EBUSY'), 'c.md', process.platform));
      expect(message).not.toMatch(WRITE_WORDS);
    } finally {
      read.mockRestore();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
    expect(await fs.readdir(root)).toEqual(['c.md']);
  });

  it('a save that cannot reach the chapter tells it to be opened again from where it is now', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused('ENOTDIR'));
    try {
      const message = await shown(
        writeChapter({
          path: file,
          text: 'two',
          eol: 'lf',
          bom: false,
          trailingNewline: true,
          expectedHash: content.hash
        })
      );
      expect(message).toBe(
        `${APP_NAME} could not find c.md. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${APP_NAME} has not changed anything.`
      );
    } finally {
      read.mockRestore();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
  });

  it('a save whose read after the backup is refused says so as a read and writes nothing', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const spies: Array<{ mockRestore(): void }> = [];
    try {
      const message = await shown(
        writeChapter(
          {
            path: file,
            text: 'two',
            eol: 'lf',
            bom: false,
            trailingNewline: true,
            expectedHash: content.hash
          },
          {
            // Step 4 has the old bytes; another program then holds the file,
            // so step 5's read, made in case it changed meanwhile, is refused.
            beforeReplace: () => {
              spies.push(vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused('EBUSY')));
              return Promise.resolve(undefined);
            }
          }
        )
      );
      expect(spies).toHaveLength(1);
      expect(message).toBe(explainReadError(refused('EBUSY'), 'c.md', process.platform));
      expect(message).not.toMatch(WRITE_WORDS);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
    expect(await fs.readdir(root)).toEqual(['c.md']);
  });

  it('a save that finds the chapter changed while its rename was refused, then cannot read it, says so as a read', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const realReadFile = fs.readFile.bind(fs);
    const spies: Array<{ mockRestore(): void }> = [];
    let renames = 0;
    try {
      const message = await shown(
        writeChapter(
          {
            path: file,
            text: 'two',
            eol: 'lf',
            bom: false,
            trailingNewline: true,
            expectedHash: content.hash
          },
          {
            atomic: {
              // Another program writes the chapter and holds it: the rename is
              // refused, the check before the retry reads new bytes, so the
              // save stops as stale, and the read of those bytes for the page
              // is refused.
              rename: async (from: string, to: string) => {
                renames += 1;
                await fs.writeFile(file, 'someone else\n');
                spies.push(
                  vi
                    .spyOn(fs, 'readFile')
                    .mockImplementationOnce((...args) => realReadFile(...args))
                    .mockRejectedValueOnce(refused('EBUSY'))
                );
                throw Object.assign(new Error('EBUSY: refused'), { code: 'EBUSY', path: from, dest: to });
              },
              sleep: () => Promise.resolve()
            }
          }
        )
      );
      expect(renames).toBe(1);
      expect(message).toBe(explainReadError(refused('EBUSY'), 'c.md', process.platform));
      expect(message).not.toMatch(WRITE_WORDS);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    // Their bytes stay, and the temp file is gone.
    expect(await fs.readFile(file, 'utf8')).toBe('someone else\n');
    expect(await fs.readdir(root)).toEqual(['c.md']);
  });

  it('a save whose rename is refused keeps the write words', async () => {
    const file = await put('c.md', 'one\n');
    const content = await readChapter(file);
    const message = await shown(
      writeChapter(
        { path: file, text: 'two', eol: 'lf', bom: false, trailingNewline: true, expectedHash: content.hash },
        {
          atomic: {
            rename: (from: string, to: string) =>
              Promise.reject(
                Object.assign(new Error('EBUSY: refused'), { code: 'EBUSY', path: from, dest: to })
              ),
            sleep: () => Promise.resolve()
          }
        }
      )
    );
    expect(message).toMatch(/ replace c\.md\b/);
    expect(message).toMatch(/Nothing was written; the file is as it was\.$/);
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
  });
});

describe('writeChapter backup hooks (apply.10, PLAN 11.3 h)', () => {
  /** A save of `text` over what `file` holds now. */
  async function saveOver(file: string, text: string, hooks: WriteHooks): Promise<SaveResponse> {
    const content = await readChapter(file);
    return writeChapter(
      {
        path: file,
        text,
        eol: content.eol,
        bom: content.bom,
        trailingNewline: content.trailingNewline,
        expectedHash: content.hash
      },
      hooks
    );
  }

  it('hands beforeReplace the exact old bytes before anything is written, and returns its answer', async () => {
    const original = Buffer.from('﻿the river had began\r\n\r\nto climb\r\n', 'utf8');
    const file = await put('c.md', original);
    const calls: Array<{ file: string; bytes: Buffer; onDisk: Buffer }> = [];
    const order: string[] = [];
    const result = await saveOver(file, 'the river had begun\n\nto climb', {
      beforeReplace: async (target, bytes) => {
        order.push('beforeReplace');
        calls.push({ file: target, bytes: Buffer.from(bytes), onDisk: await fs.readFile(target) });
        return { name: '2026-10-14 16.04.33 c.md', created: true };
      },
      onWritten: () => order.push('onWritten'),
      afterWrite: async (target) => {
        order.push('afterWrite');
        expect(await fs.readFile(target, 'utf8')).toBe('﻿the river had begun\r\n\r\nto climb\r\n');
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe(file);
    expect(calls[0]!.bytes.equals(original)).toBe(true);
    expect(calls[0]!.onDisk.equals(original)).toBe(true);
    expect(order).toEqual(['beforeReplace', 'onWritten', 'afterWrite']);
    expect(result).toEqual({
      status: 'written',
      hash: hashBytes(Buffer.from('﻿the river had begun\r\n\r\nto climb\r\n', 'utf8')),
      backup: { name: '2026-10-14 16.04.33 c.md', created: true }
    });
  });

  it('writes nothing when beforeReplace throws, and says the backup failed', async () => {
    const file = await put('c.md', 'one\n');
    const old = new Date('2026-01-02T03:04:05.000Z');
    await fs.utimes(file, old, old);
    const seen: string[] = [];
    let after = false;
    const err = await saveOver(file, 'two', {
      beforeReplace: () => Promise.reject(new Error('there is no space left on the disk')),
      onWritten: (_f, hash) => seen.push(hash),
      afterWrite: () => {
        after = true;
        return Promise.resolve();
      }
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'Could not back up the chapter before saving, so nothing was written: there is no space left on the disk'
    );
    expect((err as { code?: string }).code).toBe('io');
    expect(await fs.readFile(file, 'utf8')).toBe('one\n');
    expect((await fs.stat(file)).mtime.getTime()).toBe(old.getTime());
    expect(await fs.readdir(root)).toEqual(['c.md']);
    expect(seen).toEqual([]);
    expect(after).toBe(false);
  });

  it('returns stale, keeping the new bytes, when the file changes during the backup', async () => {
    const file = await put('c.md', 'one\n');
    let after = false;
    const result = await saveOver(file, 'mine', {
      beforeReplace: async (target) => {
        await fs.writeFile(target, 'Obsidian saved this meanwhile\n');
        return { name: 'x', created: true };
      },
      afterWrite: () => {
        after = true;
        return Promise.resolve();
      }
    });
    expect(result.status).toBe('stale');
    expect(result.status === 'stale' && result.disk.text).toBe('Obsidian saved this meanwhile');
    expect(await fs.readFile(file, 'utf8')).toBe('Obsidian saved this meanwhile\n');
    expect(after).toBe(false);
  });

  it('calls no hook when the new bytes are the ones on disk, or the file is stale', async () => {
    const file = await put('c.md', 'one\n');
    const calls: string[] = [];
    const hooks: WriteHooks = {
      beforeReplace: () => {
        calls.push('beforeReplace');
        return Promise.resolve(undefined);
      },
      afterWrite: () => {
        calls.push('afterWrite');
        return Promise.resolve();
      }
    };
    expect(await saveOver(file, 'one', hooks)).toMatchObject({ status: 'written', unchanged: true });
    const content = await readChapter(file);
    await fs.writeFile(file, 'changed elsewhere\n');
    const stale = await writeChapter(
      { path: file, text: 'two', eol: 'lf', bom: false, trailingNewline: true, expectedHash: content.hash },
      hooks
    );
    expect(stale.status).toBe('stale');
    expect(calls).toEqual([]);
  });

  it('still reports the save written when afterWrite fails', async () => {
    const file = await put('c.md', 'one\n');
    const result = await saveOver(file, 'two', {
      beforeReplace: () => Promise.resolve({ name: 'b', created: false }),
      afterWrite: () => Promise.reject(new Error('prune failed'))
    });
    expect(result).toMatchObject({ status: 'written', backup: { name: 'b', created: false } });
    expect(await fs.readFile(file, 'utf8')).toBe('two\n');
  });

  it('reports a chapter removed during the backup as gone, writing nothing', async () => {
    const file = await put('c.md', 'one\n');
    await expect(
      saveOver(file, 'two', {
        beforeReplace: async (target) => {
          await fs.rm(target);
          return undefined;
        }
      })
    ).rejects.toThrow(/no longer at/);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('with the real hooks, two saves leave two backups in userData and nothing new beside the chapter', async () => {
    const vault = path.join(root, 'vault');
    const userData = path.join(root, 'userData');
    const original = Buffer.from('﻿one\r\ntwo\r\n', 'utf8');
    const file = path.join(vault, 'Chapter 01.md');
    await fs.mkdir(vault, { recursive: true });
    await fs.writeFile(file, original);
    const backupsRoot = backupsRootFor(userData);
    let clock = new Date(2026, 9, 14, 16, 4, 33);
    const hooks = chapterBackupHooks({ backupsRoot, manuscriptFolder: vault, ci: true, now: () => clock });

    const first = await saveOver(file, 'one\nthree', hooks);
    clock = new Date(2026, 9, 14, 16, 5, 0);
    const second = await saveOver(file, 'one\nfour', hooks);

    expect(first).toMatchObject({ backup: { name: '2026-10-14 16.04.33 Chapter 01.md', created: true } });
    expect(second).toMatchObject({ backup: { name: '2026-10-14 16.05.00 Chapter 01.md', created: true } });
    const folder = backupFolderFor(backupsRoot, file, true);
    const backups = await listBackups(folder);
    expect(backups.map((b) => b.name)).toEqual([
      '2026-10-14 16.05.00 Chapter 01.md',
      '2026-10-14 16.04.33 Chapter 01.md'
    ]);
    expect(hashBytes(await fs.readFile(backups[1]!.file))).toBe(hashBytes(original));
    expect(await fs.readFile(backups[0]!.file)).toEqual(Buffer.from('﻿one\r\nthree\r\n', 'utf8'));
    expect(await fs.readdir(vault)).toEqual(['Chapter 01.md']);
  });
});

describe('creating a chapter', () => {
  it('writes the file and reports it as a chapter', async () => {
    const file = await createChapter(root, 'Chapter 03 - The Bridge', 'md', 'One line.\n');
    expect(file.name).toBe('Chapter 03 - The Bridge.md');
    expect(file.relativePath).toBe('Chapter 03 - The Bridge.md');
    expect(await fs.readFile(file.path, 'utf8')).toBe('One line.\n');
    expect((await listChapters(root, null)).map((f) => f.name)).toContain('Chapter 03 - The Bridge.md');
  });

  it('creates a .txt chapter too', async () => {
    const file = await createChapter(root, 'Scratch', 'txt', 'notes');
    expect(file.name).toBe('Scratch.txt');
    // Written LF with a trailing newline, which is what the app normalizes to.
    expect(await fs.readFile(file.path, 'utf8')).toBe('notes\n');
  });

  it('does not double an extension the author typed', async () => {
    const file = await createChapter(root, 'Chapter 04.md', 'md', '');
    expect(file.name).toBe('Chapter 04.md');
  });

  it('never overwrites an existing file', async () => {
    await put('Taken.md', 'original contents\n');
    await expect(createChapter(root, 'Taken', 'md', 'new contents')).rejects.toThrow(/already exists/i);
    expect(await fs.readFile(path.join(root, 'Taken.md'), 'utf8')).toBe('original contents\n');
  });

  it('refuses separators, traversal and reserved names', async () => {
    expect(checkChapterName(root, 'sub/Chapter', 'md').valid).toBe(false);
    expect(checkChapterName(root, String.raw`..\escape`, 'md').valid).toBe(false);
    expect(checkChapterName(root, '../escape', 'md').valid).toBe(false);
    expect(checkChapterName(root, 'CON', 'md').valid).toBe(false);
    expect(checkChapterName(root, 'what?', 'md').valid).toBe(false);
    expect(checkChapterName(root, 'trailing.', 'md').valid).toBe(false);
    for (const name of ['sub/Chapter', '../escape', 'CON']) {
      await expect(createChapter(root, name, 'md', '')).rejects.toThrow();
    }
  });

  it('accepts the ordinary names a novelist types', () => {
    for (const name of ['Chapter 01 - The Flood', "Mara's letter", 'part-two_draft3']) {
      const verdict = checkChapterName(root, name, 'md');
      expect(verdict.valid).toBe(true);
      expect(path.dirname(verdict.path ?? '')).toBe(path.resolve(root));
    }
  });

  it('answers the live "is that name taken?" question', async () => {
    await put('Here.md', 'x');
    expect(await checkChapterNameOnDisk(root, 'Here', 'md')).toMatchObject({ valid: true, exists: true });
    expect(await checkChapterNameOnDisk(root, 'Here', 'txt')).toMatchObject({ valid: true, exists: false });
    expect(await checkChapterNameOnDisk(root, 'Not there', 'md')).toMatchObject({
      valid: true,
      exists: false
    });
  });
});

describe('which files Save may write (files.2)', () => {
  const vault = path.join(path.parse(process.cwd()).root, 'Vault', 'Novel');
  const elsewhere = path.join(path.parse(process.cwd()).root, 'Elsewhere');
  const guidelines = path.join(vault, 'GUIDELINES.md');

  function guard(opened: string[] = [], manuscriptFolder: string | null = vault, ci = true) {
    const set = new OpenedChapters(ci);
    for (const file of opened) set.add(file);
    return { manuscriptFolder, guidelinesPath: guidelines, opened: set, ci };
  }

  const NOT_OPENED = /was not opened from the manuscript folder chosen in Settings, so it was not saved/;

  it.each([
    ['a chapter in the folder', path.join(vault, 'Chapter 1.md'), guard(), null],
    ['a .txt chapter in a subfolder', path.join(vault, 'Part 2', 'Chapter 9.txt'), guard(), null],
    ['an upper-case extension', path.join(vault, 'Chapter 1.MD'), guard(), null],
    ['the folder spelled in another case', path.join(vault.toUpperCase(), 'Chapter 1.md'), guard(), null],
    ['a file outside the folder', path.join(elsewhere, 'Chapter 1.md'), guard(), NOT_OPENED],
    ['a folder whose name only starts the same', `${vault}let${path.sep}Chapter 1.md`, guard(), NOT_OPENED],
    ['a path that walks out with ..', `${vault}${path.sep}..${path.sep}Other.md`, guard(), NOT_OPENED],
    ['the folder itself', vault, guard(), /not a chapter file/],
    ['a non-chapter extension', path.join(vault, 'notes.json'), guard(), /not a chapter file/],
    ['a script', path.join(vault, 'run.bat'), guard(), /not a chapter file/],
    ['the guidelines file', guidelines, guard(), /is the guidelines file/],
    ['the guidelines file in another case', guidelines.toLowerCase(), guard(), /is the guidelines file/],
    ['anything when no folder is set', path.join(vault, 'Chapter 1.md'), guard([], null), NOT_OPENED],
    [
      'a chapter opened from the old folder after Settings changed',
      path.join(elsewhere, 'Chapter 1.md'),
      guard([path.join(elsewhere, 'Chapter 1.md')]),
      null
    ],
    [
      'an opened chapter, even then never as another extension',
      path.join(elsewhere, 'Chapter 1.exe'),
      guard([path.join(elsewhere, 'Chapter 1.exe')]),
      /not a chapter file/
    ],
    [
      'another case where the file system cares about case',
      path.join(vault.toUpperCase(), 'Chapter 1.md'),
      guard([], vault, false),
      NOT_OPENED
    ]
  ])('%s', (_label, file, context, refusal) => {
    if (refusal === null) expect(() => assertSavableChapter(file, context)).not.toThrow();
    else expect(() => assertSavableChapter(file, context)).toThrow(refusal);
  });

  it('refuses with invalid-input and names only the file', () => {
    try {
      assertSavableChapter(path.join(elsewhere, 'Chapter 1.md'), guard());
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ code: 'invalid-input' });
      expect((err as Error).message).toMatch(/^Chapter 1\.md was not opened/);
      expect((err as Error).message).toContain('Settings > Manuscript folder');
    }
  });

  it('knows which platforms ignore case', () => {
    expect(caseInsensitiveFs('win32')).toBe(true);
    expect(caseInsensitiveFs('darwin')).toBe(true);
    expect(caseInsensitiveFs('linux')).toBe(false);
  });
});

describe('only UTF-8 is read (files.3)', () => {
  const cp1252 = (text: string): Buffer =>
    Buffer.from([...text].map((ch) => (ch === 'é' ? 0xe9 : ch.charCodeAt(0))));

  it.each([
    [
      'UTF-16',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Chapter one', 'utf16le')]),
      /saved as UTF-16/
    ],
    ['Windows-1252', cp1252('The café was closed.\n'), /older encoding such as Windows-1252/],
    [
      'UTF-8 with a damaged character',
      Buffer.concat([Buffer.from('Café, naïve, résumé.\n', 'utf8'), cp1252('Le café.\n')]),
      /1 damaged character, the first on line 2/
    ],
    [
      'binary',
      // A handful of stray NULs in otherwise ordinary bytes, too few for UTF-16.
      Buffer.from('PK'.padEnd(400, 'x').replace(/x{20}/g, (run) => `\0${run.slice(1)}`)),
      /not look like a text file/
    ]
  ])('refuses %s with not-utf8 and leaves the file alone', async (_label, contents, message) => {
    const file = await put('ch.md', contents);
    const refused = await readChapter(file).catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: 'not-utf8' });
    expect((refused as Error).message).toMatch(message);
    await expect(readTextFile(file)).rejects.toMatchObject({ code: 'not-utf8' });
    expect(await fs.readFile(file)).toEqual(contents);
  });

  it('still round-trips a UTF-8 file with a BOM byte for byte', async () => {
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Café.\r\n\r\nNaïve.\r\n', 'utf8')
    ]);
    const file = await put('bom.md', original);
    const read = await readChapter(file);
    expect(read.bom).toBe(true);
    await writeChapter({
      path: file,
      text: read.text,
      eol: read.eol,
      bom: read.bom,
      trailingNewline: read.trailingNewline,
      expectedHash: read.hash
    });
    expect(await fs.readFile(file)).toEqual(original);
  });

  it('refuses to save over a file that was swapped to Windows-1252 after it was read', async () => {
    const file = await put('swap.md', 'The café was closed.\n');
    const read = await readChapter(file);
    const swapped = cp1252('The café was closed.\n');
    await fs.writeFile(file, swapped);
    await expect(
      writeChapter({
        path: file,
        text: 'The café was open.\n',
        eol: 'lf',
        bom: false,
        trailingNewline: true,
        expectedHash: read.hash
      })
    ).rejects.toMatchObject({ code: 'not-utf8' });
    expect(await fs.readFile(file)).toEqual(swapped);
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses a file over 4 MiB without reading it as text', async () => {
    const file = await put('huge.md', Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    const refused = await readChapter(file).catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: 'invalid-input' });
    expect((refused as Error).message).toMatch(/^huge\.md is 4\.0 MiB, and the app opens files up to 4 MiB/);
    await expect(readTextFile(file)).rejects.toMatchObject({ code: 'invalid-input' });
    await put('limit.md', Buffer.alloc(4 * 1024 * 1024, 0x61));
    await expect(readChapter(path.join(root, 'limit.md'))).resolves.toMatchObject({
      path: path.join(root, 'limit.md')
    });
  });

  it('words the advice for the platform', () => {
    const legacy = cp1252('café');
    expect(() => decodeText(legacy, 'C:/x/Ch.md', 'win32')).toThrow(/Notepad/);
    expect(() => decodeText(legacy, '/x/Ch.md', 'darwin')).toThrow(/VS Code/);
    expect(decodeText(Buffer.from('café'), '/x/Ch.md', 'linux')).toBe('café');
  });
});
