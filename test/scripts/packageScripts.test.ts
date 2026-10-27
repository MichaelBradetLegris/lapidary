import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * release.2: the npm scripts that package and release the app, and the exact
 * pins the installer and the updater depend on (electron-updater since
 * release.8b). electron-builder 26 publishes
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
 * Packages pinned to one version, never a range, each with a floor: the pin
 * must stay on the floor's major and must not go below it. PLAN 11.1's
 * "Updates" row names electron-builder 26.17.0 and electron-updater 6.8.10 on
 * the v26 line; its "Electron" row asks for the latest 44.x, which
 * `release.21` took on 2026-10-21, raising the floor from 44.3.0 to 44.9.3. A
 * later patch or minor on the same major passes, since the release checklist
 * (11.4, step 2) and `release.10`'s Dependabot both expect one. npm's `latest`
 * tag for electron-builder is 26.15.3 and for electron-updater 6.8.9, so
 * `npm i -E electron-updater` without the version goes back, and `npm audit
 * fix --force` would take electron-builder to 26.5.0 (`opensource.3`); for
 * electron it is 45.0.0, a new major, which this test refuses. A deliberate
 * bump edits PLAN 11.1 (CLAUDE.md rule 7) and raises the floor here with it.
 */
const EXACT_PINS: Record<string, string> = {
  electron: '44.10.0',
  'electron-builder': '26.18.1',
  'electron-updater': '6.8.12'
};

/** Compares two x.y.z versions part by part as numbers: negative, zero or positive. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('packaging scripts (release.2)', () => {
  it('builds, writes the notices, then packages, and verifies the installer build after', () => {
    // opensource.5: the notices are written from the build's records, so after
    // it, and before electron-builder, which copies them beside the asar.
    expect(scripts.package).toBe(
      'npm run build && npm run notices && electron-builder --config electron-builder.config.cjs --publish never'
    );
    expect(scripts.postpackage).toBe('npm run verify:package -- --installer');
    expect(scripts.notices).toBe('node scripts/third-party-notices.ts');
  });

  it('builds the unpacked app with --dir, syncing package.json first as package does', () => {
    expect(scripts['package:dir']).toBe(
      'npm run build && npm run notices && electron-builder --config electron-builder.config.cjs --dir --publish never'
    );
    // npm runs pre<name> before <name>, so package:dir needs its own copy of prepackage.
    expect(scripts['prepackage:dir']).toBe('node scripts/sync-branding.cjs');
    expect(scripts['prepackage:dir']).toBe(scripts.prepackage);
    // No postpackage:dir: CI (release.5) runs verify:package on its output itself.
    expect(scripts['postpackage:dir']).toBeUndefined();
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
    // opensource.5 wrote verify-package.ts and release.6b the other two.
    expect(scripts['verify:package']).toBe('node scripts/verify-package.ts');
    expect(existsSync(path.join(ROOT, 'scripts', 'verify-package.ts'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'scripts', 'third-party-notices.ts'))).toBe(true);
    expect(scripts['release:check']).toBe('node scripts/check-release.cjs');
    expect(scripts['release:notes']).toBe('node scripts/release-notes.cjs');
    expect(existsSync(path.join(ROOT, 'scripts', 'check-release.cjs'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'scripts', 'release-notes.cjs'))).toBe(true);
  });
});

describe('exact pins (release.2)', () => {
  it('pins electron-updater, release.8b, among them, as a dependency the asar ships', () => {
    // The updater runs in the installed app, so it must be in `dependencies`:
    // electron-builder leaves devDependencies out of the asar.
    expect(EXACT_PINS['electron-updater']).toBe('6.8.12');
    expect(pkg.dependencies?.['electron-updater']).toBeDefined();
    expect(pkg.devDependencies?.['electron-updater']).toBeUndefined();
    expect(lock.packages['']?.dependencies?.['electron-updater']).toBe(
      pkg.dependencies?.['electron-updater']
    );
  });

  it('compares versions by number, not as text', () => {
    expect(compareVersions('26.17.0', '26.17.0')).toBe(0);
    expect(compareVersions('26.18.0', '26.17.0')).toBeGreaterThan(0);
    expect(compareVersions('26.17.1', '26.17.0')).toBeGreaterThan(0);
    expect(compareVersions('26.15.3', '26.17.0')).toBeLessThan(0);
    expect(compareVersions('26.5.0', '26.17.0')).toBeLessThan(0);
    expect(compareVersions('44.10.0', '44.9.2')).toBeGreaterThan(0);
  });

  it.each(Object.entries(EXACT_PINS))(
    'pins %s to one version, at least %s and on its major, in package.json and the lockfile',
    (name, floor) => {
      const spec = pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];
      expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
      const version = spec ?? '';
      expect(version.split('.')[0], `${name} ${version} is not on the ${floor} major`).toBe(
        floor.split('.')[0]
      );
      expect(
        compareVersions(version, floor),
        `${name} ${version} is older than ${floor}`
      ).toBeGreaterThanOrEqual(0);
      const root = lock.packages[''];
      expect(root?.devDependencies?.[name] ?? root?.dependencies?.[name]).toBe(spec);
      expect(lock.packages[`node_modules/${name}`]?.version).toBe(spec);
    }
  );
});
