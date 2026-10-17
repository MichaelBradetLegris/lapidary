import { spawnSync } from 'node:child_process';
import { promises as fs, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_NAME, APP_REPOSITORY } from '../../src/shared/branding';

/*
 * opensource.4: scripts/sync-branding.cjs copies the branding constants into
 * package.json, and with --check reports drift without writing anything. The
 * comparison runs here on objects in memory. The command line runs on a copy of
 * the scripts in a temporary folder, so these tests never write the real
 * package.json; the one run against it is a --check.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

type Json = Record<string, unknown>;

interface Difference {
  field: string;
  have: unknown;
  want: unknown;
}

interface SyncBranding {
  brandedFields(name?: string, slug?: string): Json;
  differences(pkg: Json, wanted?: Json): Difference[];
  synced(pkg: Json, wanted?: Json): Json;
  format(pkg: Json): string;
  PACKAGE_JSON: string;
}

const sync = require('../../scripts/sync-branding.cjs') as SyncBranding;

/** What package.json should carry, written out independently of the script. */
const WANTED = {
  productName: APP_NAME,
  repository: { type: 'git', url: `git+https://github.com/${APP_REPOSITORY}.git` },
  homepage: `https://github.com/${APP_REPOSITORY}#readme`,
  bugs: { url: `https://github.com/${APP_REPOSITORY}/issues` }
};

describe('the comparison, in memory', () => {
  it('wants the fields that branding.ts implies', () => {
    expect(sync.brandedFields()).toEqual(WANTED);
    expect(sync.brandedFields('Example', 'someone/example')).toEqual({
      productName: 'Example',
      repository: { type: 'git', url: 'git+https://github.com/someone/example.git' },
      homepage: 'https://github.com/someone/example#readme',
      bugs: { url: 'https://github.com/someone/example/issues' }
    });
  });

  it('finds nothing to change in a package that is in sync, whatever its key order', () => {
    const pkg = { name: 'fixture', ...WANTED, repository: { url: WANTED.repository.url, type: 'git' } };
    expect(sync.differences(pkg)).toEqual([]);
  });

  it('names each field that is missing or different', () => {
    const pkg = {
      name: 'fixture',
      productName: 'Old name',
      repository: WANTED.repository,
      bugs: { url: 'https://example.com/issues' }
    };
    expect(sync.differences(pkg)).toEqual([
      { field: 'productName', have: 'Old name', want: APP_NAME },
      { field: 'homepage', have: undefined, want: WANTED.homepage },
      { field: 'bugs', have: { url: 'https://example.com/issues' }, want: WANTED.bugs }
    ]);
  });

  it('counts an extra or mistyped nested value as a difference', () => {
    const extra = { ...WANTED, repository: { ...WANTED.repository, directory: 'app' } };
    expect(sync.differences(extra).map((d) => d.field)).toEqual(['repository']);
    const flat = { ...WANTED, repository: WANTED.repository.url, bugs: [WANTED.bugs] };
    expect(sync.differences(flat).map((d) => d.field)).toEqual(['repository', 'bugs']);
  });

  it('applies the fields in place, appends new ones and leaves its input alone', () => {
    const pkg = { name: 'fixture', productName: 'Old name', version: '1.0.0' };
    const before = structuredClone(pkg);
    const out = sync.synced(pkg);
    expect(pkg).toEqual(before);
    expect(Object.keys(out)).toEqual(['name', 'productName', 'version', 'repository', 'homepage', 'bugs']);
    expect(out.productName).toBe(APP_NAME);
    expect(sync.differences(out)).toEqual([]);
    expect(sync.format(sync.synced(out))).toBe(sync.format(out));
  });

  it('formats as npm does: two spaces and a trailing newline', () => {
    expect(sync.format({ a: 1, b: { c: 'd' } })).toBe('{\n  "a": 1,\n  "b": {\n    "c": "d"\n  }\n}\n');
  });

  it("targets the repository's own package.json", () => {
    expect(sync.PACKAGE_JSON).toBe(path.join(ROOT, 'package.json'));
  });
});

describe('the command line, on a copy', () => {
  const PAST = new Date('2020-01-01T00:00:00Z');
  const STALE = {
    name: 'fixture',
    version: '1.0.0',
    productName: 'Old name',
    homepage: 'https://example.com'
  };
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-sync-branding-'));
    await fs.mkdir(path.join(dir, 'scripts'));
    await fs.mkdir(path.join(dir, 'src', 'shared'), { recursive: true });
    for (const rel of ['scripts/sync-branding.cjs', 'scripts/branding.cjs', 'src/shared/branding.ts']) {
      await fs.copyFile(path.join(ROOT, rel), path.join(dir, rel));
    }
    file = path.join(dir, 'package.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function cli(...args: string[]): { status: number | null; output: string } {
    const script = path.join(dir, 'scripts', 'sync-branding.cjs');
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  /** Write package.json with an old mtime, so that any rewrite shows. */
  async function writePackage(text: string): Promise<void> {
    await fs.writeFile(file, text, 'utf8');
    await fs.utimes(file, PAST, PAST);
  }

  async function expectUntouched(text: string): Promise<void> {
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    expect((await fs.stat(file)).mtimeMs).toBe(PAST.getTime());
  }

  it('--check exits 1 on drift, prints each field, and writes nothing', async () => {
    const text = sync.format(STALE);
    await writePackage(text);
    const { status, output } = cli('--check');
    expect(status).toBe(1);
    expect(output).toContain('productName: "Old name"');
    expect(output).toContain('homepage: "https://example.com"');
    expect(output).toContain('repository: missing');
    expect(output).toContain('bugs: missing');
    await expectUntouched(text);
  });

  it('--check exits 0 when package.json is in sync', async () => {
    const text = sync.format({ name: 'fixture', ...WANTED });
    await writePackage(text);
    expect(cli('--check').status).toBe(0);
    await expectUntouched(text);
  });

  it('without --check it syncs once, then leaves the file alone', async () => {
    await writePackage(sync.format(STALE));
    expect(cli().status).toBe(0);
    const text = await fs.readFile(file, 'utf8');
    expect(text).toBe(sync.format({ ...STALE, ...WANTED }));

    await fs.utimes(file, PAST, PAST);
    const again = cli();
    expect(again.status).toBe(0);
    expect(again.output).toContain('matches');
    await expectUntouched(text);
    expect(cli('--check').status).toBe(0);
  });

  it('keeps a file that is in sync byte for byte, whatever its formatting', async () => {
    const text = JSON.stringify({ name: 'fixture', ...WANTED }, null, 4);
    await writePackage(text);
    expect(cli().status).toBe(0);
    await expectUntouched(text);
  });

  it('refuses an unknown argument without writing', async () => {
    const text = sync.format(STALE);
    await writePackage(text);
    const { status, output } = cli('--fix');
    expect(status).toBe(2);
    expect(output).toContain('Usage');
    await expectUntouched(text);
  });
});

describe('the real package.json', () => {
  it('passes --check, which does not write it', () => {
    const file = path.join(ROOT, 'package.json');
    const before = readFileSync(file);
    const mtime = statSync(file).mtimeMs;
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-branding.cjs'), '--check'], {
      encoding: 'utf8'
    });
    expect(result.stdout + result.stderr).toContain('matches');
    expect(result.status).toBe(0);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });
});
