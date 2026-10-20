import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFailure, explainReadError, explainWriteError, toAppError } from '../../src/main/errors';
import { ensureGuidelines, ensureGuidelinesFile, guidelinesStatus } from '../../src/main/guidelines';
import {
  assertCanOpen,
  openGuidelines,
  openGuidelinesFile,
  openInObsidian
} from '../../src/main/openGuidelines';
import type { ShellApi } from '../../src/main/shellApi';
import { obsidianOpenUrl } from '../../src/shared/obsidian';
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
  function fakeShell(openPathResult = '', externalFails?: string) {
    const calls: string[] = [];
    const shell: ShellApi = {
      openExternal: (url) => {
        calls.push(`external ${url}`);
        return externalFails === undefined ? Promise.resolve() : Promise.reject(new Error(externalFails));
      },
      openPath: (file) => (calls.push(`open ${file}`), Promise.resolve(openPathResult)),
      showItemInFolder: (file) => void calls.push(`show ${file}`)
    };
    return { calls, shell };
  }

  it('builds an Obsidian link with the path encoded', () => {
    expect(obsidianOpenUrl('C:\\Vault\\Novel One\\GUIDELINES.md')).toBe(
      'obsidian://open?path=C%3A%5CVault%5CNovel%20One%5CGUIDELINES.md'
    );
  });

  it('opens in Obsidian through its link', async () => {
    const { calls, shell } = fakeShell();
    await openGuidelinesFile('C:\\Vault\\Novel One\\GUIDELINES.md', 'obsidian', shell);
    expect(calls).toEqual(['external obsidian://open?path=C%3A%5CVault%5CNovel%20One%5CGUIDELINES.md']);
  });

  /* setup.10b: Open in Obsidian, from Review with AI and Settings. */

  it('hands the shell the link for a path with spaces, other scripts and link characters', async () => {
    const { calls, shell } = fakeShell();
    await openInObsidian('C:\\Vaults\\Roman d’été & co #2\\小説\\GUIDELINES.md', shell);
    expect(calls).toEqual([
      'external obsidian://open?path=C%3A%5CVaults%5CRoman%20d%E2%80%99%C3%A9t%C3%A9%20%26%20co%20%232%5C%E5%B0%8F%E8%AA%AC%5CGUIDELINES.md'
    ]);
    await openInObsidian('/home/writer/Notes (2026)/GUIDELINES.md', shell); // check-public: allow
    expect(calls[1]).toBe(
      'external obsidian://open?path=%2Fhome%2Fwriter%2FNotes%20%282026%29%2FGUIDELINES.md'
    );
  });

  // The messages name the file through path.basename, which splits a Windows
  // path only on Windows, so the tests that check a message hand in a path
  // with forward slashes, which both platforms split (CI runs on Linux too).
  it('refuses a .txt guidelines file for Obsidian, before the shell is called, but opens it with Open', async () => {
    const { calls, shell } = fakeShell();
    await expect(openGuidelinesFile('/vault/GUIDELINES.txt', 'obsidian', shell)).rejects.toMatchObject({
      code: 'invalid-input',
      message: 'Obsidian opens .md files, and GUIDELINES.txt is not one. Use Open to open it in another app.'
    });
    expect(calls).toEqual([]);
    await openGuidelinesFile('C:\\Vault\\GUIDELINES.txt', 'default', shell);
    expect(calls).toEqual(['open C:\\Vault\\GUIDELINES.txt']);
  });

  it('assertCanOpen takes a .md or .txt file, and only a .md one for Obsidian', () => {
    expect(() => assertCanOpen('C:\\Vault\\GUIDELINES.md', 'obsidian')).not.toThrow();
    expect(() => assertCanOpen('C:\\Vault\\GUIDELINES.txt', 'default')).not.toThrow();
    expect(() => assertCanOpen('C:\\Vault\\GUIDELINES.txt', 'obsidian')).toThrow(
      /^Obsidian opens \.md files/
    );
    expect(() => assertCanOpen('C:\\Vault\\run.bat', 'obsidian')).toThrow(/has to be a \.md or \.txt file/);
  });

  it('gives the shell no link for a path that is not a full one', async () => {
    const { calls, shell } = fakeShell();
    const relative = await openInObsidian('Novel\\GUIDELINES.md', shell).catch((err: unknown) => err);
    expect(relative).toMatchObject({ code: 'invalid-input' });
    expect((relative as Error).message).toMatch(
      /^There is no Obsidian link for Novel\\GUIDELINES\.md: it is not a full path/
    );
    await expect(openInObsidian('C:\\Vault\\\uD800.md', shell)).rejects.toMatchObject({
      code: 'invalid-input'
    });
    expect(calls).toEqual([]);
  });

  it('says what to do when the system cannot start Obsidian, keeping its reason as the detail', async () => {
    const { shell } = fakeShell('', 'Failed to open: No application is associated with the specified file');
    await expect(openInObsidian('/vault/GUIDELINES.md', shell)).rejects.toMatchObject({
      code: 'io',
      message:
        'Obsidian could not be started to open GUIDELINES.md. Check that Obsidian is installed, or use Open to open the file in another app.',
      detail: 'Failed to open: No application is associated with the specified file'
    });
  });

  it('opens with the default app, or shows the file in its folder when there is none', async () => {
    const ok = fakeShell();
    await openGuidelinesFile('/v/GUIDELINES.md', 'default', ok.shell);
    expect(ok.calls).toEqual(['open /v/GUIDELINES.md']);

    const none = fakeShell('No application is associated with the specified file');
    await expect(openGuidelinesFile('/v/GUIDELINES.md', 'default', none.shell)).rejects.toThrow(
      /^No app is set to open \.md files on this computer, so GUIDELINES\.md is shown in its folder instead/
    );
    expect(none.calls).toEqual(['open /v/GUIDELINES.md', 'show /v/GUIDELINES.md']);
  });

  it('opens nothing that is not a .md or .txt file', async () => {
    const { calls, shell } = fakeShell();
    await expect(openGuidelinesFile('C:/Vault/run.bat', 'default', shell)).rejects.toMatchObject({
      code: 'invalid-input'
    });
    await expect(openGuidelinesFile('C:/Vault/run.bat', 'obsidian', shell)).rejects.toMatchObject({
      code: 'invalid-input'
    });
    expect(calls).toEqual([]);
  });

  /* setup.10b review: guidelines:open is openGuidelines with the settings, the
     template and systemShell(), so these pin its order on disk: refuse, then
     create from the template, then open. */
  describe('guidelines:open', () => {
    it('refuses a missing .txt guidelines file for Obsidian before it creates anything', async () => {
      const txt = path.join(root, 'Novel', 'GUIDELINES.txt');
      const { calls, shell } = fakeShell();
      await expect(
        openGuidelines(settings({ guidelinesPath: txt }), 'obsidian', template, shell)
      ).rejects.toMatchObject({
        code: 'invalid-input',
        message:
          'Obsidian opens .md files, and GUIDELINES.txt is not one. Use Open to open it in another app.'
      });
      await expect(fs.access(txt)).rejects.toThrow();
      await expect(fs.access(path.dirname(txt))).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('creates the same missing .txt file from the template for Open, and opens it', async () => {
      const txt = path.join(root, 'Novel', 'GUIDELINES.txt');
      const { calls, shell } = fakeShell();
      expect(await openGuidelines(settings({ guidelinesPath: txt }), 'default', template, shell)).toEqual({
        path: txt,
        created: true
      });
      expect(await fs.readFile(txt, 'utf8')).toBe(await fs.readFile(template, 'utf8'));
      expect(calls).toEqual([`open ${txt}`]);
    });

    it('creates GUIDELINES.md for Obsidian and hands the shell its link, and leaves an existing one as it is', async () => {
      const md = path.join(root, 'Novel', 'GUIDELINES.md');
      const { calls, shell } = fakeShell();
      expect(await openGuidelines(settings(), 'obsidian', template, shell)).toEqual({
        path: md,
        created: true
      });
      expect(calls).toEqual([`external ${obsidianOpenUrl(md)}`]);
      await fs.writeFile(md, 'My own rules.\n');
      expect(await openGuidelines(settings(), 'obsidian', template, shell)).toEqual({
        path: md,
        created: false
      });
      expect(await fs.readFile(md, 'utf8')).toBe('My own rules.\n');
      expect(calls).toEqual([`external ${obsidianOpenUrl(md)}`, `external ${obsidianOpenUrl(md)}`]);
    });

    it('makes and opens nothing for a file that is not .md or .txt, or with no manuscript folder', async () => {
      const docx = path.join(root, 'Novel', 'rules.docx');
      const { calls, shell } = fakeShell();
      for (const via of ['obsidian', 'default'] as const) {
        await expect(
          openGuidelines(settings({ guidelinesPath: docx }), via, template, shell)
        ).rejects.toMatchObject({ code: 'invalid-input' });
        await expect(
          openGuidelines(settings({ manuscriptFolder: null }), via, template, shell)
        ).rejects.toMatchObject({ code: 'not-configured' });
      }
      await expect(fs.access(path.dirname(docx))).rejects.toThrow();
      expect(calls).toEqual([]);
    });
  });
});
