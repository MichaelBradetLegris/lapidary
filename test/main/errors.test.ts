import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppFailure,
  explainReadError,
  explainWriteError,
  readFailure,
  toAppError,
  type FileOperation
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

function notFound(code: string): Record<FileOperation, Record<'win32' | 'linux', Expected>> {
  return {
    read: same({
      code: 'io',
      message: `${APP_NAME} could not find Chapter 1.md. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${unchanged}`
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
        const failure = readFailure(err, undefined, platform);
        expect(failure).toBeInstanceOf(AppFailure);
        const read = toAppError(err, { operation: 'read', platform });
        // What the bridge sends: no operation, so a write unless already explained.
        expect(toAppError(failure)).toEqual(read);
        expect(toAppError(failure).message).not.toMatch(WRITE_WORDS);
      }
    }
  });

  it('names the file as told', () => {
    expect(readFailure(errno('EBUSY'), 'the review file 2026.review.json', 'linux').message).toBe(
      `${APP_NAME} is not allowed to read the review file 2026.review.json. Check that the file and its folder can be read, and that no other program is holding it, then try again. ${unchanged}`
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
