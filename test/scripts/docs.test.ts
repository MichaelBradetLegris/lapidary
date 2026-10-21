import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claudeArgs } from '../../src/main/providers/claudeOptions';
import { APP_DATA_DIR, APP_NAME } from '../../src/shared/branding';
import { EFFORT_LEVELS } from '../../src/shared/types';
import {
  installAndLoginCommand,
  installerPathCommand,
  loginCommand,
  otherInstalls,
  setupTroubleshooting,
  updateCommand,
  type SetupViewId
} from '../../src/shared/ui/setup';

/*
 * release.10: the commands and files the maintainer's documents name are the
 * ones that exist. docs/RELEASING.md was checked against the scripts and the
 * installed `claude --help` when it was written; this keeps it so when a
 * script is renamed or a flag is added to the command line.
 *
 * opensource.11: the same for README.md, the user's document. Every command
 * it gives is one the Setup screen, the release notes or package.json gives,
 * word for word; the installer and the folders it names are the ones the
 * build and the app use; its install steps are the release notes' own; and
 * its links lead to files and headings that exist.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const RELEASING = 'docs/RELEASING.md';
/** The documents that tell a maintainer or an agent which commands to run. */
const COMMAND_DOCS = [RELEASING, 'CONTRIBUTING.md', 'CLAUDE.md', 'README.md'];

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const pkg = JSON.parse(read('package.json')) as PackageJson;
const scripts = pkg.scripts ?? {};

/** The text of the `## ` section whose heading starts with `title`, up to the next `## `. */
function section(text: string, title: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${title}`));
  if (start === -1) throw new Error(`no section "${title}"`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/**
 * Whether `rel` (with `/` between its parts, from the root) names a file or
 * folder, matching the case of every part: Windows would find
 * `mockOpenAI.ts` for `mockOpenAi.ts`, where Linux, and CI's Linux leg, would not.
 */
function existsExactly(rel: string): boolean {
  let dir = ROOT;
  for (const part of path.posix.normalize(rel).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      dir = path.dirname(dir);
      continue;
    }
    if (!existsSync(dir) || !readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

/** GitHub's anchor for a heading: lower case, spaces to hyphens, other punctuation gone. */
function anchorOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}

describe('commands in the documents (release.10)', () => {
  it.each(COMMAND_DOCS)('%s names only npm scripts that exist', (file) => {
    // README types npm.cmd, which PowerShell runs where it blocks npm.ps1.
    const named = [...read(file).matchAll(/\bnpm(?:\.cmd)? run ([\w:-]+)/g)].map((match) => match[1] ?? '');
    expect(named.length, file).toBeGreaterThan(0);
    for (const name of named) expect(Object.keys(scripts), `${file}: npm run ${name}`).toContain(name);
  });

  it.each(COMMAND_DOCS)('%s runs only scripts and helpers that exist with node', (file) => {
    for (const match of read(file).matchAll(/\bnode ((?:scripts|test)\/[\w./-]+)/g)) {
      expect(existsExactly(match[1] ?? ''), `${file}: node ${match[1]}`).toBe(true);
    }
  });
});

describe('docs/RELEASING.md (release.10)', () => {
  const text = read(RELEASING);

  it('has the sections the task asks for', () => {
    const headings = text.split(/\r?\n/).filter((line) => line.startsWith('## '));
    expect(headings).toEqual([
      '## Versioning',
      '## Cutting a release',
      '## Fixing forward',
      '## A Claude Code check each release',
      '## Packages checked by hand each release',
      '## The smoke checklist'
    ]);
  });

  it('names only repository files that exist', () => {
    const paths = [...text.matchAll(/`((?:src|scripts|test|docs|resources|\.github)\/[^`\s*<>]+)`/g)].map(
      (match) => match[1] ?? ''
    );
    expect(paths.length).toBeGreaterThan(10);
    for (const file of paths) expect(existsExactly(file), file).toBe(true);
  });

  it('links only to files and headings that exist', () => {
    const anchors = text
      .split(/\r?\n/)
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => anchorOf(line.replace(/^#+ /, '')));
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] ?? '';
      if (/^https?:\/\//.test(target)) continue;
      if (target.startsWith('#')) {
        expect(anchors, target).toContain(target.slice(1));
      } else {
        const file = target.split('#')[0] ?? '';
        expect(existsExactly(path.posix.join('docs', file)), target).toBe(true);
      }
    }
  });

  it('checks every flag the app passes to Claude Code, and every effort level', () => {
    const check = section(text, 'A Claude Code check each release');
    const review = claudeArgs({ model: 'sonnet', effort: 'low', maxTurns: 3, partialMessages: true });
    const flags = new Set(review.filter((arg) => arg.startsWith('-')).map((arg) => arg.split('=')[0] ?? arg));
    expect(flags.size).toBeGreaterThan(10);
    for (const flag of flags) expect(check, flag).toMatch(new RegExp('`' + flag + '[ =`]'));
    for (const level of EFFORT_LEVELS) expect(check, level).toContain(`\`${level}\``);
    // The two commands the launch check runs (claudeBinary.ts) and the two Setup shows.
    for (const command of [
      'claude --version',
      'claude auth status --json',
      'claude auth login',
      'claude update'
    ])
      expect(check, command).toContain(`\`${command}\``);
    expect(check).toContain('MIN_CLAUDE_CODE');
    expect(check).toContain('RECOMMENDED_CLAUDE_CODE');
    expect(check).toContain('src/shared/ai/claudeModels.ts');
  });

  it("marks the owner's steps, so an agent following the doc stops before them", () => {
    // Pushing, publishing or deleting on GitHub, merging a pull request,
    // updating the author's Claude Code and a live review on their plan.
    const owners = [
      /`git push /,
      /`gh release (?:edit|delete) /,
      /\bmerge\b.*\bpull request/i,
      /Bring your own copy up to date/,
      /\*\*One live review\.\*\*/,
      /open the model list/
    ];
    const lines = text.split(/\r?\n/).filter((line) => owners.some((rule) => rule.test(line)));
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const line of lines) expect(line, line).toContain('**(author)**');
  });

  it('publishes a pre-release without --latest', () => {
    const cut = section(text, 'Cutting a release');
    expect(cut).toContain('`gh release edit vx.y.z --draft=false --latest`');
    expect(cut).toContain('`gh release edit vx.y.z --draft=false`');
  });

  it('looks up the major of Electron that package.json pins', () => {
    const major = /^(\d+)\./.exec(
      pkg.devDependencies?.['electron'] ?? pkg.dependencies?.['electron'] ?? ''
    )?.[1];
    expect(major).toBeDefined();
    const named = [...text.matchAll(/npm view electron@(\d+) version/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const value of named) expect(value).toBe(major);
  });

  it('checks the npm tags of electron-builder and electron-updater', () => {
    const packages = section(text, 'Packages checked by hand each release');
    expect(packages).toContain('npm view electron-builder dist-tags');
    expect(packages).toContain('npm view electron-updater dist-tags');
  });
});

interface ReleaseNotes {
  renderFooter(template: string, values: Record<string, unknown>): string;
  footerValues(version: string): Record<string, string> & { installer: string };
  FOOTER: string;
}

interface BuilderConfig {
  productName?: string;
  nsis?: { artifactName?: string };
}

describe('README.md (opensource.11)', () => {
  const text = read('README.md');
  const notes = require('../../scripts/release-notes.cjs') as ReleaseNotes;
  const builder = require('../../electron-builder.config.cjs') as BuilderConfig;
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();

  /** Every inline code span, and every line of a fenced block, as written. */
  const fence = /^[ \t]*```[a-z]*\n([\s\S]*?)^[ \t]*```$/gm;
  const fenced = [...text.matchAll(fence)].flatMap((match) =>
    (match[1] ?? '').split('\n').map((line) => line.trim())
  );
  const spans = [...text.replace(fence, '').matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? '');
  const code = [...fenced, ...spans].filter((item) => item !== '');

  /** What the Setup screen shows on Windows, in every view: its commands and its troubleshooting answers. */
  const views: SetupViewId[] = ['not-installed', 'signed-out', 'expired', 'could-not-check', 'outdated'];
  const setupWords = [
    installAndLoginCommand('windows'),
    loginCommand(undefined, 'windows').command,
    updateCommand(undefined, 'windows').command,
    installerPathCommand('windows', 'auth login'),
    ...otherInstalls('windows').map((install) => install.command),
    ...views.flatMap((view) =>
      setupTroubleshooting(view, null, 'windows', 'windows').map((item) => `${item.question}\n${item.answer}`)
    )
  ].join('\n');

  it('gives only commands the Setup screen gives, word for word', () => {
    const commands = code.filter((item) => /^(?:claude|winget|irm|brew) /.test(item));
    expect(commands.length).toBeGreaterThanOrEqual(6);
    expect(commands).toContain(installAndLoginCommand('windows'));
    for (const command of commands) expect(setupWords, command).toContain(command);
  });

  it('runs npm only with commands and scripts that exist', () => {
    // "npm error" is what npm prints when a command fails, which the README quotes.
    const runs = code.filter((item) => /^npm(?:\.cmd)? /.test(item) && item !== 'npm error');
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const [, verb = '', name = ''] = /^npm(?:\.cmd)? (\S+)(?: (\S+))?/.exec(run) ?? [];
      expect(['ci', 'install', 'test', 'start', 'run'], run).toContain(verb);
      if (verb === 'run') expect(Object.keys(scripts), run).toContain(name);
    }
  });

  it('passes Claude Code only flags the app passes', () => {
    const review = claudeArgs({ model: 'sonnet', effort: 'low', maxTurns: 3, partialMessages: true });
    const flags = code.filter((item) => /^--[a-z]/.test(item));
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) expect(review, flag).toContain(flag);
  });

  it('names the installer as the build names it', () => {
    expect(builder.productName).toBe(APP_NAME);
    expect(builder.nsis?.artifactName).toBe('${productName}-Setup-${version}.${ext}');
    const named = [...text.matchAll(/\b([\w-]+-Setup-[^\s`"]+\.exe)\b/g)].map((match) => match[1] ?? '');
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const name of named) {
      expect(name).toMatch(new RegExp(`^${APP_NAME}-Setup-(?:<version>|\\d+\\.\\d+\\.\\d+)\\.exe$`));
    }
  });

  it("gives the release notes' install steps and checksum command word for word", () => {
    const footer = notes.renderFooter(readFileSync(notes.FOOTER, 'utf8'), notes.footerValues('1.0.0'));
    const install = flat(section(text, 'Installing'));
    const steps = section(footer.replace(/^### /gm, '## '), 'Installing')
      .split('\n')
      .flatMap((line) => /^\d+\. (.+)$/.exec(line)?.[1] ?? []);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const step of steps) expect(install, step).toContain(flat(step));
    expect(install).toContain(
      `${APP_NAME} is not code-signed, so your browser and Windows may warn you the first time.`
    );
    const hash = /^Get-FileHash .+$/m.exec(footer)?.[0];
    expect(hash).toBe(`Get-FileHash "$HOME\\Downloads\\${notes.footerValues('1.0.0').installer}"`);
    expect(fenced).toContain(hash);
  });

  it('names the folders the app and its installer use', () => {
    const folders = [...text.matchAll(/%(?:APPDATA|LOCALAPPDATA|USERPROFILE)%(?:\\[\w.-]+)*/g)].map(
      (match) => match[0]
    );
    const known = [
      `%APPDATA%\\${APP_DATA_DIR}`,
      `%LOCALAPPDATA%\\Programs\\${pkg.name ?? ''}`,
      `%LOCALAPPDATA%\\${pkg.name ?? ''}-updater`,
      '%USERPROFILE%\\.local\\bin',
      '%APPDATA%',
      '%LOCALAPPDATA%'
    ];
    expect(folders.length).toBeGreaterThanOrEqual(6);
    for (const folder of folders) expect(known, folder).toContain(folder);
    // The uninstall steps name the two folders a user deletes by hand.
    const uninstall = section(text, 'Uninstalling');
    expect(uninstall).toContain(`\`${APP_DATA_DIR}\``);
    expect(uninstall).toContain(`\`${pkg.name ?? ''}-updater\``);
  });

  it('links only to files and headings that exist', () => {
    const anchors = text
      .split(/\r?\n/)
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => anchorOf(line.replace(/^#+ /, '')));
    const targets = [
      ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ''),
      ...[...text.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1] ?? '')
    ];
    expect(targets.filter((target) => target.startsWith('#')).length).toBeGreaterThan(10);
    expect(targets.filter((target) => target.endsWith('.png')).length).toBeGreaterThanOrEqual(3);
    for (const target of targets) {
      if (/^https?:\/\//.test(target)) continue;
      if (target.startsWith('#')) expect(anchors, target).toContain(target.slice(1));
      else expect(existsExactly(target.split('#')[0] ?? ''), target).toBe(true);
    }
  });
});
