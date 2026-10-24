import { randomUUID } from 'node:crypto';
import { readSecrets, readSecretsChecked, updateSecrets, type KeyVault } from '../secrets';

/**
 * The ChatGPT sign-in's part of secrets.json (codex.2, CLAUDE.md rule 2 b,
 * PLAN 5.7): the host id, the registrations OpenAI issued, and the one sign-in
 * kept, whose tokens are a single safeStorage ciphertext. Nothing here is ever
 * sent to the page or logged: the status the page sees is built from it in
 * `src/main/chatgpt/index.ts`.
 *
 * - `hostId` is the `ext_agent_host_id` OpenAI asks for: made once, the first
 *   time a sign-in starts, and kept through restarts, sign-outs and new
 *   sign-ins, since none of them is a new host. An opaque `urn:uuid:` value,
 *   never derived from the account.
 * - A registration is a client id OpenAI issued at a first sign-in
 *   (`client_id=dynamic_agent_client`), kept with the account's `sub` once a
 *   sign-in with it has been checked, the account's "I have confirmed my data
 *   settings" box, and whether the next sign-in has to ask for consent again.
 *   Signing out keeps it, so a later sign-in reuses the client id.
 * - The session is the sign-in kept: its registration's client id, the plan
 *   the sign-in named, and the tokens, encrypted. Signing out removes it.
 *
 * A part that is missing, damaged or of the wrong shape reads as nothing, as
 * secrets.json's own junk does. A secrets.json that is there but cannot be
 * read is another matter: `readChatGptChecked` and every change throw then,
 * and the status falls back on what was last read or written (index.ts).
 */

export interface Registration {
  /** the client id OpenAI issued for this account on this computer */
  clientId: string;
  /** the account's `sub` from a checked ID token; null while no sign-in with it has finished */
  subject: string | null;
  /** the account's "I have confirmed my data settings" box */
  dataSettingsConfirmed: boolean;
  /** its last sign-in did not grant the plan's use, so the next asks OpenAI's page for consent again */
  consentNeeded: boolean;
  savedAt: string;
}

/** The tokens a sign-in gave, as one encrypted value. */
export interface SessionTokens {
  accessToken: string;
  /** null when the token answer carried none */
  refreshToken: string | null;
  idToken: string;
  /** the scopes granted, space-separated */
  scope: string;
  /** when the access token ends, ISO time */
  expiresAt: string;
}

export interface Session {
  /** the registration it belongs to */
  clientId: string;
  /** base64 of safeStorage.encryptString of the `SessionTokens`' JSON */
  ciphertext: string;
  /** the plan the sign-in named, such as `Plus`, or null */
  plan: string | null;
  savedAt: string;
}

export interface ChatGptSecrets {
  hostId: string | null;
  /** the registration a plain Sign in with ChatGPT reuses */
  lastClientId: string | null;
  registrations: Registration[];
  session: Session | null;
}

/** Nothing kept: no host id yet, no registration and no sign-in. */
function empty(): ChatGptSecrets {
  return { hostId: null, lastClientId: null, registrations: [], session: null };
}

/** A host id this app made: `urn:uuid:` and a UUID, as OpenAI's documentation offers. */
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a client id may look like here: OpenAI's are like `oaiapp_...`; nothing with spaces or markup. */
export function isClientId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{1,256}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readRegistration(value: unknown): Registration | null {
  if (!isRecord(value) || !isClientId(value['clientId'])) return null;
  return {
    clientId: value['clientId'],
    subject: text(value['subject']),
    dataSettingsConfirmed: value['dataSettingsConfirmed'] === true,
    consentNeeded: value['consentNeeded'] === true,
    savedAt: text(value['savedAt']) ?? ''
  };
}

function readSession(value: unknown): Session | null {
  if (!isRecord(value) || !isClientId(value['clientId'])) return null;
  const ciphertext = text(value['ciphertext']);
  if (!ciphertext) return null;
  return {
    clientId: value['clientId'],
    ciphertext,
    plan: text(value['plan']),
    savedAt: text(value['savedAt']) ?? ''
  };
}

/** The part as secrets.json holds it, checked; anything malformed reads as nothing. */
export function normalizeChatGpt(value: unknown): ChatGptSecrets {
  if (!isRecord(value)) return empty();
  const hostId = text(value['hostId']);
  const registrations: Registration[] = [];
  for (const entry of Array.isArray(value['registrations']) ? value['registrations'] : []) {
    const registration = readRegistration(entry);
    if (registration && !registrations.some((r) => r.clientId === registration.clientId)) {
      registrations.push(registration);
    }
  }
  const session = readSession(value['session']);
  const lastClientId = isClientId(value['lastClientId']) ? value['lastClientId'] : null;
  return {
    hostId: hostId !== null && HOST_ID.test(hostId) ? hostId : null,
    lastClientId: registrations.some((r) => r.clientId === lastClientId) ? lastClientId : null,
    registrations,
    // A sign-in whose registration is gone has nothing to say who it is.
    session: session && registrations.some((r) => r.clientId === session.clientId) ? session : null
  };
}

/** The part, leniently: a file that cannot be read reads as nothing kept. For a status only. */
export async function readChatGpt(userDataDir: string): Promise<ChatGptSecrets> {
  return normalizeChatGpt((await readSecrets(userDataDir)).chatgpt);
}

/**
 * The part, for a decision a change follows (which registration a sign-in
 * uses, whose account it is, whether there is a sign-in to end): throws while
 * secrets.json is there but cannot be read, rather than deciding on nothing.
 */
export async function readChatGptChecked(userDataDir: string): Promise<ChatGptSecrets> {
  return normalizeChatGpt((await readSecretsChecked(userDataDir)).chatgpt);
}

/** Change the part, after any other change to secrets.json under way, and answer with what was written. */
export async function updateChatGpt(
  userDataDir: string,
  change: (current: ChatGptSecrets) => ChatGptSecrets
): Promise<ChatGptSecrets> {
  let written = empty();
  await updateSecrets(userDataDir, (file) => {
    written = change(normalizeChatGpt(file.chatgpt));
    return { ...file, version: 1, chatgpt: written };
  });
  return written;
}

/** The host id, made and written the first time it is asked for, and the same ever after. */
export async function ensureHostId(
  userDataDir: string,
  make: () => string = () => `urn:uuid:${randomUUID()}`
): Promise<string> {
  const current = await readChatGpt(userDataDir);
  if (current.hostId) return current.hostId;
  const written = await updateChatGpt(userDataDir, (c) => (c.hostId ? c : { ...c, hostId: make() }));
  if (!written.hostId) throw new Error('The host id could not be kept.');
  return written.hostId;
}

/** The registration a plain sign-in reuses: the last one used, else none. */
export function lastRegistration(secrets: ChatGptSecrets): Registration | null {
  return secrets.registrations.find((r) => r.clientId === secrets.lastClientId) ?? null;
}

/** The kept sign-in's registration, or null when signed out. */
export function sessionRegistration(secrets: ChatGptSecrets): Registration | null {
  const session = secrets.session;
  return session ? (secrets.registrations.find((r) => r.clientId === session.clientId) ?? null) : null;
}

/** `registrations` with `next` in the place of the one with its client id, or added at the end. */
export function withRegistration(registrations: Registration[], next: Registration): Registration[] {
  return registrations.some((r) => r.clientId === next.clientId)
    ? registrations.map((r) => (r.clientId === next.clientId ? next : r))
    : [...registrations, next];
}

/** The tokens as one encrypted value. */
export function sealTokens(vault: KeyVault, tokens: SessionTokens): string {
  return vault.encryptString(JSON.stringify(tokens)).toString('base64');
}

/** The tokens back, or null when they cannot be decrypted or read. */
export function openTokens(vault: KeyVault, ciphertext: string): SessionTokens | null {
  try {
    const parsed: unknown = JSON.parse(vault.decryptString(Buffer.from(ciphertext, 'base64')));
    if (!isRecord(parsed)) return null;
    const accessToken = text(parsed['accessToken']);
    const idToken = text(parsed['idToken']);
    if (!accessToken || !idToken) return null;
    return {
      accessToken,
      refreshToken: text(parsed['refreshToken']),
      idToken,
      scope: text(parsed['scope']) ?? '',
      expiresAt: text(parsed['expiresAt']) ?? ''
    };
  } catch {
    return null;
  }
}
