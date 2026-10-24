import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOpenAiKey,
  openAiKey,
  openAiKeyStatus,
  readSecrets,
  secretsPath,
  storeOpenAiKey,
  updateSecrets,
  type KeyVault
} from '../../src/main/secrets';

/**
 * A stand-in for Electron's safeStorage. It reverses and base64-wraps the text
 * with a marker, which is enough to prove three things: the file never holds
 * the plaintext, decryption goes through the vault, and a vault that cannot
 * encrypt stops the key being stored at all.
 */
function fakeVault(available = true): KeyVault & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString: (plain) => {
      calls.push('encrypt');
      return Buffer.from(`VAULT:${[...plain].reverse().join('')}`, 'utf8');
    },
    decryptString: (buf) => {
      calls.push('decrypt');
      const text = buf.toString('utf8');
      if (!text.startsWith('VAULT:')) throw new Error('not ours');
      return [...text.slice('VAULT:'.length)].reverse().join('');
    }
  };
}

const KEY = 'sk-proj-THISISATESTKEY1234abcd'; // check-public: allow
const noEnv: NodeJS.ProcessEnv = {};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-secrets-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('OpenAI key storage', () => {
  it('reports nothing configured on a fresh machine', async () => {
    expect(await openAiKeyStatus(fakeVault(), dir, noEnv)).toEqual({
      configured: false,
      source: 'none',
      last4: '',
      encryptionAvailable: true
    });
    expect(await openAiKey(fakeVault(), dir, noEnv)).toBeNull();
  });

  it('round-trips a key through the vault and never writes the plaintext', async () => {
    const vault = fakeVault();
    const status = await storeOpenAiKey(vault, dir, `  ${KEY}\n`, noEnv);
    expect(status).toEqual({ configured: true, source: 'stored', last4: 'abcd', encryptionAvailable: true });

    const onDisk = await fs.readFile(secretsPath(dir), 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain('THISISATESTKEY');
    const parsed = JSON.parse(onDisk) as { version: number; openai: { ciphertext: string; last4: string } };
    expect(parsed.version).toBe(1);
    expect(parsed.openai.last4).toBe('abcd');
    expect(Buffer.from(parsed.openai.ciphertext, 'base64').toString('utf8').startsWith('VAULT:')).toBe(true);

    expect(await openAiKey(vault, dir, noEnv)).toBe(KEY);
    expect(vault.calls).toEqual(['encrypt', 'decrypt']);
  });

  it('keeps the key out of settings.json, in a file of its own', async () => {
    await storeOpenAiKey(fakeVault(), dir, KEY, noEnv);
    expect(path.basename(secretsPath(dir))).toBe('secrets.json');
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
  });

  it('refuses to store anything when encryption is unavailable', async () => {
    const vault = fakeVault(false);
    await expect(storeOpenAiKey(vault, dir, KEY, noEnv)).rejects.toThrow(/cannot encrypt/);
    await expect(fs.access(secretsPath(dir))).rejects.toThrow();
    expect(vault.calls).toEqual([]);
    expect((await openAiKeyStatus(vault, dir, noEnv)).encryptionAvailable).toBe(false);
  });

  it('rejects something that is plainly not a key', async () => {
    await expect(storeOpenAiKey(fakeVault(), dir, '  abc ', noEnv)).rejects.toThrow(/does not look like/);
  });

  it('falls back to OPENAI_API_KEY only when nothing is stored', async () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-from-env-9876' };
    expect(await openAiKeyStatus(fakeVault(), dir, env)).toMatchObject({
      configured: true,
      source: 'environment',
      last4: '9876'
    });
    expect(await openAiKey(fakeVault(), dir, env)).toBe('sk-from-env-9876');

    await storeOpenAiKey(fakeVault(), dir, KEY, env);
    expect((await openAiKeyStatus(fakeVault(), dir, env)).source).toBe('stored');
    expect(await openAiKey(fakeVault(), dir, env)).toBe(KEY);
  });

  it('removes a stored key, leaving the environment key in charge', async () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-from-env-9876' };
    await storeOpenAiKey(fakeVault(), dir, KEY, env);
    const after = await clearOpenAiKey(fakeVault(), dir, env);
    expect(after.source).toBe('environment');
    expect(await fs.readFile(secretsPath(dir), 'utf8')).not.toContain('ciphertext');
    expect((await clearOpenAiKey(fakeVault(), dir, noEnv)).configured).toBe(false);
  });

  it('says so when a stored key cannot be decrypted, instead of pretending there is none', async () => {
    await storeOpenAiKey(fakeVault(), dir, KEY, noEnv);
    const other: KeyVault = {
      ...fakeVault(),
      decryptString: () => {
        throw new Error('DPAPI says no');
      }
    };
    await expect(openAiKey(other, dir, noEnv)).rejects.toThrow(/could not be decrypted/);
  });

  it('treats a corrupt secrets file as no key rather than crashing', async () => {
    await fs.writeFile(secretsPath(dir), '{ not json');
    expect((await openAiKeyStatus(fakeVault(), dir, noEnv)).configured).toBe(false);
  });
});

/* codex.2: the file holds the ChatGPT sign-in too, which src/main/chatgpt
   reads and writes through `updateSecrets`; chatgptSignIn.test.ts drives it. */
describe('the two credentials side by side', () => {
  it('keeps the ChatGPT sign-in when the key is saved or removed', async () => {
    const vault = fakeVault();
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } }));
    await storeOpenAiKey(vault, dir, KEY, noEnv);
    expect((await readSecrets(dir)).chatgpt).toEqual({ hostId: 'kept' });
    await clearOpenAiKey(vault, dir, noEnv);
    const file = await readSecrets(dir);
    expect(file).toEqual({ version: 1, chatgpt: { hostId: 'kept' } });
  });

  it('keeps every change when two arrive at once, writing one after the other', async () => {
    await Promise.all([
      storeOpenAiKey(fakeVault(), dir, KEY, noEnv),
      updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept' } })),
      updateSecrets(dir, (file) => ({ ...file, chatgpt: { ...(file.chatgpt as object), lastClientId: 'c' } }))
    ]);
    const file = await readSecrets(dir);
    expect(file.openai?.last4).toBe('abcd');
    expect(file.chatgpt).toEqual({ hostId: 'kept', lastClientId: 'c' });
  });

  it('goes on writing after a change that throws', async () => {
    await expect(
      updateSecrets(dir, () => {
        throw new Error('refused');
      })
    ).rejects.toThrow('refused');
    await storeOpenAiKey(fakeVault(), dir, KEY, noEnv);
    expect((await readSecrets(dir)).openai?.last4).toBe('abcd');
  });
});

/* codex.2 review: a write reads the file first, and the file now holds both
   credentials, so a read that fails must never be taken for an empty file. */
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

  /** The file holding a key and a sign-in's part, as two credentials side by side. */
  async function both(): Promise<Buffer> {
    await storeOpenAiKey(fakeVault(), dir, KEY, noEnv);
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'kept', registrations: ['r'] } }));
    return fs.readFile(secretsPath(dir));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing while the file is there but cannot be read, so neither credential is lost', async () => {
    const bytes = await both();
    for (const write of [
      () => storeOpenAiKey(fakeVault(), dir, 'sk-proj-ANOTHERTESTKEY5678wxyz', noEnv), // check-public: allow
      () => clearOpenAiKey(fakeVault(), dir, noEnv),
      () => updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'other' } }))
    ]) {
      vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
      const refused = await write().then(
        () => null,
        (err: unknown) => err as { code?: string; message?: string }
      );
      expect(refused?.code).toBe('io');
      expect(refused?.message).toContain('secrets.json');
      vi.restoreAllMocks();
      expect(await fs.readFile(secretsPath(dir))).toEqual(bytes);
    }
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
  });

  it('still reads as no key for a status, and is read again for the next write', async () => {
    await both();
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    expect((await openAiKeyStatus(fakeVault(), dir, noEnv)).configured).toBe(false);
    await updateSecrets(dir, (file) => ({ ...file, chatgpt: { hostId: 'changed' } }));
    const file = await readSecrets(dir);
    expect(file.openai?.last4).toBe('abcd');
    expect(file.chatgpt).toEqual({ hostId: 'changed' });
  });

  it('copies a damaged file aside before writing a new one: not JSON, not an object or another version', async () => {
    for (const [n, junk] of ['{ not json', '', '[1, 2]', '{"version": 2, "openai": {}}'].entries()) {
      await fs.writeFile(secretsPath(dir), junk);
      await storeOpenAiKey(fakeVault(), dir, KEY, noEnv);
      expect((await readSecrets(dir)).openai?.last4).toBe('abcd');
      const copies = (await fs.readdir(dir))
        .filter((name) => name.startsWith('secrets.json.corrupt-'))
        .sort();
      expect(copies).toHaveLength(n + 1);
      expect(copies.every((name) => /^secrets\.json\.corrupt-\d{14}(-\d+)?$/.test(name))).toBe(true);
      const contents = await Promise.all(copies.map((name) => fs.readFile(path.join(dir, name), 'utf8')));
      expect(contents).toContain(junk);
    }
  });

  it('writes nothing over a damaged file it cannot copy aside', async () => {
    await fs.writeFile(secretsPath(dir), '{ not json');
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(
      Object.assign(new Error('EPERM: operation not permitted, copyfile'), { code: 'EPERM' })
    );
    await expect(storeOpenAiKey(fakeVault(), dir, KEY, noEnv)).rejects.toMatchObject({ code: 'io' });
    expect(await fs.readFile(secretsPath(dir), 'utf8')).toBe('{ not json');
    expect(await fs.readdir(dir)).toEqual(['secrets.json']);
  });
});
