/*
 * opensource.5: checks what electron-builder built, per PLAN 11.3 (n), before
 * anything is released. It reads dist/win-unpacked and, with --installer, the
 * installer files beside it, and exits 1 with one line per problem.
 *
 *   npm run verify:package                  after npm run package:dir (CI, release.5)
 *   npm run verify:package -- --installer   after npm run package (postpackage)
 *   node scripts/verify-package.ts [--installer] [--dist <folder>]
 *
 * The checks:
 *
 * - The asar's listing has /out/main/index.js and /package.json, and nothing
 *   under /samples, /test, /src, /dist or /.dev-userdata.
 * - No @anthropic-ai package, and no file named claude.exe or claude, in the
 *   asar or anywhere on disk in the unpacked app (PLAN 11.1, C.87).
 * - resources/ holds THIRD_PARTY_NOTICES.txt, LICENSE.txt and
 *   GUIDELINES.default.md, and the notices name every package in the asar's
 *   node_modules at the version found there.
 * - With --installer: resources/app-update.yml names the GitHub repository from
 *   src/shared/branding.ts, with no publisherName unless the environment sets
 *   EXPECT_SIGNED (then it must have one); dist/latest.yml names this version,
 *   the installer's file name, and the installer's size and sha512; and the
 *   installer's .blockmap is there.
 *
 * Like check-public.ts it uses only erasable TypeScript and Node's built-in
 * modules, so Node runs it as it is: the asar is read here rather than through
 * @electron/asar, and the two YAML files by their lines. The name and the
 * repository come from scripts/branding.cjs, the version from package.json.
 */

import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface VerifyOptions {
  /** The folder electron-builder wrote to: it holds win-unpacked and the installer. */
  dist: string;
  /** Also check what only the installer build makes. */
  installer: boolean;
  productName: string;
  version: string;
  owner: string;
  repo: string;
  /** EXPECT_SIGNED is set: app-update.yml must name a publisher. */
  expectSigned: boolean;
}

/* ------------------------------------------------------------------------- */
/* The asar                                                                  */
/* ------------------------------------------------------------------------- */

export interface AsarEntry {
  /** From the archive's root, starting with `/`, with forward slashes. */
  path: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  /** Where the file's bytes start, after the header; undefined when unpacked. */
  offset: number | undefined;
}

interface AsarNode {
  files?: Record<string, AsarNode>;
  link?: string;
  size?: number;
  offset?: string;
  unpacked?: boolean;
}

export interface Asar {
  entries: AsarEntry[];
  /** A packed file's bytes, or undefined when there is no such file in the archive. */
  read(entryPath: string): Buffer | undefined;
}

/**
 * Reads an asar archive's header: a 4-byte 4, the header pickle's size, then
 * that pickle (its payload size, the JSON's length and the JSON). File bytes
 * follow the header, each at its `offset`.
 */
export function readAsar(file: string): Asar {
  const fd = openSync(file, 'r');
  let header: AsarNode;
  let dataStart: number;
  try {
    const sizes = Buffer.alloc(8);
    if (readSync(fd, sizes, 0, 8, 0) !== 8 || sizes.readUInt32LE(0) !== 4) {
      throw new Error('not an asar archive');
    }
    const headerSize = sizes.readUInt32LE(4);
    const pickle = Buffer.alloc(headerSize);
    if (headerSize < 8 || readSync(fd, pickle, 0, headerSize, 8) !== headerSize) {
      throw new Error('its header is cut short');
    }
    const jsonLength = pickle.readInt32LE(4);
    if (jsonLength < 0 || jsonLength > headerSize - 8) throw new Error('its header is damaged');
    header = JSON.parse(pickle.toString('utf8', 8, 8 + jsonLength)) as AsarNode;
    dataStart = 8 + headerSize;
  } finally {
    closeSync(fd);
  }

  const entries: AsarEntry[] = [];
  const walk = (node: AsarNode, prefix: string): void => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const entryPath = `${prefix}/${name.replace(/\\/g, '/')}`;
      if (child.files) {
        entries.push({ path: entryPath, kind: 'dir', size: 0, offset: undefined });
        walk(child, entryPath);
      } else if (typeof child.link === 'string') {
        entries.push({ path: entryPath, kind: 'link', size: 0, offset: undefined });
      } else {
        const offset = child.unpacked || child.offset === undefined ? undefined : Number(child.offset);
        entries.push({ path: entryPath, kind: 'file', size: child.size ?? 0, offset });
      }
    }
  };
  walk(header, '');
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  return {
    entries,
    read(entryPath) {
      const entry = byPath.get(entryPath);
      if (!entry || entry.kind !== 'file' || entry.offset === undefined) return undefined;
      const bytes = Buffer.alloc(entry.size);
      const fd2 = openSync(file, 'r');
      try {
        readSync(fd2, bytes, 0, entry.size, dataStart + entry.offset);
      } finally {
        closeSync(fd2);
      }
      return bytes;
    }
  };
}

/** Folders of the repository that must never be packed. */
export const FORBIDDEN_IN_ASAR: readonly string[] = ['/samples', '/test', '/src', '/dist', '/.dev-userdata'];

/** Files the app cannot start without. */
export const REQUIRED_IN_ASAR: readonly string[] = ['/out/main/index.js', '/package.json'];

/** Files electron-builder copies beside the asar (`extraResources`). */
export const REQUIRED_RESOURCES: readonly string[] = [
  'THIRD_PARTY_NOTICES.txt',
  'LICENSE.txt',
  'GUIDELINES.default.md'
];

/** Whether a path, with forward slashes, belongs to an Anthropic package or is a Claude Code binary. */
export function anthropicProblem(entryPath: string, isFile: boolean): string | undefined {
  const segments = entryPath.split('/');
  if (segments.some((segment) => segment.toLowerCase() === '@anthropic-ai')) {
    return 'is part of an @anthropic-ai package';
  }
  const base = (segments[segments.length - 1] ?? '').toLowerCase();
  if (isFile && (base === 'claude' || base === 'claude.exe')) return 'is a Claude Code binary';
  return undefined;
}

/** Each `name@version` in the asar's node_modules, read from the packages' own package.json. */
export function asarPackages(asar: Asar): { name: string; version: string; path: string }[] {
  const found: { name: string; version: string; path: string }[] = [];
  for (const entry of asar.entries) {
    const match = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(entry.path);
    if (!match?.[1] || entry.kind !== 'file') continue;
    let manifest: { name?: unknown; version?: unknown } = {};
    try {
      manifest = JSON.parse(asar.read(entry.path)?.toString('utf8') ?? '{}') as typeof manifest;
    } catch {
      // A package.json that is not JSON still names its package by its folder.
    }
    found.push({
      name: typeof manifest.name === 'string' ? manifest.name : match[1],
      version: typeof manifest.version === 'string' ? manifest.version : '',
      path: entry.path.slice(0, -'/package.json'.length)
    });
  }
  return found;
}

/**
 * The `name version` headings of THIRD_PARTY_NOTICES.txt: the line after each
 * rule of `=` that opens an entry (renderNotices in third-party-notices.ts).
 */
export function noticeHeadings(text: string): Set<string> {
  const lines = text.split(/\r?\n/);
  const headings = new Set<string>();
  lines.forEach((line, index) => {
    const next = lines[index + 1];
    if (/^={20,}$/.test(line) && next !== undefined && next.trim() !== '' && !/^={20,}$/.test(next)) {
      headings.add(next.trim());
    }
  });
  return headings;
}

/* ------------------------------------------------------------------------- */
/* The YAML files                                                            */
/* ------------------------------------------------------------------------- */

function unquote(value: string): string {
  const trimmed = value.trim();
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * The flat YAML electron-builder writes for app-update.yml and latest.yml: the
 * top level's `key: value` lines, and the items of a `files:` list.
 */
export function readSimpleYaml(text: string): {
  top: Record<string, string>;
  files: Record<string, string>[];
} {
  const top: Record<string, string> = {};
  const files: Record<string, string>[] = [];
  for (const line of text.split(/\r?\n/)) {
    let match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (match?.[1]) {
      top[match[1]] = unquote(match[2] ?? '');
      continue;
    }
    match = /^\s+-\s+([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (match?.[1]) {
      files.push({ [match[1]]: unquote(match[2] ?? '') });
      continue;
    }
    match = /^\s+([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line);
    const item = files[files.length - 1];
    if (match?.[1] && item) item[match[1]] = unquote(match[2] ?? '');
  }
  return { top, files };
}

/* ------------------------------------------------------------------------- */
/* The checks                                                                */
/* ------------------------------------------------------------------------- */

function stat(file: string) {
  return statSync(file, { throwIfNoEntry: false });
}

/** Every file and folder under `dir`, relative to it with forward slashes, in order of name. */
function walkDisk(dir: string): { path: string; isFile: boolean }[] {
  const out: { path: string; isFile: boolean }[] = [];
  const visit = (current: string, prefix: string): void => {
    const entries = readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = `${prefix}/${entry.name}`;
      out.push({ path: rel, isFile: !entry.isDirectory() });
      if (entry.isDirectory()) visit(path.join(current, entry.name), rel);
    }
  };
  visit(dir, '');
  return out;
}

export function installerName(productName: string, version: string): string {
  return `${productName}-Setup-${version}.exe`;
}

export interface VerifyResult {
  /** One line per problem; empty when the package passes. */
  problems: string[];
  /** How many entries the asar lists, for the summary. */
  asarEntries: number;
  /** `name version` of each package in the asar's node_modules. */
  asarPackages: string[];
}

/** Checks the package in `options.dist`. */
export function verifyPackage(options: VerifyOptions): VerifyResult {
  const problems: string[] = [];
  const result: VerifyResult = { problems, asarEntries: 0, asarPackages: [] };
  const unpacked = path.join(options.dist, 'win-unpacked');
  const resources = path.join(unpacked, 'resources');
  if (!stat(unpacked)?.isDirectory()) {
    problems.push(`${unpacked} is missing. Run npm run package or npm run package:dir first.`);
    return result;
  }

  // The asar.
  const asarFile = path.join(resources, 'app.asar');
  let asar: Asar | undefined;
  try {
    asar = readAsar(asarFile);
  } catch (error) {
    problems.push(
      `resources/app.asar could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (asar) {
    result.asarEntries = asar.entries.length;
    const paths = new Set(asar.entries.map((entry) => entry.path));
    for (const required of REQUIRED_IN_ASAR) {
      if (!paths.has(required)) problems.push(`app.asar has no ${required}`);
    }
    for (const forbidden of FORBIDDEN_IN_ASAR) {
      const inside = asar.entries.filter(
        (entry) => entry.path === forbidden || entry.path.startsWith(`${forbidden}/`)
      );
      if (inside.length > 0) problems.push(`app.asar holds ${forbidden} (${inside.length} entries)`);
    }
    for (const entry of asar.entries) {
      const problem = anthropicProblem(entry.path, entry.kind !== 'dir');
      if (problem) problems.push(`app.asar ${entry.path} ${problem}`);
    }
  }

  // Everything on disk, the unpacked asar folder included.
  for (const entry of walkDisk(unpacked)) {
    const problem = anthropicProblem(entry.path, entry.isFile);
    if (problem) problems.push(`win-unpacked${entry.path} ${problem}`);
  }

  // Beside the asar.
  for (const name of REQUIRED_RESOURCES) {
    const info = stat(path.join(resources, name));
    if (!info?.isFile()) problems.push(`resources/${name} is missing`);
    else if (info.size === 0) problems.push(`resources/${name} is empty`);
  }
  const noticesFile = path.join(resources, 'THIRD_PARTY_NOTICES.txt');
  const packed = asar ? asarPackages(asar) : [];
  result.asarPackages = packed.map((pkg) => `${pkg.name} ${pkg.version}`).sort();
  if (stat(noticesFile)?.isFile()) {
    const headings = noticeHeadings(readFileSync(noticesFile, 'utf8'));
    for (const pkg of packed) {
      const heading = `${pkg.name} ${pkg.version}`;
      if (!headings.has(heading)) {
        problems.push(
          `THIRD_PARTY_NOTICES.txt does not list ${heading}, which app.asar holds at ${pkg.path}`
        );
      }
    }
  }

  if (options.installer) problems.push(...verifyInstaller(options, resources));
  return result;
}

function verifyInstaller(options: VerifyOptions, resources: string): string[] {
  const problems: string[] = [];

  const updateFile = path.join(resources, 'app-update.yml');
  if (!stat(updateFile)?.isFile()) {
    problems.push('resources/app-update.yml is missing');
  } else {
    const { top } = readSimpleYaml(readFileSync(updateFile, 'utf8'));
    const want: Record<string, string> = { provider: 'github', owner: options.owner, repo: options.repo };
    for (const [key, value] of Object.entries(want)) {
      if (top[key] !== value) {
        problems.push(`app-update.yml has ${key}: ${top[key] ?? '(none)'}, not ${value}`);
      }
    }
    const publisher = top.publisherName;
    if (publisher !== undefined && !options.expectSigned) {
      problems.push('app-update.yml names a publisherName, but EXPECT_SIGNED is not set');
    } else if (publisher === undefined && options.expectSigned) {
      problems.push('app-update.yml has no publisherName, though EXPECT_SIGNED is set');
    }
  }

  const name = installerName(options.productName, options.version);
  const installer = path.join(options.dist, name);
  const installerInfo = stat(installer);
  if (!installerInfo?.isFile()) problems.push(`${name} is missing`);
  if (!stat(`${installer}.blockmap`)?.isFile()) problems.push(`${name}.blockmap is missing`);

  const latestFile = path.join(options.dist, 'latest.yml');
  if (!stat(latestFile)?.isFile()) {
    problems.push('latest.yml is missing');
    return problems;
  }
  const { top, files } = readSimpleYaml(readFileSync(latestFile, 'utf8'));
  if (top.version !== options.version) {
    problems.push(`latest.yml has version ${top.version ?? '(none)'}, not ${options.version}`);
  }
  if (top.path !== name) problems.push(`latest.yml has path ${top.path ?? '(none)'}, not ${name}`);
  const first = files[0];
  if (files.length !== 1 || !first) {
    problems.push(`latest.yml lists ${files.length} files, not 1`);
  } else {
    if (first.url !== name) problems.push(`latest.yml's file is ${first.url ?? '(none)'}, not ${name}`);
    if (installerInfo?.isFile()) {
      if (first.size !== String(installerInfo.size)) {
        problems.push(
          `latest.yml gives size ${first.size ?? '(none)'}, but ${name} is ${installerInfo.size} bytes`
        );
      }
      const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64');
      if (first.sha512 !== sha512) problems.push(`latest.yml's sha512 does not match ${name}`);
      if (top.sha512 !== undefined && top.sha512 !== sha512) {
        problems.push(`latest.yml's top-level sha512 does not match ${name}`);
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- */
/* The command                                                               */
/* ------------------------------------------------------------------------- */

function main(): void {
  const args = process.argv.slice(2);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const given = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : undefined;
  const dist = path.resolve(given ?? path.join(root, 'dist'));
  const require = createRequire(import.meta.url);
  const branding = require('./branding.cjs') as {
    appName(): string;
    appRepository(): { owner: string; repo: string };
  };
  const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  const { owner, repo } = branding.appRepository();
  const installer = args.includes('--installer');
  const {
    problems,
    asarEntries,
    asarPackages: packed
  } = verifyPackage({
    dist,
    installer,
    productName: branding.appName(),
    version,
    owner,
    repo,
    expectSigned: expectSigned(process.env.EXPECT_SIGNED)
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`verify-package: ${problem}`);
    console.error(`verify-package: ${problems.length} problem(s) in ${dist}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `verify-package: app.asar lists ${asarEntries} entries; its node_modules: ${packed.join(', ')}.`
  );
  console.log(`verify-package: ${dist} passes${installer ? ', with the installer' : ''}.`);
}

/** EXPECT_SIGNED counts as set unless it is empty, 0 or false. */
export function expectSigned(value: string | undefined): boolean {
  return value !== undefined && !['', '0', 'false'].includes(value.trim().toLowerCase());
}

/** Whether Node was asked to run this file, rather than a test importing it (see check-public.ts). */
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
