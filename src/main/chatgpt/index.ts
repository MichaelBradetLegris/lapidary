import type { ChatGptSignOut, ChatGptStatus } from '../../shared/ipc';
import {
  CALLBACK_CANCELLED,
  CALLBACK_NOT_OURS,
  CALLBACK_SIGNED_IN,
  CHATGPT_REVIEW_FAILURES,
  NO_ENCRYPTION_TEXT,
  SIGN_IN_WAIT_MINUTES,
  callbackFailedPage,
  notSignedInText,
  renewRefusedText,
  renewServerText,
  signInFailureMessage,
  type NotSignedInReason,
  type SignInFailure
} from '../../shared/ui/chatgpt';
import { fail, type AppFailure } from '../errors';
import type { Logger } from '../log';
import { safely, type KeyVault } from '../secrets';
import type { ShellApi } from '../shellApi';
import { checkIdToken, readIdTokenIdentity } from './idToken';
import { openLoopback, type Callback } from './loopback';
import {
  DYNAMIC_CLIENT_ID,
  ENDED_REFRESH_ERRORS,
  REQUEST_TIMEOUT_MS,
  authEndpoints,
  authorizationUrl,
  codeExchangeFields,
  getJson,
  grantsPlan,
  needsRenewal,
  newAttempt,
  oauthError,
  postForm,
  readCallback,
  readRefreshAnswer,
  readTokenAnswer,
  refreshFields,
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
  type ChatGptSecrets,
  type Registration,
  type Session,
  type SessionTokens
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
 * Since codex.3 a review asks for the access token (`accessToken`), which is
 * renewed with the refresh token, one renewal at a time, when it has ended or
 * OpenAI has refused it; a refresh token OpenAI no longer takes ends the
 * sign-in here, so the page shows it as not signed in.
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

export interface AccessTokenOptions {
  /** ends this caller's wait for a renewal, which goes on and is kept */
  signal?: AbortSignal;
  /**
   * the token OpenAI's API just refused with a 401: it is renewed even when
   * its end is not near, unless the kept token is already another one
   */
  rejected?: string;
}

export interface ChatGptAuth {
  status(): Promise<ChatGptStatus>;
  /** resolves once signed in; rejects with `cancelled`, or with the reason the sign-in did not finish */
  signIn(options: { another: boolean }): Promise<ChatGptStatus>;
  /** end the sign-in that is waiting, if any */
  cancelSignIn(): void;
  signOut(): Promise<ChatGptSignOut>;
  confirmDataSettings(confirmed: boolean): Promise<ChatGptStatus>;
  /**
   * The bearer for a request to OpenAI's API with the plan (codex.3, PLAN
   * 5.8): the kept access token, or a renewed one when it has ended or is
   * about to, or when OpenAI refused it (`rejected`). Rejects with
   * `chatgpt-not-signed-in` when no sign-in is kept, or when OpenAI says the
   * kept one has ended, which removes it; with `chatgpt-server` or
   * `chatgpt-failed` when a renewal could not be made, which keeps it. Never
   * logged, and never sent to the page.
   */
  accessToken(options?: AccessTokenOptions): Promise<string>;
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
    // A renewal held for its write has the refresh token OpenAI takes now; the
    // one on disk was spent by it, so the held one is the sign-in to end
    // (codex.3 review).
    const pending = held?.from === session.ciphertext ? held : null;
    const live = pending ? openTokens(deps.vault, pending.ciphertext) : tokens;
    const controller = new AbortController();
    const release = deps.track?.(controller) ?? ((): void => undefined);
    let revoked = false;
    try {
      if (live?.refreshToken) {
        revoked = await revokeRefreshToken(
          deps.fetch,
          authEndpoints(deps.authBase()).revoke,
          session.clientId,
          live.refreshToken,
          { signal: controller.signal, ...(deps.sleep ? { sleep: deps.sleep } : {}) }
        );
      }
      // The spent one as well, should OpenAI still take it for a while; its answer says nothing of the sign-in.
      if (pending) await letGo(session.clientId, tokens?.refreshToken ?? null, controller.signal);
    } finally {
      release();
    }
    // Removed whatever OpenAI said: the registration and the host id stay, for a later sign-in.
    await keep(() => updateChatGpt(dir, (c) => ({ ...c, session: null })));
    dropHeld(session.ciphertext);
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

  /* ---------------- the access token, for reviews (codex.3) ---------------- */

  function notSignedIn(reason: NotSignedInReason): AppFailure {
    return fail('chatgpt-not-signed-in', notSignedInText(reason));
  }

  /**
   * The renewal under way, shared by every request that waits on one, so a
   * sign-in's refreshes are made one at a time, as OpenAI's page on sessions
   * asks: refresh tokens rotate, and a second refresh with the same one would
   * be refused as reused.
   */
  let renewing: Promise<string> | null = null;

  /**
   * A renewal secrets.json would not take, as while a sync, backup or
   * antivirus tool held it: OpenAI had rotated the refresh token by then, so
   * it is kept for the run, under the sign-in it renewed, and written with
   * the next request rather than lost. Sign out ends its refresh token at
   * OpenAI, and it goes with the sign-in it renewed (`dropHeld`).
   */
  let held: { from: string; ciphertext: string; plan: string | null } | null = null;

  /** Write a renewal over the sign-in it renewed, only while that is still the one kept. */
  function keepRenewal(from: string, ciphertext: string, plan: string | null): Promise<ChatGptSecrets> {
    return keep(() =>
      updateChatGpt(deps.userDataDir(), (c) =>
        c.session && c.session.ciphertext === from
          ? {
              ...c,
              session: {
                ...c.session,
                ciphertext,
                plan: plan ?? c.session.plan,
                savedAt: now().toISOString()
              }
            }
          : c
      )
    );
  }

  /** A held renewal goes with the sign-in it renewed: once that is removed, nothing is held for it. */
  function dropHeld(from: string): void {
    if (held?.from === from) held = null;
  }

  /**
   * The kept sign-in and the tokens to use: a renewal held from before is
   * written over it first, and from then on the sign-in kept is that
   * renewal, so a renewal of it is compared with what the file holds (codex.3
   * review: compared with the sign-in before, it read as replaced, and the
   * new refresh token was ended at OpenAI). While secrets.json still refuses
   * it, the held tokens are used over the sign-in on disk, and a renewal of
   * them is held in its place.
   */
  async function readKept(): Promise<{
    session: Session;
    registration: Registration;
    tokens: SessionTokens;
  }> {
    // Checked: a sign-in that cannot be read is not one that is not there.
    const secrets = remember(await readChatGptChecked(deps.userDataDir()));
    let session = secrets.session;
    const registration = sessionRegistration(secrets);
    if (!session || !registration) throw notSignedIn('signed-out');
    let ciphertext = session.ciphertext;
    if (held?.from === session.ciphertext) {
      const pending = held;
      try {
        const written = await keepRenewal(pending.from, pending.ciphertext, pending.plan);
        if (written.session?.ciphertext === pending.ciphertext) {
          // Not one held since, by a renewal of this one that secrets.json refused in turn.
          if (held === pending) held = null;
          session = written.session;
        }
      } catch {
        // Still held: written with the next request.
      }
      ciphertext = pending.ciphertext;
    }
    const tokens = openTokens(deps.vault, ciphertext);
    if (!tokens) throw fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.unreadable);
    return { session, registration, tokens };
  }

  async function accessToken(options: AccessTokenOptions = {}): Promise<string> {
    const { tokens } = await readKept();
    const refused = options.rejected !== undefined && sameSecret(options.rejected, tokens.accessToken);
    if (!refused && !needsRenewal(tokens.expiresAt, now())) return tokens.accessToken;
    renewing ??= renewKept(tokens.accessToken).finally(() => {
      renewing = null;
    });
    return options.signal ? untilAborted(renewing, options.signal) : renewing;
  }

  /**
   * A renewal, from the sign-in kept as it starts, read again: one written
   * since the request read the file has spent the refresh token that read
   * holds, and OpenAI would refuse it as reused and end the sign-in (codex.3
   * review). A token that has changed since the request saw it, and is not
   * near its end, is the request's with no renewal.
   */
  async function renewKept(seen: string): Promise<string> {
    const kept = await readKept();
    if (!sameSecret(kept.tokens.accessToken, seen) && !needsRenewal(kept.tokens.expiresAt, now())) {
      return kept.tokens.accessToken;
    }
    return renew(kept.session, kept.registration, kept.tokens);
  }

  /**
   * Renew the access token with the refresh token (OpenAI's page on
   * sessions): kept, encrypted, in place of the old ones only while the kept
   * sign-in is still the one renewed. An answer that says the refresh token
   * can no longer be used ends the sign-in here; one that came for another
   * account, or without the plan's scope, is ended at OpenAI and not kept.
   * No answer or an error status keeps the sign-in: OpenAI's page says not
   * to drop one for a failure of the network or of its servers. Logged as
   * `chatgpt.refresh` with fixed words, never a token.
   */
  async function renew(session: Session, registration: Registration, tokens: SessionTokens): Promise<string> {
    const started = now().getTime();
    const dir = deps.userDataDir();
    const logRenewal = (
      outcome: 'done' | 'ended' | 'failed',
      fields: Record<string, string | number> = {}
    ): void =>
      deps.log(outcome === 'done' ? 'info' : 'warn', 'chatgpt.refresh', {
        outcome,
        ...fields,
        durationMs: now().getTime() - started
      });
    /** The kept sign-in is still the one being renewed: not signed out, nor signed in anew, meanwhile. */
    const same = (c: ChatGptSecrets): boolean => c.session?.ciphertext === session.ciphertext;

    if (!tokens.refreshToken) {
      await keep(() => updateChatGpt(dir, (c) => (same(c) ? { ...c, session: null } : c)));
      dropHeld(session.ciphertext);
      logRenewal('ended', { reason: 'no-refresh-token' });
      throw notSignedIn('ended');
    }

    const endpoints = authEndpoints(deps.authBase());
    // Not the caller's signal: a renewal cut short after OpenAI had rotated
    // the refresh token would lose the sign-in. Quitting still ends it.
    const controller = new AbortController();
    const release = deps.track?.(controller) ?? ((): void => undefined);
    let answer: FormAnswer;
    try {
      answer = await postForm(
        deps.fetch,
        endpoints.token,
        refreshFields(session.clientId, tokens.refreshToken),
        controller.signal
      );
    } catch {
      logRenewal('failed', { reason: 'no-answer' });
      throw fail('chatgpt-server', CHATGPT_REVIEW_FAILURES.renewNoAnswer);
    } finally {
      release();
    }

    if (answer.status !== 200) {
      const error = oauthError(answer.json);
      if (answer.status >= 400 && answer.status < 500 && error !== null && ENDED_REFRESH_ERRORS.has(error)) {
        // Ended: the registration stays, but one OpenAI no longer knows is not offered again.
        await keep(() =>
          updateChatGpt(dir, (c) =>
            same(c)
              ? {
                  ...c,
                  session: null,
                  lastClientId:
                    error === 'invalid_client' && c.lastClientId === session.clientId ? null : c.lastClientId
                }
              : c
          )
        );
        dropHeld(session.ciphertext);
        logRenewal('ended', { reason: error, status: answer.status });
        throw notSignedIn('ended');
      }
      logRenewal('failed', { reason: answer.status >= 500 ? 'server' : 'refused', status: answer.status });
      throw answer.status >= 500
        ? fail('chatgpt-server', renewServerText(answer.status))
        : fail('chatgpt-failed', renewRefusedText(answer.status));
    }

    const renewed = readRefreshAnswer(answer.json, now(), tokens);
    if (!renewed) {
      logRenewal('failed', { reason: 'malformed' });
      throw fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.renewMalformed);
    }
    const identity = renewed.idToken === tokens.idToken ? null : readIdTokenIdentity(renewed.idToken);
    const otherAccount =
      identity !== null && registration.subject !== null && identity.subject !== registration.subject;
    if (otherAccount || !grantsPlan(renewed.scope)) {
      await letGo(session.clientId, renewed.refreshToken, new AbortController().signal);
      await keep(() =>
        updateChatGpt(dir, (c) => {
          if (!same(c)) return c;
          const kept = c.registrations.find((r) => r.clientId === session.clientId);
          // Without the plan's use, the next sign-in asks OpenAI's page for consent again (5.7 item 5).
          return otherAccount || !kept
            ? { ...c, session: null }
            : {
                ...c,
                session: null,
                registrations: withRegistration(c.registrations, { ...kept, consentNeeded: true })
              };
        })
      );
      dropHeld(session.ciphertext);
      logRenewal('ended', { reason: otherAccount ? 'other-account' : 'no-plan-use' });
      throw notSignedIn(otherAccount ? 'ended' : 'no-plan-use');
    }

    const ciphertext = sealTokens(deps.vault, renewed);
    const plan = identity?.plan ?? null;
    let written: ChatGptSecrets;
    try {
      written = await keepRenewal(session.ciphertext, ciphertext, plan);
    } catch {
      // OpenAI has rotated the refresh token: held for the run and written with the next request.
      held = { from: session.ciphertext, ciphertext, plan };
      logRenewal('done', { kept: 'later' });
      return renewed.accessToken;
    }
    if (written.session?.ciphertext !== ciphertext) {
      // Signed out, or signed in anew, while OpenAI answered: this renewal is not kept, so OpenAI ends it.
      await letGo(session.clientId, renewed.refreshToken, new AbortController().signal);
      dropHeld(session.ciphertext);
      logRenewal('ended', { reason: written.session ? 'replaced' : 'signed-out' });
      // A sign-in made meanwhile has a token of its own, fresh, for the request.
      const fresh = written.session ? openTokens(deps.vault, written.session.ciphertext) : null;
      if (fresh && !needsRenewal(fresh.expiresAt, now())) return fresh.accessToken;
      throw notSignedIn('signed-out');
    }
    // Written: any renewal held from before is behind this one.
    held = null;
    logRenewal('done');
    return renewed.accessToken;
  }

  return { status, signIn, cancelSignIn, signOut, confirmDataSettings, accessToken };
}
