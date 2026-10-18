import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppFailure,
  explainReadError,
  explainWriteError,
  readFailure,
  toAppError,
  writeFailure,
  type FileOperation,
  type MakeKind
} from '../../src/main/errors';
import { APP_NAME } from '../../src/shared/branding';

/* apply.24: a refused read is explained as a read, a refused write as a
   write, for every error code, on Windows and elsewhere. */

const FILE = path.join(path.sep, 'vault', 'Chapter 1.md');

function errno(code: string, file: string = FILE): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: refused, open '${file}'`), { code, path: file });
}

/** Words that belong to a write and must never explain a read. */
const WRITE_WORDS = /replace|save again|Nothing was written|Controlled folder access|second and a half/;

/** Words that belong to a read and must never explain a write. */
const READ_WORDS = /\bread (Chapter|it)\b|could not find|has not changed anything|try again/;

const unchanged = `${APP_NAME} has not changed anything.`;

type Expected = { code: 'io' | 'unknown'; message: string | RegExp };

/** What each code says, read and written, on Windows and on Linux. */
const TABLE: Record<string, Record<FileOperation, Record<'win32' | 'linux', Expected>>> = {
  EBUSY: lockedBoth(),
  EPERM: lockedBoth(),
  EACCES: lockedBoth(),
  ENOENT: notFound('ENOENT'),
  ENOTDIR: notFound('ENOTDIR'),
  EISDIR: {
    read: same({
      code: 'io',
      message: `${APP_NAME} could not read Chapter 1.md, because it is a folder, not a file. ${unchanged}`
    }),
    write: same({ code: 'io', message: raw('EISDIR') })
  },
  EEXIST: { read: same(otherRead('EEXIST')), write: same({ code: 'io', message: raw('EEXIST') }) },
  ENOSPC: {
    read: same(otherRead('ENOSPC')),
    write: same({
      code: 'io',
      message:
        'There is no space left on the disk for Chapter 1.md. Free some space and save again. Nothing was written; the file is as it was.'
    })
  },
  EROFS: {
    read: same(otherRead('EROFS')),
    write: same({
      code: 'io',
      message:
        'Chapter 1.md is on a read-only drive, so it cannot be saved there. Nothing was written; the file is as it was.'
    })
  },
  EIO: { read: same(otherRead('EIO')), write: same({ code: 'unknown', message: raw('EIO') }) },
  // libuv's name for an error it has none for, such as a cloud file that cannot be fetched
  UNKNOWN: { read: same(otherRead('UNKNOWN')), write: same({ code: 'unknown', message: raw('UNKNOWN') }) }
};

function same(expected: Expected): Record<'win32' | 'linux', Expected> {
  return { win32: expected, linux: expected };
}

function raw(code: string): string {
  return `${code}: refused, open '${FILE}'`;
}

function otherRead(code: string): Expected {
  return {
    code: 'io',
    message: `${APP_NAME} could not read Chapter 1.md (${code}). If it is on a network, USB or cloud drive, check that the drive is connected, then try again. ${unchanged}`
  };
}

/** A read that finds nothing, of a file that is not a chapter (no `reopen`). */
function notFound(code: string): Record<FileOperation, Record<'win32' | 'linux', Expected>> {
  return {
    read: same({
      code: 'io',
      message: `${APP_NAME} could not find Chapter 1.md. It may have been renamed, moved or deleted. ${unchanged}`
    }),
    write: same({ code: 'io', message: raw(code) })
  };
}

function lockedBoth(): Record<FileOperation, Record<'win32' | 'linux', Expected>> {
  return {
    read: {
      win32: {
        code: 'io',
        message: `Windows would not let ${APP_NAME} read Chapter 1.md. Another program may have it open, such as a sync, backup or antivirus tool, or your Windows account may not be allowed to read it. Close it there, or wait a moment, and try again. ${unchanged}`
      },
      linux: {
        code: 'io',
        message: `${APP_NAME} is not allowed to read Chapter 1.md. Check that the file and its folder can be read, and that no other program is holding it, then try again. ${unchanged}`
      }
    },
    write: {
      win32: {
        code: 'io',
        message: new RegExp(
          `^Windows would not let ${APP_NAME} replace Chapter 1\\.md, even after trying for a second and a half\\..*Controlled folder access.*Nothing was written; the file is as it was\\.$`
        )
      },
      linux: {
        code: 'io',
        message: `${APP_NAME} is not allowed to replace Chapter 1.md. Check that the file and its folder are writable, and that no other program is holding it, then save again. Nothing was written; the file is as it was.`
      }
    }
  };
}

describe('toAppError, read and write', () => {
  for (const [code, byOperation] of Object.entries(TABLE)) {
    for (const operation of ['read', 'write'] as const) {
      for (const platform of ['win32', 'linux'] as const) {
        it(`${code}, ${operation}, ${platform}`, () => {
          const expected = byOperation[operation][platform];
          const error = toAppError(errno(code), { operation, platform });
          expect(error.code).toBe(expected.code);
          if (typeof expected.message === 'string') expect(error.message).toBe(expected.message);
          else expect(error.message).toMatch(expected.message);
          expect(error.detail).toContain(`${code}: refused`);
          if (operation === 'read') expect(error.message).not.toMatch(WRITE_WORDS);
          else expect(error.message).not.toMatch(READ_WORDS);
        });
      }
    }
  }

  it('takes an error as a write when nothing says otherwise', () => {
    for (const code of Object.keys(TABLE)) {
      for (const platform of ['win32', 'linux'] as const) {
        const err = errno(code);
        expect(toAppError(err, { platform })).toEqual(toAppError(err, { operation: 'write', platform }));
      }
    }
  });

  it('names the file as told, or by its own name, and a temp file by the file it stood for', () => {
    const named = toAppError(errno('EBUSY'), {
      operation: 'read',
      platform: 'win32',
      name: 'the file they are kept in'
    });
    expect(named.message).toMatch(/^Windows would not let \S+ read the file they are kept in\. /);
    expect(named.message).not.toContain(FILE);
    const tmp = path.join(path.sep, 'vault', '.Chapter 1.md.0123456789ab.tmp');
    expect(toAppError(errno('EPERM', tmp), { operation: 'read', platform: 'linux' }).message).toMatch(
      /not allowed to read Chapter 1\.md\./
    );
    expect(
      toAppError(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }), { operation: 'read' }).message
    ).toMatch(/read the file\./);
  });

  it('tells only a chapter it cannot find to be opened again from where it is now', () => {
    const reopenWords = /open it again|from where it is now/;
    for (const code of ['ENOENT', 'ENOTDIR']) {
      for (const platform of ['win32', 'linux'] as const) {
        expect(toAppError(errno(code), { operation: 'read', platform, reopen: true }).message).toBe(
          `${APP_NAME} could not find Chapter 1.md. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${unchanged}`
        );
        // A review file, the drafts file, the guidelines file or a backup
        // folder cannot be opened again from somewhere else.
        for (const name of [
          'the review file 2026-10-17T12-00-00-000Z.review.json',
          'the file they are kept in',
          'GUIDELINES.md',
          'the backup folder of Chapter 1.md'
        ]) {
          const message = toAppError(errno(code), { operation: 'read', platform, name }).message;
          expect(message).toBe(
            `${APP_NAME} could not find ${name}. It may have been renamed, moved or deleted. ${unchanged}`
          );
          expect(message).not.toMatch(reopenWords);
        }
      }
    }
    // No other code, read or written, has words that change with it.
    for (const code of Object.keys(TABLE)) {
      for (const operation of ['read', 'write'] as const) {
        for (const platform of ['win32', 'linux'] as const) {
          if (operation === 'read' && (code === 'ENOENT' || code === 'ENOTDIR')) continue;
          const err = errno(code);
          const chapter = toAppError(err, { operation, platform, reopen: true });
          expect(chapter, `${code} ${operation} ${platform}`).toEqual(
            toAppError(err, { operation, platform })
          );
          expect(chapter.message).not.toMatch(reopenWords);
        }
      }
    }
  });

  it('never starts a sentence with the name, so a file name is shown as it is', () => {
    const lower = path.join(path.sep, 'vault', 'chapter 1.md');
    for (const code of Object.keys(TABLE)) {
      for (const platform of ['win32', 'linux'] as const) {
        const message = toAppError(errno(code, lower), { operation: 'read', platform }).message;
        expect(message, code).toContain('chapter 1.md');
        expect(message, code).not.toContain('Chapter 1.md');
      }
    }
  });

  it('leaves errors that do not come from the file system as they are, either way', () => {
    for (const operation of ['read', 'write'] as const) {
      expect(toAppError(new SyntaxError('Unexpected token'), { operation })).toMatchObject({
        code: 'unknown',
        message: 'Unexpected token'
      });
      const argument = Object.assign(new TypeError('The "path" argument must be of type string'), {
        code: 'ERR_INVALID_ARG_TYPE'
      });
      expect(toAppError(argument, { operation }).message).toBe('The "path" argument must be of type string');
      expect(toAppError(new AppFailure('not-utf8', 'Re-save it as UTF-8.'), { operation })).toEqual({
        code: 'not-utf8',
        message: 'Re-save it as UTF-8.'
      });
      expect(toAppError('plain', { operation })).toEqual({ code: 'unknown', message: 'plain' });
    }
  });
});

describe('explainReadError and explainWriteError', () => {
  it('have nothing to say about an error without a system code', () => {
    for (const explain of [explainReadError, explainWriteError]) {
      expect(explain(new Error('plain'), 'Ch.md', 'win32')).toBeNull();
      expect(explain(null, 'Ch.md', 'win32')).toBeNull();
    }
    expect(
      explainReadError(Object.assign(new Error('x'), { code: 'ERR_INVALID_ARG_TYPE' }), 'Ch.md', 'win32')
    ).toBeNull();
  });
});

describe('readFailure', () => {
  it('carries the read words through the IPC bridge, which takes the rest as writes', () => {
    for (const code of Object.keys(TABLE)) {
      for (const platform of ['win32', 'linux'] as const) {
        const err = errno(code);
        const failure = readFailure(err, undefined, { platform });
        expect(failure).toBeInstanceOf(AppFailure);
        const read = toAppError(err, { operation: 'read', platform });
        // What the bridge sends: no operation, so a write unless already explained.
        expect(toAppError(failure)).toEqual(read);
        expect(toAppError(failure).message).not.toMatch(WRITE_WORDS);
      }
    }
  });

  it('names the file as told', () => {
    expect(
      readFailure(errno('EBUSY'), 'the review file 2026.review.json', { platform: 'linux' }).message
    ).toBe(
      `${APP_NAME} is not allowed to read the review file 2026.review.json. Check that the file and its folder can be read, and that no other program is holding it, then try again. ${unchanged}`
    );
  });

  it('tells a chapter, and only a chapter, to be opened again from where it is now', () => {
    expect(readFailure(errno('ENOENT'), 'Chapter 1.md', { reopen: true, platform: 'win32' }).message).toBe(
      `${APP_NAME} could not find Chapter 1.md. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${unchanged}`
    );
    expect(
      readFailure(errno('ENOENT'), 'the review file 2026.review.json', { platform: 'win32' }).message
    ).toBe(
      `${APP_NAME} could not find the review file 2026.review.json. It may have been renamed, moved or deleted. ${unchanged}`
    );
  });

  it('leaves alone what is already in words, and what does not come from the file system', () => {
    const refusal = new AppFailure('not-utf8', 'Re-save it as UTF-8.');
    expect(readFailure(refusal, 'Ch.md')).toBe(refusal);
    const parse = new SyntaxError('Unexpected token');
    expect(readFailure(parse, 'Ch.md')).toBe(parse);
    const argument = Object.assign(new TypeError('bad path'), { code: 'ERR_INVALID_ARG_TYPE' });
    expect(readFailure(argument, 'Ch.md')).toBe(argument);
    expect(readFailure('odd', 'Ch.md')).toEqual(new Error('odd'));
  });
});

/* apply.25: a write that makes something new, a file, a copy or a folder, is
   never retried and replaces nothing, so its words say what was being made
   and to try again; a temp file that could not be made is not retried
   either. Only a refused rename claims a second and a half. */

const CFA = `If that keeps happening, Windows Security's Controlled folder access may be blocking ${APP_NAME}: allow it under Windows Security > Virus & threat protection > Ransomware protection > Allow an app through Controlled folder access.`;

/** Words that belong to replacing a file, and the retries only a rename gets. */
const REPLACE_WORDS = /replace|save again|second and a half|even after|the file is as it was/;

/** A read's words, which a write that makes something must never have; "try again" is a write's too now. */
const READ_ONLY_WORDS = /\bread (Chapter|it|the)\b|could not find|has not changed anything/;

/** The exact words for each kind that makes something, on Windows and Linux. */
const MADE: Record<MakeKind, { name: string; win32: string; linux: string }> = {
  create: {
    name: 'Chapter 1.md',
    win32: `Windows would not let ${APP_NAME} create Chapter 1.md. Another program may be holding its folder, or your Windows account may not be allowed to add files to it. Wait a moment and try again. ${CFA} Nothing was written.`,
    linux: `${APP_NAME} is not allowed to create Chapter 1.md. Check that its folder is writable, then try again. Nothing was written.`
  },
  copy: {
    name: 'GUIDELINES.md',
    win32: `Windows would not let ${APP_NAME} create GUIDELINES.md from the template. Another program may be holding its folder, or your Windows account may not be allowed to add files to it. Wait a moment and try again. ${CFA} Nothing was written.`,
    linux: `${APP_NAME} is not allowed to create GUIDELINES.md from the template. Check that its folder is writable, then try again. Nothing was written.`
  },
  folder: {
    name: 'the review folder of Chapter 1.md',
    win32: `Windows would not let ${APP_NAME} create the review folder of Chapter 1.md. Another program may be holding the folder it goes in, or your Windows account may not be allowed to add folders there. Wait a moment and try again. ${CFA} Nothing was written.`,
    linux: `${APP_NAME} is not allowed to create the review folder of Chapter 1.md. Check that the folder it goes in is writable, then try again. Nothing was written.`
  }
};

describe('toAppError, by what the write was making (apply.25)', () => {
  for (const [kind, expected] of Object.entries(MADE) as [MakeKind, (typeof MADE)[MakeKind]][]) {
    it(`${kind}: a refusal says what was being made, claims no retries and says to try again`, () => {
      for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
        for (const platform of ['win32', 'linux'] as const) {
          const error = toAppError(errno(code), {
            operation: 'write',
            write: kind,
            name: expected.name,
            platform
          });
          expect(error.code).toBe('io');
          expect(error.message, `${code} ${platform}`).toBe(expected[platform]);
          expect(error.message).not.toMatch(REPLACE_WORDS);
          expect(error.message).not.toMatch(READ_ONLY_WORDS);
          // Controlled folder access blocks creating files too.
          expect(error.message.includes('Controlled folder access')).toBe(platform === 'win32');
        }
      }
    });

    it(`${kind}: a full disk and a read-only drive, and nothing else`, () => {
      for (const platform of ['win32', 'linux'] as const) {
        const context = { operation: 'write', write: kind, name: expected.name, platform } as const;
        expect(toAppError(errno('ENOSPC'), context).message).toBe(
          `There is no space left on the disk for ${expected.name}. Free some space and try again.`
        );
        expect(toAppError(errno('EROFS'), context).message).toBe(
          `${APP_NAME} cannot create ${expected.name}, because the drive is read-only. Nothing was written.`
        );
        // A folder that is not there has words of its own (apply.25 review, below).
        const others = ['EISDIR', 'EEXIST', 'EIO', 'UNKNOWN'];
        for (const code of kind === 'folder' ? others : ['ENOENT', 'ENOTDIR', ...others]) {
          expect(toAppError(errno(code), context).message, code).toBe(raw(code));
        }
      }
    });
  }

  it('takes a write as replacing a file when nothing says otherwise', () => {
    for (const code of Object.keys(TABLE)) {
      for (const platform of ['win32', 'linux'] as const) {
        const err = errno(code);
        expect(toAppError(err, { platform })).toEqual(toAppError(err, { write: 'replace', platform }));
      }
    }
  });

  it('words a read as a read whatever kind of write is named', () => {
    for (const kind of ['replace', 'create', 'copy', 'folder'] as const) {
      for (const platform of ['win32', 'linux'] as const) {
        const err = errno('EBUSY');
        expect(toAppError(err, { operation: 'read', write: kind, platform })).toEqual(
          toAppError(err, { operation: 'read', platform })
        );
      }
    }
  });

  it('claims no retries for a temp file that could not be made; a refused rename still does', () => {
    const dir = path.join(path.sep, 'vault');
    const tmp = path.join(dir, '.Chapter 1.md.0123456789ab.tmp');
    const target = path.join(dir, 'Chapter 1.md');
    const opened = (code: string): NodeJS.ErrnoException =>
      Object.assign(new Error(`${code}: refused, open '${tmp}'`), { code, syscall: 'open', path: tmp });
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      expect(toAppError(opened(code), { platform: 'win32' }).message).toBe(
        `Windows would not let ${APP_NAME} write the new version of Chapter 1.md into its folder. Another program may be holding the folder, or your Windows account may not be allowed to add files to it. Wait a moment and save again. ${CFA} Nothing was written; the file is as it was.`
      );
      expect(toAppError(opened(code), { platform: 'linux' }).message).toBe(
        `${APP_NAME} is not allowed to write the new version of Chapter 1.md into its folder. Check that the folder is writable, then save again. Nothing was written; the file is as it was.`
      );
      const renamed = Object.assign(new Error(`${code}: refused, rename`), {
        code,
        syscall: 'rename',
        path: tmp,
        dest: target
      });
      expect(toAppError(renamed, { platform: 'win32' }).message).toMatch(
        /^Windows would not let \S+ replace Chapter 1\.md, even after trying for a second and a half\. /
      );
    }
    // A full disk is worded as before, and a file that is not a temp file keeps the rename's words.
    expect(toAppError(opened('ENOSPC'), { platform: 'win32' }).message).toBe(
      'There is no space left on the disk for Chapter 1.md. Free some space and save again. Nothing was written; the file is as it was.'
    );
    expect(toAppError(errno('EPERM'), { platform: 'win32' }).message).toMatch(/even after trying/);
  });
});

describe('writeFailure (apply.25)', () => {
  it('carries the words for what was being made through the IPC bridge', () => {
    for (const kind of ['create', 'copy', 'folder'] as const) {
      for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOSPC', 'EROFS']) {
        for (const platform of ['win32', 'linux'] as const) {
          const err = errno(code);
          const failure = writeFailure(err, kind, 'the folder for GUIDELINES.md', { platform });
          expect(failure).toBeInstanceOf(AppFailure);
          // What the bridge sends: no kind, so a replace unless already explained.
          expect(toAppError(failure)).toEqual(
            toAppError(err, { write: kind, name: 'the folder for GUIDELINES.md', platform })
          );
          expect(toAppError(failure).message).not.toMatch(REPLACE_WORDS);
        }
      }
    }
  });

  it('names the file by its own name when not told', () => {
    expect(writeFailure(errno('EPERM'), 'create', undefined, { platform: 'linux' }).message).toBe(
      `${APP_NAME} is not allowed to create Chapter 1.md. Check that its folder is writable, then try again. Nothing was written.`
    );
  });

  it('leaves alone an error it has no words for, so its code can still be tested', () => {
    for (const code of ['EEXIST', 'ENOENT', 'EIO']) {
      const err = errno(code);
      expect(writeFailure(err, 'create')).toBe(err);
    }
    const refusal = new AppFailure('invalid-input', 'Already there.');
    expect(writeFailure(refusal, 'create')).toBe(refusal);
    const argument = Object.assign(new TypeError('bad path'), { code: 'ERR_INVALID_ARG_TYPE' });
    expect(writeFailure(argument, 'folder')).toBe(argument);
    expect(writeFailure('odd', 'copy')).toEqual(new Error('odd'));
  });
});

/* apply.25 review: a folder is made with everything on its path, so ENOENT
   means its drive, or the share it is on, is not there, and ENOTDIR that a
   file is in its way. The reviews folder, chosen in Settings, can be on a
   USB, network or cloud drive; while that drive is not connected no chapter
   opens, and Node 24 on Windows reports it as "ENOENT: no such file or
   directory, mkdir '\\?'", which must not be all the card says. */
describe('a folder that cannot be made where it goes (apply.25 review)', () => {
  const REVIEWS = 'the reviews folder Q:\\Reviews';
  /** Node 24 on Windows, for mkdir('Q:\\Reviews', {recursive: true}) with no Q: drive. */
  const missingDrive = (): NodeJS.ErrnoException =>
    Object.assign(new Error("ENOENT: no such file or directory, mkdir '\\\\?'"), {
      code: 'ENOENT',
      errno: -4058,
      syscall: 'mkdir',
      path: '\\\\?'
    });

  const notThere = (name: string, settings: string): string =>
    `${APP_NAME} could not create ${name}, because the drive or the folder it goes in is not there. If it is on a network, USB or cloud drive, check that the drive is connected${settings}, then try again. Nothing was written.`;
  const fileInTheWay = (name: string, settings: string): string =>
    `${APP_NAME} could not create ${name}, because a file has the name of one of the folders it goes in. Move or rename that file${settings}, then try again. Nothing was written.`;
  const SETTINGS = ', or choose another reviews folder in Settings';

  it('says the drive or the folder it goes in is not there, and offers Settings only for a folder chosen there', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const context = { operation: 'write', write: 'folder', platform } as const;
      const shown = toAppError(missingDrive(), { ...context, name: REVIEWS, setting: 'reviews folder' });
      expect(shown.code).toBe('io');
      expect(shown.message).toBe(notThere(REVIEWS, SETTINGS));
      expect(
        toAppError(errno('ENOENT'), { ...context, name: 'the review folder of Chapter 1.md' }).message
      ).toBe(notThere('the review folder of Chapter 1.md', ''));
    }
  });

  it('says a file is in the way of a folder', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const context = { operation: 'write', write: 'folder', platform } as const;
      expect(
        toAppError(errno('ENOTDIR'), { ...context, name: REVIEWS, setting: 'reviews folder' }).message
      ).toBe(fileInTheWay(REVIEWS, SETTINGS));
      expect(toAppError(errno('ENOTDIR'), { ...context, name: 'the folder for GUIDELINES.md' }).message).toBe(
        fileInTheWay('the folder for GUIDELINES.md', '')
      );
    }
  });

  it('never shows the system text, its code or the path Windows gives', () => {
    const message = toAppError(missingDrive(), {
      write: 'folder',
      name: REVIEWS,
      setting: 'reviews folder',
      platform: 'win32'
    }).message;
    expect(message).not.toMatch(/ENOENT|no such file|mkdir|\\\\\?/);
    expect(message).not.toMatch(REPLACE_WORDS);
    expect(message).not.toMatch(READ_ONLY_WORDS);
  });

  it('keeps ENOENT and ENOTDIR as they are for a new file or a copy, whose callers test the code', () => {
    for (const kind of ['create', 'copy'] as const) {
      for (const code of ['ENOENT', 'ENOTDIR']) {
        const err = errno(code);
        expect(toAppError(err, { write: kind, setting: 'reviews folder', platform: 'win32' }).message).toBe(
          raw(code)
        );
        expect(writeFailure(err, kind, undefined, { setting: 'reviews folder' })).toBe(err);
      }
    }
  });

  it('adds Settings to no other words of a folder', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOSPC', 'EROFS']) {
      for (const platform of ['win32', 'linux'] as const) {
        const context = { write: 'folder', name: REVIEWS, platform } as const;
        const err = errno(code);
        expect(toAppError(err, { ...context, setting: 'reviews folder' })).toEqual(toAppError(err, context));
      }
    }
  });

  it('carries the words through the IPC bridge from writeFailure', () => {
    const failure = writeFailure(missingDrive(), 'folder', REVIEWS, { setting: 'reviews folder' });
    expect(failure).toBeInstanceOf(AppFailure);
    expect(toAppError(failure).message).toBe(notThere(REVIEWS, SETTINGS));
    expect(toAppError(writeFailure(errno('ENOTDIR'), 'folder', REVIEWS)).message).toBe(
      fileInTheWay(REVIEWS, '')
    );
  });
});
