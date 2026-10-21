import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claudeArgs } from '../../src/main/providers/claudeOptions';
import { EFFORT_LEVELS } from '../../src/shared/types';

/*
 * release.10: the commands and files the maintainer's documents name are the
 * ones that exist. docs/RELEASING.md was checked against the scripts and the
 * installed `claude --help` when it was written; this keeps it so when a
 * script is renamed or a flag is added to the command line.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const RELEASING = 'docs/RELEASING.md';
/** The documents that tell a maintainer or an agent which commands to run. */
const COMMAND_DOCS = [RELEASING, 'CONTRIBUTING.md', 'CLAUDE.md', 'README.md'];

interface PackageJson {
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
