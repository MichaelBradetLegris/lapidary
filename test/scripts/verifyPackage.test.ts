import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { renderNotices, type ShippedPackage } from '../../scripts/third-party-notices';
import {
  anthropicProblem,
  expectSigned,
  installerName,
  noticeHeadings,
  readAsar,
  readSimpleYaml,
  verifyPackage,
  type VerifyOptions
} from '../../scripts/verify-package';

/*
 * opensource.5: scripts/verify-package.ts, the one check of what
 * electron-builder built (PLAN 11.3 n), run here on fake package trees in a
 * temporary folder: dist/win-unpacked with an asar written by writeAsar below,
 * the files beside it, and the installer files.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-package.ts');
const require = createRequire(import.meta.url);
const branding = require('../../scripts/branding.cjs') as {
  appName(): string;
  appRepository(): { owner: string; repo: string };
};
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string })
  .version;
const { owner: OWNER, repo: REPO } = branding.appRepository();
const NAME = branding.appName();

type AsarContent = string | { unpacked: string } | { link: string };

/**
 * Writes an asar archive as @electron/asar does: a pickle holding 4, a pickle
 * holding the header's JSON (its payload size, the string's length, the string
 * padded to 4 bytes), then the packed files' bytes in order.
 */
function writeAsar(file: string, entries: Record<string, AsarContent>): void {
  type Node =
    { files: Record<string, Node> } | { size: number; offset?: string; unpacked?: true } | { link: string };
  const top: { files: Record<string, Node> } = { files: {} };
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [entryPath, content] of Object.entries(entries)) {
    const parts = entryPath.split('/').filter(Boolean);
    let dir = top;
    for (const part of parts.slice(0, -1)) {
      const next = (dir.files[part] ??= { files: {} });
      if (!('files' in next)) throw new Error(`${part} is a file`);
      dir = next;
    }
    const name = parts[parts.length - 1]!;
    if (typeof content === 'string') {
      const bytes = Buffer.from(content);
      dir.files[name] = { size: bytes.length, offset: String(offset) };
      chunks.push(bytes);
      offset += bytes.length;
    } else if ('unpacked' in content) {
      dir.files[name] = { size: Buffer.byteLength(content.unpacked), unpacked: true };
    } else {
      dir.files[name] = { link: content.link };
    }
  }
  const json = Buffer.from(JSON.stringify(top));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4);
  json.copy(padded);
  const headerPickle = Buffer.alloc(8 + padded.length);
  headerPickle.writeUInt32LE(4 + padded.length, 0);
  headerPickle.writeInt32LE(json.length, 4);
  padded.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

function notice(name: string, version: string): ShippedPackage {
  return {
    dir: `node_modules/${name}`,
    name,
    version,
    licence: 'MIT',
    source: undefined,
    shipped: ['asar'],
    files: [{ name: 'LICENSE', text: 'MIT License' }]
  };
}

const ASAR: Record<string, AsarContent> = {
  '/package.json': JSON.stringify({ name: 'manuscript-review', version: VERSION }),
  '/out/main/index.js': 'console.log("main");',
  '/out/preload/index.cjs': '',
  '/out/renderer/index.html': '<!doctype html>',
  '/node_modules/chokidar/package.json': JSON.stringify({ name: 'chokidar', version: '5.0.0' }),
  '/node_modules/chokidar/index.js': 'module.exports = {};',
  '/node_modules/@scope/pkg/package.json': JSON.stringify({ name: '@scope/pkg', version: '1.2.3' }),
  '/node_modules/zod/package.json': JSON.stringify({ name: 'zod', version: '4.5.4' }),
  // A package.json below a package's own folder is not a package of its own.
  '/node_modules/zod/v4/package.json': JSON.stringify({ type: 'module' }),
  '/node_modules/chokidar/node_modules/readdirp/package.json': JSON.stringify({
    name: 'readdirp',
    version: '5.1.1'
  })
};

const NOTICES = renderNotices('Example', VERSION, [
  notice('@scope/pkg', '1.2.3'),
  notice('chokidar', '5.0.0'),
  notice('readdirp', '5.1.1'),
  notice('zod', '4.5.4')
]);

const INSTALLER_BYTES = Buffer.from('an installer, as far as this test is concerned');

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface FakeDist {
  dist: string;
  unpacked: string;
  resources: string;
  options: VerifyOptions;
}

/** A dist folder that passes every check, the installer's included. */
function fakeDist(asar: Record<string, AsarContent> = ASAR): FakeDist {
  const dist = mkdtempSync(path.join(os.tmpdir(), 'verify-package-test-'));
  temps.push(dist);
  const unpacked = path.join(dist, 'win-unpacked');
  const resources = path.join(unpacked, 'resources');
  mkdirSync(path.join(unpacked, 'locales'), { recursive: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(path.join(unpacked, `${NAME}.exe`), 'MZ');
  writeFileSync(path.join(unpacked, 'locales', 'en-US.pak'), 'pak');
  writeFileSync(path.join(unpacked, 'LICENSE.electron.txt'), 'MIT');
  writeAsar(path.join(resources, 'app.asar'), asar);
  writeFileSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'), NOTICES);
  writeFileSync(path.join(resources, 'LICENSE.txt'), 'MIT License\n');
  writeFileSync(path.join(resources, 'GUIDELINES.default.md'), '# Guidelines\n');
  writeFileSync(
    path.join(resources, 'app-update.yml'),
    `owner: ${OWNER}\nrepo: ${REPO}\nprovider: github\nreleaseType: draft\nupdaterCacheDirName: manuscript-review-updater\n`
  );
  const file = installerName(NAME, VERSION);
  writeFileSync(path.join(dist, file), INSTALLER_BYTES);
  writeFileSync(path.join(dist, `${file}.blockmap`), 'blockmap');
  writeLatest(dist, {});
  return {
    dist,
    unpacked,
    resources,
    options: {
      dist,
      installer: true,
      productName: NAME,
      version: VERSION,
      owner: OWNER,
      repo: REPO,
      expectSigned: false
    }
  };
}

/** latest.yml as electron-builder writes it, with any field replaced. */
function writeLatest(
  dist: string,
  change: { version?: string; url?: string; path?: string; size?: string; sha512?: string }
): void {
  const file = installerName(NAME, VERSION);
  const sha512 = change.sha512 ?? createHash('sha512').update(INSTALLER_BYTES).digest('base64');
  writeFileSync(
    path.join(dist, 'latest.yml'),
    [
      `version: ${change.version ?? VERSION}`,
      'files:',
      `  - url: ${change.url ?? file}`,
      `    sha512: ${sha512}`,
      `    size: ${change.size ?? INSTALLER_BYTES.length}`,
      `path: ${change.path ?? file}`,
      `sha512: ${sha512}`,
      "releaseDate: '2026-10-20T20:01:34.952Z'",
      ''
    ].join('\n')
  );
}

function problems(options: VerifyOptions): string[] {
  return verifyPackage(options).problems;
}

describe('reading the package', () => {
  it('lists an asar as @electron/asar writes it, and reads its packed files', () => {
    const { resources } = fakeDist({
      ...ASAR,
      '/node_modules/x/bin/tool.node': { unpacked: 'binary' },
      '/node_modules/.bin/tool': { link: '../x/bin/tool.js' }
    });
    const asar = readAsar(path.join(resources, 'app.asar'));
    const listed = asar.entries.map((entry) => `${entry.kind} ${entry.path}`);
    expect(listed).toContain('dir /out');
    expect(listed).toContain('file /out/main/index.js');
    expect(listed).toContain('dir /node_modules/@scope');
    expect(listed).toContain('file /node_modules/x/bin/tool.node');
    expect(listed).toContain('link /node_modules/.bin/tool');
    expect(asar.read('/out/main/index.js')?.toString()).toBe('console.log("main");');
    expect(asar.read('/node_modules/zod/package.json')?.toString()).toBe(
      ASAR['/node_modules/zod/package.json']
    );
    expect(asar.read('/node_modules/x/bin/tool.node')).toBeUndefined();
    expect(asar.read('/out')).toBeUndefined();
    expect(asar.read('/nothing')).toBeUndefined();
  });

  it('reads the flat YAML electron-builder writes', () => {
    const { dist } = fakeDist();
    const { top, files } = readSimpleYaml(readFileSync(path.join(dist, 'latest.yml'), 'utf8'));
    expect(top.version).toBe(VERSION);
    expect(top.releaseDate).toBe('2026-10-20T20:01:34.952Z');
    expect(top.files).toBe('');
    expect(files).toEqual([
      {
        url: installerName(NAME, VERSION),
        sha512: createHash('sha512').update(INSTALLER_BYTES).digest('base64'),
        size: String(INSTALLER_BYTES.length)
      }
    ]);
  });

  it('reads the headings third-party-notices.ts writes', () => {
    expect([...noticeHeadings(NOTICES)]).toEqual([
      '@scope/pkg 1.2.3',
      'chokidar 5.0.0',
      'readdirp 5.1.1',
      'zod 4.5.4'
    ]);
    expect([...noticeHeadings(NOTICES.replace(/\n/g, '\r\n'))]).toHaveLength(4);
  });

  it('tells an Anthropic package or a Claude Code binary by its path', () => {
    expect(anthropicProblem('/node_modules/@anthropic-ai/claude-agent-sdk/cli.js', true)).toBe(
      'is part of an @anthropic-ai package'
    );
    expect(anthropicProblem('/node_modules/@Anthropic-AI', false)).toBe(
      'is part of an @anthropic-ai package'
    );
    expect(anthropicProblem('/resources/claude.exe', true)).toBe('is a Claude Code binary');
    expect(anthropicProblem('/resources/bin/CLAUDE', true)).toBe('is a Claude Code binary');
    expect(anthropicProblem('/resources/claude', false)).toBeUndefined();
    expect(anthropicProblem('/resources/claude.md', true)).toBeUndefined();
    expect(anthropicProblem('/out/main/claudeCli.js', true)).toBeUndefined();
  });

  it('counts EXPECT_SIGNED as set unless it is empty, 0 or false', () => {
    expect(expectSigned(undefined)).toBe(false);
    expect(expectSigned('')).toBe(false);
    expect(expectSigned('0')).toBe(false);
    expect(expectSigned('False')).toBe(false);
    expect(expectSigned('1')).toBe(true);
    expect(expectSigned('true')).toBe(true);
  });
});

describe('the checks', () => {
  it('passes a good package, and reports what its asar holds', () => {
    const { options } = fakeDist();
    const result = verifyPackage(options);
    expect(result.problems).toEqual([]);
    expect(result.asarPackages).toEqual([
      '@scope/pkg 1.2.3',
      'chokidar 5.0.0',
      'readdirp 5.1.1',
      'zod 4.5.4'
    ]);
    expect(result.asarEntries).toBe(22);
  });

  it('says so when there is nothing to check', () => {
    const { options, unpacked } = fakeDist();
    rmSync(unpacked, { recursive: true });
    expect(problems(options)).toEqual([
      `${unpacked} is missing. Run npm run package or npm run package:dir first.`
    ]);
  });

  it('fails an asar without the main script or package.json', () => {
    const asar = { ...ASAR };
    delete asar['/out/main/index.js'];
    delete asar['/package.json'];
    expect(problems(fakeDist(asar).options)).toEqual([
      'app.asar has no /out/main/index.js',
      'app.asar has no /package.json'
    ]);
  });

  it.each([
    '/samples/manuscript/Chapter 01.md',
    '/test/a.test.ts',
    '/src/main/index.ts',
    '/dist/x.exe',
    '/.dev-userdata/settings.json'
  ])('fails an asar that holds %s', (entry) => {
    const top = `/${entry.split('/')[1]!}`;
    const count = entry.split('/').length - 1;
    expect(problems(fakeDist({ ...ASAR, [entry]: 'x' }).options)).toEqual([
      `app.asar holds ${top} (${count} entries)`
    ]);
  });

  it('does not mistake a file that only starts like a forbidden folder', () => {
    expect(
      problems(fakeDist({ ...ASAR, '/out/renderer/assets/src-map.js': 'x', '/testing.txt': 'x' }).options)
    ).toEqual([]);
  });

  it('fails an @anthropic-ai package or a claude.exe in the asar', () => {
    const { options } = fakeDist({
      ...ASAR,
      '/node_modules/@anthropic-ai/claude-agent-sdk/package.json': JSON.stringify({
        name: '@anthropic-ai/claude-agent-sdk',
        version: '0.3.283'
      }),
      '/node_modules/sdk-win32-x64/claude.exe': { unpacked: 'MZ' }
    });
    expect(problems(options)).toEqual([
      'app.asar /node_modules/@anthropic-ai is part of an @anthropic-ai package',
      'app.asar /node_modules/@anthropic-ai/claude-agent-sdk is part of an @anthropic-ai package',
      'app.asar /node_modules/@anthropic-ai/claude-agent-sdk/package.json is part of an @anthropic-ai package',
      'app.asar /node_modules/sdk-win32-x64/claude.exe is a Claude Code binary',
      'THIRD_PARTY_NOTICES.txt does not list @anthropic-ai/claude-agent-sdk 0.3.283, which app.asar holds at /node_modules/@anthropic-ai/claude-agent-sdk'
    ]);
  });

  it('fails a claude.exe copied anywhere into the unpacked app', () => {
    const { options, unpacked, resources } = fakeDist();
    writeFileSync(path.join(unpacked, 'claude.exe'), 'MZ');
    mkdirSync(path.join(resources, 'app.asar.unpacked', 'node_modules', '@anthropic-ai'), {
      recursive: true
    });
    writeFileSync(
      path.join(resources, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude'),
      'ELF'
    );
    expect(problems(options)).toEqual([
      'win-unpacked/claude.exe is a Claude Code binary',
      'win-unpacked/resources/app.asar.unpacked/node_modules/@anthropic-ai is part of an @anthropic-ai package',
      'win-unpacked/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude is part of an @anthropic-ai package'
    ]);
  });

  it('fails a package without the notices, the licence or the guidelines template beside the asar', () => {
    const { options, resources } = fakeDist();
    rmSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'));
    rmSync(path.join(resources, 'GUIDELINES.default.md'));
    writeFileSync(path.join(resources, 'LICENSE.txt'), '');
    expect(problems(options)).toEqual([
      'resources/THIRD_PARTY_NOTICES.txt is missing',
      'resources/LICENSE.txt is empty',
      'resources/GUIDELINES.default.md is missing'
    ]);
  });

  it('fails notices that leave out a package the asar holds, or name another version', () => {
    const { options, resources } = fakeDist();
    writeFileSync(
      path.join(resources, 'THIRD_PARTY_NOTICES.txt'),
      renderNotices('Example', VERSION, [
        notice('@scope/pkg', '1.2.3'),
        notice('chokidar', '4.0.3'),
        notice('zod', '4.5.4')
      ])
    );
    expect(problems(options)).toEqual([
      'THIRD_PARTY_NOTICES.txt does not list chokidar 5.0.0, which app.asar holds at /node_modules/chokidar',
      'THIRD_PARTY_NOTICES.txt does not list readdirp 5.1.1, which app.asar holds at /node_modules/chokidar/node_modules/readdirp'
    ]);
  });

  it('fails a file that is not an asar archive', () => {
    const { options, resources } = fakeDist();
    writeFileSync(path.join(resources, 'app.asar'), 'PK\u0003\u0004 not an asar');
    expect(problems(options)).toEqual(['resources/app.asar could not be read: not an asar archive']);
  });
});

describe('the installer checks (--installer)', () => {
  it('are skipped without --installer, as after package:dir', () => {
    const { options, dist, resources } = fakeDist();
    rmSync(path.join(resources, 'app-update.yml'));
    rmSync(path.join(dist, 'latest.yml'));
    rmSync(path.join(dist, installerName(NAME, VERSION)));
    expect(problems({ ...options, installer: false })).toEqual([]);
    expect(problems(options)).toEqual([
      'resources/app-update.yml is missing',
      `${installerName(NAME, VERSION)} is missing`,
      'latest.yml is missing'
    ]);
  });

  it('fail an app-update.yml that names another repository or provider', () => {
    const { options, resources } = fakeDist();
    writeFileSync(
      path.join(resources, 'app-update.yml'),
      `owner: someone-else\nrepo: ${REPO}\nprovider: generic\n`
    );
    expect(problems(options)).toEqual([
      'app-update.yml has provider: generic, not github',
      `app-update.yml has owner: someone-else, not ${OWNER}`
    ]);
  });

  it('want a publisherName only when EXPECT_SIGNED is set', () => {
    const { options, resources } = fakeDist();
    expect(problems({ ...options, expectSigned: true })).toEqual([
      'app-update.yml has no publisherName, though EXPECT_SIGNED is set'
    ]);
    const file = path.join(resources, 'app-update.yml');
    writeFileSync(file, `${readFileSync(file, 'utf8')}publisherName:\n  - Example Ltd\n`);
    expect(problems({ ...options, expectSigned: true })).toEqual([]);
    expect(problems(options)).toEqual(['app-update.yml names a publisherName, but EXPECT_SIGNED is not set']);
  });

  it('fail a latest.yml with another version, file name, size or sha512', () => {
    const { options, dist } = fakeDist();
    const file = installerName(NAME, VERSION);
    writeLatest(dist, {
      version: '9.9.9',
      url: 'Other-Setup.exe',
      path: 'Other-Setup.exe',
      size: '12',
      sha512: 'abc='
    });
    expect(problems(options)).toEqual([
      `latest.yml has version 9.9.9, not ${VERSION}`,
      `latest.yml has path Other-Setup.exe, not ${file}`,
      `latest.yml's file is Other-Setup.exe, not ${file}`,
      `latest.yml gives size 12, but ${file} is ${INSTALLER_BYTES.length} bytes`,
      `latest.yml's sha512 does not match ${file}`,
      `latest.yml's top-level sha512 does not match ${file}`
    ]);
  });

  it('fail an installer without its .blockmap', () => {
    const { options, dist } = fakeDist();
    rmSync(path.join(dist, `${installerName(NAME, VERSION)}.blockmap`));
    expect(problems(options)).toEqual([`${installerName(NAME, VERSION)}.blockmap is missing`]);
  });
});

describe('the command', () => {
  it('exits 0 on a good package and 1 once a claude.exe is copied into it', () => {
    const { dist, unpacked } = fakeDist();
    const passed = spawnSync(process.execPath, [SCRIPT, '--installer', '--dist', dist], {
      encoding: 'utf8',
      env: { ...process.env, EXPECT_SIGNED: '' }
    });
    expect(passed.stderr).toBe('');
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain(
      'verify-package: app.asar lists 22 entries; its node_modules: @scope/pkg 1.2.3'
    );
    expect(passed.stdout).toContain('passes, with the installer.');

    writeFileSync(path.join(unpacked, 'claude.exe'), 'MZ');
    const failed = spawnSync(process.execPath, [SCRIPT, '--dist', dist], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toBe(
      `verify-package: win-unpacked/claude.exe is a Claude Code binary\nverify-package: 1 problem(s) in ${dist}\n`
    );
  });
});
