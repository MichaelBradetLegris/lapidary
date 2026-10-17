import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOW_MARKER,
  decodeText,
  findLeaks,
  looksBinary,
  scanFiles,
  skippedByName,
  type LeakKind
} from '../../scripts/check-public';

/*
 * opensource.7: scripts/check-public.ts. Every profile path and address here is
 * a placeholder, and each line that spells one carries the allow marker, so the
 * checker passes this file too. Key shapes are put together at run time, so the
 * file holds no key-shaped literal for any scanner to trip on.
 */

const HOME = 'C:\\Users\\Ann'; // check-public: allow
const POSIX_HOME = '/home/ann'; // check-public: allow
const ADDRESS = 'ann.writer+books@mailbox.invalid'; // check-public: allow
const BODY = 'Ab12'.repeat(10);

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'check-public.ts'
);

function kinds(text: string): LeakKind[] {
  return findLeaks(text, 'a.md').map((leak) => leak.kind);
}

function one(kind: LeakKind, text: string, line = 1, file = 'a.md') {
  return [{ file, line, kind, text }];
}

describe('Windows profile paths', () => {
  it.each([
    ['C:\\Users\\Ann\\Vault', 'C:\\Users\\Ann'], // check-public: allow
    ['C:/Users/Ann/Vault', 'C:/Users/Ann'], // check-public: allow
    ['{"path":"C:\\\\Users\\\\Ann\\\\Vault"}', 'C:\\\\Users\\\\Ann'], // check-public: allow
    ["d:\\users\\ann o'neil\\x", 'd:\\users\\ann'], // check-public: allow
    ['file:///E:/USERS/Ann/x.md', 'E:/USERS/Ann'], // check-public: allow
    ['PATH=C:/bin;C:/Users/Ann/bin', 'C:/Users/Ann'] // check-public: allow
  ])('finds %s, once', (line, text) => {
    expect(findLeaks(line, 'a.md')).toEqual(one('windows-profile-path', text));
  });

  it.each([
    'C:\\Users\\<name>\\.local\\bin',
    '%USERPROFILE%\\.local\\bin\\claude.exe',
    'C:\\Users\\%USERNAME%',
    'C:\\Users\\',
    'C:\\vault\\Chapter 1.md',
    'C:/Program Files/x'
  ])('passes the placeholder or plain path %s', (line) => {
    expect(findLeaks(line, 'a.md')).toEqual([]);
  });
});

describe('POSIX profile paths', () => {
  it.each([
    ['/home/ann/novel', '/home/ann'], // check-public: allow
    ['/Users/ann/Novel', '/Users/ann'], // check-public: allow
    ["'/home/ann o'\\''neil/x'", '/home/ann'], // check-public: allow
    ['cd /c/Users/ann/dev', '/c/Users/ann'], // check-public: allow
    ['/mnt/c/Users/ann/dev', '/mnt/c/Users/ann'], // check-public: allow
    ['file:///home/ann/x.md', '/home/ann'], // check-public: allow
    ['/var/home/ann/x', '/var/home/ann'], // check-public: allow
    ['/usr/home/ann/x', '/usr/home/ann'], // check-public: allow
    ['PATH=/usr/local/bin:/home/ann/.local/bin', '/home/ann'], // check-public: allow
    ['export PATH="$PATH:/Users/ann/bin"', '/Users/ann'], // check-public: allow
    ['PATH=/usr/bin:/c/Users/ann/bin', '/c/Users/ann'], // check-public: allow
    ['scp ann@host:/home/ann/x', '/home/ann'], // check-public: allow
    ['scp build.zip host:/home/ann/drop/', '/home/ann'] // check-public: allow
  ])('finds %s, once', (line, text) => {
    expect(findLeaks(line, 'a.md')).toEqual(one('posix-profile-path', text));
  });

  it.each([
    'https://github.com/home/x and https://example.com/Users/ann',
    'http://localhost:8080/home/ann and https://example.com/var/home/ann',
    '/usr/local/bin/claude',
    '$HOME/.local/bin',
    '/home/<name>',
    'src/home/page.tsx'
  ])('passes %s', (line) => {
    expect(findLeaks(line, 'a.md')).toEqual([]);
  });
});

describe('email addresses', () => {
  it.each([
    ADDRESS,
    'ann@notexample.com', // check-public: allow
    'ann@example.com.mailbox.invalid', // check-public: allow
    'git@gitlab.invalid' // check-public: allow
  ])('finds %s', (address) => {
    expect(findLeaks(`write to ${address}.`, 'a.md')).toEqual(one('email', address));
  });

  it.each([
    '45394569+someone@users.noreply.github.com',
    'noreply@anthropic.com',
    'ann@example.com',
    'ann.o.example+books@mail.example.com',
    'a@example.org',
    'git@github.com:owner/repo.git'
  ])('allows %s', (address) => {
    expect(findLeaks(`write to ${address}.`, 'a.md')).toEqual([]);
  });

  it('passes package names and versions', () => {
    expect(findLeaks('npm i @scope/pkg@1.2.3 react@18.3.1 node_modules/@openai/x', 'a.md')).toEqual([]);
  });
});

describe('key shapes', () => {
  it.each([
    ['sk-', 'sk-key'],
    ['sk-ant-api03-', 'sk-key'],
    ['sk-proj-', 'sk-key'],
    ['ghp_', 'github-token'],
    ['gho_', 'github-token'],
    ['github_pat_', 'github-token']
  ] as const)('finds a long %s value', (prefix, kind) => {
    const value = prefix + BODY;
    expect(findLeaks(`KEY=${value} rest`, 'a.md')).toEqual(one(kind, value));
  });

  it.each(['RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ', ''])('finds a %sPEM private key', (type) => {
    expect(kinds(`-----BEGIN ${type}PRIVATE KEY-----`)).toEqual(['private-key']);
  });

  it('anchors at a word boundary', () => {
    const tail = 'abcdefghijklmnopqrstu';
    expect(kinds(`sk-${tail}`)).toEqual(['sk-key']);
    expect(kinds(`task-${tail}`)).toEqual([]);
    expect(kinds(`ask-${BODY}`)).toEqual([]);
    expect(kinds(`my_ghp_${BODY}`)).toEqual([]);
  });

  it.each([
    'sk-test',
    'sk-ant-test',
    'sk-test-ok-1234',
    'search for ghp_, gho_ and github_pat_',
    'search for `BEGIN .*PRIVATE KEY`',
    '-----BEGIN PUBLIC KEY-----'
  ])('passes the short dummy or bare prefix in %s', (line) => {
    expect(findLeaks(line, 'a.md')).toEqual([]);
  });
});

describe('the allow marker', () => {
  it('is the documented phrase', () => {
    expect(ALLOW_MARKER).toBe('check-public: allow');
  });

  it('skips its own line and no other', () => {
    const text = [`home = '${HOME}' // ${ALLOW_MARKER}`, `home = '${HOME}'`].join('\n');
    expect(findLeaks(text, 'a.ts')).toEqual(one('windows-profile-path', HOME, 2, 'a.ts'));
  });

  it('works in any comment style', () => {
    expect(findLeaks(`${HOME} # ${ALLOW_MARKER}`, 'a.yml')).toEqual([]);
    expect(findLeaks(`${HOME} <!-- ${ALLOW_MARKER} -->`, 'a.md')).toEqual([]);
    expect(findLeaks(`${HOME} /* ${ALLOW_MARKER} */`, 'a.css')).toEqual([]);
    expect(findLeaks(` * ${ALLOW_MARKER}: ${HOME}`, 'a.ts')).toEqual([]);
  });

  it.each([
    `Mark the line with \`${ALLOW_MARKER}\`, as in ${HOME}.`,
    `"${ALLOW_MARKER}" ${HOME}`,
    `${HOME} // see ${ALLOW_MARKER}`,
    `${HOME} // ${ALLOW_MARKER}ed`
  ])('counts only right after a comment opener, so %s is scanned', (line) => {
    expect(kinds(line)).toEqual(['windows-profile-path']);
  });
});

describe('lines', () => {
  it('numbers lines from 1 across LF and CRLF, with one entry per hit', () => {
    const text = `clean\r\n${HOME} and ${ADDRESS}\n\n${POSIX_HOME}\n`;
    expect(findLeaks(text, 'b.md')).toEqual([
      { file: 'b.md', line: 2, kind: 'windows-profile-path', text: HOME },
      { file: 'b.md', line: 2, kind: 'email', text: ADDRESS },
      { file: 'b.md', line: 4, kind: 'posix-profile-path', text: POSIX_HOME }
    ]);
  });
});

describe('scanFiles', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads text files and passes over the lockfile, binaries, folders and missing files', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'check-public-'));
    const leak = `path ${HOME}\n`;
    writeFileSync(path.join(dir, 'notes.md'), `clean\n${leak}`);
    writeFileSync(path.join(dir, 'package-lock.json'), leak);
    writeFileSync(path.join(dir, 'icon.PNG'), leak);
    writeFileSync(path.join(dir, 'data.bin'), Buffer.concat([Buffer.from(leak), Buffer.from([0])]));
    mkdirSync(path.join(dir, 'folder'));
    const files = ['notes.md', 'package-lock.json', 'icon.PNG', 'data.bin', 'folder', 'deleted.md'];
    expect(scanFiles(dir, files)).toEqual({
      scanned: 1,
      skipped: ['data.bin'],
      leaks: one('windows-profile-path', HOME, 2, 'notes.md')
    });
  });

  it('reads UTF-16 with a byte order mark, as Windows PowerShell 5.1 writes it', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'check-public-'));
    const utf16 = Buffer.from(`clean\r\nvault = ${HOME}\\Vault\r\n`, 'utf16le');
    writeFileSync(path.join(dir, 'le.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]));
    writeFileSync(
      path.join(dir, 'be.txt'),
      Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()])
    );
    expect(scanFiles(dir, ['le.txt', 'be.txt'])).toEqual({
      scanned: 2,
      skipped: [],
      leaks: [
        ...one('windows-profile-path', HOME, 2, 'le.txt'),
        ...one('windows-profile-path', HOME, 2, 'be.txt')
      ]
    });
  });

  it('decodes by byte order mark, and treats a NUL character in UTF-16 as binary', () => {
    const le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeText(le('héllo'))).toBe('héllo');
    expect(decodeText(le('a\0b'))).toBeUndefined();
    // An odd trailing byte in big-endian text is dropped, not misread.
    expect(decodeText(Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x00]))).toBe('A');
    expect(decodeText(Buffer.from('plain ascii'))).toBe('plain ascii');
    expect(decodeText(Buffer.from([65, 0, 66]))).toBeUndefined();
    expect(decodeText(Buffer.alloc(0))).toBe('');
  });

  it('skips by name and by a NUL byte in the first 8 KiB', () => {
    expect(skippedByName('sub/package-lock.json')).toBe(true);
    expect(skippedByName('resources/icon/icon.ico')).toBe(true);
    expect(skippedByName('README.md')).toBe(false);
    expect(looksBinary(new Uint8Array([65, 0, 66]))).toBe(true);
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
  });
});

describe('the command line', () => {
  let repo = '';
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = '';
  });

  function git(...args: string[]): void {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }

  function run(script = SCRIPT, cwd = repo): { status: number | null; out: string[]; all: string } {
    const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    return {
      status: result.status,
      out: result.stdout.split(/\r?\n/).filter((line) => line.length > 0),
      all: result.stdout + result.stderr
    };
  }

  // Spawns git and Node, which can be slow on a cold CI machine.
  it('runs under plain Node on tracked and unignored files, exiting 1 on a hit', { timeout: 30_000 }, () => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'check-public-repo-'));
    git('init', '-q');
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.md\n');
    writeFileSync(path.join(repo, 'tracked.md'), `${HOME}\n`);
    git('add', 'tracked.md');
    writeFileSync(path.join(repo, 'untracked.md'), `x\n${POSIX_HOME}\n`);
    writeFileSync(path.join(repo, 'ignored.md'), `${HOME}\n`);

    const failing = run();
    expect(failing.status).toBe(1);
    expect([...failing.out].sort()).toEqual([
      'tracked.md:1: windows-profile-path',
      'untracked.md:2: posix-profile-path'
    ]);
    // The value itself is never printed.
    expect(failing.all).not.toContain(HOME);
    expect(failing.all).not.toContain(POSIX_HOME);

    // Fixed, or marked: exit 0. The scan covers .gitignore, tracked.md and untracked.md.
    writeFileSync(path.join(repo, 'tracked.md'), 'clean\n');
    writeFileSync(path.join(repo, 'untracked.md'), `${POSIX_HOME} // ${ALLOW_MARKER}\n`);
    const passing = run();
    expect(passing.status).toBe(0);
    expect(passing.out).toEqual(['check-public: nothing found in 3 files.']);
  });

  // Node gives the module its real path, while argv keeps the link. A guard that
  // compared the two as written would scan nothing and exit 0.
  it('still scans when the script is reached through a junction or symlink', { timeout: 30_000 }, () => {
    // Everything, the link's target included, lives under this one scratch folder.
    repo = mkdtempSync(path.join(os.tmpdir(), 'check-public-link-'));
    const real = path.join(repo, 'real');
    mkdirSync(path.join(real, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, path.join(real, 'scripts', 'check-public.ts'));
    writeFileSync(path.join(real, 'leak.md'), `vault = ${HOME}\\Vault\n`);
    expect(spawnSync('git', ['init', '-q'], { cwd: real }).status).toBe(0);
    const link = path.join(repo, 'link');
    // 'junction' needs no admin rights on Windows and is ignored elsewhere.
    symlinkSync(real, link, 'junction');

    const result = run(path.join(link, 'scripts', 'check-public.ts'), link);
    expect(result.out).toEqual(['leak.md:1: windows-profile-path']);
    expect(result.status).toBe(1);
  });

  it('names a file it does not read because it looks binary', { timeout: 30_000 }, () => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'check-public-repo-'));
    git('init', '-q');
    writeFileSync(path.join(repo, 'data.bin'), Buffer.from([65, 0, 66]));
    writeFileSync(path.join(repo, 'a.md'), 'clean\n');
    writeFileSync(path.join(repo, 'b.md'), 'clean\n');
    const result = run();
    expect(result.status).toBe(0);
    expect(result.out).toEqual([
      'check-public: not read, looks binary: data.bin',
      'check-public: nothing found in 2 files.'
    ]);
  });
});
