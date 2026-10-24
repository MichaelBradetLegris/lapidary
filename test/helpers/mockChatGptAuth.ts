/**
 * A stand-in for OpenAI's sign-in server, so Sign in with ChatGPT (codex.2)
 * can be driven end to end with no ChatGPT account and no network. Dev-only:
 * nothing in `src/` imports it. It answers as OpenAI's documentation for
 * open-source apps describes the flow (PLAN 5.7, Appendix A, read 2026-10-24):
 *
 * - GET  /api/accounts/authorize      checks what the app asks, then sends the
 *                                     browser back to the app's loopback port
 *                                     with a code, as an author who signs in
 *                                     and allows the app would; a first sign-in
 *                                     (`client_id=dynamic_agent_client`) is
 *                                     issued a client id of its own
 * - POST /api/accounts/oauth/token    exchanges a code, checking the client id,
 *                                     the PKCE verifier, the redirect and the
 *                                     resource, for tokens and an RS256 ID token
 * - POST /api/accounts/oauth/revoke   ends a refresh token
 * - GET  /.well-known/jwks.json       the key the ID tokens are signed with
 * - GET  /.well-known/openid-configuration
 *
 * The scenario changes one answer (`AuthScenario`). Two ways to use it:
 *   vitest:  const mock = await startMockChatGptAuth(); ... mock.url ...
 *            mock.approve(url) plays the browser for the URL the app opened.
 *   by hand: node test/helpers/mockChatGptAuth.ts --port 4600 [--scenario ok]
 *            then start the app with MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL=http://127.0.0.1:4600
 *            (a development switch that a packaged build ignores). Under
 *            `dev:clean --shell-stub` the app prints the address it would
 *            open; GET it, follow the redirect to the app, and the app is
 *            signed in. POST /mock/scenario with a scenario's name changes the
 *            scenario, and GET /mock/requests lists what the app sent.
 *
 * The file has no relative imports so Node can run it directly.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type AuthScenario =
  /** everything as OpenAI's documentation describes it */
  | 'ok'
  /** the author does not allow the app: `error=access_denied` */
  | 'denied'
  /** the page answers with another error: `error=server_error` */
  | 'refused'
  /** the grant lacks `chatgpt.tokens.use.direct` */
  | 'noplanscope'
  /** the ID token names no plan */
  | 'noplantype'
  /** a first sign-in's answer carries no client id */
  | 'noclientid'
  /** a later sign-in's answer names another client id */
  | 'otherclient'
  /** the ID token is another account's */
  | 'othersubject'
  /** the ID token carries another nonce */
  | 'badnonce'
  /** the ID token is signed with a key the JWKS does not hold */
  | 'badsignature'
  /** the ID token has expired */
  | 'expired'
  /** the ID token names another issuer */
  | 'wrongissuer'
  /** the ID token is for another client */
  | 'wrongaudience'
  /** the token endpoint refuses the code: `invalid_grant` */
  | 'invalidgrant'
  /** the token endpoint answers 500 */
  | 'tokenerror'
  /** the token endpoint answers 200 with no ID token */
  | 'notokens'
  /** the key endpoint answers 500 */
  | 'jwksfails'
  /** the key endpoint answers 200 with a body that is not JSON */
  | 'jwksjunk'
  /** the revocation endpoint answers 500 */
  | 'revokefails';

export const AUTH_SCENARIOS: readonly AuthScenario[] = [
  'ok',
  'denied',
  'refused',
  'noplanscope',
  'noplantype',
  'noclientid',
  'otherclient',
  'othersubject',
  'badnonce',
  'badsignature',
  'expired',
  'wrongissuer',
  'wrongaudience',
  'invalidgrant',
  'tokenerror',
  'notokens',
  'jwksfails',
  'jwksjunk',
  'revokefails'
];

/** The account's email, which must never reach the log or the page. */
export const MOCK_EMAIL = 'writer@example.com';
export const MOCK_SUBJECT = 'user-mock-0001';
export const MOCK_OTHER_SUBJECT = 'user-mock-0002';
export const MOCK_KEY_ID = 'mock-key-1';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const ALL_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', PLAN_SCOPE];

export interface MockAuthRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  form: Record<string, string>;
}

/** Every secret the mock handed out, so a test can look for each in the log, the page and the file. */
export interface MockSecrets {
  codes: string[];
  accessTokens: string[];
  refreshTokens: string[];
  idTokens: string[];
}

export interface MockChatGptAuth {
  /** the issuer and the base of every endpoint, for MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL */
  url: string;
  requests: MockAuthRequest[];
  scenario: AuthScenario;
  /** the client ids issued to first sign-ins, in order */
  issued: string[];
  secrets: MockSecrets;
  /** the refresh tokens revoked */
  revoked: string[];
  /**
   * Play the browser: open the authorization address the app opened and, when
   * the mock sends it on, follow it to the app's loopback port. Answers with
   * the app's page, or the mock's own refusal.
   */
  approve: (authorizeUrl: string) => Promise<{ status: number; location: string | null; page: string }>;
  close: () => Promise<void>;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  nonce: string;
  scope: string;
  subject: string;
  used: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => resolve(text));
  });
}

function random(): string {
  return randomBytes(18).toString('base64url');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function signJwt(payload: Record<string, unknown>, key: KeyObject): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: MOCK_KEY_ID })).toString(
    'base64url'
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), key).toString('base64url');
  return `${header}.${body}.${signature}`;
}

export async function startMockChatGptAuth(
  options: { port?: number; scenario?: AuthScenario; log?: boolean } = {}
): Promise<MockChatGptAuth> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: MOCK_KEY_ID, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  let base = '';

  const mock: MockChatGptAuth = {
    url: '',
    requests: [],
    scenario: options.scenario ?? 'ok',
    issued: [],
    secrets: { codes: [], accessTokens: [], refreshTokens: [], idTokens: [] },
    revoked: [],
    approve: async (authorizeUrl) => {
      const first = await fetch(authorizeUrl, { redirect: 'manual' });
      const location = first.headers.get('location');
      if (first.status !== 302 || !location) {
        return { status: first.status, location: null, page: await first.text() };
      }
      const second = await fetch(location);
      return { status: second.status, location, page: await second.text() };
    },
    close: () => Promise.resolve()
  };

  function authorize(query: Record<string, string>, res: ServerResponse): void {
    const missing = [
      'client_id',
      'ext_agent_host_id',
      'response_type',
      'redirect_uri',
      'scope',
      'resource',
      'state',
      'nonce',
      'code_challenge',
      'code_challenge_method'
    ].filter((name) => !query[name]);
    if (missing.length > 0) return sendText(res, 400, `missing ${missing.join(', ')}`);
    const firstSignIn = query['client_id'] === 'dynamic_agent_client';
    if (firstSignIn && !query['agent_name_hint']) return sendText(res, 400, 'a first sign-in names the app');
    if (!firstSignIn && query['agent_name_hint'])
      return sendText(res, 400, 'only a first sign-in names the app');
    if (!firstSignIn && !mock.issued.includes(query['client_id'] ?? '')) {
      return sendText(res, 400, 'unknown client');
    }
    if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(query['ext_agent_host_id'] ?? '')) {
      return sendText(res, 400, 'bad host id');
    }
    if (query['response_type'] !== 'code') return sendText(res, 400, 'response_type must be code');
    const redirect = query['redirect_uri'] ?? '';
    if (!/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(redirect))
      return sendText(res, 400, 'bad redirect');
    const asked = (query['scope'] ?? '').split(' ');
    if (ALL_SCOPES.some((scope) => !asked.includes(scope))) return sendText(res, 400, 'scopes missing');
    if (query['resource'] !== RESOURCE) return sendText(res, 400, 'bad resource');
    if (query['code_challenge_method'] !== 'S256') return sendText(res, 400, 'S256 only');

    const back = new URL(redirect);
    back.searchParams.set('state', query['state'] ?? '');
    if (mock.scenario === 'denied' || mock.scenario === 'refused') {
      back.searchParams.set('error', mock.scenario === 'denied' ? 'access_denied' : 'server_error');
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    let clientId = query['client_id'] ?? '';
    if (firstSignIn) {
      clientId = `oaiapp_mock_${mock.issued.length + 1}`;
      mock.issued.push(clientId);
    }
    const scope = (mock.scenario === 'noplanscope' ? ALL_SCOPES.filter((s) => s !== PLAN_SCOPE) : ALL_SCOPES)
      .slice()
      .sort()
      .join(' ');
    const code = `code_${random()}`;
    mock.secrets.codes.push(code);
    codes.set(code, {
      clientId,
      redirectUri: redirect,
      challenge: query['code_challenge'] ?? '',
      nonce: query['nonce'] ?? '',
      scope,
      subject: mock.scenario === 'othersubject' ? MOCK_OTHER_SUBJECT : MOCK_SUBJECT,
      used: false
    });
    back.searchParams.set('code', code);
    back.searchParams.set('scope', scope);
    if (firstSignIn && mock.scenario !== 'noclientid') back.searchParams.set('client_id', clientId);
    if (!firstSignIn && mock.scenario === 'otherclient')
      back.searchParams.set('client_id', 'oaiapp_mock_other');
    res.writeHead(302, { location: back.toString() });
    res.end();
  }

  function token(form: Record<string, string>, res: ServerResponse): void {
    if (form['grant_type'] !== 'authorization_code') {
      return sendJson(res, 400, { error: 'unsupported_grant_type' });
    }
    if (mock.scenario === 'tokenerror') return sendJson(res, 500, { error: 'server_error' });
    const entry = codes.get(form['code'] ?? '');
    const verifier = form['code_verifier'] ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      !entry ||
      entry.used ||
      mock.scenario === 'invalidgrant' ||
      form['client_id'] !== entry.clientId ||
      form['redirect_uri'] !== entry.redirectUri ||
      form['resource'] !== RESOURCE ||
      challenge !== entry.challenge
    ) {
      return sendJson(res, 400, { error: 'invalid_grant' });
    }
    entry.used = true;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt(
      {
        sub: entry.subject,
        aud: RESOURCE,
        client_id: entry.clientId,
        scope: entry.scope,
        'https://api.openai.com/auth': { per_user_salt: random(), encrypted_auth_metadata: random() },
        iss: base,
        iat: now,
        exp: now + 3600,
        jti: random(),
        nbf: now
      },
      privateKey
    );
    const idToken = signJwt(
      {
        iss: mock.scenario === 'wrongissuer' ? 'https://issuer.example.com' : base,
        aud: mock.scenario === 'wrongaudience' ? 'oaiapp_someone_else' : entry.clientId,
        sub: entry.subject,
        email: MOCK_EMAIL,
        email_verified: true,
        nonce: mock.scenario === 'badnonce' ? 'not-this-attempt' : entry.nonce,
        iat: now,
        exp: mock.scenario === 'expired' ? now - 3600 : now + 3600,
        'https://api.openai.com/auth': mock.scenario === 'noplantype' ? {} : { chatgpt_plan_type: 'plus' }
      },
      mock.scenario === 'badsignature' ? stranger : privateKey
    );
    const refreshToken = `rt_mock_${random()}`;
    mock.secrets.accessTokens.push(accessToken);
    mock.secrets.refreshTokens.push(refreshToken);
    mock.secrets.idTokens.push(idToken);
    sendJson(res, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(mock.scenario === 'notokens' ? {} : { id_token: idToken }),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: entry.scope
    });
  }

  function revoke(form: Record<string, string>, res: ServerResponse): void {
    if (mock.scenario === 'revokefails') return sendJson(res, 500, { error: 'server_error' });
    if (form['token_type_hint'] !== 'refresh_token' || !form['client_id'] || !form['token']) {
      return sendJson(res, 400, { error: 'invalid_request' });
    }
    mock.revoked.push(form['token']);
    res.writeHead(200);
    res.end();
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = await readBody(req);
      const form = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(body)) : {};
      const query = Object.fromEntries(url.searchParams);
      mock.requests.push({ method: req.method ?? 'GET', path: url.pathname, query, form });
      if (options.log)
        console.log(`[mock-chatgpt-auth] ${req.method ?? ''} ${url.pathname} (${mock.scenario})`);

      if (req.method === 'GET' && url.pathname === '/api/accounts/authorize') return authorize(query, res);
      if (req.method === 'POST' && url.pathname === '/api/accounts/oauth/token') return token(form, res);
      if (req.method === 'POST' && url.pathname === '/api/accounts/oauth/revoke') return revoke(form, res);
      if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
        if (mock.scenario === 'jwksfails') return sendJson(res, 500, { error: 'server_error' });
        if (mock.scenario === 'jwksjunk') return sendText(res, 200, '<html>not the keys</html>');
        return sendJson(res, 200, { keys: [jwk] });
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        return sendJson(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/api/accounts/authorize`,
          token_endpoint: `${base}/api/accounts/oauth/token`,
          revocation_endpoint: `${base}/api/accounts/oauth/revoke`,
          jwks_uri: `${base}/.well-known/jwks.json`
        });
      }
      if (req.method === 'POST' && url.pathname === '/mock/scenario') {
        const name = body.trim() as AuthScenario;
        if (!AUTH_SCENARIOS.includes(name)) return sendText(res, 400, `no scenario ${body.trim()}`);
        mock.scenario = name;
        return sendText(res, 200, name);
      }
      if (req.method === 'GET' && url.pathname === '/mock/requests') return sendJson(res, 200, mock.requests);
      sendText(res, 404, `No mock for ${req.method ?? ''} ${url.pathname}`);
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  mock.url = base;
  mock.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return mock;
}

/* Run directly: `node test/helpers/mockChatGptAuth.ts --port 4600 [--scenario ok]`. */
const invokedDirectly = /mockChatGptAuth\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  const flag = (name: string): string | undefined => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const scenario = (flag('--scenario') ?? 'ok') as AuthScenario;
  void startMockChatGptAuth({ port: Number(flag('--port') ?? 4600), scenario, log: true }).then((mock) => {
    console.log(`[mock-chatgpt-auth] listening on ${mock.url} (${mock.scenario})`);
  });
}
