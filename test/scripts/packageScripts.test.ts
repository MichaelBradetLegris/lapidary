import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * release.2: the npm scripts that package and release the app, and the exact
 * pins the installer and the updater depend on. electron-builder 26 publishes
 * on its own on CI, on a tag build, or under an npm script named `release`,
 * unless it is told `--publish never` (`PublishManager` in app-builder-lib;
 * PLAN `release.2`).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  packages: Record<string, (PackageJson & { version?: string }) | undefined>;
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as PackageLock;
const scripts = pkg.scripts ?? {};

/**
 * Packages pinned to one version, never a range (PLAN 11.1, "Updates" and
 * "Electron"). electron-updater joins the list when `release.8b` adds it.
 */
const EXACT_PINS = ['electron', 'electron-builder'];

describe('packaging scripts (release.2)', () => {
  it('builds the unpacked app with --dir, syncing package.json first as package does', () => {
    expect(scripts['package:dir']).toBe(
      'npm run build && electron-builder --config electron-builder.config.cjs --dir --publish never'
    );
    // npm runs pre<name> before <name>, so package:dir needs its own copy of prepackage.
    expect(scripts['prepackage:dir']).toBe('node scripts/sync-branding.cjs');
    expect(scripts['prepackage:dir']).toBe(scripts.prepackage);
  });

  it('tells every electron-builder run never to publish', () => {
    const runs = Object.entries(scripts).filter(([, command]) => /\belectron-builder\b/.test(command));
    expect(runs.map(([name]) => name)).toEqual(expect.arrayContaining(['package', 'package:dir']));
    for (const [name, command] of runs) expect(command, name).toMatch(/ --publish never(?: |$)/);
  });

  it('has no script named release, under which electron-builder would always publish', () => {
    expect(Object.keys(scripts)).not.toContain('release');
  });

  it('points the verifier and the release scripts at their agreed files', () => {
    // The files themselves land with opensource.5 (verify-package.ts) and release.6b (the other two).
    expect(scripts['verify:package']).toBe('node scripts/verify-package.ts');
    expect(scripts['release:check']).toBe('node scripts/check-release.cjs');
    expect(scripts['release:notes']).toBe('node scripts/release-notes.cjs');
  });
});

describe('exact pins (release.2)', () => {
  it.each(EXACT_PINS)('pins %s to one version in package.json and the lockfile', (name) => {
    const spec = pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];
    expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
    const root = lock.packages[''];
    expect(root?.devDependencies?.[name] ?? root?.dependencies?.[name]).toBe(spec);
    expect(lock.packages[`node_modules/${name}`]?.version).toBe(spec);
  });
});
