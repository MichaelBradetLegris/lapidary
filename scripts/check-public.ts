/*
 * opensource.7: a guard against publishing what belongs to one machine or one
 * person. It reads every file git would commit and reports each line that holds
 * a profile path, an email address or something shaped like a key.
 *
 *   npm run check:public
 *   node scripts/check-public.ts
 *
 * Node strips the types itself, so this file uses only erasable TypeScript and
 * Node's built-in modules: nothing has to be built or installed first.
 *
 * A line that has to keep such a value, such as a test fixture with a
 * placeholder profile path, ends with a comment that starts with the marker
 * `check-public: allow`. The marker covers its own line and no other, and only
 * counts right after a comment opener, so prose that names it is still scanned.
 * The output names the file, the line and the kind of hit, never the value, so a
 * real key does not end up in a CI log.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LeakKind =
  'windows-profile-path' | 'posix-profile-path' | 'email' | 'sk-key' | 'github-token' | 'private-key';

export interface Leak {
  file: string;
  /** 1-based. */
  line: number;
  kind: LeakKind;
  /** What matched. Tests read it; the command line never prints it. */
  text: string;
}

export const ALLOW_MARKER = 'check-public: allow';

/** The marker right after `//`, `/*`, `#`, `<!--` or a leading `*`, with only spaces between. */
const ALLOW_COMMENT = /(?:\/\/|\/\*|#|<!--|^\s*\*)\s*check-public: allow\b/;

interface Rule {
  kind: LeakKind;
  /** Global, so `matchAll` can walk every hit on a line. */
  pattern: RegExp;
  /** Matches that are fine to publish. */
  allowed?: (match: string) => boolean;
}

/*
 * A user name starts with a letter, digit or underscore. Placeholders such as
 * `<name>`, `%USERNAME%`, `$USER` and `{user}` start with something else and pass.
 */
const RULES: readonly Rule[] = [
  {
    // C:\Users\<name>, C:/Users/<name> and JSON's C:\\Users\\<name>, on any drive, in any case.
    kind: 'windows-profile-path',
    pattern: /\b[a-z]:(?:\\+|\/+)users(?:\\+|\/+)[\p{L}\p{N}_][\p{L}\p{N}_.-]*/giu
  },
  {
    // /home/<name> and /Users/<name>, also as Git Bash (/c/Users/<name>), WSL
    // (/mnt/c/Users/<name>), Fedora Atomic (/var/home/<name>) and FreeBSD
    // (/usr/home/<name>) write them. Not after a letter, digit, `_`, `.` or `-`, so
    // URL paths do not count. Not after a drive letter and colon either, as the
    // rule above already reports C:/Users/<name>; any other colon, as in a PATH
    // list or an scp target, still counts.
    kind: 'posix-profile-path',
    pattern:
      /(?<![\p{L}\p{N}_.-])(?<!(?:^|[^\p{L}\p{N}_])[a-z]:)(?:\/(?:mnt|var|usr))?(?:\/[a-z])?\/(?:home|users)\/[\p{L}\p{N}_][\p{L}\p{N}_.-]*/giu
  },
  {
    kind: 'email',
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allowed: allowedEmail
  },
  {
    // OpenAI (sk-, sk-proj-) and Anthropic (sk-ant-) keys. Real ones have a body far
    // longer than 20 characters; short dummies such as sk-test pass.
    kind: 'sk-key',
    pattern: /(?<![A-Za-z0-9_-])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g
  },
  {
    // GitHub tokens: classic (ghp_), OAuth (gho_), app (ghs_, ghu_), refresh (ghr_)
    // and fine-grained (github_pat_).
    kind: 'github-token',
    pattern: /(?<![A-Za-z0-9_])(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g
  },
  {
    // The first line of a PEM private key: RSA, EC, OPENSSH, ENCRYPTED or none.
    kind: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g
  }
];

/** Addresses that belong to no one, or that GitHub hands out so a real one stays private. */
function allowedEmail(address: string): boolean {
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at).toLowerCase();
  const domain = address.slice(at + 1).toLowerCase();
  if (local === 'git' && domain === 'github.com') return true;
  if (local === 'noreply' || local === 'no-reply') return true;
  if (domain === 'users.noreply.github.com') return true;
  return ['example.com', 'example.org'].some((safe) => domain === safe || domain.endsWith(`.${safe}`));
}

/** Every hit in `text`, which is the content of `file`. Lines with an allow comment are skipped. */
export function findLeaks(text: string, file: string): Leak[] {
  const leaks: Leak[] = [];
  text.split(/\r?\n/).forEach((content, index) => {
    if (ALLOW_COMMENT.test(content)) return;
    for (const rule of RULES) {
      for (const match of content.matchAll(rule.pattern)) {
        if (rule.allowed?.(match[0])) continue;
        leaks.push({ file, line: index + 1, kind: rule.kind, text: match[0] });
      }
    }
  });
  return leaks;
}

/** Generated, and full of third-party metadata the project does not write. */
const SKIPPED_FILES: ReadonlySet<string> = new Set(['package-lock.json']);

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.7z',
  '.bmp',
  '.dll',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.node',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.tgz',
  '.ttf',
  '.wasm',
  '.wav',
  '.webp',
  '.woff',
  '.woff2',
  '.zip'
]);

/** A NUL byte in the first 8 KiB means binary, much as git decides it. */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

/**
 * The text of a file, or undefined when it looks binary. A byte order mark picks
 * UTF-16, which Windows PowerShell 5.1 writes by default and whose ASCII carries
 * NUL bytes; there a NUL character means binary. Anything else is read as UTF-8.
 */
export function decodeText(bytes: Buffer): string | undefined {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = bytes.toString('utf16le', 2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Big-endian: swap each pair of bytes in a copy, then read it as little-endian.
    text = Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2)))
      .swap16()
      .toString('utf16le');
  } else {
    return looksBinary(bytes) ? undefined : bytes.toString('utf8');
  }
  return text.slice(0, 4096).includes('\0') ? undefined : text;
}

/** Whether `file` (relative to the repository root) is left out of the scan by name alone. */
export function skippedByName(file: string): boolean {
  return (
    SKIPPED_FILES.has(path.posix.basename(file)) || BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())
  );
}

/**
 * Scans `files`, relative to `root`. Paths that are missing (deleted but still
 * tracked) or not plain files, and files skipped by name, are passed over.
 * `skipped` lists the files left unread because their content looks binary.
 */
export function scanFiles(
  root: string,
  files: readonly string[]
): { scanned: number; skipped: string[]; leaks: Leak[] } {
  let scanned = 0;
  const skipped: string[] = [];
  const leaks: Leak[] = [];
  for (const file of files) {
    if (skippedByName(file)) continue;
    const full = path.join(root, file);
    if (!statSync(full, { throwIfNoEntry: false })?.isFile()) continue;
    const text = decodeText(readFileSync(full));
    if (text === undefined) {
      skipped.push(file);
      continue;
    }
    scanned += 1;
    leaks.push(...findLeaks(text, file));
  }
  return { scanned, skipped, leaks };
}

/** The files git tracks plus the untracked ones it does not ignore, as git would commit them. */
export function filesToCheck(root: string): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return [...new Set(listing.split('\0').filter((file) => file.length > 0))];
}

function main(): void {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const { scanned, skipped, leaks } = scanFiles(root, filesToCheck(root));
  for (const file of skipped) console.log(`check-public: not read, looks binary: ${file}`);
  for (const leak of leaks) console.log(`${leak.file}:${leak.line}: ${leak.kind}`);
  if (leaks.length > 0) {
    console.error(
      `check-public: ${leaks.length} hit(s) in ${scanned} files. Remove each value, or end a deliberate placeholder's line with a comment that starts with "${ALLOW_MARKER}".`
    );
    process.exitCode = 1;
  } else {
    console.log(`check-public: nothing found in ${scanned} files.`);
  }
}

/**
 * Whether Node was asked to run this file, rather than a test importing it. Node
 * gives the module its real path while argv keeps any junction or symlink the
 * caller went through, so both sides are resolved to real paths first.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const real = (file: string): string => {
    const full = realpathSync.native(file);
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  try {
    return real(entry) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) main();
