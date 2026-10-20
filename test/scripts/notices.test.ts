import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { packageDirOf } from '../../scripts/bundled-packages';
import {
  ALLOWED_LICENCES,
  NOTICES_FILE,
  declaredLicence,
  entryHeading,
  licenceIds,
  licenceProblem,
  licenceProblems,
  renderNotices,
  resolvePackageDir,
  shippedPackages,
  sourceUrl,
  writeNotices,
  type ShippedPackage
} from '../../scripts/third-party-notices';

/*
 * opensource.5: scripts/third-party-notices.ts, which writes
 * out/THIRD_PARTY_NOTICES.txt and refuses a licence outside the allowed list,
 * and scripts/bundled-packages.ts, the Vite plugin that tells it what each
 * bundle holds. The trees here are made up in a temporary folder.
 */

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'third-party-notices.ts'
);

const MIT_TEXT = 'MIT License\n\nCopyright (c) 2026 Example Author\n\nPermission is hereby granted...';

function pkg(overrides: Partial<ShippedPackage> = {}): ShippedPackage {
  return {
    dir: 'node_modules/a',
    name: 'a',
    version: '1.0.0',
    licence: 'MIT',
    source: undefined,
    shipped: ['asar'],
    files: [{ name: 'LICENSE', text: MIT_TEXT }],
    ...overrides
  };
}

describe('the licence gate', () => {
  it('passes every licence on the allowed list', () => {
    expect(ALLOWED_LICENCES).toEqual([
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
    ]);
    for (const id of ALLOWED_LICENCES) expect(licenceProblem(id), id).toBeUndefined();
  });

  it('passes a list of packages whose licences are all allowed', () => {
    const packages = ALLOWED_LICENCES.map((licence, index) =>
      pkg({ name: `p${index}`, dir: `node_modules/p${index}`, licence })
    );
    expect(licenceProblems(packages)).toEqual([]);
  });

  it('fails a GPL entry in an otherwise allowed list, naming it', () => {
    const packages = [
      pkg({ name: 'fine', dir: 'node_modules/fine' }),
      pkg({ name: 'copyleft', dir: 'node_modules/copyleft', version: '2.1.0', licence: 'GPL-3.0-only' }),
      pkg({ name: 'also-fine', dir: 'node_modules/also-fine', licence: 'ISC' })
    ];
    expect(licenceProblems(packages)).toEqual([
      'copyleft 2.1.0 (node_modules/copyleft) has GPL-3.0-only, and GPL-3.0-only is not on the allowed list'
    ]);
  });

  it.each(['GPL-2.0', 'GPL-3.0-or-later', 'LGPL-2.1-only', 'AGPL-3.0', 'MPL-2.0', 'CC-BY-4.0', 'UNLICENSED'])(
    'fails %s',
    (licence) => {
      expect(licenceProblem(licence)).toMatch(/is not on the allowed list$/);
    }
  );

  it.each([
    '(MIT OR Apache-2.0)',
    'MIT OR Apache-2.0',
    'MIT AND BSD-3-Clause',
    '(MIT AND (ISC OR 0BSD))',
    '((BlueOak-1.0.0))',
    'mit or apache-2.0',
    'Apache-2.0 and CC0-1.0'
  ])('passes the SPDX expression %s, all of whose parts are allowed', (expression) => {
    expect(licenceProblem(expression)).toBeUndefined();
  });

  it.each([
    ['MIT OR GPL-3.0', 'GPL-3.0'],
    ['(MIT AND LGPL-2.1)', 'LGPL-2.1'],
    ['Apache-2.0 WITH LLVM-exception', 'LLVM-exception'],
    ['MIT+', 'MIT+'],
    ['(GPL-2.0 OR MPL-1.1) AND ISC', 'GPL-2.0, MPL-1.1']
  ])('fails %s, which has a part not on the list', (expression, refused) => {
    expect(licenceProblem(expression)).toBe(
      `has ${expression}, and ${refused} ${refused.includes(',') ? 'are' : 'is'} not on the allowed list`
    );
  });

  it.each(['MIT AND', '(MIT', 'MIT)', 'MIT Apache-2.0', 'OR MIT', '()', 'SEE LICENSE IN LICENSE.md', ''])(
    'fails "%s", which is not an expression',
    (expression) => {
      expect(licenceProblem(expression)).toMatch(/not an SPDX licence expression$/);
    }
  );

  it('reads the identifiers out of an expression', () => {
    expect(licenceIds('(MIT OR Apache-2.0) AND ISC')).toEqual(['MIT', 'Apache-2.0', 'ISC']);
    expect(licenceIds('GPL-2.0 WITH Classpath-exception-2.0')).toEqual([
      'GPL-2.0',
      'Classpath-exception-2.0'
    ]);
    expect(licenceIds('MIT AND')).toBeUndefined();
  });

  it('fails a package that declares no licence, or ships no licence file', () => {
    expect(licenceProblem(undefined)).toBe('declares no licence');
    expect(
      licenceProblems([
        pkg({ licence: undefined }),
        pkg({ name: 'b', dir: 'node_modules/b', files: [] }),
        pkg({ name: 'c', dir: 'node_modules/c', files: [{ name: 'NOTICE', text: 'Notice only.' }] })
      ])
    ).toEqual([
      'a 1.0.0 (node_modules/a) declares no licence',
      'b 1.0.0 (node_modules/b) has no licence file to copy',
      'c 1.0.0 (node_modules/c) has no licence file to copy'
    ]);
  });

  it('reads the licence fields package.json has had', () => {
    expect(declaredLicence({ license: 'MIT' })).toBe('MIT');
    expect(declaredLicence({ license: { type: 'ISC', url: 'https://example.com/isc' } })).toBe('ISC');
    expect(declaredLicence({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT) AND (Apache-2.0)'
    );
    expect(declaredLicence({ licenses: { type: 'BSD-2-Clause' } })).toBe('BSD-2-Clause');
    expect(declaredLicence({ licenses: [{ type: 'MIT' }, { url: 'https://example.com' }] })).toBeUndefined();
    expect(declaredLicence({})).toBeUndefined();
    expect(declaredLicence({ license: '  ' })).toBeUndefined();
    // The older list form passes when each entry is allowed, and fails on one that is not.
    expect(
      licenceProblem(declaredLicence({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }))
    ).toBeUndefined();
    expect(licenceProblem(declaredLicence({ licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] }))).toMatch(
      /GPL-2.0 is not on the allowed list/
    );
  });
});

/* ------------------------------------------------------------------------- */

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'notices-test-'));
  temps.push(dir);
  return dir;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

/** A package folder with a package.json and a LICENSE with CRLF line ends. */
function addPackage(
  root: string,
  dir: string,
  manifest: { name: string; version: string; license?: string } & Record<string, unknown>
): void {
  writeJson(path.join(root, dir, 'package.json'), manifest);
  writeFileSync(
    path.join(root, dir, 'LICENSE'),
    `${manifest.license ?? 'MIT'} licence of ${manifest.name}\r\n`
  );
}

function writeBundles(root: string, renderer: string[], main: string[] = [], preload: string[] = []): void {
  for (const [build, packages] of [
    ['main', main],
    ['preload', preload],
    ['renderer', renderer]
  ] as const) {
    writeJson(path.join(root, 'out', build, 'bundled-packages.json'), { packages });
  }
}

/**
 * A made-up project: dependencies a (whose own dependency d is nested in it, and
 * e hoisted), c (with an optional peer x that is installed and a required peer y),
 * an optional dependency b that is not installed, a devDependency z, Electron,
 * and a renderer bundle holding r and a.
 */
function fakeProject(): string {
  const root = tempRoot();
  writeJson(path.join(root, 'package.json'), {
    name: 'fake-app',
    version: '2.3.4',
    dependencies: { a: '^1.0.0', c: '^1.0.0' },
    optionalDependencies: { b: '^1.0.0' },
    devDependencies: { z: '^1.0.0', electron: '44.3.0', r: '^1.0.0' }
  });
  addPackage(root, 'node_modules/a', {
    name: 'a',
    version: '1.0.0',
    license: 'MIT',
    repository: 'github:example/a',
    dependencies: { d: '^2.0.0', e: '^1.0.0' }
  });
  addPackage(root, 'node_modules/a/node_modules/d', { name: 'd', version: '2.0.0', license: 'ISC' });
  addPackage(root, 'node_modules/d', { name: 'd', version: '1.0.0', license: 'ISC' });
  addPackage(root, 'node_modules/e', { name: 'e', version: '1.0.0', license: '(MIT OR Apache-2.0)' });
  addPackage(root, 'node_modules/c', {
    name: 'c',
    version: '1.0.0',
    license: 'Apache-2.0',
    peerDependencies: { x: '*', y: '*' },
    peerDependenciesMeta: { x: { optional: true } }
  });
  writeFileSync(path.join(root, 'node_modules/c/NOTICE'), 'c\nCopyright 2026 Example Ltd.\n');
  addPackage(root, 'node_modules/x', { name: 'x', version: '1.0.0', license: 'GPL-3.0' });
  addPackage(root, 'node_modules/y', { name: 'y', version: '1.0.0', license: 'BSD-2-Clause' });
  addPackage(root, 'node_modules/z', { name: 'z', version: '1.0.0', license: 'GPL-3.0' });
  addPackage(root, 'node_modules/electron', {
    name: 'electron',
    version: '44.3.0',
    license: 'MIT',
    repository: 'https://github.com/electron/electron',
    dependencies: { z: '^1.0.0' }
  });
  addPackage(root, 'node_modules/r', {
    name: 'r',
    version: '3.0.0',
    license: 'MIT',
    homepage: 'https://example.com/r'
  });
  writeBundles(root, ['node_modules/a', 'node_modules/r']);
  return root;
}

describe('what ships', () => {
  it('finds packages as Node does: nested first, then the folders above', () => {
    const root = fakeProject();
    expect(resolvePackageDir('d', path.join(root, 'node_modules/a'), root)).toBe(
      path.join(root, 'node_modules/a/node_modules/d')
    );
    expect(resolvePackageDir('d', root, root)).toBe(path.join(root, 'node_modules/d'));
    expect(resolvePackageDir('e', path.join(root, 'node_modules/a'), root)).toBe(
      path.join(root, 'node_modules/e')
    );
    expect(resolvePackageDir('b', root, root)).toBeUndefined();
  });

  it('lists Electron, the production tree and the bundles, and nothing else', () => {
    const root = fakeProject();
    const shipped = shippedPackages(root).map((p) => [p.dir, p.name, p.version, p.licence, p.shipped]);
    expect(shipped).toEqual([
      ['node_modules/electron', 'electron', '44.3.0', 'MIT', ['runtime']],
      ['node_modules/a', 'a', '1.0.0', 'MIT', ['asar', 'bundle']],
      ['node_modules/c', 'c', '1.0.0', 'Apache-2.0', ['asar']],
      ['node_modules/a/node_modules/d', 'd', '2.0.0', 'ISC', ['asar']],
      ['node_modules/e', 'e', '1.0.0', '(MIT OR Apache-2.0)', ['asar']],
      ['node_modules/r', 'r', '3.0.0', 'MIT', ['bundle']],
      ['node_modules/y', 'y', '1.0.0', 'BSD-2-Clause', ['asar']]
    ]);
    // Not shipped: the hoisted d no one requires from the tree, the optional peer
    // x, the devDependency z (also Electron's own dependency) and the missing b.
  });

  it('copies each licence file and notice, licences first, with LF line ends and no byte order mark', () => {
    const root = fakeProject();
    const bom = String.fromCharCode(0xfeff);
    writeFileSync(path.join(root, 'node_modules/c/LICENSE.md'), `${bom}# Licence\r\n\r\nText.\r\n\r\n`);
    writeFileSync(path.join(root, 'node_modules/c/README.md'), 'Not a licence.');
    const c = shippedPackages(root).find((p) => p.name === 'c');
    expect(c?.files).toEqual([
      { name: 'LICENSE', text: 'Apache-2.0 licence of c' },
      { name: 'LICENSE.md', text: '# Licence\n\nText.' },
      { name: 'NOTICE', text: 'c\nCopyright 2026 Example Ltd.' }
    ]);
  });

  it('stops when a required dependency is not installed', () => {
    const root = fakeProject();
    rmSync(path.join(root, 'node_modules/e'), { recursive: true });
    expect(() => shippedPackages(root)).toThrow(
      'node_modules/a needs e, which is not installed. Run npm ci first.'
    );
    // A peer dependency that is not marked optional is required too.
    const other = fakeProject();
    rmSync(path.join(other, 'node_modules/y'), { recursive: true });
    expect(() => shippedPackages(other)).toThrow(
      'node_modules/c needs y, which is not installed. Run npm ci first.'
    );
    // And so is one of the project's own dependencies.
    const third = fakeProject();
    rmSync(path.join(third, 'node_modules/c'), { recursive: true });
    expect(() => shippedPackages(third)).toThrow(
      'package.json needs c, which is not installed. Run npm ci first.'
    );
  });

  it('stops when a build has not recorded its bundle', () => {
    const root = fakeProject();
    rmSync(path.join(root, 'out', 'preload', 'bundled-packages.json'));
    expect(() => shippedPackages(root)).toThrow(
      'out/preload/bundled-packages.json is missing. Run npm run build first.'
    );
  });

  it('gives a web address for the source where the package names one', () => {
    expect(sourceUrl({ repository: 'github:openai/openai-node' })).toBe(
      'https://github.com/openai/openai-node'
    );
    expect(sourceUrl({ repository: { type: 'git', url: 'git+https://github.com/pmndrs/zustand.git' } })).toBe(
      'https://github.com/pmndrs/zustand'
    );
    expect(sourceUrl({ repository: 'git://github.com/x/y.git' })).toBe('https://github.com/x/y');
    expect(sourceUrl({ repository: 'git@github.com:x/y.git' })).toBe('https://github.com/x/y');
    expect(sourceUrl({ repository: 'x/y' })).toBe('https://github.com/x/y');
    expect(sourceUrl({ homepage: 'https://example.com/r' })).toBe('https://example.com/r');
    expect(sourceUrl({ repository: 'not a url', homepage: 'ftp://example.com' })).toBeUndefined();
  });
});

describe('the notices file', () => {
  it('lists every package, then gives each its own entry with its licence text', () => {
    const root = fakeProject();
    const text = renderNotices('Example', '2.3.4', shippedPackages(root));
    expect(
      text.startsWith('Third-party notices for Example 2.3.4\n\nExample is released under the MIT License')
    ).toBe(true);
    expect(text).toContain('LICENSES.chromium.html');
    expect(text).toContain('\n  electron 44.3.0  ');
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
    const headings = text
      .split('\n')
      .filter((line, i, lines) => line !== '' && !/^=+$/.test(line) && /^=+$/.test(lines[i - 1] ?? ''));
    expect(headings).toEqual([
      'electron 44.3.0',
      'a 1.0.0',
      'c 1.0.0',
      'd 2.0.0',
      'e 1.0.0',
      'r 3.0.0',
      'y 1.0.0'
    ]);
    expect(text).toContain('Licence: (MIT OR Apache-2.0)');
    expect(text).toContain('Source: https://github.com/example/a');
    expect(text).toContain("Shipped: in the app's node_modules, bundled into the app's code");
    expect(text).toContain('Apache-2.0 licence of c\n');
    expect(text).toContain('Copyright 2026 Example Ltd.\n');
    expect(entryHeading({ name: '@scope/x', version: '1.2.3' })).toBe('@scope/x 1.2.3');
  });

  it('is written to out/ when every licence is allowed', () => {
    const root = fakeProject();
    const result = writeNotices(root, 'Example');
    expect(result.problems).toEqual([]);
    expect(result.file).toBe(path.join(root, 'out', NOTICES_FILE));
    expect(readFileSync(result.file, 'utf8')).toContain('\ny 1.0.0\n');
  });

  it('is not written, and an earlier one is removed, when a shipped package has a licence outside the list', () => {
    const root = fakeProject();
    expect(writeNotices(root, 'Example').problems).toEqual([]);
    addPackage(root, 'node_modules/y', { name: 'y', version: '1.0.0', license: 'GPL-3.0-or-later' });
    const result = writeNotices(root, 'Example');
    expect(result.problems).toEqual([
      'y 1.0.0 (node_modules/y) has GPL-3.0-or-later, and GPL-3.0-or-later is not on the allowed list'
    ]);
    expect(existsSync(result.file)).toBe(false);
  });

  it('exits 1 from the command line on a refused licence, and 0 once it is gone', () => {
    const root = fakeProject();
    addPackage(root, 'node_modules/r', { name: 'r', version: '3.0.0', license: 'AGPL-3.0-only' });
    const refused = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('notices: r 3.0.0 (node_modules/r) has AGPL-3.0-only');
    expect(refused.stderr).toContain('nothing written');
    expect(existsSync(path.join(root, 'out', NOTICES_FILE))).toBe(false);

    addPackage(root, 'node_modules/r', { name: 'r', version: '3.0.0', license: 'MIT' });
    const written = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    expect(written.stderr).toBe('');
    expect(written.status).toBe(0);
    expect(written.stdout).toBe('notices: 7 packages written to out/THIRD_PARTY_NOTICES.txt\n');
  });
});

describe('the bundled-packages plugin', () => {
  const root = path.resolve('/project');

  it('names the package folder a module comes from, relative to the project', () => {
    const at = (rest: string): string => path.join(root, rest).replace(/\\/g, '/');
    expect(packageDirOf(at('node_modules/react/index.js'), root)).toBe('node_modules/react');
    expect(packageDirOf(at('node_modules/react-dom/cjs/react-dom-client.production.js'), root)).toBe(
      'node_modules/react-dom'
    );
    expect(packageDirOf(`\0${at('node_modules/react/index.js')}?commonjs-module`, root)).toBe(
      'node_modules/react'
    );
    expect(packageDirOf(at('node_modules/@scope/pkg/dist/x.js'), root)).toBe('node_modules/@scope/pkg');
    expect(packageDirOf(at('node_modules/a/node_modules/b/lib/x.js'), root)).toBe(
      'node_modules/a/node_modules/b'
    );
    expect(packageDirOf(path.join(root, 'node_modules', 'zustand', 'esm', 'index.mjs'), root)).toBe(
      'node_modules/zustand'
    );
  });

  it("passes over the project's own code and Vite's virtual modules", () => {
    expect(packageDirOf(path.join(root, 'src/renderer/App.tsx').replace(/\\/g, '/'), root)).toBeUndefined();
    expect(packageDirOf('\0commonjsHelpers.js', root)).toBeUndefined();
    expect(packageDirOf('\0vite/preload-helper.js', root)).toBeUndefined();
    // A query is not part of the path, even when it names a package's folder.
    const own = path.join(root, 'src/renderer/styles/app.css').replace(/\\/g, '/');
    expect(packageDirOf(`${own}?inline&from=/node_modules/x/`, root)).toBeUndefined();
  });
});
