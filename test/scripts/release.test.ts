import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_NAME, APP_REPOSITORY } from '../../src/shared/branding';

/*
 * release.6b: the two scripts the release workflow runs (PLAN 11.3 n).
 * scripts/check-release.cjs refuses a tag that cannot be released, before
 * `npm ci`; scripts/release-notes.cjs makes the release's notes from the
 * version's CHANGELOG section and .github/release-footer.md. Each check runs
 * here both ways, on text in memory; the command lines run on a copy of the
 * scripts in a temporary folder, with made-up package files and CHANGELOG,
 * and once each against the repository itself, which they only read.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

interface Section {
  heading: string;
  date: string | null;
  dateText: string;
  body: string;
}

interface FooterValues {
  version: string;
  tag: string;
  name: string;
  installer: string;
  repo: string;
}

interface ReleaseNotes {
  TAG_PATTERN: RegExp;
  versionFromTag(tag: unknown): string | null;
  isCalendarDate(text: string): boolean;
  extractSection(changelog: string, version: string): Section | null;
  hasEntries(body: string): boolean;
  renderFooter(template: string, values: Record<string, unknown>): string;
  installerName(version: string, name?: string): string;
  footerValues(version: string, name?: string, slug?: string): FooterValues;
  releaseNotes(changelog: string, footer: string, values: FooterValues): string;
  CHANGELOG: string;
  FOOTER: string;
}

interface ReleaseFiles {
  packageJson: string | null;
  packageLock: string | null;
  changelog: string | null;
}

interface CheckRelease {
  checkRelease(tag: string, files: ReleaseFiles): string[];
  readReleaseFiles(root?: string): ReleaseFiles;
  ROOT: string;
}

interface BuilderConfig {
  nsis: { artifactName: string };
}

const notes = require('../../scripts/release-notes.cjs') as ReleaseNotes;
const check = require('../../scripts/check-release.cjs') as CheckRelease;
const builder = require('../../electron-builder.config.cjs') as BuilderConfig;

const FOOTER_TEXT = readFileSync(path.join(ROOT, '.github', 'release-footer.md'), 'utf8');
const CLAUDE_SENTENCE =
  'Reviews with Claude need Claude Code, which you install and sign in to yourself; it is not included.';

/** A CHANGELOG in the repository's shape, with an Unreleased section, two releases and the foot's links. */
const CHANGELOG = [
  '# Changelog',
  '',
  'All notable changes to this project are documented in this file.',
  '',
  '## [Unreleased]',
  '',
  '### Fixed',
  '',
  '- Something not released yet.',
  '',
  '## [1.0.0] - 2026-11-02',
  '',
  'The first public release.',
  '',
  '### Added',
  '',
  '- One thing.',
  '- Another thing.',
  '',
  '### Fixed',
  '',
  '- A third thing.',
  '',
  '## [0.9.0-rc.1] - 2026-10-30',
  '',
  '### Added',
  '',
  '- A trial.',
  '',
  '[unreleased]: https://github.com/example/example/compare/v1.0.0...HEAD',
  '[1.0.0]: https://github.com/example/example/compare/v0.9.0-rc.1...v1.0.0',
  '[0.9.0-rc.1]: https://github.com/example/example/releases/tag/v0.9.0-rc.1',
  ''
].join('\n');

const BODY_1_0_0 = [
  'The first public release.',
  '',
  '### Added',
  '',
  '- One thing.',
  '- Another thing.',
  '',
  '### Fixed',
  '',
  '- A third thing.'
].join('\n');

function packageJson(version: unknown): string {
  return `${JSON.stringify({ name: 'fixture', version, private: true }, null, 2)}\n`;
}

function packageLock(version: unknown, rootVersion: unknown = version): string {
  return `${JSON.stringify(
    {
      name: 'fixture',
      version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'fixture', version: rootVersion } }
    },
    null,
    2
  )}\n`;
}

function files(version = '1.0.0', changelog = CHANGELOG): ReleaseFiles {
  return { packageJson: packageJson(version), packageLock: packageLock(version), changelog };
}

describe('the tag (versionFromTag)', () => {
  it.each([
    ['v1.0.0', '1.0.0'],
    ['v0.1.0', '0.1.0'],
    ['v10.20.30', '10.20.30'],
    ['v0.9.0-rc.1', '0.9.0-rc.1'],
    ['v1.0.0-alpha', '1.0.0-alpha'],
    ['v1.0.0-alpha-beta.2', '1.0.0-alpha-beta.2'],
    ['v1.0.0-0.3.7', '1.0.0-0.3.7'],
    ['v1.0.0-x.7.z.92', '1.0.0-x.7.z.92'],
    ['v1.0.0-0a', '1.0.0-0a']
  ])('takes %s as version %s', (tag, version) => {
    expect(notes.versionFromTag(tag)).toBe(version);
  });

  it.each([
    '1.0.0',
    'V1.0.0',
    'v1',
    'v1.0',
    'v1.0.0.0',
    'v01.0.0',
    'v1.00.0',
    'v1.0.00',
    'v1.0.0-',
    'v1.0.0-rc..1',
    'v1.0.0-rc.01',
    'v1.0.0-rc_1',
    'v1.0.0+build.5',
    'v1.0.0-rc.1+build.5',
    ' v1.0.0',
    'v1.0.0 ',
    'v1.0.0\n',
    'refs/tags/v1.0.0',
    'v1.0.0; echo',
    ''
  ])('refuses %j', (tag) => {
    expect(notes.versionFromTag(tag)).toBeNull();
  });

  it('refuses something that is not a string', () => {
    expect(notes.versionFromTag(undefined)).toBeNull();
    expect(notes.versionFromTag(100)).toBeNull();
  });

  it('accepts only tags that the release workflow starts on', () => {
    // release.yml starts on `v[0-9]+.[0-9]+.[0-9]+*` (PLAN 11.3 n).
    const trigger = /^v[0-9]+\.[0-9]+\.[0-9]+/;
    for (const tag of ['v1.0.0', 'v0.9.0-rc.1', 'v10.20.30-x.1']) {
      expect(notes.versionFromTag(tag)).not.toBeNull();
      expect(tag).toMatch(trigger);
    }
  });
});

describe('the date (isCalendarDate)', () => {
  it.each(['2026-11-02', '2026-09-27', '2028-02-29', '2026-12-31', '2026-01-01'])('takes %s', (text) => {
    expect(notes.isCalendarDate(text)).toBe(true);
  });

  it.each([
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-31',
    '2026-1-2',
    '26-11-02',
    '2026/11/02',
    '02-11-2026',
    '2026-11-02 ',
    'TBD',
    ''
  ])('refuses %j', (text) => {
    expect(notes.isCalendarDate(text)).toBe(false);
  });
});

describe('a CHANGELOG section (extractSection)', () => {
  it('gives the heading, the date and the body up to the next section', () => {
    expect(notes.extractSection(CHANGELOG, '1.0.0')).toEqual({
      heading: '## [1.0.0] - 2026-11-02',
      date: '2026-11-02',
      dateText: '2026-11-02',
      body: BODY_1_0_0
    });
  });

  it('stops the last section at the version links at the foot', () => {
    const section = notes.extractSection(CHANGELOG, '0.9.0-rc.1');
    expect(section?.date).toBe('2026-10-30');
    expect(section?.body).toBe('### Added\n\n- A trial.');
  });

  it('runs the last section to the end of a file with no links', () => {
    const text = '# Changelog\n\n## [1.0.0] - 2026-11-02\n\n### Added\n\n- One thing.\n\n\n';
    expect(notes.extractSection(text, '1.0.0')?.body).toBe('### Added\n\n- One thing.');
  });

  it('keeps an ordinary reference link, which is not a version link', () => {
    const text =
      '## [1.0.0] - 2026-11-02\n\n- See [the guide][guide].\n\n[guide]: https://example.com/guide\n';
    expect(notes.extractSection(text, '1.0.0')?.body).toBe(
      '- See [the guide][guide].\n\n[guide]: https://example.com/guide'
    );
  });

  it('finds the Unreleased section by its name, undated', () => {
    const section = notes.extractSection(CHANGELOG, 'Unreleased');
    expect(section?.date).toBeNull();
    expect(section?.body).toBe('### Fixed\n\n- Something not released yet.');
  });

  it('is null when there is no section for the version, matching it whole', () => {
    expect(notes.extractSection(CHANGELOG, '2.0.0')).toBeNull();
    expect(notes.extractSection(CHANGELOG, '1.0')).toBeNull();
    expect(notes.extractSection(CHANGELOG, '0.9.0')).toBeNull();
    expect(notes.extractSection(CHANGELOG, '1.0.0-rc.1')).toBeNull();
    expect(notes.extractSection('', '1.0.0')).toBeNull();
  });

  it('wants the bracketed heading of Keep a Changelog', () => {
    expect(notes.extractSection('## 1.0.0 - 2026-11-02\n\n- One thing.\n', '1.0.0')).toBeNull();
    expect(notes.extractSection('### [1.0.0] - 2026-11-02\n\n- One thing.\n', '1.0.0')).toBeNull();
    expect(notes.extractSection('##[1.0.0] - 2026-11-02\n\n- One thing.\n', '1.0.0')).toBeNull();
  });

  it.each([
    ['## [1.0.0]', ''],
    ['## [1.0.0] - TBD', 'TBD'],
    ['## [1.0.0] - 2026-02-30', '2026-02-30'],
    ['## [1.0.0] - 2026-11-2', '2026-11-2'],
    ['## [1.0.0] - 2026-11-02 [YANKED]', '2026-11-02 [YANKED]'],
    ['## [1.0.0] 2026-11-02', '']
  ])('gives no date for %j', (heading, dateText) => {
    const section = notes.extractSection(`${heading}\n\n- One thing.\n`, '1.0.0');
    expect(section?.heading).toBe(heading);
    expect(section?.date).toBeNull();
    expect(section?.dateText).toBe(dateText);
    expect(section?.body).toBe('- One thing.');
  });

  it('reads a file with CRLF line endings and a byte order mark', () => {
    const crlf = `\uFEFF${CHANGELOG.replace(/\n/g, '\r\n')}`;
    expect(notes.extractSection(crlf, '1.0.0')).toEqual(notes.extractSection(CHANGELOG, '1.0.0'));
    expect(notes.extractSection(crlf, '1.0.0')?.body).not.toContain('\r');
  });

  it('takes a heading inside a code fence as text', () => {
    const text = [
      '## [1.0.0] - 2026-11-02',
      '',
      '- A change to how headings are written:',
      '',
      '```md',
      '## [0.9.0] - 2026-10-30',
      '```',
      '',
      '- Another change.',
      '',
      '## [0.9.0] - 2026-10-30',
      '',
      '- The real one.'
    ].join('\n');
    expect(notes.extractSection(text, '1.0.0')?.body).toContain('- Another change.');
    expect(notes.extractSection(text, '0.9.0')?.body).toBe('- The real one.');
  });

  it('ends a section at the title as well as at the next version', () => {
    const text = '## [1.0.0] - 2026-11-02\n\n- One thing.\n\n# Older history\n\nNotes.\n';
    expect(notes.extractSection(text, '1.0.0')?.body).toBe('- One thing.');
  });

  it('throws when the version has two sections', () => {
    const twice = `${CHANGELOG}\n## [1.0.0] - 2026-11-03\n\n- Again.\n`;
    expect(() => notes.extractSection(twice, '1.0.0')).toThrow(/2 sections for 1\.0\.0/);
  });

  it('finds the sections of the real CHANGELOG', () => {
    const real = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const first = notes.extractSection(real, '0.1.0');
    expect(first?.date).toBe('2026-09-27');
    expect(first?.body.startsWith('Private builds for the author')).toBe(true);
    expect(notes.hasEntries(first?.body ?? '')).toBe(true);
    expect(notes.extractSection(real, 'Unreleased')?.date).toBeNull();
  });
});

describe('a section that lists a change (hasEntries)', () => {
  it.each([
    '- One thing.',
    '* One thing.',
    '+ One thing.',
    '1. One thing.',
    '2) One thing.',
    '### Added\n\n- One.'
  ])('counts %j', (body) => {
    expect(notes.hasEntries(body)).toBe(true);
  });

  it.each([
    '',
    '### Added',
    '### Added\n\n### Fixed',
    'Work towards 1.0.',
    '-No space.',
    '- ',
    '-\nThe next line.',
    '1.\n\nThe next line.',
    '---'
  ])('does not count %j', (body) => {
    expect(notes.hasEntries(body)).toBe(false);
  });
});

describe('the footer (renderFooter)', () => {
  it('fills every placeholder, each time it appears', () => {
    expect(notes.renderFooter('{a} and {b}, then {a} again.', { a: 'one', b: 'two' })).toBe(
      'one and two, then one again.'
    );
  });

  it('leaves braces that hold no word alone', () => {
    const text = 'Get-ChildItem | ForEach-Object { $_ } {} {1} {a b} {-x}';
    expect(notes.renderFooter(text, {})).toBe(text);
  });

  it('ignores values it has no placeholder for', () => {
    expect(notes.renderFooter('{a}', { a: 'one', b: 'two' })).toBe('one');
  });

  it('throws on a leftover placeholder, naming each one once', () => {
    expect(() => notes.renderFooter('{a} {missing} {other} {missing}', { a: 'one' })).toThrow(
      'The release footer has no value for {missing}, {other}.'
    );
  });

  it.each([
    ['an empty value', ''],
    ['a value that is not text', 1],
    ['no value', undefined]
  ])('throws on a placeholder with %s', (_label, value) => {
    expect(() => notes.renderFooter('Download {installer}.', { installer: value })).toThrow('{installer}');
  });

  it('does not take a name from the object prototype', () => {
    expect(() => notes.renderFooter('{constructor} {toString}', {})).toThrow(
      'no value for {constructor}, {toString}'
    );
  });

  it('throws on a placeholder that a value brought in', () => {
    expect(() => notes.renderFooter('{a}', { a: '{b}' })).toThrow('{b}');
  });
});

describe('the values and the real footer', () => {
  it("names the installer as electron-builder's artifactName does", () => {
    const fromConfig = builder.nsis.artifactName
      .replace('${productName}', APP_NAME)
      .replace('${version}', '1.0.0')
      .replace('${ext}', 'exe');
    expect(notes.installerName('1.0.0')).toBe(fromConfig);
    expect(notes.installerName('0.9.0-rc.1', 'Example')).toBe('Example-Setup-0.9.0-rc.1.exe');
  });

  it('fills the placeholders from the version and branding.ts', () => {
    expect(notes.footerValues('1.0.0')).toEqual({
      version: '1.0.0',
      tag: 'v1.0.0',
      name: APP_NAME,
      installer: `${APP_NAME}-Setup-1.0.0.exe`,
      repo: APP_REPOSITORY
    });
  });

  it('renders with nothing left in braces', () => {
    const footer = notes.renderFooter(FOOTER_TEXT, { ...notes.footerValues('1.0.0') });
    expect(footer).not.toMatch(/[{}]/);
  });

  it('uses only the placeholders that footerValues fills, and spells the name nowhere', () => {
    const used = new Set(Array.from(FOOTER_TEXT.matchAll(/\{([A-Za-z]\w*)\}/g), (match) => match[1] ?? ''));
    expect([...used].filter((word) => !(word in notes.footerValues('1.0.0')))).toEqual([]);
    expect(used).toContain('installer');
    expect(used).toContain('name');
    expect(FOOTER_TEXT).not.toMatch(new RegExp(`\\b${APP_NAME}\\b`, 'i'));
  });

  it('says what to download, how past the warnings, how updates come, the checksums and Claude Code', () => {
    const footer = notes.renderFooter(FOOTER_TEXT, { ...notes.footerValues('1.2.3') });
    // The download name.
    expect(footer).toContain(`**${APP_NAME}-Setup-1.2.3.exe**`);
    // The browser's warning, then SmartScreen's.
    expect(footer).toContain("isn't commonly downloaded");
    expect(footer).toContain('**Keep anyway**');
    expect(footer).toContain('"Windows protected your PC"');
    expect(footer).toContain('**More info**, then **Run anyway**');
    // Updates arrive in the app.
    expect(footer).toContain('updates arrive in the app');
    // The checksums, and how to check one on Windows.
    expect(footer).toContain('`SHA256SUMS.txt`');
    expect(footer).toContain(`Get-FileHash "$HOME\\Downloads\\${APP_NAME}-Setup-1.2.3.exe"`);
    // Word for word, as PLAN release.6b gives it.
    expect(footer).toContain(CLAUDE_SENTENCE);
    expect(footer).toContain(`https://github.com/${APP_REPOSITORY}#readme`);
  });

  it('is LF text that ends in one newline', () => {
    expect(FOOTER_TEXT).not.toContain('\r');
    expect(FOOTER_TEXT.endsWith('\n')).toBe(true);
    expect(FOOTER_TEXT.endsWith('\n\n')).toBe(false);
  });
});

describe('the notes (releaseNotes)', () => {
  const values = notes.footerValues('1.0.0');

  it('are the section body, a rule and the footer, ending in one newline', () => {
    const text = notes.releaseNotes(CHANGELOG, 'Footer for {tag}.\n\n', values);
    expect(text).toBe(`${BODY_1_0_0}\n\n---\n\nFooter for v1.0.0.\n`);
  });

  it('read the real footer, with CRLF line endings too', () => {
    const lf = notes.releaseNotes(CHANGELOG, FOOTER_TEXT, values);
    expect(lf.startsWith(`${BODY_1_0_0}\n\n---\n\n### Installing\n`)).toBe(true);
    expect(lf).toContain(CLAUDE_SENTENCE);
    expect(lf).not.toMatch(/[{}\r]/);
    expect(notes.releaseNotes(CHANGELOG, FOOTER_TEXT.replace(/\n/g, '\r\n'), values)).toBe(lf);
  });

  it('throw when the CHANGELOG has no section for the version', () => {
    expect(() => notes.releaseNotes(CHANGELOG, 'Footer.', notes.footerValues('2.0.0'))).toThrow(
      'CHANGELOG.md has no "## [2.0.0] - YYYY-MM-DD" section.'
    );
  });

  it('throw when the section is not dated', () => {
    const undated = CHANGELOG.replace('## [1.0.0] - 2026-11-02', '## [1.0.0]');
    expect(() => notes.releaseNotes(undated, 'Footer.', values)).toThrow('is not dated');
  });

  it('throw when the section lists no change', () => {
    const empty = '## [1.0.0] - 2026-11-02\n\n### Added\n\n## [0.9.0] - 2026-10-30\n\n- A trial.\n';
    expect(() => notes.releaseNotes(empty, 'Footer.', values)).toThrow('lists no change');
  });

  it('throw when the footer has a leftover placeholder', () => {
    expect(() => notes.releaseNotes(CHANGELOG, 'Download {download}.', values)).toThrow('{download}');
  });
});

describe('the release check (checkRelease)', () => {
  it('passes when the tag, both package files and a dated CHANGELOG section agree', () => {
    expect(check.checkRelease('v1.0.0', files('1.0.0'))).toEqual([]);
    expect(check.checkRelease('v0.9.0-rc.1', files('0.9.0-rc.1'))).toEqual([]);
  });

  it('refuses a malformed tag with that one problem', () => {
    for (const tag of ['1.0.0', 'v1.0', 'v1.0.0+build', 'v01.0.0', '']) {
      const problems = check.checkRelease(tag, files('1.0.0'));
      expect(problems, tag).toHaveLength(1);
      expect(problems[0], tag).toContain('is not a release tag');
    }
  });

  it("refuses a tag that is not package.json's version", () => {
    const mismatched = { ...files('1.0.0'), packageJson: packageJson('1.0.1') };
    expect(check.checkRelease('v1.0.0', mismatched)).toEqual([
      `package.json's version is "1.0.1", not "1.0.0".`
    ]);
    const missing = { ...files('1.0.0'), packageJson: '{"name": "fixture"}' };
    expect(check.checkRelease('v1.0.0', missing)).toEqual([
      `package.json's version is missing, not "1.0.0".`
    ]);
  });

  it("refuses a tag that is not the lockfile's own version", () => {
    const mismatched = { ...files('1.0.0'), packageLock: packageLock('0.9.0', '1.0.0') };
    expect(check.checkRelease('v1.0.0', mismatched)).toEqual([
      `package-lock.json's version is "0.9.0", not "1.0.0".`
    ]);
  });

  it("refuses a tag that is not the lockfile's root package version", () => {
    const mismatched = { ...files('1.0.0'), packageLock: packageLock('1.0.0', '0.9.0') };
    expect(check.checkRelease('v1.0.0', mismatched)).toEqual([
      `package-lock.json's root package version is "0.9.0", not "1.0.0".`
    ]);
    const noRoot = { ...files('1.0.0'), packageLock: '{"version": "1.0.0", "packages": {}}' };
    expect(check.checkRelease('v1.0.0', noRoot)).toEqual([
      'package-lock.json has no root package entry (packages[""]).'
    ]);
  });

  it('refuses package files that cannot be read or parsed', () => {
    const unread = { ...files('1.0.0'), packageJson: null, packageLock: null };
    expect(check.checkRelease('v1.0.0', unread)).toEqual([
      'package.json could not be read.',
      'package-lock.json could not be read.'
    ]);
    const broken = { ...files('1.0.0'), packageJson: '{"version": "1.0.0",', packageLock: '["1.0.0"]' };
    expect(check.checkRelease('v1.0.0', broken)).toEqual([
      'package.json is not valid JSON.',
      'package-lock.json does not hold a JSON object.'
    ]);
  });

  it('reads package files that start with a byte order mark', () => {
    const bom = {
      ...files('1.0.0'),
      packageJson: `\uFEFF${packageJson('1.0.0')}`,
      packageLock: `\uFEFF${packageLock('1.0.0')}`
    };
    expect(check.checkRelease('v1.0.0', bom)).toEqual([]);
  });

  it('refuses a version with no CHANGELOG section', () => {
    expect(check.checkRelease('v2.0.0', files('2.0.0'))).toEqual([
      'CHANGELOG.md has no "## [2.0.0] - YYYY-MM-DD" section.'
    ]);
    expect(check.checkRelease('v1.0.0', { ...files('1.0.0'), changelog: null })).toEqual([
      'CHANGELOG.md could not be read.'
    ]);
  });

  it.each(['## [1.0.0]', '## [1.0.0] - TBD', '## [1.0.0] - 2026-02-30', '## [1.0.0] - 2026-11-2'])(
    'refuses an undated section: %j',
    (heading) => {
      const changelog = CHANGELOG.replace('## [1.0.0] - 2026-11-02', heading);
      const problems = check.checkRelease('v1.0.0', files('1.0.0', changelog));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`is not dated: "${heading}"`);
    }
  );

  it('refuses a section that lists no change', () => {
    const changelog = CHANGELOG.replace(BODY_1_0_0, '### Added\n\n### Fixed');
    expect(check.checkRelease('v1.0.0', files('1.0.0', changelog))).toEqual([
      `CHANGELOG.md's section for 1.0.0 lists no change: it needs at least one line starting "- ".`
    ]);
    const prose = CHANGELOG.replace(BODY_1_0_0, 'Work towards 1.0.');
    expect(check.checkRelease('v1.0.0', files('1.0.0', prose))).toHaveLength(1);
  });

  it('refuses a version with two sections', () => {
    const changelog = `${CHANGELOG}\n## [1.0.0] - 2026-11-03\n\n- Again.\n`;
    expect(check.checkRelease('v1.0.0', files('1.0.0', changelog))).toEqual([
      'CHANGELOG.md has 2 sections for 1.0.0; it should have one.'
    ]);
  });

  it('reports every problem at once, in order', () => {
    const all = {
      packageJson: packageJson('0.9.0'),
      packageLock: packageLock('0.8.0', '0.7.0'),
      changelog: '## [1.0.0]\n\n### Added\n'
    };
    expect(check.checkRelease('v1.0.0', all)).toEqual([
      `package.json's version is "0.9.0", not "1.0.0".`,
      `package-lock.json's version is "0.8.0", not "1.0.0".`,
      `package-lock.json's root package version is "0.7.0", not "1.0.0".`,
      `CHANGELOG.md's section for 1.0.0 is not dated: "## [1.0.0]" should end in " - YYYY-MM-DD", a real date.`,
      `CHANGELOG.md's section for 1.0.0 lists no change: it needs at least one line starting "- ".`
    ]);
  });
});

describe('Node builtins only', () => {
  /** The modules a CommonJS file requires. */
  function requires(file: string): string[] {
    const source = readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
    return Array.from(source.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g), (match) => match[2] ?? '');
  }

  it('the release scripts require builtins and each other, and branding.cjs builtins', () => {
    expect(requires('check-release.cjs')).toEqual(['node:fs', 'node:path', './release-notes.cjs']);
    expect(requires('release-notes.cjs')).toEqual(['node:fs', 'node:path', './branding.cjs']);
    expect(requires('branding.cjs')).toEqual(['node:fs', 'node:path']);
  });

  it('reads the files of the repository it belongs to', () => {
    expect(check.ROOT).toBe(ROOT);
    expect(notes.CHANGELOG).toBe(path.join(ROOT, 'CHANGELOG.md'));
    expect(notes.FOOTER).toBe(path.join(ROOT, '.github', 'release-footer.md'));
  });
});

describe('the command lines, on a copy', () => {
  const COPIED = [
    'scripts/check-release.cjs',
    'scripts/release-notes.cjs',
    'scripts/branding.cjs',
    'src/shared/branding.ts',
    '.github/release-footer.md'
  ];
  let dir: string;

  beforeEach(() => {
    // Outside the repository, with no node_modules of its own.
    dir = mkdtempSync(path.join(os.tmpdir(), 'mrev-release-'));
    for (const rel of COPIED) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), readFileSync(path.join(ROOT, rel)));
    }
    writeRelease('1.0.0', CHANGELOG);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeRelease(version: string, changelog: string): void {
    writeFileSync(path.join(dir, 'package.json'), packageJson(version));
    writeFileSync(path.join(dir, 'package-lock.json'), packageLock(version));
    writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  }

  function run(script: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], {
      cwd: dir,
      encoding: 'utf8'
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('check-release exits 0 with one line when the release agrees', () => {
    const result = run('check-release.cjs', 'v1.0.0');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      'v1.0.0: package.json, package-lock.json and the CHANGELOG section dated 2026-11-02 agree.\n'
    );
    expect(result.stderr).toBe('');
  });

  it('check-release exits 1 and lists each problem when it does not', () => {
    writeRelease('1.0.1', CHANGELOG);
    const result = run('check-release.cjs', 'v1.0.1');
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'v1.0.1 cannot be released:\n  - CHANGELOG.md has no "## [1.0.1] - YYYY-MM-DD" section.\n'
    );
    const mismatched = run('check-release.cjs', 'v1.0.0');
    expect(mismatched.status).toBe(1);
    expect(mismatched.stderr).toContain(`package.json's version is "1.0.1", not "1.0.0".`);
    const malformed = run('check-release.cjs', '1.0.1');
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('is not a release tag');
  });

  it('check-release exits 1 when a file is missing', () => {
    rmSync(path.join(dir, 'package-lock.json'));
    const result = run('check-release.cjs', 'v1.0.0');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package-lock.json could not be read.');
  });

  it('check-release exits 2 without exactly one tag', () => {
    for (const args of [[], ['v1.0.0', 'v1.0.1'], ['--tag']]) {
      const result = run('check-release.cjs', ...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/check-release.cjs <tag>');
    }
  });

  it('release-notes prints the notes', () => {
    const result = run('release-notes.cjs', 'v1.0.0');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(notes.releaseNotes(CHANGELOG, FOOTER_TEXT, notes.footerValues('1.0.0')));
    expect(result.stdout).toContain(`${APP_NAME}-Setup-1.0.0.exe`);
    expect(result.stdout).not.toMatch(/[{}]/);
  });

  it('release-notes writes them to the file --out names, as LF text', () => {
    writeRelease('0.9.0-rc.1', CHANGELOG.replace(/\n/g, '\r\n'));
    const result = run('release-notes.cjs', 'v0.9.0-rc.1', '--out', 'notes.md');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('Wrote the notes for v0.9.0-rc.1 to notes.md.\n');
    const written = readFileSync(path.join(dir, 'notes.md'), 'utf8');
    expect(written).toBe(notes.releaseNotes(CHANGELOG, FOOTER_TEXT, notes.footerValues('0.9.0-rc.1')));
    expect(written.startsWith('### Added\n\n- A trial.\n\n---\n\n### Installing\n')).toBe(true);
    expect(written).not.toContain('\r');
  });

  it('release-notes exits 1 and writes nothing when it cannot make them', () => {
    const missing = run('release-notes.cjs', 'v2.0.0', '--out', 'notes.md');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toBe('CHANGELOG.md has no "## [2.0.0] - YYYY-MM-DD" section.\n');
    expect(existsSync(path.join(dir, 'notes.md'))).toBe(false);

    writeFileSync(path.join(dir, '.github', 'release-footer.md'), 'Download {download}.\n');
    const leftover = run('release-notes.cjs', 'v1.0.0', '--out', 'notes.md');
    expect(leftover.status).toBe(1);
    expect(leftover.stderr).toBe('The release footer has no value for {download}.\n');
    expect(existsSync(path.join(dir, 'notes.md'))).toBe(false);

    const malformed = run('release-notes.cjs', '1.0.0');
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('is not a release tag');
  });

  it('release-notes exits 2 on a malformed command line', () => {
    for (const args of [[], ['v1.0.0', 'v1.0.1'], ['v1.0.0', '--out'], ['--out', 'notes.md'], ['--help']]) {
      const result = run('release-notes.cjs', ...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/release-notes.cjs <tag> [--out <file>]');
    }
    expect(existsSync(path.join(dir, 'notes.md'))).toBe(false);
  });
});

describe('the repository itself', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

  it("passes the release check for package.json's version, and is not written", () => {
    const watched = ['package.json', 'package-lock.json', 'CHANGELOG.md'].map((name) =>
      path.join(ROOT, name)
    );
    const before = watched.map((file) => [readFileSync(file), statSync(file).mtimeMs] as const);
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'check-release.cjs'), `v${pkg.version}`],
      {
        encoding: 'utf8'
      }
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    watched.forEach((file, index) => {
      expect(readFileSync(file).equals(before[index]?.[0] ?? Buffer.alloc(0)), file).toBe(true);
      expect(statSync(file).mtimeMs, file).toBe(before[index]?.[1]);
    });
  });

  it('makes notes for the released 0.1.0', () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.cjs'), 'v0.1.0'], {
      encoding: 'utf8'
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('Private builds for the author')).toBe(true);
    expect(result.stdout).toContain(`\n\n---\n\n### Installing\n`);
    expect(result.stdout).toContain(CLAUDE_SENTENCE);
    expect(result.stdout).not.toMatch(/[{}]/);
  });
});
