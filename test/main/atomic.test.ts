import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENAME_BACKOFF_MS, atomicWriteFile, type TargetCheck } from '../../src/main/atomic';
import { explainWriteError, toAppError } from '../../src/main/errors';
import { readChapter, writeChapter } from '../../src/main/files';
import { APP_NAME } from '../../src/shared/branding';

/* files.4: a write that survives a file held open for a moment. */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-atomic-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function errno(code: string, file?: string, dest?: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: refused`), { code, path: file, dest });
}

/** A rename that refuses with `code` the first `times` calls, then really renames. */
function refusing(code: string, times = Infinity) {
  const calls: string[] = [];
  const rename = async (from: string, to: string): Promise<void> => {
    calls.push(to);
    if (calls.length <= times) throw errno(code, from, to);
    await fs.rename(from, to);
  };
  return { calls, rename };
}

function recordSleeps() {
  const waits: number[] = [];
  return { waits, sleep: (ms: number): Promise<void> => (waits.push(ms), Promise.resolve()) };
}

async function leftovers(): Promise<string[]> {
  return (await fs.readdir(root)).filter((name) => name.endsWith('.tmp'));
}

describe('atomicWriteFile', () => {
  it('waits out a lock that clears, backing off', async () => {
    const target = path.join(root, 'ch.md');
    await fs.writeFile(target, 'old');
    const { calls, rename } = refusing('EPERM', 2);
    const { waits, sleep } = recordSleeps();
    expect(await atomicWriteFile(target, Buffer.from('new'), { rename, sleep })).toBe('written');
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([50, 100]);
    expect(await fs.readFile(target, 'utf8')).toBe('new');
    expect(await leftovers()).toEqual([]);
  });

  it('gives up after six attempts and about a second and a half, leaving the file alone', async () => {
    const target = path.join(root, 'ch.md');
    await fs.writeFile(target, 'old');
    const { calls, rename } = refusing('EBUSY');
    const { waits, sleep } = recordSleeps();
    await expect(atomicWriteFile(target, Buffer.from('new'), { rename, sleep })).rejects.toMatchObject({
      code: 'EBUSY'
    });
    expect(calls).toHaveLength(6);
    expect(waits.slice(0, 5)).toEqual([...RENAME_BACKOFF_MS]);
    expect(RENAME_BACKOFF_MS.reduce((a, b) => a + b, 0)).toBe(1550);
    expect(await fs.readFile(target, 'utf8')).toBe('old');
    expect(await leftovers()).toEqual([]);
  });

  it('does not retry an error that waiting cannot fix', async () => {
    const target = path.join(root, 'ch.md');
    const { calls, rename } = refusing('ENOSPC');
    await expect(
      atomicWriteFile(target, Buffer.from('new'), { rename, sleep: recordSleeps().sleep })
    ).rejects.toMatchObject({
      code: 'ENOSPC'
    });
    expect(calls).toHaveLength(1);
    expect(await leftovers()).toEqual([]);
  });

  it('skips the rename in a round where the target cannot even be read', async () => {
    const target = path.join(root, 'ch.md');
    await fs.writeFile(target, 'old');
    const { calls, rename } = refusing('EPERM');
    const checks: TargetCheck[] = ['unreadable', 'same', 'unreadable', 'same', 'same'];
    const beforeRetry = (): Promise<TargetCheck> => Promise.resolve(checks.shift() ?? 'same');
    await expect(
      atomicWriteFile(target, Buffer.from('new'), { rename, sleep: recordSleeps().sleep, beforeRetry })
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(calls).toHaveLength(4);
  });

  it.skipIf(process.platform === 'win32')('keeps the target s permission bits', async () => {
    const target = path.join(root, 'ch.md');
    await fs.writeFile(target, 'old');
    await fs.chmod(target, 0o640);
    await atomicWriteFile(target, Buffer.from('new'));
    expect((await fs.stat(target)).mode & 0o777).toBe(0o640);
  });
});

describe('writeChapter while the chapter is locked', () => {
  it('stops with stale, keeping the outside bytes, when the file changes during the retries', async () => {
    const file = path.join(root, 'ch.md');
    await fs.writeFile(file, 'The café was closed.\n');
    const read = await readChapter(file);
    let changed = false;
    const rename = async (from: string, to: string): Promise<void> => {
      if (!changed) {
        // Obsidian holds the file and writes the author's own edit meanwhile.
        changed = true;
        await fs.writeFile(to, 'The café was closed early.\n');
        throw errno('EPERM', from, to);
      }
      await fs.rename(from, to);
    };
    const response = await writeChapter(
      {
        path: file,
        text: 'The café was open.',
        eol: 'lf',
        bom: false,
        trailingNewline: true,
        expectedHash: read.hash
      },
      { atomic: { rename, sleep: recordSleeps().sleep } }
    );
    expect(response.status).toBe('stale');
    expect(response.status === 'stale' && response.disk.text).toBe('The café was closed early.');
    expect(await fs.readFile(file, 'utf8')).toBe('The café was closed early.\n');
    expect(await leftovers()).toEqual([]);
  });

  it('saves once a brief lock clears', async () => {
    const file = path.join(root, 'ch.md');
    await fs.writeFile(file, 'one\n');
    const read = await readChapter(file);
    const { rename } = refusing('EBUSY', 3);
    const response = await writeChapter(
      { path: file, text: 'two', eol: 'lf', bom: false, trailingNewline: true, expectedHash: read.hash },
      { atomic: { rename, sleep: recordSleeps().sleep } }
    );
    expect(response.status).toBe('written');
    expect(await fs.readFile(file, 'utf8')).toBe('two\n');
  });
});

describe('explainWriteError', () => {
  it('gives the Windows lock and Controlled folder access text, naming the app', () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const text = explainWriteError(errno(code), 'Chapter 1.md', 'win32')!;
      expect(text).toContain(`Windows would not let ${APP_NAME} replace Chapter 1.md`);
      expect(text).toContain('Controlled folder access');
      expect(text).toMatch(/Nothing was written; the file is as it was\.$/);
    }
    expect(explainWriteError(errno('EACCES'), 'Chapter 1.md', 'darwin')).toContain('writable');
  });

  it('explains a full disk and a read-only drive, and nothing else', () => {
    expect(explainWriteError(errno('ENOSPC'), 'Ch.md', 'win32')).toMatch(
      /^There is no space left on the disk for Ch\.md/
    );
    expect(explainWriteError(errno('EROFS'), 'Ch.md', 'linux')).toMatch(/^Ch\.md is on a read-only drive/);
    expect(explainWriteError(errno('ENOENT'), 'Ch.md', 'win32')).toBeNull();
    expect(explainWriteError(new Error('plain'), 'Ch.md', 'win32')).toBeNull();
  });

  it('is what toAppError says, naming the chapter rather than the temp file', () => {
    const target = path.join(root, 'Chapter 1.md');
    const tmp = path.join(root, '.Chapter 1.md.0123456789ab.tmp');
    const error = toAppError(errno('EPERM', tmp, target), { platform: 'win32' });
    expect(error.code).toBe('io');
    expect(error.message).toMatch(/replace Chapter 1\.md, even after/);
    expect(toAppError(errno('ENOSPC', tmp), { platform: 'win32' }).message).toContain(
      'disk for Chapter 1.md'
    );
  });
});
