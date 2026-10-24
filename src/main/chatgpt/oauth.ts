import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_NAME } from '../../shared/branding';
import { isClientId, type SessionTokens } from './store';

/**
 * Sign in with ChatGPT's OAuth, as OpenAI's documentation for open-source apps
 * gives it (PLAN 5.7, Appendix A, read 2026-10-24): an authorization code with
 * PKCE, the answer taken on a loopback port, no client secret and no partner
 * key. The first sign-in on a computer registers the app with
 * `client_id=dynamic_agent_client`, the app's own name as `agent_name_hint`
 * and the host id; the answer carries the client id OpenAI issued, which every
 * later sign-in for that account sends instead, without the name. The app
 * names itself and no other client (CLAUDE.md rule 6's spirit; the Sign in
 * with ChatGPT terms' line on impersonation): no other header or parameter
 * says who it is.
 *
 * Nothing here logs, and nothing it returns for the page holds a token, a
 * code, the client id, the state, the nonce or the PKCE verifier.
 */

/** OpenAI's sign-in server: the issuer, and the base of every endpoint below. */
export const CHATGPT_AUTH_BASE = 'https://auth.openai.com';

/** The first sign-in's client id: OpenAI's registration entrypoint, never kept and never exchanged. */
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';

/** What the tokens are for: OpenAI's API, where the reviews go (codex.3). */
export const RESOURCE = 'https://api.openai.com/v1';

/** The scope that lets the app use the ChatGPT plan; without it a sign-in is not kept. */
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';

/** The identity scopes, the refresh token and the plan's use, in the order OpenAI's page lists them. */
export const SCOPES: readonly string[] = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  PLAN_SCOPE
];

/** Where the browser brings the answer: `http://127.0.0.1:<port>/auth/callback`, never `localhost`. */
export const CALLBACK_PATH = '/auth/callback';

export interface AuthEndpoints {
  /** what an ID token's `iss` must be */
  issuer: string;
  authorize: string;
  token: string;
  revoke: string;
  jwks: string;
}

/**
 * The endpoints under OpenAI's sign-in server, or under the development
 * switch's stand-in (`MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL`), which a packaged
 * build ignores. The paths are OpenAI's discovery document's, read 2026-10-24.
 */
export function authEndpoints(base: string | null): AuthEndpoints {
  const issuer = (base ?? CHATGPT_AUTH_BASE).replace(/\/+$/, '');
  return {
    issuer,
    authorize: `${issuer}/api/accounts/authorize`,
    token: `${issuer}/api/accounts/oauth/token`,
    revoke: `${issuer}/api/accounts/oauth/revoke`,
    jwks: `${issuer}/.well-known/jwks.json`
  };
}

/** A fresh random value for `state`, `nonce` or a PKCE verifier: 32 random bytes, base64url. */
export function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

/** The PKCE challenge for a verifier: base64url of its SHA-256, without padding (S256). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Whether two secrets are the same, in a time that does not tell how much of them matched. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** One attempt's values: fresh for every attempt, never written anywhere. */
export interface Attempt {
  state: string;
  nonce: string;
  verifier: string;
}

export function newAttempt(): Attempt {
  return { state: randomValue(), nonce: randomValue(), verifier: randomValue() };
}

export interface AuthorizationRequest {
  endpoint: string;
  /** `DYNAMIC_CLIENT_ID` for a first sign-in, else the client id kept for the account */
  clientId: string;
  hostId: string;
  redirectUri: string;
  attempt: Attempt;
  /** ask OpenAI's page for consent again, after a sign-in that did not grant the plan's use */
  consent?: boolean;
}

/**
 * The address the browser opens. A first sign-in adds the app's name as
 * `agent_name_hint`; a later one leaves it out, as OpenAI's page says.
 */
export function authorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(request.endpoint);
  const params = url.searchParams;
  params.set('client_id', request.clientId);
  if (request.clientId === DYNAMIC_CLIENT_ID) params.set('agent_name_hint', APP_NAME);
  params.set('ext_agent_host_id', request.hostId);
  params.set('response_type', 'code');
  params.set('redirect_uri', request.redirectUri);
  params.set('scope', SCOPES.join(' '));
  params.set('resource', RESOURCE);
  params.set('state', request.attempt.state);
  params.set('nonce', request.attempt.nonce);
  params.set('code_challenge_method', 'S256');
  params.set('code_challenge', pkceChallenge(request.attempt.verifier));
  if (request.consent) params.set('prompt', 'consent');
  return url.toString();
}

/** Why an answer is refused, in `signInFailureMessage`'s words (src/shared/ui/chatgpt.ts). */
export type CallbackFailure = 'denied' | 'refused' | 'registration' | 'client-mismatch';

export type CallbackReading =
  /** not this attempt's answer: told so in the browser, and the wait goes on */
  | { kind: 'not-ours' }
  | { kind: 'failed'; reason: CallbackFailure; error?: string }
  | { kind: 'code'; code: string; clientId: string; scope: string | null };

/** OpenAI's error word, kept only when it is a plain word, for the page's message. */
function errorWord(value: string): string | undefined {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/** The one value of a parameter, or null when it is missing or given twice. */
function single(query: URLSearchParams, name: string): string | null {
  const all = query.getAll(name);
  return all.length === 1 ? (all[0] ?? null) : null;
}

/**
 * The browser's answer, read as OpenAI's page says: the state first, then a
 * refusal, then the code and the client id. A first sign-in's answer must
 * carry the issued client id; a later one may leave it out, and may not name
 * another.
 */
export function readCallback(
  query: URLSearchParams,
  pending: { state: string; clientId: string }
): CallbackReading {
  const state = single(query, 'state');
  if (state === null || !sameSecret(state, pending.state)) return { kind: 'not-ours' };
  const error = single(query, 'error');
  if (error !== null) {
    const word = errorWord(error);
    return error === 'access_denied'
      ? { kind: 'failed', reason: 'denied' }
      : { kind: 'failed', reason: 'refused', ...(word ? { error: word } : {}) };
  }
  const code = single(query, 'code');
  if (!code) return { kind: 'failed', reason: 'refused' };
  const scope = single(query, 'scope');
  const given = query.getAll('client_id');
  if (pending.clientId === DYNAMIC_CLIENT_ID) {
    const issued = given.length === 1 ? given[0] : undefined;
    if (!isClientId(issued) || issued === DYNAMIC_CLIENT_ID)
      return { kind: 'failed', reason: 'registration' };
    return { kind: 'code', code, clientId: issued, scope };
  }
  if (given.some((id) => id !== pending.clientId)) return { kind: 'failed', reason: 'client-mismatch' };
  return { kind: 'code', code, clientId: pending.clientId, scope };
}

/* ------------------------------------------------------------------ */
/* The token endpoint                                                  */
/* ------------------------------------------------------------------ */

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** How long one request to the sign-in server may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

export interface FormAnswer {
  status: number;
  /** the JSON body, or null when there was none or it was not JSON */
  json: unknown;
}

/** The answer's status and its body as JSON, or null when there was none or it was not JSON. */
async function readAnswer(response: Response): Promise<FormAnswer> {
  const body = await response.text();
  let json: unknown;
  try {
    json = body.length > 0 ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

/** POST a form and read the JSON answer. Throws only when no answer came. */
export async function postForm(
  fetch: Fetch,
  url: string,
  fields: Record<string, string>,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<FormAnswer> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  });
  return readAnswer(response);
}

/**
 * GET a JSON document, such as OpenAI's signing keys, and read the answer,
 * whatever its status. Throws only when no answer came.
 */
export async function getJson(
  fetch: Fetch,
  url: string,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<FormAnswer> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  });
  return readAnswer(response);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The OAuth `error` of a refusal, such as `invalid_grant`, or null. */
export function oauthError(json: unknown): string | null {
  return isRecord(json) ? text(json['error']) : null;
}

/**
 * The tokens of a successful exchange, or null when the answer is not one: an
 * access token and an ID token are needed, the type must be Bearer, and the
 * scopes granted are the answer's, or the browser's, or, when neither says,
 * those asked for (RFC 6749 5.1).
 */
export function readTokenAnswer(
  json: unknown,
  now: Date,
  callbackScope: string | null
): SessionTokens | null {
  if (!isRecord(json)) return null;
  const accessToken = text(json['access_token']);
  const idToken = text(json['id_token']);
  if (!accessToken || !idToken) return null;
  const type = text(json['token_type']) ?? 'Bearer';
  if (type.toLowerCase() !== 'bearer') return null;
  const expiresIn = json['expires_in'];
  const seconds =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return {
    accessToken,
    refreshToken: text(json['refresh_token']),
    idToken,
    scope: text(json['scope']) ?? callbackScope ?? SCOPES.join(' '),
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString()
  };
}

/** Whether the scopes granted include the plan's use. */
export function grantsPlan(scope: string): boolean {
  return scope.split(/[\s+]+/).includes(PLAN_SCOPE);
}

/** The exchange of the browser's code for the tokens, with the verifier and the same redirect and resource. */
export function codeExchangeFields(
  code: string,
  clientId: string,
  verifier: string,
  redirectUri: string
): Record<string, string> {
  return {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: RESOURCE
  };
}

/* ------------------------------------------------------------------ */
/* Renewing the access token (codex.3)                                 */
/* ------------------------------------------------------------------ */

/**
 * A renewal of the access token, as OpenAI's page on sessions gives it
 * (Appendix A): a form POST to the token endpoint of the refresh token, the
 * issued client id and the resource, without `scope`.
 */
export function refreshFields(clientId: string, refreshToken: string): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    resource: RESOURCE
  };
}

/**
 * The errors OpenAI's page on errors and recovery lists for a refresh token
 * that can no longer be used (Appendix A, read 2026-10-24): the sign-in has
 * ended, and only signing in again brings it back. `invalid_client`, the
 * registration itself refused, ends it too.
 */
export const ENDED_REFRESH_ERRORS: ReadonlySet<string> = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
  'invalid_client'
]);

/**
 * The tokens a renewal gave, or null when the answer is not one: a new
 * access token is needed and the type must be Bearer. Refresh tokens rotate,
 * so the answer's replaces the old one; an answer without one, or without an
 * ID token or the scopes, keeps the old ones.
 */
export function readRefreshAnswer(json: unknown, now: Date, previous: SessionTokens): SessionTokens | null {
  if (!isRecord(json)) return null;
  const accessToken = text(json['access_token']);
  if (!accessToken) return null;
  const type = text(json['token_type']) ?? 'Bearer';
  if (type.toLowerCase() !== 'bearer') return null;
  const expiresIn = json['expires_in'];
  const seconds =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
  return {
    accessToken,
    refreshToken: text(json['refresh_token']) ?? previous.refreshToken,
    idToken: text(json['id_token']) ?? previous.idToken,
    scope: text(json['scope']) ?? previous.scope,
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString()
  };
}

/** How long before its end an access token is renewed rather than sent, for a clock that is a little off. */
export const RENEW_BEFORE_MS = 60_000;

/** Whether a token ending at `expiresAt` (ISO time) is to be renewed before it is sent: it ends within `RENEW_BEFORE_MS`, or its end cannot be read. */
export function needsRenewal(expiresAt: string, now: Date): boolean {
  const end = Date.parse(expiresAt);
  return Number.isNaN(end) || end - now.getTime() <= RENEW_BEFORE_MS;
}

/** How long to wait before each retry of a revocation that got no answer or a 5xx. */
export const REVOKE_BACKOFF_MS: readonly number[] = [500, 1500];

/**
 * Ask OpenAI to end a sign-in by revoking its refresh token (OpenAI's page on
 * sessions): a form POST of the token, its type and the client id. A 200 says
 * it is ended, an already ended one included. A dead connection or a 5xx is
 * tried again after `REVOKE_BACKOFF_MS`; any other answer, or running out of
 * tries, answers false, and the caller says that OpenAI did not confirm it.
 */
export async function revokeRefreshToken(
  fetch: Fetch,
  endpoint: string,
  clientId: string,
  refreshToken: string,
  options: { signal: AbortSignal; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }
): Promise<boolean> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fields = { token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId };
  for (let attempt = 0; attempt <= REVOKE_BACKOFF_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(REVOKE_BACKOFF_MS[attempt - 1] ?? 0);
    if (options.signal.aborted) return false;
    try {
      const answer = await postForm(fetch, endpoint, fields, options.signal, options.timeoutMs ?? 10_000);
      if (answer.status === 200) return true;
      if (answer.status < 500) return false;
    } catch {
      // No answer: try again while there are tries left.
    }
  }
  return false;
}
