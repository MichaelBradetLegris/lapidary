import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_OUTPUT_NOTICE,
  APP_DATA_DIR,
  APP_ID,
  APP_NAME,
  APP_REPOSITORY,
  DISCLAIMER
} from '../src/shared/branding';

/*
 * The app's name is written in one place, src/shared/branding.ts, so a rename
 * is one edit (C.21, C.38). This guard fails when anything that ships or builds
 * the app spells the name, or a name it used to have, anywhere else. Tests are
 * not scanned: they may name things on purpose.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** Names the app has had, or nearly had (PLAN Appendix D 1). Add the old one here on every rename. */
const FORMER_NAMES = ['Stet', 'Igneous'];

interface Branding {
  appName(): string;
  appId(): string;
  appRepository(): { owner: string; repo: string; slug: string };
}

interface BuilderConfig {
  appId?: string;
  productName?: string;
  nsis?: { shortcutName?: string; deleteAppDataOnUninstall?: boolean };
}

interface PackageJson {
  name?: string;
  productName?: string;
  private?: boolean;
  license?: string;
  author?: { name?: string; email?: string };
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
  scripts?: Record<string, string>;
}

const branding = require('../scripts/branding.cjs') as Branding;
const builder = require('../electron-builder.config.cjs') as BuilderConfig;
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;

/** Files under `dir` (recursively when `deep`) whose extension is in `exts`. */
function filesIn(dir: string, exts: readonly string[], deep: boolean): string[] {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(full)) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) {
      if (deep) out.push(...filesIn(rel, exts, deep));
    } else if (exts.includes(path.extname(entry).toLowerCase())) {
      out.push(rel);
    }
  }
  return out;
}

function scannedFiles(): string[] {
  return [
    ...filesIn('src', ['.ts', '.tsx', '.html', '.css'], true),
    ...filesIn('scripts', ['.cjs', '.mjs', '.ts', '.py'], false),
    ...filesIn('resources', ['.md'], false),
    // The release notes' footer (release.6b) is shown on every release page.
    ...filesIn('.github', ['.yml', '.yaml', '.md'], true),
    'electron.vite.config.ts',
    'electron-builder.config.cjs'
  ].filter((file) => path.normalize(file) !== path.normalize('src/shared/branding.ts'));
}

/** Every `file:line` that spells one of `names` as a whole word, in any case. */
function spellings(names: readonly string[]): string[] {
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'i');
  const hits: string[] = [];
  for (const file of scannedFiles()) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${file.replace(/\\/g, '/')}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('the app name lives only in branding.ts', () => {
  it('is spelled nowhere else, under its current or a former name', () => {
    expect(spellings([APP_NAME, ...FORMER_NAMES])).toEqual([]);
  });

  it('actually scans the source tree', () => {
    const files = scannedFiles().map((f) => f.replace(/\\/g, '/'));
    expect(files).toContain('src/main/index.ts');
    expect(files).toContain('src/renderer/index.html');
    expect(files).toContain('scripts/branding.cjs');
    expect(files).toContain('scripts/release-notes.cjs');
    expect(files).toContain('.github/release-footer.md');
    expect(files).not.toContain('src/shared/branding.ts');
  });

  it('is a plain name', () => {
    expect(APP_NAME.trim()).toBe(APP_NAME);
    expect(APP_NAME.length).toBeGreaterThan(0);
    expect(FORMER_NAMES).not.toContain(APP_NAME);
  });
});

describe('the build reads the same constants', () => {
  it('scripts/branding.cjs returns what branding.ts says', () => {
    expect(branding.appName()).toBe(APP_NAME);
    expect(branding.appId()).toBe(APP_ID);
    expect(branding.appRepository().slug).toBe(APP_REPOSITORY);
  });

  it('package.json carries the synced product name and the frozen package name', () => {
    expect(pkg.productName).toBe(APP_NAME);
    expect(pkg.name).toBe('manuscript-review');
  });

  it('electron-builder uses the constants and keeps user data on uninstall', () => {
    expect(builder.appId).toBe(APP_ID);
    expect(builder.productName).toBe(APP_NAME);
    expect(builder.nsis?.shortcutName).toBe(APP_NAME);
    expect(builder.nsis?.deleteAppDataOnUninstall).not.toBe(true);
  });
});

describe('licence and package metadata (opensource.4)', () => {
  it('is MIT, private, and by the author at his GitHub noreply address', () => {
    expect(pkg.license).toBe('MIT');
    expect(pkg.private).toBe(true);
    expect(pkg.author?.name).toBe('Michael Bradet-Legris');
    // GitHub's noreply form is <numeric id>+<login>@users.noreply.github.com.
    const owner = branding.appRepository().owner;
    expect(pkg.author?.email).toMatch(/^\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com$/);
    expect(pkg.author?.email?.endsWith(`+${owner}@users.noreply.github.com`)).toBe(true);
  });

  it('points repository, homepage and bugs at APP_REPOSITORY', () => {
    const { slug } = branding.appRepository();
    expect(pkg.repository).toEqual({ type: 'git', url: `git+https://github.com/${slug}.git` });
    expect(pkg.homepage).toBe(`https://github.com/${slug}#readme`);
    expect(pkg.bugs).toEqual({ url: `https://github.com/${slug}/issues` });
  });

  it('ships the MIT licence text with the author as copyright holder', () => {
    const licence = readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
    expect(licence.startsWith('MIT License\n')).toBe(true);
    expect(licence).toContain('\nCopyright (c) 2026 Michael Bradet-Legris\n');
    expect(licence).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy');
    expect(licence).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
  });

  it('never publishes from the package script, and checks the sync on its own', () => {
    // With a repository field, electron-builder publishes on CI unless told not to.
    expect(pkg.scripts?.package).toMatch(/electron-builder .*--publish never/);
    expect(pkg.scripts?.['branding:check']).toBe('node scripts/sync-branding.cjs --check');
    expect(pkg.scripts?.prepackage).toBe('node scripts/sync-branding.cjs');
  });
});

describe('compliance wording (opensource.6)', () => {
  /** README.md with every run of whitespace made one space, so rewrapping a paragraph cannot break the check. */
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');

  it('keeps Claude, Anthropic and OpenAI marks out of the name', () => {
    // Anthropic's legal page: no Claude Code or Anthropic name in a product's own name (PLAN Appendix A).
    expect(APP_NAME).not.toMatch(/claude|anthropic|openai|chatgpt|gpt/i);
  });

  it('says what the app is, and is not, built from APP_NAME', () => {
    expect(DISCLAIMER.startsWith(`${APP_NAME} is an independent open-source project.`)).toBe(true);
    expect(DISCLAIMER).toContain('It runs Claude Code, made by Anthropic,');
    expect(DISCLAIMER).toContain('not made, endorsed or sponsored by Anthropic or OpenAI');
    expect(DISCLAIMER).toContain('includes no Anthropic software');
  });

  it('pins the AI output notice', () => {
    expect(AI_OUTPUT_NOTICE).toBe(
      'Suggestions and comments come from an AI model and can be wrong or misleading. Check each one, and verify any factual claim, before you accept it.'
    );
  });

  it('carries both, word for word, in README.md', () => {
    expect(readme).toContain(DISCLAIMER);
    expect(readme).toContain(AI_OUTPUT_NOTICE);
  });
});

describe('the data folder is independent of the name', () => {
  it('stays where every existing install keeps its settings and reviews', () => {
    // Electron derives userData from the app name. If the two moved together, a
    // rename would orphan the author's settings and their saved reviews.
    expect(APP_DATA_DIR).toBe('ai-grammar-checker');
    expect(APP_DATA_DIR.toLowerCase()).not.toBe(APP_NAME.toLowerCase());
    expect(APP_DATA_DIR).not.toBe(pkg.name);
  });
});
