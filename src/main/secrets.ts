import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '../shared/branding';
import type { OpenAiKeyStatus } from '../shared/ipc';
import { atomicWriteFile } from './atomic';
import { fail, readFailure } from './errors';
import { log } from './log';

/**
 * The two credentials this app stores (CLAUDE.md rule 2 b): the author's
 * OpenAI API key, and since codex.2 the ChatGPT sign-in, whose part of the
 * file is `src/main/chatgpt/store.ts`'s.
 *
 * They live in their own file beside settings.json, never inside it, encrypted
 * with Electron's safeStorage (DPAPI on Windows). Only the main process ever
 * holds the plaintext, and only for the length of one call; the renderer is told
 * nothing but whether a key exists and its last four characters, or whether a
 * sign-in exists and its plan. Claude's credentials are still never touched at
 * all.
 *
 * Every write reads the file, changes its own part and writes the whole file
 * back, one write at a time per folder (`updateSecrets`), so saving the key
 * keeps the sign-in and signing in or out keeps the key. So a write never
 * takes a read that failed for an empty file: while the file is there but
 * cannot be read (a sync, backup or antivirus tool holding it), nothing is
 * written, and a damaged file (not JSON, not an object, another version) is
 * copied aside as `secrets.json.corrupt-<time>` before a new one is written
 * over it, or nothing is written when no copy can be made (the codex.2
 * review; settings.json's rule, hardening.15). A read for a status is
 * lenient: there, any failure reads as nothing stored.
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

export interface SecretsFile {
  version: 1;
  openai?: {
    /** base64 of safeStorage.encryptString */
    ciphertext: string;
    last4: string;
    savedAt: string;
  };
  /** the ChatGPT sign-in, read and checked by `src/main/chatgpt/store.ts` */
  chatgpt?: unknown;
}

export function secretsPath(userDataDir: string): string {
  return path.join(userDataDir, SECRETS_FILENAME);
}

function last4(key: string): string {
  return key.slice(-4);
}

/** What one read of the file found. */
type SecretsRead =
  | { kind: 'ok'; file: SecretsFile }
  /** no file: nothing stored yet */
  | { kind: 'missing' }
  /** not JSON, not an object, or a version this app does not write */
  | { kind: 'damaged' }
  /** there, but the system would not let it be read */
  | { kind: 'unreadable'; error: unknown };

function errnoCode(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : null;
}

async function readOnce(userDataDir: string): Promise<SecretsRead> {
  let text: string;
  try {
    text = await fs.readFile(secretsPath(userDataDir), 'utf8');
  } catch (err) {
    return errnoCode(err) === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', error: err };
  }
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as SecretsFile).version === 1
    ) {
      return { kind: 'ok', file: parsed as SecretsFile };
    }
  } catch {
    // Not JSON: damaged, below.
  }
  return { kind: 'damaged' };
}

/**
 * The file as it is on disk, for a status: no file, an unreadable one or junk
 * reads as an empty one. Never the read a write is built on.
 */
export async function readSecrets(userDataDir: string): Promise<SecretsFile> {
  const read = await readOnce(userDataDir);
  return read.kind === 'ok' ? read.file : { version: 1 };
}

/** A read the system refused, in plain words that name the file and say nothing was changed. */
function unreadable(error: unknown): Error {
  log('warn', 'secrets.read-failed', { code: errnoCode(error) });
  return readFailure(error, SECRETS_FILENAME);
}

/**
 * The file as it is on disk, for a decision a change follows, such as which
 * registration a sign-in uses or whether there is a sign-in to end: no file
 * or a damaged one reads as an empty one, but a file the system will not let
 * be read throws, so nothing is decided on a read that failed.
 */
export async function readSecretsChecked(userDataDir: string): Promise<SecretsFile> {
  const read = await readOnce(userDataDir);
  if (read.kind === 'unreadable') throw unreadable(read.error);
  return read.kind === 'ok' ? read.file : { version: 1 };
}

/** How many names a copy of a damaged file may try: the stamp, then `-2` to `-20`. */
const COPY_NAMES = 20;

function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Copy a damaged secrets.json beside itself, under the first of twenty names
 * not taken, never over an earlier copy. Throws when no copy could be made,
 * so the file is not written over.
 */
async function setAside(userDataDir: string): Promise<void> {
  const file = secretsPath(userDataDir);
  const base = `${file}.corrupt-${stamp(new Date())}`;
  let code: string | null = 'EEXIST';
  for (let n = 1; n <= COPY_NAMES; n += 1) {
    const target = n === 1 ? base : `${base}-${n}`;
    try {
      await fs.copyFile(file, target, fsConstants.COPYFILE_EXCL);
      log('warn', 'secrets.unreadable', { kept: path.basename(target) });
      return;
    } catch (err) {
      code = errnoCode(err);
      if (code !== 'EEXIST') break;
    }
  }
  log('warn', 'secrets.unreadable', { kept: 'none', code });
  throw fail(
    'io',
    `Nothing was saved, because ${SECRETS_FILENAME}, where ${APP_NAME} keeps the OpenAI key and the ChatGPT sign-in, is damaged and no copy of it could be made, so writing would lose what it holds. ${APP_NAME}'s log says why the copy failed.`
  );
}

async function writeSecrets(userDataDir: string, contents: SecretsFile): Promise<void> {
  const file = secretsPath(userDataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Off Windows only its owner may read it; on Windows the profile folder already sees to that.
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(contents, null, 2)}\n`, 'utf8'), {
    mode: 0o600
  });
}

/** The write in progress for each folder, so two changes never read the same file and race. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Read the file, let `change` make the new contents, and write them, after any
 * change already under way for the same folder. Answers with what was written.
 * Rejects, with nothing written, while the file is there but cannot be read,
 * and for a damaged file that could not be copied aside.
 */
export function updateSecrets(
  userDataDir: string,
  change: (file: SecretsFile) => SecretsFile
): Promise<SecretsFile> {
  const key = path.resolve(userDataDir);
  const run = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const read = await readOnce(userDataDir);
      if (read.kind === 'unreadable') throw unreadable(read.error);
      if (read.kind === 'damaged') await setAside(userDataDir);
      const next = change(read.kind === 'ok' ? read.file : { version: 1 });
      await writeSecrets(userDataDir, next);
      return next;
    });
  queues.set(key, run);
  const done = (): void => {
    if (queues.get(key) === run) queues.delete(key);
  };
  run.then(done, done);
  return run;
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
  const file = await readSecrets(userDataDir);
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
  const file = await readSecrets(userDataDir);
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
  await updateSecrets(userDataDir, (file) => ({
    ...file,
    version: 1,
    openai: { ciphertext, last4: last4(trimmed), savedAt: new Date().toISOString() }
  }));
  return openAiKeyStatus(vault, userDataDir, env);
}

/** Forget a stored key. The environment variable, if any, is not this app's to remove. */
export async function clearOpenAiKey(
  vault: KeyVault,
  userDataDir: string,
  env?: NodeJS.ProcessEnv
): Promise<OpenAiKeyStatus> {
  await updateSecrets(userDataDir, (file) => {
    const { openai: _removed, ...rest } = file;
    return { ...rest, version: 1 };
  });
  return openAiKeyStatus(vault, userDataDir, env);
}

/** safeStorage can throw before the app is ready; a failure means "not available". */
export function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
