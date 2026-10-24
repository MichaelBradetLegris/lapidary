import { existsSync, promises as fs, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSecrets, readSecretsChecked, secretsPath, updateSecrets } from '../../src/main/secrets';

/* secrets.json since codex.6: the ChatGPT sign-in's part alone, which
   src/main/chatgpt reads and writes through `updateSecrets`
   (chatgptSignIn.test.ts drives it). The OpenAI API key a build before
   codex.6 saved beside it is read past and left out of the next write. */

/**
 * The file as the #14 build wrote it with a key saved and a sign-in kept: the
 * key's part beside the sign-in's, its ciphertext, its last four characters
 * and when it was saved (src/main/secrets.ts at 4c5cd3d).
 */
const KEY_PART = {
  ciphertext: Buffer.from('what safeStorage made of the key', 'utf8').toString('base64'),
  last4: '7Qa2',
  savedAt: '2026-10-24T09:00:00.000Z'
};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-secrets-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeRaw(contents: unknown): Promise<void> {
  await fs.writeFile(secretsPath(dir), `${JSON.stringify(contents, null, 2)}\n`);
}

describe('the one credential, the ChatGPT sign-in (codex.6)', () => {
  it('reads nothing on a fresh machine, and keeps the sign-in in a file of its own, never settings.json', async () => {
    expect(await readSecrets(dir)).toEqual({ version: 1 });
    expect(await readSecretsChecked(dir)).toEqual({ version: 1 });
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } }));
    expect(path.basename(secretsPath(dir))).toBe('secrets.json');
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
    expect(await readSecrets(dir)).toEqual({ version: 1, chatgpt: { hostId: 'kept' } });
  });

  it('reads a file from before codex.6 that still holds an OpenAI key as one without it, never using it', async () => {
    await writeRaw({ version: 1, openai: KEY_PART, chatgpt: { hostId: 'kept' } });
    expect(await readSecrets(dir)).toEqual({ version: 1, chatgpt: { hostId: 'kept' } });
    expect(await readSecretsChecked(dir)).toEqual({ version: 1, chatgpt: { hostId: 'kept' } });
    // Read, but not written: the key stays on disk until the next write.
    expect(await fs.readFile(secretsPath(dir), 'utf8')).toContain(KEY_PART.ciphertext);
  });

  it('drops the key at the next write, keeping the sign-in', async () => {
    await writeRaw({ version: 1, openai: KEY_PART, chatgpt: { hostId: 'kept' } });
    let seen: unknown = null;
    const written = await updateSecrets(dir, (file) => {
      seen = file;
      return { ...file, chatgpt: { ...(file.chatgpt as object), lastClientId: 'c' } };
    });
    // The change never sees the key, so a spread of the file cannot carry it on.
    expect(seen).toEqual({ version: 1, chatgpt: { hostId: 'kept' } });
    expect(written).toEqual({ version: 1, chatgpt: { hostId: 'kept', lastClientId: 'c' } });
    const onDisk = await fs.readFile(secretsPath(dir), 'utf8');
    expect(JSON.parse(onDisk)).toEqual({ version: 1, chatgpt: { hostId: 'kept', lastClientId: 'c' } });
    for (const trace of ['openai', KEY_PART.ciphertext, KEY_PART.last4]) expect(onDisk).not.toContain(trace);
  });

  it('drops a key with no sign-in beside it at the next write too, and any other part it does not know', async () => {
    await writeRaw({ version: 1, openai: KEY_PART, later: { x: 1 } });
    expect(await readSecrets(dir)).toEqual({ version: 1 });
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'new' } }));
    expect(JSON.parse(await fs.readFile(secretsPath(dir), 'utf8'))).toEqual({
      version: 1,
      chatgpt: { hostId: 'new' }
    });
  });

  it('reads OPENAI_API_KEY nowhere: only buildClaudeEnv names it, to keep it from Claude Code', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const files: string[] = [];
    const walk = (folder: string): void => {
      for (const entry of readdirSync(path.join(root, folder))) {
        const rel = `${folder}/${entry}`;
        if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(rel);
      }
    };
    expect(existsSync(path.join(root, 'src'))).toBe(true);
    walk('src');
    const naming = files.filter((file) =>
      readFileSync(path.join(root, file), 'utf8').includes('OPENAI_API_KEY')
    );
    expect(naming).toEqual(['src/main/providers/claudeOptions.ts']);
  });
});

describe('writes, one after the other', () => {
  it('keeps every change when two arrive at once, writing one after the other', async () => {
    await writeRaw({ version: 1, openai: KEY_PART });
    await Promise.all([
      updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } })),
      updateSecrets(dir, (file) => ({ ...file, chatgpt: { ...(file.chatgpt as object), lastClientId: 'c' } }))
    ]);
    expect(await readSecrets(dir)).toEqual({ version: 1, chatgpt: { hostId: 'kept', lastClientId: 'c' } });
  });

  it('goes on writing after a change that throws', async () => {
    await expect(
      updateSecrets(dir, () => {
        throw new Error('refused');
      })
    ).rejects.toThrow('refused');
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } }));
    expect((await readSecrets(dir)).chatgpt).toEqual({ hostId: 'kept' });
  });
});

/* codex.2 review: a write reads the file first, so a read that fails must
   never be taken for an empty file. */
describe('a secrets.json that cannot be read', () => {
  /** What Windows gives while a sync, backup or antivirus tool holds the file. */
  function busy(): NodeJS.ErrnoException {
    return Object.assign(new Error(`EBUSY: resource busy or locked, open '${secretsPath(dir)}'`), {
      code: 'EBUSY',
      errno: -4082,
      syscall: 'open',
      path: secretsPath(dir)
    });
  }

  /** A file from before codex.6, a key's part beside a sign-in's. */
  async function both(): Promise<Buffer> {
    await writeRaw({ version: 1, openai: KEY_PART, chatgpt: { hostId: 'kept', registrations: ['r'] } });
    return fs.readFile(secretsPath(dir));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing while the file is there but cannot be read, so the sign-in is not lost', async () => {
    const bytes = await both();
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    const refused = await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'other' } })).then(
      () => null,
      (err: unknown) => err as { code?: string; message?: string }
    );
    expect(refused?.code).toBe('io');
    expect(refused?.message).toContain('secrets.json');
    vi.restoreAllMocks();
    expect(await fs.readFile(secretsPath(dir))).toEqual(bytes);
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
    // A decision's read refuses too, rather than deciding on nothing.
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    await expect(readSecretsChecked(dir)).rejects.toMatchObject({ code: 'io' });
  });

  it('still reads as nothing kept for a status, and is read again for the next write', async () => {
    await both();
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    expect(await readSecrets(dir)).toEqual({ version: 1 });
    await updateSecrets(dir, (file) => ({
      ...file,
      chatgpt: { ...(file.chatgpt as object), hostId: 'changed' }
    }));
    expect(await readSecrets(dir)).toEqual({
      version: 1,
      chatgpt: { hostId: 'changed', registrations: ['r'] }
    });
  });

  it('copies a damaged file aside before writing a new one: not JSON, not an object or another version', async () => {
    for (const [n, junk] of ['{ not json', '', '[1, 2]', '{"version": 2, "openai": {}}'].entries()) {
      await fs.writeFile(secretsPath(dir), junk);
      await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: `h${n}` } }));
      expect(await readSecrets(dir)).toEqual({ version: 1, chatgpt: { hostId: `h${n}` } });
      const copies = (await fs.readdir(dir))
        .filter((name) => name.startsWith('secrets.json.corrupt-'))
        .sort();
      expect(copies).toHaveLength(n + 1);
      expect(copies.every((name) => /^secrets\.json\.corrupt-\d{14}(-\d+)?$/.test(name))).toBe(true);
      const contents = await Promise.all(copies.map((name) => fs.readFile(path.join(dir, name), 'utf8')));
      expect(contents).toContain(junk);
    }
  });

  it('writes nothing over a damaged file it cannot copy aside, and says where the sign-in is kept', async () => {
    await fs.writeFile(secretsPath(dir), '{ not json');
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(
      Object.assign(new Error('EPERM: operation not permitted, copyfile'), { code: 'EPERM' })
    );
    const refused = updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } }));
    await expect(refused).rejects.toMatchObject({ code: 'io' });
    await expect(refused).rejects.toThrow(/keeps the ChatGPT sign-in, is damaged/);
    await expect(refused).rejects.not.toThrow(/OpenAI key/);
    expect(await fs.readFile(secretsPath(dir), 'utf8')).toBe('{ not json');
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
  });
});
