import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGuidelines, ensureGuidelinesFile, guidelinesStatus } from '../../src/main/guidelines';
import { obsidianOpenUrl, openGuidelinesFile, type ShellApi } from '../../src/main/openGuidelines';
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
  function fakeShell(openPathResult = '') {
    const calls: string[] = [];
    const shell: ShellApi = {
      openExternal: (url) => (calls.push(`external ${url}`), Promise.resolve()),
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
});
