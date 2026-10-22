import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFailure, explainReadError, explainWriteError, toAppError } from '../../src/main/errors';
import {
  assertGuidelinesFile,
  ensureGuidelines,
  ensureGuidelinesFile,
  guidelinesStatus
} from '../../src/main/guidelines';
import { openGuidelines, openGuidelinesFile } from '../../src/main/openGuidelines';
import type { ShellApi } from '../../src/main/shellApi';
import { normalizeSettings } from '../../src/shared/settings';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';

/* setup.10: the guidelines file is created once, never overwritten, and opened
   where the author edits it. */

let root: string;
let template: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-guidelines-'));
  template = path.join(root, 'template.md');
  await fs.writeFile(template, '# Editing guidelines\n\n## Style sheet\n\n- Spelling variant: (US or UK)\n');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, manuscriptFolder: path.join(root, 'Novel'), ...patch };
}

describe('ensureGuidelinesFile', () => {
  it('creates GUIDELINES.md in the manuscript folder from the template, once', async () => {
    const first = await ensureGuidelinesFile(settings(), template);
    expect(first).toEqual({ path: path.join(root, 'Novel', 'GUIDELINES.md'), created: true });
    expect(await fs.readFile(first.path, 'utf8')).toBe(await fs.readFile(template, 'utf8'));
    expect(await ensureGuidelinesFile(settings(), template)).toEqual({ ...first, created: false });
  });

  it('never overwrites an existing file, whatever it holds', async () => {
    const file = path.join(root, 'Novel', 'GUIDELINES.md');
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, 'My own rules.\n');
    expect((await ensureGuidelinesFile(settings(), template)).created).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe('My own rules.\n');
    await fs.writeFile(file, '');
    await ensureGuidelinesFile(settings(), template);
    expect(await fs.readFile(file, 'utf8')).toBe('');
  });

  it('uses the file chosen in Settings, and only a .md or .txt one', async () => {
    const chosen = path.join(root, 'Elsewhere', 'house style.txt');
    expect((await ensureGuidelinesFile(settings({ guidelinesPath: chosen }), template)).path).toBe(chosen);
    await expect(
      ensureGuidelinesFile(settings({ guidelinesPath: path.join(root, 'rules.docx') }), template)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(fs.access(path.join(root, 'rules.docx'))).rejects.toThrow();
  });

  it('is chosen in a settings file only when main would take it (hardening.8)', () => {
    // The normaliser keeps an absolute file path exactly when assertGuidelinesFile would accept it.
    for (const name of [
      'GUIDELINES.md',
      'house style.TXT',
      'notes.v2.Md',
      '..md',
      '.md',
      '.txt',
      'rules.docx',
      'rules.md.bak',
      'rules',
      'rules.',
      'rules.md '
    ]) {
      const file = path.join(root, 'Novel', name);
      let accepted = true;
      try {
        assertGuidelinesFile(file);
      } catch {
        accepted = false;
      }
      expect(normalizeSettings({ guidelinesPath: file }).guidelinesPath, name).toBe(accepted ? file : null);
    }
  });

  it('says so when there is nowhere to put it, or no template', async () => {
    await expect(ensureGuidelinesFile(settings({ manuscriptFolder: null }), template)).rejects.toMatchObject({
      code: 'not-configured'
    });
    await expect(ensureGuidelinesFile(settings(), path.join(root, 'gone.md'))).rejects.toMatchObject({
      code: 'not-found'
    });
  });

  it('reads the text for a review, under the UTF-8 rules', async () => {
    const info = await ensureGuidelines(settings(), template);
    expect(info.text).toContain('## Style sheet');
    await fs.writeFile(info.path, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    await expect(ensureGuidelines(settings(), template)).rejects.toMatchObject({ code: 'not-utf8' });
  });
});

describe('a guidelines file that cannot be read (apply.24)', () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    it(`explains ${code} as a read, before a review and in Settings`, async () => {
      const { path: file } = await ensureGuidelinesFile(settings(), template);
      const refused = Object.assign(new Error(`${code}: refused`), { code, path: file });
      const expected = explainReadError(refused, 'GUIDELINES.md', process.platform);
      for (const reading of [
        () => ensureGuidelines(settings(), template),
        () => guidelinesStatus(settings())
      ]) {
        const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused);
        try {
          const err = await reading().then(
            () => null,
            (e: unknown) => e
          );
          expect(err).toBeInstanceOf(AppFailure);
          const shown = toAppError(err);
          expect(shown).toMatchObject({ code: 'io', message: expected });
          expect(shown.message).not.toMatch(
            /replace|save again|Nothing was written|Controlled folder access/
          );
        } finally {
          read.mockRestore();
        }
      }
    });
  }
});

/* apply.25: copying the template is never retried and replaces nothing, so a
   refusal says what was being made and to try again, never "save again". */
describe('a guidelines file that cannot be made (apply.25)', () => {
  const NOT_A_RENAME = /replace|save again|second and a half|even after|the file is as it was/;

  async function shown(promise: Promise<unknown>): Promise<string> {
    const err = await promise.then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AppFailure);
    return toAppError(err).message;
  }

  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    it(`explains ${code} copying the template as making GUIDELINES.md from it`, async () => {
      const target = path.join(root, 'Novel', 'GUIDELINES.md');
      const refused = Object.assign(new Error(`${code}: refused, copyfile '${template}' -> '${target}'`), {
        code,
        syscall: 'copyfile',
        path: template,
        dest: target
      });
      const copy = vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(refused);
      try {
        const message = await shown(ensureGuidelinesFile(settings(), template));
        expect(message).toBe(explainWriteError(refused, 'GUIDELINES.md', process.platform, 'copy'));
        expect(message).toMatch(
          / create GUIDELINES\.md from the template\. .*try again\. .*Nothing was written\.$/
        );
        expect(message).not.toMatch(NOT_A_RENAME);
      } finally {
        copy.mockRestore();
      }
      await expect(fs.access(target)).rejects.toThrow();
    });
  }

  it('explains a folder it may not make for the file as making that folder', async () => {
    const folder = path.join(root, 'Novel');
    const refused = Object.assign(new Error(`EPERM: refused, mkdir '${folder}'`), {
      code: 'EPERM',
      syscall: 'mkdir',
      path: folder
    });
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(refused);
    try {
      const message = await shown(ensureGuidelinesFile(settings(), template));
      expect(message).toBe(
        explainWriteError(refused, 'the folder for GUIDELINES.md', process.platform, 'folder')
      );
      expect(message).toMatch(
        / create the folder for GUIDELINES\.md\. .*try again\. .*Nothing was written\.$/
      );
      expect(message).not.toMatch(NOT_A_RENAME);
    } finally {
      mkdir.mockRestore();
    }
    await expect(fs.access(folder)).rejects.toThrow();
  });
});

describe('guidelinesStatus', () => {
  it('reports a missing file without creating it', async () => {
    const status = await guidelinesStatus(settings());
    expect(status).toEqual({
      path: path.join(root, 'Novel', 'GUIDELINES.md'),
      exists: false,
      styleSheet: 'missing'
    });
    await expect(fs.access(status.path!)).rejects.toThrow();
    expect(await guidelinesStatus(settings({ manuscriptFolder: null }))).toEqual({
      path: null,
      exists: false,
      styleSheet: 'missing'
    });
  });

  it('reports blank until the style sheet has an entry', async () => {
    const { path: file } = await ensureGuidelinesFile(settings(), template);
    expect((await guidelinesStatus(settings())).styleSheet).toBe('blank');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('(US or UK)', 'UK'));
    expect(await guidelinesStatus(settings())).toEqual({ path: file, exists: true, styleSheet: 'filled' });
  });
});

describe('opening the guidelines file', () => {
  /* polish.3: Open hands the file to the system's app for its type, which is
     Obsidian when the author has made it the app for .md files. Nothing is
     handed to the system as a link. */
  function fakeShell(openPathResult = '') {
    const calls: string[] = [];
    const shell: ShellApi = {
      openExternal: (url) => (calls.push(`external ${url}`), Promise.resolve()),
      openPath: (file) => (calls.push(`open ${file}`), Promise.resolve(openPathResult)),
      showItemInFolder: (file) => void calls.push(`show ${file}`)
    };
    return { calls, shell };
  }

  it('opens a .md or a .txt file with the system app, and hands the system no link', async () => {
    const { calls, shell } = fakeShell();
    await openGuidelinesFile('C:\\Vault\\Novel One\\GUIDELINES.md', shell);
    await openGuidelinesFile('C:\\Vault\\GUIDELINES.txt', shell);
    expect(calls).toEqual(['open C:\\Vault\\Novel One\\GUIDELINES.md', 'open C:\\Vault\\GUIDELINES.txt']);
  });

  // The messages name the file through path.basename, which splits a Windows
  // path only on Windows, so the tests that check a message hand in a path
  // with forward slashes, which both platforms split (CI runs on Linux too).
  it('shows the file in its folder when no app is set for its type, and says so', async () => {
    const none = fakeShell('No application is associated with the specified file');
    await expect(openGuidelinesFile('/v/GUIDELINES.md', none.shell)).rejects.toMatchObject({
      code: 'io',
      message:
        'No app is set to open .md files on this computer, so GUIDELINES.md is shown in its folder instead. Open it with Obsidian or any text editor.',
      detail: 'No application is associated with the specified file'
    });
    expect(none.calls).toEqual(['open /v/GUIDELINES.md', 'show /v/GUIDELINES.md']);
  });

  it('opens nothing that is not a .md or .txt file', async () => {
    const { calls, shell } = fakeShell();
    await expect(openGuidelinesFile('C:/Vault/run.bat', shell)).rejects.toMatchObject({
      code: 'invalid-input'
    });
    expect(calls).toEqual([]);
  });

  /* setup.10b review, polish.3: guidelines:open is openGuidelines with the
     settings, the template and systemShell(), so these pin its order on
     disk: refuse, then create from the template, then open. */
  describe('guidelines:open', () => {
    it('creates a missing GUIDELINES.md from the template and opens it, and leaves an existing one as it is', async () => {
      const md = path.join(root, 'Novel', 'GUIDELINES.md');
      const { calls, shell } = fakeShell();
      expect(await openGuidelines(settings(), template, shell)).toEqual({ path: md, created: true });
      expect(await fs.readFile(md, 'utf8')).toBe(await fs.readFile(template, 'utf8'));
      expect(calls).toEqual([`open ${md}`]);
      await fs.writeFile(md, 'My own rules.\n');
      expect(await openGuidelines(settings(), template, shell)).toEqual({ path: md, created: false });
      expect(await fs.readFile(md, 'utf8')).toBe('My own rules.\n');
      expect(calls).toEqual([`open ${md}`, `open ${md}`]);
    });

    it('creates a missing .txt guidelines file from the template too, and opens it', async () => {
      const txt = path.join(root, 'Novel', 'GUIDELINES.txt');
      const { calls, shell } = fakeShell();
      expect(await openGuidelines(settings({ guidelinesPath: txt }), template, shell)).toEqual({
        path: txt,
        created: true
      });
      expect(await fs.readFile(txt, 'utf8')).toBe(await fs.readFile(template, 'utf8'));
      expect(calls).toEqual([`open ${txt}`]);
    });

    it('makes and opens nothing for a file that is not .md or .txt, or with no manuscript folder', async () => {
      const docx = path.join(root, 'Novel', 'rules.docx');
      const { calls, shell } = fakeShell();
      await expect(openGuidelines(settings({ guidelinesPath: docx }), template, shell)).rejects.toMatchObject(
        {
          code: 'invalid-input'
        }
      );
      await expect(
        openGuidelines(settings({ manuscriptFolder: null }), template, shell)
      ).rejects.toMatchObject({
        code: 'not-configured'
      });
      await expect(fs.access(path.dirname(docx))).rejects.toThrow();
      expect(calls).toEqual([]);
    });
  });
});
