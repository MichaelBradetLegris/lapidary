import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { GuidelinesInfo, GuidelinesStatus } from '../shared/ipc';
import { styleSheetStatus } from '../shared/prompt/guidelines';
import type { Settings } from '../shared/types';
import { fail, readFailure } from './errors';
import { readTextFile } from './files';

/*
 * Electron-free, like files.ts: ipc.ts knows where the shipped template is
 * (GUIDELINES_TEMPLATE) and passes its path in, so tests run without Electron.
 */

/** The shipped template's file name, in resources/ in development and beside the app once packaged. */
export const GUIDELINES_TEMPLATE = 'GUIDELINES.default.md';

export function guidelinesPathFor(settings: Settings): string | null {
  if (settings.guidelinesPath) return settings.guidelinesPath;
  if (settings.manuscriptFolder) return path.join(settings.manuscriptFolder, 'GUIDELINES.md');
  return null;
}

/** The guidelines file must be text the author edits; nothing else is created or opened as one. */
export function assertGuidelinesFile(file: string): void {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.md' && ext !== '.txt') {
    throw fail(
      'invalid-input',
      `The guidelines file has to be a .md or .txt file, and ${path.basename(file)} is not. Choose another one in Settings.`
    );
  }
}

/**
 * Make sure the guidelines file exists, creating it from the shipped template
 * the first time. The copy uses `COPYFILE_EXCL`, so it can only ever create:
 * an existing file, whatever it holds, is never touched (CLAUDE.md rule 1).
 * The copy is a normal file in the manuscript folder that the author edits in
 * Obsidian like anything else.
 */
export async function ensureGuidelinesFile(
  settings: Settings,
  template: string
): Promise<{ path: string; created: boolean }> {
  const target = guidelinesPathFor(settings);
  if (!target) {
    throw fail('not-configured', 'Choose a manuscript folder before using the guidelines file.');
  }
  assertGuidelinesFile(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.copyFile(template, target, constants.COPYFILE_EXCL);
    return { path: target, created: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return { path: target, created: false };
    if (code === 'ENOENT') {
      const templateThere = await fs.access(template).then(
        () => true,
        () => false
      );
      if (!templateThere) throw fail('not-found', `The guidelines template is missing at ${template}`);
    }
    throw err;
  }
}

/**
 * The guidelines text, read under the same UTF-8 rules as a chapter. A read
 * the system refuses is explained as a read (`readFailure`, apply.24).
 */
export async function readGuidelines(file: string): Promise<string> {
  try {
    return await readTextFile(file);
  } catch (err) {
    throw readFailure(err, path.basename(file));
  }
}

/** The guidelines a review is sent, creating the file first if needed. */
export async function ensureGuidelines(settings: Settings, template: string): Promise<GuidelinesInfo> {
  const { path: file, created } = await ensureGuidelinesFile(settings, template);
  return { path: file, text: await readGuidelines(file), created };
}

/** Where the guidelines are and whether their style sheet is filled in. Creates nothing. */
export async function guidelinesStatus(settings: Settings): Promise<GuidelinesStatus> {
  const file = guidelinesPathFor(settings);
  if (!file) return { path: null, exists: false, styleSheet: 'missing' };
  let text: string;
  try {
    text = await readTextFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { path: file, exists: false, styleSheet: 'missing' };
    throw readFailure(err, path.basename(file));
  }
  return { path: file, exists: true, styleSheet: styleSheetStatus(text) };
}
