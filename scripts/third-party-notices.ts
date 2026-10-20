/*
 * opensource.5: writes out/THIRD_PARTY_NOTICES.txt, which the installer puts
 * beside the app (`extraResources`), with every third-party package the app
 * ships and the licence and notice files that package carries. It removes the
 * file an earlier run wrote before it starts, so when it fails, on a licence
 * that is not one of ALLOWED_LICENCES or on a tree it cannot read, it leaves
 * no notices behind.
 *
 *   npm run notices
 *   node scripts/third-party-notices.ts [--root <folder>]
 *
 * `npm run package` and `npm run package:dir` run it after the build and before
 * electron-builder. The packages it lists are:
 *
 * - Electron, which every copy of the app runs on;
 * - the production dependency tree that electron-builder copies into the asar:
 *   package.json's `dependencies` and `optionalDependencies`, then theirs, and
 *   peer dependencies that are not marked optional, each found as Node finds
 *   it. An optional dependency that is not installed is passed over;
 * - the packages Vite put inside a bundle, as each build recorded them in
 *   out/<main|preload|renderer>/bundled-packages.json (scripts/bundled-packages.ts).
 *
 * `scripts/verify-package.ts` checks afterwards that every package in the
 * built asar is named here, so a difference from electron-builder's own list
 * fails the build rather than going unnoticed.
 *
 * Like check-public.ts, this uses only erasable TypeScript and Node's built-in
 * modules, so Node runs it as it is. The app's name comes from
 * scripts/branding.cjs.
 */

import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Licences a shipped package may have (PLAN `opensource.5`). An SPDX expression
 * passes only when every licence in it is one of these, whether it joins them
 * with AND or OR.
 */
export const ALLOWED_LICENCES: readonly string[] = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0'
];

/** The builds whose bundles are recorded, each in out/<build>/bundled-packages.json. */
export const BUILDS: readonly string[] = ['main', 'preload', 'renderer'];

/**
 * The name scripts/bundled-packages.ts gives each record. It is written out
 * here as well, because this script imports nothing of the project's so that
 * Node can run it as it is; test/scripts/notices.test.ts pins the two equal.
 */
export const BUNDLED_PACKAGES_FILE = 'bundled-packages.json';
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

/** How a package reaches the user. */
export type Shipped = 'runtime' | 'asar' | 'bundle';

const SHIPPED_LABELS: Record<Shipped, string> = {
  runtime: 'the runtime',
  asar: "in the app's node_modules",
  bundle: "bundled into the app's code"
};

export interface LicenceFile {
  name: string;
  text: string;
}

export interface ShippedPackage {
  /** The package folder, relative to the root, with forward slashes. */
  dir: string;
  name: string;
  version: string;
  /** What package.json declares, as an SPDX expression, or undefined. */
  licence: string | undefined;
  source: string | undefined;
  shipped: Shipped[];
  files: LicenceFile[];
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
  homepage?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean } | undefined>;
}

/* ------------------------------------------------------------------------- */
/* The licence gate                                                          */
/* ------------------------------------------------------------------------- */

/**
 * The licence a package.json declares, as one SPDX expression: `license` as a
 * string, or the older `license: {type}` and `licenses: [{type}, ...]`, whose
 * entries are joined with AND. Undefined when it declares none.
 */
export function declaredLicence(pkg: { license?: unknown; licenses?: unknown }): string | undefined {
  const typeOf = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.trim() || undefined;
    if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') {
      return value.type.trim() || undefined;
    }
    return undefined;
  };
  const single = typeOf(pkg.license);
  if (single) return single;
  const list = Array.isArray(pkg.licenses) ? pkg.licenses : pkg.licenses ? [pkg.licenses] : [];
  const types = list.map(typeOf);
  if (types.length === 0 || types.some((type) => type === undefined)) return undefined;
  return types.length === 1 ? types[0] : types.map((type) => `(${type})`).join(' AND ');
}

/**
 * The licence identifiers in an SPDX expression, or undefined when it is not
 * one: identifiers joined by AND or OR, in brackets or not, an exception after
 * WITH counting as an identifier. Operators are read in any case.
 */
export function licenceIds(expression: string): string[] | undefined {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  const ids: string[] = [];
  let at = 0;
  const operator = (word: string | undefined): string | undefined => {
    const upper = word?.toUpperCase();
    return upper === 'AND' || upper === 'OR' || upper === 'WITH' ? upper : undefined;
  };
  // term := '(' expression ')' | id [WITH id]
  const term = (): boolean => {
    const token = tokens[at];
    if (token === '(') {
      at += 1;
      if (!expr() || tokens[at] !== ')') return false;
      at += 1;
      return true;
    }
    if (token === undefined || token === ')' || operator(token)) return false;
    ids.push(token);
    at += 1;
    if (operator(tokens[at]) === 'WITH') {
      const exception = tokens[at + 1];
      if (exception === undefined || exception === '(' || exception === ')' || operator(exception)) {
        return false;
      }
      ids.push(exception);
      at += 2;
    }
    return true;
  };
  // expression := term ((AND | OR) term)*
  const expr = (): boolean => {
    if (!term()) return false;
    while (operator(tokens[at]) === 'AND' || operator(tokens[at]) === 'OR') {
      at += 1;
      if (!term()) return false;
    }
    return true;
  };
  return expr() && at === tokens.length ? ids : undefined;
}

/** Why `licence` may not ship, or undefined when every licence in it is allowed. */
export function licenceProblem(licence: string | undefined): string | undefined {
  if (licence === undefined) return 'declares no licence';
  const ids = licenceIds(licence);
  if (ids === undefined) return `has "${licence}", which is not an SPDX licence expression`;
  const allowed = new Set(ALLOWED_LICENCES.map((id) => id.toLowerCase()));
  const refused = ids.filter((id) => !allowed.has(id.toLowerCase()));
  if (refused.length === 0) return undefined;
  return `has ${licence}, and ${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} not on the allowed list`;
}

/** A notice file (NOTICE, NOTICE.md), which goes with a licence but is not one. */
const NOTICE_FILE = /^notice/i;

/** One line per package that may not ship, or that has no licence file; empty when all may. */
export function licenceProblems(packages: readonly ShippedPackage[]): string[] {
  const problems: string[] = [];
  for (const pkg of packages) {
    const problem = licenceProblem(pkg.licence);
    if (problem) problems.push(`${pkg.name} ${pkg.version} (${pkg.dir}) ${problem}`);
    if (!pkg.files.some((file) => !NOTICE_FILE.test(file.name))) {
      problems.push(`${pkg.name} ${pkg.version} (${pkg.dir}) has no licence file to copy`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------------- */
/* Finding what ships                                                        */
/* ------------------------------------------------------------------------- */

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A text file's contents, without a leading byte order mark. */
function readText(file: string): string {
  const text = readFileSync(file, 'utf8');
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
}

function readJson(file: string): PackageJson {
  return JSON.parse(readText(file)) as PackageJson;
}

function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isFolder(dir: string): boolean {
  return statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Forward slashes, relative to `root`. */
function relative(root: string, dir: string): string {
  return path.relative(root, dir).replace(/\\/g, '/');
}

/**
 * The folder Node would load package `name` from when required in `fromDir`:
 * `node_modules/<name>` there, then in each folder above it, up to `root`.
 */
export function resolvePackageDir(name: string, fromDir: string, root: string): string | undefined {
  let dir = path.resolve(fromDir);
  const top = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (isFile(path.join(candidate, 'package.json'))) return candidate;
    if (dir === top) return undefined;
    const parent = path.dirname(dir);
    if (parent === dir || !parent.startsWith(top)) return undefined;
    dir = parent;
  }
}

/**
 * The folders of the production dependency tree under `root`: `dependencies`
 * and `optionalDependencies`, recursively, and peer dependencies that are not
 * optional. Throws when a required one is not installed.
 */
export function productionTree(root: string): string[] {
  const found = new Set<string>();
  const visit = (dir: string, pkg: PackageJson): void => {
    const optionalPeers = pkg.peerDependenciesMeta ?? {};
    const wanted: [string, boolean][] = [
      ...Object.keys(pkg.dependencies ?? {}).map((name): [string, boolean] => [name, true]),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((name): [string, boolean] => [name, false]),
      ...Object.keys(pkg.peerDependencies ?? {})
        .filter((name) => optionalPeers[name]?.optional !== true)
        .map((name): [string, boolean] => [name, true])
    ];
    for (const [name, required] of wanted) {
      const child = resolvePackageDir(name, dir, root);
      if (!child) {
        if (required) {
          const who = dir === path.resolve(root) ? 'package.json' : relative(root, dir);
          throw new Error(`${who} needs ${name}, which is not installed. Run npm ci first.`);
        }
        continue;
      }
      if (found.has(child)) continue;
      found.add(child);
      visit(child, readJson(path.join(child, 'package.json')));
    }
  };
  visit(path.resolve(root), readJson(path.join(root, 'package.json')));
  return [...found];
}

/**
 * The package folders the builds put in their bundles, from each build's
 * bundled-packages.json under `outDir`. Throws when one is missing: the build
 * has not run, or ran without the plugin.
 */
export function bundledPackageDirs(root: string, outDir: string): string[] {
  const dirs = new Set<string>();
  for (const build of BUILDS) {
    const file = path.join(outDir, build, BUNDLED_PACKAGES_FILE);
    if (!isFile(file)) {
      throw new Error(`${relative(root, file)} is missing. Run npm run build first.`);
    }
    const record = JSON.parse(readFileSync(file, 'utf8')) as { packages?: unknown };
    if (!Array.isArray(record.packages) || record.packages.some((dir) => typeof dir !== 'string')) {
      throw new Error(`${relative(root, file)} does not list packages.`);
    }
    for (const dir of record.packages as string[]) dirs.add(path.resolve(root, dir));
  }
  return [...dirs];
}

/**
 * Licence and notice files, case aside: a name that starts with LICENSE or
 * LICENCE (or either in the plural), UNLICENSE, COPYING or NOTICE, alone or
 * followed by `.`, `-` or `_` and more (LICENSE.md, LICENSE-MIT, License.Apache,
 * COPYING.LESSER), or one with LICENSE or LICENCE after a `.`, `-` or `_`
 * (MIT-LICENSE.txt, THIRD-PARTY-LICENSES.md).
 */
const LICENCE_FILE = /^(?:(?:un)?licen[cs]es?|copying|notice)(?:$|[.\-_])|[.\-_]licen[cs]es?(?:$|[.\-_])/i;

/** Scripts and data, which are not licence texts whatever their names say (add-license.js). */
const SCRIPT_OR_DATA = /\.(?:[cm]?[jt]sx?|json|map|node|wasm|sh|cmd|bat|ps1|py)$/i;

/** A folder of licence texts as REUSE lays them out, LICENSES/MIT.txt; its files are copied too. */
const LICENCE_FOLDER = /^licen[cs]es$/i;

/**
 * The licence and notice files at the top of a package folder and in a
 * LICENSES folder there, named `LICENSES/<file>`: licences first, then
 * notices, each by name. Any other folder is passed over, one named LICENSE
 * included.
 */
export function licenceFiles(dir: string): LicenceFile[] {
  const isText = (name: string): boolean => !SCRIPT_OR_DATA.test(name);
  const names: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (LICENCE_FOLDER.test(name) && isFolder(full)) {
      for (const inner of readdirSync(full)) {
        if (isText(inner) && isFile(path.join(full, inner))) names.push(`${name}/${inner}`);
      }
    } else if (LICENCE_FILE.test(name) && isText(name) && isFile(full)) {
      names.push(name);
    }
  }
  names.sort((a, b) => Number(NOTICE_FILE.test(a)) - Number(NOTICE_FILE.test(b)) || a.localeCompare(b, 'en'));
  return names.map((name) => ({
    name,
    text: readText(path.join(dir, name)).replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  }));
}

/** A web address for the package's source, from `repository` or `homepage`. */
export function sourceUrl(pkg: { repository?: unknown; homepage?: unknown }): string | undefined {
  const repo = pkg.repository;
  let url =
    typeof repo === 'string'
      ? repo
      : repo && typeof repo === 'object' && 'url' in repo && typeof repo.url === 'string'
        ? repo.url
        : undefined;
  if (url) {
    url = url
      .trim()
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^ssh:\/\/git@/, 'https://')
      .replace(/^git@([^:]+):/, 'https://$1/')
      .replace(/^github:/, 'https://github.com/')
      .replace(/\.git$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    if (/^https?:\/\//.test(url)) return url;
  }
  return typeof pkg.homepage === 'string' && /^https?:\/\//.test(pkg.homepage) ? pkg.homepage : undefined;
}

/**
 * Every package the app ships: Electron, the production tree and what the
 * bundles hold, one entry per folder, Electron first and then by name and
 * version.
 */
export function shippedPackages(root: string, outDir = path.join(root, 'out')): ShippedPackage[] {
  const byDir = new Map<string, Shipped[]>();
  const add = (dir: string, shipped: Shipped): void => {
    const list = byDir.get(dir) ?? [];
    if (!list.includes(shipped)) list.push(shipped);
    byDir.set(dir, list);
  };
  const electron = resolvePackageDir('electron', root, root);
  if (!electron) throw new Error('electron is not installed. Run npm ci first.');
  add(electron, 'runtime');
  for (const dir of productionTree(root)) add(dir, 'asar');
  for (const dir of bundledPackageDirs(root, outDir)) add(dir, 'bundle');

  const packages = [...byDir].map(([dir, shipped]): ShippedPackage => {
    const manifest = path.join(dir, 'package.json');
    if (!isFile(manifest)) throw new Error(`${relative(root, dir)} has no package.json.`);
    const pkg = readJson(manifest);
    return {
      dir: relative(root, dir),
      name: typeof pkg.name === 'string' ? pkg.name : path.basename(dir),
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      licence: declaredLicence(pkg),
      source: sourceUrl(pkg),
      shipped,
      files: licenceFiles(dir)
    };
  });
  const rank = (pkg: ShippedPackage): number => (pkg.shipped.includes('runtime') ? 0 : 1);
  return packages.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, 'en') ||
      a.version.localeCompare(b.version, 'en', { numeric: true }) ||
      a.dir.localeCompare(b.dir, 'en')
  );
}

/* ------------------------------------------------------------------------- */
/* The file                                                                  */
/* ------------------------------------------------------------------------- */

export const ENTRY_RULE = '='.repeat(78);
const FILE_RULE = '-'.repeat(78);

/** The heading line of a package's entry, which `verify-package.ts` looks for. */
export function entryHeading(pkg: { name: string; version: string }): string {
  return `${pkg.name} ${pkg.version}`;
}

/** The text of THIRD_PARTY_NOTICES.txt, with LF line ends. */
export function renderNotices(
  appName: string,
  appVersion: string,
  packages: readonly ShippedPackage[]
): string {
  const width = Math.max(...packages.map((pkg) => entryHeading(pkg).length), 0) + 2;
  const licenceWidth = Math.max(...packages.map((pkg) => (pkg.licence ?? '').length), 0) + 2;
  const lines = [
    `Third-party notices for ${appName} ${appVersion}`,
    '',
    `${appName} is released under the MIT License, in LICENSE.txt beside this file.`,
    `It includes the third-party software below. Each package is listed with the`,
    `licence its package.json declares, followed by the licence and notice files`,
    `it comes with. The licences of Chromium and the other software inside`,
    `Electron are in LICENSES.chromium.html, in the folder above this one.`,
    '',
    'Packages:',
    '',
    ...packages.map(
      (pkg) =>
        `  ${entryHeading(pkg).padEnd(width)}${(pkg.licence ?? '').padEnd(licenceWidth)}${pkg.shipped
          .map((shipped) => SHIPPED_LABELS[shipped])
          .join(', ')}`
    )
  ];
  for (const pkg of packages) {
    lines.push('', '', ENTRY_RULE, entryHeading(pkg), ENTRY_RULE, '');
    lines.push(`Licence: ${pkg.licence ?? 'none declared'}`);
    if (pkg.source) lines.push(`Source: ${pkg.source}`);
    lines.push(`Shipped: ${pkg.shipped.map((shipped) => SHIPPED_LABELS[shipped]).join(', ')}`);
    for (const file of pkg.files) {
      lines.push('', FILE_RULE, file.name, FILE_RULE, '', file.text);
    }
  }
  return `${lines.map((line) => line.replace(/\s+$/, '')).join('\n')}\n`;
}

/**
 * Removes the out/THIRD_PARTY_NOTICES.txt an earlier run wrote, finds what
 * ships under `root`, checks the licences and, when all are allowed, writes the
 * file again. When one is not, it returns the problems; when the tree cannot be
 * read, it throws. Either way there is then no notices file, so that no build
 * can ship notices that are out of date.
 */
export function writeNotices(
  root: string,
  appName: string
): { problems: string[]; file: string; packages: ShippedPackage[] } {
  const outDir = path.join(root, 'out');
  const file = path.join(outDir, NOTICES_FILE);
  rmSync(file, { force: true });
  const packages = shippedPackages(root, outDir);
  const problems = licenceProblems(packages);
  if (problems.length > 0) return { problems, file, packages };
  const version = readJson(path.join(root, 'package.json')).version;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, renderNotices(appName, typeof version === 'string' ? version : '0.0.0', packages));
  return { problems, file, packages };
}

function main(): void {
  const args = process.argv.slice(2);
  const given = args.includes('--root') ? args[args.indexOf('--root') + 1] : undefined;
  const root = path.resolve(given ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const require = createRequire(import.meta.url);
  const branding = require('./branding.cjs') as { appName(): string };
  try {
    const { problems, file, packages } = writeNotices(root, branding.appName());
    if (problems.length > 0) {
      for (const problem of problems) console.error(`notices: ${problem}`);
      console.error(
        `notices: nothing written. Allowed licences: ${ALLOWED_LICENCES.join(', ')}, or an SPDX expression made only of them.`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`notices: ${packages.length} packages written to ${relative(root, file)}`);
  } catch (error) {
    console.error(`notices: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
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
