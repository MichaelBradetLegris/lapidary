import type { ChatGptSignOut, ChatGptStatus } from '../../shared/ipc';
import {
  CALLBACK_CANCELLED,
  CALLBACK_NOT_OURS,
  CALLBACK_SIGNED_IN,
  NO_ENCRYPTION_TEXT,
  SIGN_IN_WAIT_MINUTES,
  callbackFailedPage,
  signInFailureMessage,
  type SignInFailure
} from '../../shared/ui/chatgpt';
import { fail, type AppFailure } from '../errors';
import type { Logger } from '../log';
import { safely, type KeyVault } from '../secrets';
import type { ShellApi } from '../shellApi';
import { checkIdToken } from './idToken';
import { openLoopback, type Callback } from './loopback';
import {
  DYNAMIC_CLIENT_ID,
  REQUEST_TIMEOUT_MS,
  authEndpoints,
  authorizationUrl,
  codeExchangeFields,
  getJson,
  grantsPlan,
  newAttempt,
  oauthError,
  postForm,
  readCallback,
  readTokenAnswer,
  revokeRefreshToken,
  sameSecret,
  type Fetch,
  type FormAnswer
} from './oauth';
import {
  ensureHostId,
  lastRegistration,
  openTokens,
  readChatGpt,
  readChatGptChecked,
  sealTokens,
  sessionRegistration,
  updateChatGpt,
  withRegistration,
  type ChatGptSecrets
} from './store';

/**
 * Sign in with ChatGPT (codex.2, PLAN 5.7): one sign-in at a time, the
 * status the page may see, Sign out, and the account's data settings box.
 *
 * A sign-in makes the host id the first time, opens a loopback listener,
 * opens OpenAI's page in the system browser (`systemShell`, which the shell
 * stub replaces in a test run) and waits for the browser's answer, up to
 * `SIGN_IN_WAIT_MINUTES`. The answer's code is exchanged with the attempt's
 * PKCE verifier, the ID token is checked (idToken.ts), the scopes must grant
 * the plan's use, and only then are the tokens kept, encrypted, in
 * secrets.json (store.ts). A new sign-in, Cancel, Sign out or quitting ends
 * the one waiting. Sign out asks OpenAI to end the sign-in, then removes it
 * here whatever OpenAI answered, keeping the registration and the host id.
 *
 * The log (CLAUDE.md rule 9) gets what happened and why, as fixed words:
 * never a token, the code, the client id, the state, the nonce, the
 * verifier, the host id or the account's email or id.
 *
 * No electron import: safeStorage, the shell, fetch and the folder are
 * handed in, so test/main/chatgptSignIn.test.ts drives it against
 * test/helpers/mockChatGptAuth.ts.
 */

/** How long a sign-in waits for the browser's answer. */
export const SIGN_IN_WAIT_MS = SIGN_IN_WAIT_MINUTES * 60 * 1000;

/** How long the browser's tab may wait for its page while the code is exchanged and checked. */
const RESPOND_WITHIN_MS = 3 * REQUEST_TIMEOUT_MS;

export interface ChatGptAuthDeps {
  userDataDir: () => string;
  vault: KeyVault;
  shell: () => ShellApi;
  fetch: Fetch;
  /** the development switch's stand-in for OpenAI's sign-in server, or null for OpenAI's own */
  authBase: () => string | null;
  log: Logger['log'];
  /** tracks an attempt's controller, so quitting ends it (`registerController`) */
  track?: (controller: AbortController) => () => void;
  /** runs a write of secrets.json, so Restart now lets it end (`trackWrite`) */
  write?: <T>(work: () => Promise<T>) => Promise<T>;
  now?: () => Date;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ChatGptAuth {
  status(): Promise<ChatGptStatus>;
  /** resolves once signed in; rejects with `cancelled`, or with the reason the sign-in did not finish */
  signIn(options: { another: boolean }): Promise<ChatGptStatus>;
  /** end the sign-in that is waiting, if any */
  cancelSignIn(): void;
  signOut(): Promise<ChatGptSignOut>;
  confirmDataSettings(confirmed: boolean): Promise<ChatGptStatus>;
}

/** A sign-in that did not finish, with the fixed word the log gets. */
class SignInStop extends Error {
  constructor(
    readonly failure: AppFailure,
    readonly reason: SignInFailure | 'cancelled' | 'encryption' | 'signed-in',
    readonly fields: Record<string, string | number> = {}
  ) {
    super(failure.message);
  }
}

function stopFor(
  reason: SignInFailure,
  extra?: string,
  fields: Record<string, string | number> = {}
): SignInStop {
  return new SignInStop(fail('chatgpt-sign-in-failed', signInFailureMessage(reason, extra)), reason, fields);
}

function cancelled(): SignInStop {
  return new SignInStop(fail('cancelled', 'Sign-in cancelled.'), 'cancelled');
}

/** `promise`, or a rejection as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

export function createChatGptAuth(deps: ChatGptAuthDeps): ChatGptAuth {
  const now = deps.now ?? ((): Date => new Date());
  const write = deps.write ?? (<T>(work: () => Promise<T>): Promise<T> => work());
  let waiting: AbortController | null = null;
  /**
   * The sign-in's part as last read or written here, for a status asked while
   * secrets.json is there but cannot be read (a sync, backup or antivirus
   * tool holding it): the page is told what is still on disk, not "not
   * signed in" (codex.2 review). Nothing is ever decided on it: the sign-in,
   * Sign out and the box read the file again, and refuse while they cannot.
   */
  let known: ChatGptSecrets | null = null;
  const remember = (secrets: ChatGptSecrets): ChatGptSecrets => {
    known = secrets;
    return secrets;
  };
  /** A write of the sign-in's part, remembered as `known`. */
  const keep = (work: () => Promise<ChatGptSecrets>): Promise<ChatGptSecrets> => write(work).then(remember);

  async function status(): Promise<ChatGptStatus> {
    const dir = deps.userDataDir();
    let secrets: ChatGptSecrets;
    try {
      secrets = remember(await readChatGptChecked(dir));
    } catch {
      // What was last read or written in this run; with nothing yet, nothing kept, as before.
      secrets = known ?? (await readChatGpt(dir));
    }
    const registration = sessionRegistration(secrets);
    const base = deps.authBase();
    return {
      signedIn: registration !== null,
      plan: registration ? (secrets.session?.plan ?? null) : null,
      dataSettingsConfirmed: registration?.dataSettingsConfirmed ?? false,
      signingIn: waiting !== null,
      registered: lastRegistration(secrets) !== null,
      encryptionAvailable: safely(() => deps.vault.isEncryptionAvailable(), false),
      ...(base ? { devServer: base } : {})
    };
  }

  /** Ask OpenAI to end a refresh token the app will not keep; what it answers changes nothing here. */
  async function letGo(clientId: string, refreshToken: string | null, signal: AbortSignal): Promise<void> {
    if (!refreshToken) return;
    const endpoints = authEndpoints(deps.authBase());
    await revokeRefreshToken(deps.fetch, endpoints.revoke, clientId, refreshToken, {
      signal,
      ...(deps.sleep ? { sleep: deps.sleep } : {})
    }).catch(() => false);
  }

  /** One sign-in, from the host id to the tokens kept; answers with what was written and whose registration it used. */
  async function attempt(
    another: boolean,
    signal: AbortSignal
  ): Promise<{ written: ChatGptSecrets; registration: 'new' | 'saved' }> {
    if (!safely(() => deps.vault.isEncryptionAvailable(), false)) {
      throw new SignInStop(fail('not-configured', NO_ENCRYPTION_TEXT), 'encryption');
    }
    const dir = deps.userDataDir();
    // Checked reads here and below: a secrets.json that cannot be read stops
    // the sign-in, rather than registering the app again or taking another
    // account's sign-in on a kept registration (codex.2 review).
    const before = await readChatGptChecked(dir);
    if (sessionRegistration(before)) {
      throw new SignInStop(
        fail('invalid-input', 'You are signed in to ChatGPT already. Sign out first to sign in again.'),
        'signed-in'
      );
    }
    // Made before the first sign-in and kept ever after: a restart or a new sign-in is not a new host.
    const hostId = await write(() => ensureHostId(dir));
    const saved = another ? null : lastRegistration(before);
    const clientId = saved?.clientId ?? DYNAMIC_CLIENT_ID;
    const endpoints = authEndpoints(deps.authBase());
    const values = newAttempt();

    const loopback = await openLoopback({
      isOurs: (query) => {
        const states = query.getAll('state');
        return states.length === 1 && sameSecret(states[0] ?? '', values.state);
      },
      notOurs: CALLBACK_NOT_OURS,
      late: CALLBACK_CANCELLED,
      respondWithinMs: RESPOND_WITHIN_MS
    });
    let callback: Callback | null = null;
    /** Answer the browser's tab with the reason, and hand back what to throw. */
    const refuse = (stop: SignInStop): SignInStop => {
      callback?.respond(callbackFailedPage(stop.failure.message));
      return stop;
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      loopback.close(CALLBACK_CANCELLED);
    }, deps.waitMs ?? SIGN_IN_WAIT_MS);
    const onAbort = (): void => loopback.close(CALLBACK_CANCELLED);
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      // Ended while the listener was opening: no browser is opened for it.
      if (signal.aborted) throw cancelled();
      deps.log('info', 'chatgpt.sign-in.start', {
        registration: saved ? 'saved' : 'new',
        consent: saved?.consentNeeded === true
      });
      const url = authorizationUrl({
        endpoint: endpoints.authorize,
        clientId,
        hostId,
        redirectUri: loopback.redirectUri,
        attempt: values,
        ...(saved?.consentNeeded ? { consent: true } : {})
      });
      try {
        await deps.shell().openExternal(url);
      } catch {
        throw stopFor('browser');
      }

      try {
        callback = await untilAborted(loopback.callback, signal);
      } catch {
        if (signal.aborted) throw cancelled();
        if (timedOut) throw stopFor('timeout');
        throw cancelled();
      }

      const reading = readCallback(callback.query, { state: values.state, clientId });
      if (reading.kind === 'not-ours') throw refuse(stopFor('refused'));
      if (reading.kind === 'failed') throw refuse(stopFor(reading.reason, reading.error));

      // A first sign-in's client id is kept at once: should the exchange fail,
      // the next sign-in reuses it rather than registering the app again.
      if (clientId === DYNAMIC_CLIENT_ID) {
        await keep(() =>
          updateChatGpt(dir, (c) => ({
            ...c,
            lastClientId: reading.clientId,
            registrations: withRegistration(c.registrations, {
              clientId: reading.clientId,
              subject: null,
              dataSettingsConfirmed: false,
              consentNeeded: false,
              savedAt: now().toISOString()
            })
          }))
        );
      }

      // Each request to OpenAI that fails says how: no answer, an error
      // status, or an answer not in the form OpenAI documents, and which
      // endpoint (`endpoint` in the log), so the page never blames the
      // connection for an answer that came (codex.2 review).
      let answer: FormAnswer;
      try {
        answer = await postForm(
          deps.fetch,
          endpoints.token,
          codeExchangeFields(reading.code, reading.clientId, values.verifier, loopback.redirectUri),
          signal
        );
      } catch {
        if (signal.aborted) throw refuse(cancelled());
        throw refuse(stopFor('no-answer', undefined, { endpoint: 'token' }));
      }
      if (answer.status !== 200) {
        const error = oauthError(answer.json);
        throw refuse(
          error === 'invalid_grant'
            ? stopFor('invalid-grant', undefined, { status: answer.status })
            : stopFor('server', String(answer.status), { endpoint: 'token', status: answer.status })
        );
      }
      const tokens = readTokenAnswer(answer.json, now(), reading.scope);
      if (!tokens) throw refuse(stopFor('malformed', undefined, { endpoint: 'token' }));

      let keys: FormAnswer;
      try {
        keys = await getJson(deps.fetch, endpoints.jwks, signal);
      } catch {
        if (signal.aborted) throw refuse(cancelled());
        throw refuse(stopFor('no-answer', undefined, { endpoint: 'keys' }));
      }
      if (keys.status !== 200) {
        throw refuse(stopFor('server', String(keys.status), { endpoint: 'keys', status: keys.status }));
      }
      if (keys.json === null) throw refuse(stopFor('malformed', undefined, { endpoint: 'keys' }));
      const jwks = keys.json;
      const check = checkIdToken(tokens.idToken, jwks, {
        issuer: endpoints.issuer,
        clientId: reading.clientId,
        nonce: values.nonce,
        now: now()
      });
      if (!check.ok) throw refuse(stopFor('id-token', undefined, { problem: check.problem }));

      const current = await readChatGptChecked(dir);
      const registration = current.registrations.find((r) => r.clientId === reading.clientId) ?? null;
      if (registration?.subject && registration.subject !== check.identity.subject) {
        await letGo(reading.clientId, tokens.refreshToken, signal);
        throw refuse(stopFor('other-account'));
      }
      if (!grantsPlan(tokens.scope)) {
        await letGo(reading.clientId, tokens.refreshToken, signal);
        await keep(() =>
          updateChatGpt(dir, (c) => ({
            ...c,
            lastClientId: reading.clientId,
            registrations: withRegistration(c.registrations, {
              clientId: reading.clientId,
              subject: check.identity.subject,
              dataSettingsConfirmed: registration?.dataSettingsConfirmed ?? false,
              consentNeeded: true,
              savedAt: now().toISOString()
            })
          }))
        );
        throw refuse(stopFor('no-plan-use'));
      }

      const ciphertext = sealTokens(deps.vault, tokens);
      const savedAt = now().toISOString();
      const written = await keep(() =>
        updateChatGpt(dir, (c) => {
          const kept = c.registrations.find((r) => r.clientId === reading.clientId);
          return {
            ...c,
            lastClientId: reading.clientId,
            registrations: withRegistration(c.registrations, {
              clientId: reading.clientId,
              subject: check.identity.subject,
              dataSettingsConfirmed: kept?.dataSettingsConfirmed ?? false,
              consentNeeded: false,
              savedAt
            }),
            session: { clientId: reading.clientId, ciphertext, plan: check.identity.plan, savedAt }
          };
        })
      );
      callback.respond(CALLBACK_SIGNED_IN);
      return { written, registration: saved ? 'saved' : 'new' };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      loopback.close(CALLBACK_CANCELLED);
    }
  }

  async function signIn({ another }: { another: boolean }): Promise<ChatGptStatus> {
    // A new sign-in replaces the one waiting, whose tab may have been closed.
    waiting?.abort();
    const controller = new AbortController();
    waiting = controller;
    const release = deps.track?.(controller) ?? ((): void => undefined);
    const started = now().getTime();
    try {
      const { written, registration } = await attempt(another, controller.signal);
      deps.log('info', 'chatgpt.sign-in.done', {
        registration,
        plan: written.session?.plan ?? null,
        durationMs: now().getTime() - started
      });
    } catch (err) {
      const stop = err instanceof SignInStop ? err : null;
      deps.log(stop?.reason === 'cancelled' ? 'info' : 'warn', 'chatgpt.sign-in.failed', {
        reason: stop?.reason ?? 'unexpected',
        ...(stop?.fields ?? {}),
        durationMs: now().getTime() - started
      });
      throw stop ? stop.failure : err;
    } finally {
      release();
      if (waiting === controller) waiting = null;
    }
    // Read once the attempt is over, so the page is not told a sign-in is still waiting.
    return status();
  }

  function cancelSignIn(): void {
    waiting?.abort();
  }

  async function signOut(): Promise<ChatGptSignOut> {
    cancelSignIn();
    const dir = deps.userDataDir();
    // Checked: a sign-in that cannot be read is not one that is not there.
    const secrets = await readChatGptChecked(dir);
    const session = secrets.session;
    if (!session) return { status: await status(), revoked: true };
    const tokens = openTokens(deps.vault, session.ciphertext);
    const controller = new AbortController();
    const release = deps.track?.(controller) ?? ((): void => undefined);
    let revoked = false;
    try {
      if (tokens?.refreshToken) {
        revoked = await revokeRefreshToken(
          deps.fetch,
          authEndpoints(deps.authBase()).revoke,
          session.clientId,
          tokens.refreshToken,
          { signal: controller.signal, ...(deps.sleep ? { sleep: deps.sleep } : {}) }
        );
      }
    } finally {
      release();
    }
    // Removed whatever OpenAI said: the registration and the host id stay, for a later sign-in.
    await keep(() => updateChatGpt(dir, (c) => ({ ...c, session: null })));
    deps.log('info', 'chatgpt.sign-out', { revoked });
    return { status: await status(), revoked };
  }

  async function confirmDataSettings(confirmed: boolean): Promise<ChatGptStatus> {
    const dir = deps.userDataDir();
    const written = await keep(() =>
      updateChatGpt(dir, (c) => {
        const registration = sessionRegistration(c);
        if (!registration) return c;
        return {
          ...c,
          registrations: withRegistration(c.registrations, {
            ...registration,
            dataSettingsConfirmed: confirmed
          })
        };
      })
    );
    if (!sessionRegistration(written)) {
      throw fail(
        'not-configured',
        'Sign in with ChatGPT first: the box is kept for the account you sign in with.'
      );
    }
    deps.log('info', 'chatgpt.data-settings', { confirmed });
    return status();
  }

  return { status, signIn, cancelSignIn, signOut, confirmDataSettings };
}
