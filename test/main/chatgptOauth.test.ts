import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_MS, checkIdToken } from '../../src/main/chatgpt/idToken';
import {
  CALLBACK_PATH,
  CHATGPT_AUTH_BASE,
  DYNAMIC_CLIENT_ID,
  PLAN_SCOPE,
  RESOURCE,
  REVOKE_BACKOFF_MS,
  SCOPES,
  authEndpoints,
  authorizationUrl,
  codeExchangeFields,
  grantsPlan,
  newAttempt,
  pkceChallenge,
  readCallback,
  readTokenAnswer,
  revokeRefreshToken,
  type Fetch
} from '../../src/main/chatgpt/oauth';
import { ensureHostId, normalizeChatGpt, openTokens, sealTokens } from '../../src/main/chatgpt/store';
import type { KeyVault } from '../../src/main/secrets';
import { APP_NAME } from '../../src/shared/branding';

/* codex.2: the pieces of Sign in with ChatGPT that need no server, against
   OpenAI's documentation for open-source apps as read on 2026-10-24 (PLAN
   5.7, Appendix A): the authorization address, the browser's answer, the
   token answer, the ID token's checks and the revocation's retries. The
   whole flow, against test/helpers/mockChatGptAuth.ts, is in
   chatgptSignIn.test.ts. */

const HOST_ID = 'urn:uuid:0f8e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const REDIRECT = 'http://127.0.0.1:53111/auth/callback';

describe('the endpoints (codex.2)', () => {
  it("are OpenAI's sign-in server's, or the development switch's stand-in's", () => {
    expect(authEndpoints(null)).toEqual({
      issuer: 'https://auth.openai.com',
      authorize: 'https://auth.openai.com/api/accounts/authorize',
      token: 'https://auth.openai.com/api/accounts/oauth/token',
      revoke: 'https://auth.openai.com/api/accounts/oauth/revoke',
      jwks: 'https://auth.openai.com/.well-known/jwks.json'
    });
    expect(CHATGPT_AUTH_BASE).toBe('https://auth.openai.com');
    expect(authEndpoints('http://127.0.0.1:4600/').issuer).toBe('http://127.0.0.1:4600');
    expect(authEndpoints('http://127.0.0.1:4600').token).toBe(
      'http://127.0.0.1:4600/api/accounts/oauth/token'
    );
  });
});

describe('the authorization address (codex.2)', () => {
  const attempt = { state: 'state-1', nonce: 'nonce-1', verifier: 'verifier-1' };

  it('registers the app on a first sign-in, by its own name, with the host id and fresh PKCE values', () => {
    const url = new URL(
      authorizationUrl({
        endpoint: authEndpoints(null).authorize,
        clientId: DYNAMIC_CLIENT_ID,
        hostId: HOST_ID,
        redirectUri: REDIRECT,
        attempt
      })
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/api/accounts/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'dynamic_agent_client',
      agent_name_hint: APP_NAME,
      ext_agent_host_id: HOST_ID,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge_method: 'S256',
      code_challenge: pkceChallenge('verifier-1')
    });
    // Each value once, and nothing that names another client or carries a secret.
    expect([...url.searchParams.keys()]).toHaveLength(11);
    expect(url.toString()).not.toContain('verifier-1');
  });

  it('reuses the kept client id later, without the name, and asks for consent only when told to', () => {
    const later = new URL(
      authorizationUrl({
        endpoint: authEndpoints(null).authorize,
        clientId: 'oaiapp_kept',
        hostId: HOST_ID,
        redirectUri: REDIRECT,
        attempt
      })
    );
    expect(later.searchParams.get('client_id')).toBe('oaiapp_kept');
    expect(later.searchParams.has('agent_name_hint')).toBe(false);
    expect(later.searchParams.get('ext_agent_host_id')).toBe(HOST_ID);
    expect(later.searchParams.has('prompt')).toBe(false);
    const consent = new URL(
      authorizationUrl({
        endpoint: authEndpoints(null).authorize,
        clientId: 'oaiapp_kept',
        hostId: HOST_ID,
        redirectUri: REDIRECT,
        attempt,
        consent: true
      })
    );
    expect(consent.searchParams.get('prompt')).toBe('consent');
  });

  it('asks for the identity scopes, the refresh token and the plan, for the API as the resource', () => {
    expect(SCOPES).toEqual(['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE]);
    expect(PLAN_SCOPE).toBe('chatgpt.tokens.use.direct');
    expect(RESOURCE).toBe('https://api.openai.com/v1');
    expect(CALLBACK_PATH).toBe('/auth/callback');
  });

  it('makes fresh state, nonce and verifier values each time, 32 random bytes each', () => {
    const a = newAttempt();
    const b = newAttempt();
    for (const value of [a.state, a.nonce, a.verifier]) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([a.state, a.nonce, a.verifier, b.state, b.nonce, b.verifier]).size).toBe(6);
  });

  it("computes the S256 challenge as RFC 7636's example does", () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});

describe("the browser's answer (codex.2)", () => {
  const first = { state: 'state-1', clientId: DYNAMIC_CLIENT_ID };
  const later = { state: 'state-1', clientId: 'oaiapp_kept' };
  const q = (text: string): URLSearchParams => new URLSearchParams(text);

  it("is not this attempt's without its state, with another, or with two", () => {
    expect(readCallback(q('code=c&client_id=oaiapp_1'), first)).toEqual({ kind: 'not-ours' });
    expect(readCallback(q('code=c&state=state-2&client_id=oaiapp_1'), first)).toEqual({ kind: 'not-ours' });
    expect(readCallback(q('code=c&state=state-1&state=state-1'), later)).toEqual({ kind: 'not-ours' });
  });

  it('reads a refusal after the state, keeping only a plain error word', () => {
    expect(readCallback(q('error=access_denied&state=state-1'), first)).toEqual({
      kind: 'failed',
      reason: 'denied'
    });
    expect(readCallback(q('error=server_error&state=state-1'), first)).toEqual({
      kind: 'failed',
      reason: 'refused',
      error: 'server_error'
    });
    expect(readCallback(q('error=%3Cscript%3E&state=state-1'), first)).toEqual({
      kind: 'failed',
      reason: 'refused'
    });
    expect(readCallback(q('state=state-1'), first)).toEqual({ kind: 'failed', reason: 'refused' });
  });

  it("takes a first sign-in's issued client id, and refuses one with none", () => {
    expect(readCallback(q('code=c&scope=openid&state=state-1&client_id=oaiapp_1'), first)).toEqual({
      kind: 'code',
      code: 'c',
      clientId: 'oaiapp_1',
      scope: 'openid'
    });
    for (const bad of ['', '&client_id=', '&client_id=dynamic_agent_client', '&client_id=a%20b']) {
      expect(readCallback(q(`code=c&state=state-1${bad}`), first)).toEqual({
        kind: 'failed',
        reason: 'registration'
      });
    }
  });

  it("keeps a later sign-in's client id when the answer names none, and refuses another", () => {
    expect(readCallback(q('code=c&state=state-1'), later)).toEqual({
      kind: 'code',
      code: 'c',
      clientId: 'oaiapp_kept',
      scope: null
    });
    expect(readCallback(q('code=c&state=state-1&client_id=oaiapp_kept'), later)).toMatchObject({
      kind: 'code',
      clientId: 'oaiapp_kept'
    });
    expect(readCallback(q('code=c&state=state-1&client_id=oaiapp_other'), later)).toEqual({
      kind: 'failed',
      reason: 'client-mismatch'
    });
  });
});

describe('the token answer (codex.2)', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');

  it('exchanges the code with the issued client id, the verifier and the same redirect and resource', () => {
    expect(codeExchangeFields('c', 'oaiapp_1', 'v', REDIRECT)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_1',
      code: 'c',
      code_verifier: 'v',
      redirect_uri: REDIRECT,
      resource: 'https://api.openai.com/v1'
    });
  });

  it('reads the tokens, the scopes granted and when the access token ends', () => {
    expect(
      readTokenAnswer(
        {
          access_token: 'at',
          refresh_token: 'rt',
          id_token: 'it',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct'
        },
        now,
        null
      )
    ).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'it',
      scope: 'openid chatgpt.tokens.use.direct',
      expiresAt: '2026-10-24T11:00:00.000Z'
    });
  });

  it("falls back to the browser's scopes, then to those asked for, and needs no refresh token", () => {
    const answer = { access_token: 'at', id_token: 'it', token_type: 'bearer' };
    expect(readTokenAnswer(answer, now, 'openid email')).toMatchObject({
      scope: 'openid email',
      refreshToken: null
    });
    expect(readTokenAnswer(answer, now, null)?.scope).toBe(SCOPES.join(' '));
  });

  it('is no answer without an access token or an ID token, or for another token type', () => {
    expect(readTokenAnswer({ id_token: 'it' }, now, null)).toBeNull();
    expect(readTokenAnswer({ access_token: 'at' }, now, null)).toBeNull();
    expect(readTokenAnswer({ access_token: 'at', id_token: 'it', token_type: 'mac' }, now, null)).toBeNull();
    expect(readTokenAnswer('not json', now, null)).toBeNull();
  });

  it('grants the plan only with chatgpt.tokens.use.direct among the scopes', () => {
    expect(grantsPlan('openid chatgpt.tokens.use.direct email')).toBe(true);
    expect(grantsPlan('chatgpt.tokens.use.direct+email')).toBe(true);
    expect(grantsPlan('openid email offline_access')).toBe(false);
    expect(grantsPlan('chatgpt.tokens.use.directly')).toBe(false);
  });
});

describe('revoking a refresh token (codex.2)', () => {
  function fakeFetch(statuses: Array<number | 'no answer'>): { fetch: Fetch; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      fetch: (_url, init) => {
        calls.push(typeof init.body === 'string' ? init.body : '');
        const next = statuses.shift() ?? 'no answer';
        if (next === 'no answer') return Promise.reject(new TypeError('fetch failed'));
        return Promise.resolve(new Response(next === 200 ? '' : '{}', { status: next }));
      }
    };
  }
  const run = (fetch: Fetch): Promise<boolean> =>
    revokeRefreshToken(fetch, 'https://auth.openai.com/api/accounts/oauth/revoke', 'oaiapp_1', 'rt_1', {
      signal: new AbortController().signal,
      sleep: () => Promise.resolve()
    });

  it('sends the token, its type and the client id, and takes a 200 as ended', async () => {
    const fake = fakeFetch([200]);
    expect(await run(fake.fetch)).toBe(true);
    expect(fake.calls).toEqual(['token=rt_1&token_type_hint=refresh_token&client_id=oaiapp_1']);
  });

  it('tries again after a dead connection or a 5xx, at most twice more', async () => {
    const recovers = fakeFetch(['no answer', 503, 200]);
    expect(await run(recovers.fetch)).toBe(true);
    expect(recovers.calls).toHaveLength(3);
    const never = fakeFetch([500, 500, 500, 500]);
    expect(await run(never.fetch)).toBe(false);
    expect(never.calls).toHaveLength(REVOKE_BACKOFF_MS.length + 1);
  });

  it('stops at any other answer', async () => {
    const refused = fakeFetch([400, 200]);
    expect(await run(refused.fetch)).toBe(false);
    expect(refused.calls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* The ID token                                                        */
/* ------------------------------------------------------------------ */

const ISSUER = 'https://auth.openai.com';
const CLIENT = 'oaiapp_1';
const NOW = new Date('2026-10-24T10:00:00.000Z');
const SECONDS = Math.floor(NOW.getTime() / 1000);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] };

function token(
  payload: Record<string, unknown>,
  options: { key?: KeyObject; header?: Record<string, unknown> } = {}
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', ...options.header })).toString(
    'base64url'
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), options.key ?? keys.privateKey);
  return `${header}.${body}.${signature.toString('base64url')}`;
}

const CLAIMS = {
  iss: ISSUER,
  aud: CLIENT,
  sub: 'user-1',
  email: 'writer@example.com',
  nonce: 'nonce-1',
  iat: SECONDS,
  exp: SECONDS + 3600,
  'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' }
};
const EXPECTED = { issuer: ISSUER, clientId: CLIENT, nonce: 'nonce-1', now: NOW };

describe('the ID token (codex.2)', () => {
  it('gives the account and the plan once every check passes', () => {
    expect(checkIdToken(token(CLAIMS), JWKS, EXPECTED)).toEqual({
      ok: true,
      identity: { subject: 'user-1', plan: 'Plus' }
    });
    const { ['https://api.openai.com/auth']: _auth, ...noPlan } = CLAIMS;
    expect(checkIdToken(token(noPlan), JWKS, EXPECTED)).toEqual({
      ok: true,
      identity: { subject: 'user-1', plan: null }
    });
  });

  it('takes an audience list that holds the client id, with the client as the authorised party', () => {
    expect(checkIdToken(token({ ...CLAIMS, aud: ['x', CLIENT], azp: CLIENT }), JWKS, EXPECTED).ok).toBe(true);
    expect(checkIdToken(token({ ...CLAIMS, aud: ['x', CLIENT], azp: 'x' }), JWKS, EXPECTED)).toEqual({
      ok: false,
      problem: 'audience'
    });
  });

  const PROBLEMS: Array<[string, string, string]> = [
    ['not a token', 'not.a', 'shape'],
    ['an unsigned token', `${token(CLAIMS).split('.').slice(0, 2).join('.')}.`, 'shape'],
    ['another algorithm', token(CLAIMS, { header: { alg: 'HS256' } }), 'algorithm'],
    ['a key the server does not publish', token(CLAIMS, { header: { kid: 'k9' } }), 'key'],
    ["a stranger's signature", token(CLAIMS, { key: otherKeys.privateKey }), 'signature'],
    ['another issuer', token({ ...CLAIMS, iss: 'https://issuer.example.com' }), 'issuer'],
    ['another client', token({ ...CLAIMS, aud: 'oaiapp_2' }), 'audience'],
    ['an ended token', token({ ...CLAIMS, exp: SECONDS - CLOCK_SKEW_MS / 1000 - 1 }), 'expired'],
    ['no expiry', token({ ...CLAIMS, exp: undefined }), 'expired'],
    ["another attempt's nonce", token({ ...CLAIMS, nonce: 'nonce-2' }), 'nonce'],
    ['no account', token({ ...CLAIMS, sub: '' }), 'subject']
  ];

  it.each(PROBLEMS)('refuses %s', (_label, value, problem) => {
    expect(checkIdToken(value, JWKS, EXPECTED)).toEqual({ ok: false, problem });
  });

  it('refuses a payload changed after it was signed', () => {
    const [header, , signature] = token(CLAIMS).split('.');
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, sub: 'user-2' })).toString('base64url');
    expect(checkIdToken(`${header}.${forged}.${signature}`, JWKS, EXPECTED)).toEqual({
      ok: false,
      problem: 'signature'
    });
  });

  it('lets a clock a minute slow read a token that has just ended', () => {
    expect(checkIdToken(token({ ...CLAIMS, exp: SECONDS - 60 }), JWKS, EXPECTED).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The kept part of secrets.json                                       */
/* ------------------------------------------------------------------ */

describe('the ChatGPT part of secrets.json (codex.2)', () => {
  const vault: KeyVault = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`VAULT:${[...plain].reverse().join('')}`, 'utf8'),
    decryptString: (buf) => {
      const text = buf.toString('utf8');
      if (!text.startsWith('VAULT:')) throw new Error('not ours');
      return [...text.slice('VAULT:'.length)].reverse().join('');
    }
  };

  it('reads junk, a damaged part or a sign-in without its registration as nothing', () => {
    const empty = { hostId: null, lastClientId: null, registrations: [], session: null };
    expect(normalizeChatGpt(undefined)).toEqual(empty);
    expect(normalizeChatGpt('junk')).toEqual(empty);
    expect(
      normalizeChatGpt({
        hostId: 'not-a-urn',
        lastClientId: 'oaiapp_gone',
        registrations: [{ clientId: 'bad id' }, { clientId: 'oaiapp_1', subject: 'user-1' }, 7],
        session: { clientId: 'oaiapp_2', ciphertext: 'x' }
      })
    ).toEqual({
      hostId: null,
      lastClientId: null,
      registrations: [
        {
          clientId: 'oaiapp_1',
          subject: 'user-1',
          dataSettingsConfirmed: false,
          consentNeeded: false,
          savedAt: ''
        }
      ],
      session: null
    });
  });

  it('keeps the tokens as one encrypted value, read back only through the vault', () => {
    const tokens = {
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'it',
      scope: 'openid',
      expiresAt: '2026-10-24T11:00:00.000Z'
    };
    const sealed = sealTokens(vault, tokens);
    expect(Buffer.from(sealed, 'base64').toString('utf8')).not.toContain('"accessToken":"at"');
    expect(openTokens(vault, sealed)).toEqual(tokens);
    expect(openTokens({ ...vault, decryptString: () => 'not json' }, sealed)).toBeNull();
    expect(openTokens({ ...vault, decryptString: () => '{"idToken":"it"}' }, sealed)).toBeNull();
  });

  it('makes the host id once, a urn:uuid, and keeps it', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mrev-host-'));
    try {
      const first = await ensureHostId(dir);
      expect(first).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(await ensureHostId(dir, () => 'urn:uuid:never-used')).toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
