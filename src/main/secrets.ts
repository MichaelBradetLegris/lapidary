import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OpenAiKeyStatus } from '../shared/ipc';
import { atomicWriteFile } from './atomic';
import { fail } from './errors';

/**
 * The one credential this app stores: the author's OpenAI API key.
 *
 * It lives in its own file beside settings.json, never inside it, encrypted with
 * Electron's safeStorage (DPAPI on Windows). Only the main process ever holds
 * the plaintext, and only for the length of one call; the renderer is told
 * nothing but whether a key exists and its last four characters (CLAUDE.md
 * rule 2). Claude's credentials are still never touched at all.
 *
 * safeStorage is passed in rather than imported so the rules here can be tested
 * without an Electron process.
 */

export interface KeyVault {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export const SECRETS_FILENAME = 'secrets.json';

interface SecretsFile {
  version: 1;
  openai?: {
    /** base64 of safeStorage.encryptString */
    ciphertext: string;
    last4: string;
    savedAt: string;
  };
}

export function secretsPath(userDataDir: string): string {
  return path.join(userDataDir, SECRETS_FILENAME);
}

function last4(key: string): string {
  return key.slice(-4);
}

async function readFile(userDataDir: string): Promise<SecretsFile> {
  try {
    const text = await fs.readFile(secretsPath(userDataDir), 'utf8');
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (typeof parsed === 'object' && parsed !== null && (parsed as SecretsFile).version === 1) {
      return parsed as SecretsFile;
    }
  } catch {
    // No file, unreadable file, or junk: there is simply no stored key.
  }
  return { version: 1 };
}

async function writeFile(userDataDir: string, contents: SecretsFile): Promise<void> {
  const file = secretsPath(userDataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(contents, null, 2)}\n`, 'utf8'));
}

/** The key from the environment, when one is set. Never stored, never shown. */
function environmentKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env['OPENAI_API_KEY'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * What the renderer is allowed to know. A stored key wins over the environment,
 * so pasting one into Settings has a visible effect even on a machine where
 * OPENAI_API_KEY happens to be set.
 */
export async function openAiKeyStatus(
  vault: KeyVault,
  userDataDir: string,
  env?: NodeJS.ProcessEnv
): Promise<OpenAiKeyStatus> {
  const encryptionAvailable = safely(() => vault.isEncryptionAvailable(), false);
  const file = await readFile(userDataDir);
  if (file.openai) {
    return { configured: true, source: 'stored', last4: file.openai.last4, encryptionAvailable };
  }
  const fromEnv = environmentKey(env);
  if (fromEnv) {
    return { configured: true, source: 'environment', last4: last4(fromEnv), encryptionAvailable };
  }
  return { configured: false, source: 'none', last4: '', encryptionAvailable };
}

/**
 * The plaintext key, for one call, in the main process only. Returns null when
 * there is none, and throws only when a stored key exists but cannot be read
 * back, which the author needs to hear about rather than see as "no key".
 */
export async function openAiKey(
  vault: KeyVault,
  userDataDir: string,
  env?: NodeJS.ProcessEnv
): Promise<string | null> {
  const file = await readFile(userDataDir);
  if (file.openai) {
    try {
      return vault.decryptString(Buffer.from(file.openai.ciphertext, 'base64'));
    } catch (err) {
      throw fail(
        'openai-no-key',
        'The saved OpenAI key could not be decrypted on this machine. Save it again in Settings.',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return environmentKey(env);
}

/** Encrypt and store a key. Refuses rather than writing plaintext. */
export async function storeOpenAiKey(
  vault: KeyVault,
  userDataDir: string,
  key: string,
  env?: NodeJS.ProcessEnv
): Promise<OpenAiKeyStatus> {
  const trimmed = key.trim();
  if (trimmed.length < 8) {
    throw fail('invalid-input', 'That does not look like an API key. Paste the whole key.');
  }
  if (!safely(() => vault.isEncryptionAvailable(), false)) {
    throw fail(
      'not-configured',
      'Windows cannot encrypt secrets for this app right now, so the key was not saved. ' +
        'Set OPENAI_API_KEY in the environment instead.'
    );
  }

  const ciphertext = vault.encryptString(trimmed).toString('base64');
  await writeFile(userDataDir, {
    version: 1,
    openai: { ciphertext, last4: last4(trimmed), savedAt: new Date().toISOString() }
  });
  return openAiKeyStatus(vault, userDataDir, env);
}

/** Forget a stored key. The environment variable, if any, is not this app's to remove. */
export async function clearOpenAiKey(
  vault: KeyVault,
  userDataDir: string,
  env?: NodeJS.ProcessEnv
): Promise<OpenAiKeyStatus> {
  await writeFile(userDataDir, { version: 1 });
  return openAiKeyStatus(vault, userDataDir, env);
}

/** safeStorage can throw before the app is ready; a failure means "not available". */
function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
