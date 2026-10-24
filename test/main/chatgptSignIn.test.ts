import { promises as fs } from 'node:fs';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatGptAuth, type ChatGptAuth, type ChatGptAuthDeps } from '../../src/main/chatgpt';
import { ensureHostId, readChatGpt, updateChatGpt } from '../../src/main/chatgpt/store';
import { AppFailure } from '../../src/main/errors';
import { abortAll, registerController } from '../../src/main/providers/controllers';
import {
  clearOpenAiKey,
  openAiKey,
  readSecrets,
  secretsPath,
  storeOpenAiKey,
  type KeyVault
} from '../../src/main/secrets';
import type { ShellApi } from '../../src/main/shellApi';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus } from '../../src/shared/ipc';
import { signInFailureMessage, type SignInFailure } from '../../src/shared/ui/chatgpt';
import {
  MOCK_EMAIL,
  MOCK_SUBJECT,
  startMockChatGptAuth,
  type MockAuthRequest,
  type MockChatGptAuth
} from '../helpers/mockChatGptAuth';

/* codex.2: Sign in with ChatGPT end to end, against a stand-in for OpenAI's
   sign-in server (test/helpers/mockChatGptAuth.ts), as OpenAI's
   documentation for open-source apps describes it (PLAN 5.7, Appendix A,
   read 2026-10-24). No agent has a ChatGPT account, so the author's own
   first sign-in is the real check (PLAN codex.2). The browser is played by
   the mock: the shell's openExternal hands it the address the app opened,
   and it follows the redirect to the app's loopback port. */

function fakeVault(available = true): KeyVault {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`VAULT:${[...plain].reverse().join('')}`, 'utf8'),
    decryptString: (buf) => {
      const text = buf.toString('utf8');
      if (!text.startsWith('VAULT:')) throw new Error('not ours');
      return [...text.slice('VAULT:'.length)].reverse().join('');
    }
  };
}

interface LogCall {
  level: string;
  event: string;
  fields: Record<string, unknown>;
}

let dir: string;
let mock: MockChatGptAuth;
let logs: LogCall[];
/** what the "browser" got back from the app, for each address it was handed */
let pages: Array<Promise<{ status: number; location: string | null; page: string }>>;
/** the addresses the app opened */
let opened: string[];
/** when false, the shell records the address but nobody signs in */
let approve: boolean;

function shell(): ShellApi {
  return {
    openExternal: (url) => {
      opened.push(url);
      if (approve) pages.push(mock.approve(url));
      return Promise.resolve();
    },
    openPath: () => Promise.resolve(''),
    showItemInFolder: () => undefined
  };
}

function auth(patch: Partial<ChatGptAuthDeps> = {}): ChatGptAuth {
  return createChatGptAuth({
    userDataDir: () => dir,
    vault: fakeVault(),
    shell,
    fetch: (input, init) => fetch(input, init),
    authBase: () => mock.url,
    log: (level, event, fields = {}) => logs.push({ level, event, fields: { ...fields } }),
    sleep: () => Promise.resolve(),
    ...patch
  });
}

/** The authorization requests the mock received, newest last. */
function authorizations(): MockAuthRequest[] {
  return mock.requests.filter((r) => r.path === '/api/accounts/authorize');
}

function tokenRequests(): MockAuthRequest[] {
  return mock.requests.filter((r) => r.path === '/api/accounts/oauth/token');
}

/** The failure a sign-in ended with. */
async function failure(promise: Promise<unknown>): Promise<AppFailure> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppFailure);
    return err as AppFailure;
  }
  throw new Error('the sign-in finished');
}

/** The page the browser was shown last. */
async function lastPage(): Promise<{ status: number; page: string }> {
  const answer = await pages.at(-1);
  if (!answer) throw new Error('no page');
  return answer;
}

/** Every value the app must never log, show or keep in plain text. */
function secrets(): string[] {
  const values = [
    ...mock.secrets.codes,
    ...mock.secrets.accessTokens,
    ...mock.secrets.refreshTokens,
    ...mock.secrets.idTokens,
    ...mock.issued,
    MOCK_EMAIL
  ];
  for (const a of authorizations()) {
    values.push(a.query['state'] ?? '', a.query['nonce'] ?? '', a.query['ext_agent_host_id'] ?? '');
  }
  for (const t of tokenRequests()) values.push(t.form['code_verifier'] ?? '');
  return values.filter((v) => v.length > 0);
}

const SIGNED_IN: ChatGptStatus = {
  signedIn: true,
  plan: 'Plus',
  dataSettingsConfirmed: false,
  signingIn: false,
  registered: true,
  encryptionAvailable: true
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-chatgpt-'));
  mock = await startMockChatGptAuth();
  logs = [];
  pages = [];
  opened = [];
  approve = true;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await mock.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('a first sign-in (codex.2)', () => {
  it('registers the app under its own name, with the host id it makes, and keeps the issued client id', async () => {
    const status = await auth().signIn({ another: false });
    expect(status).toEqual({ ...SIGNED_IN, devServer: mock.url });
    const [asked] = authorizations();
    expect(asked?.query).toMatchObject({
      client_id: 'dynamic_agent_client',
      agent_name_hint: APP_NAME,
      response_type: 'code',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource: 'https://api.openai.com/v1',
      code_challenge_method: 'S256'
    });
    expect(asked?.query['ext_agent_host_id']).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(asked?.query['redirect_uri']).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    // The code went back with the client id OpenAI issued, the verifier, and the same redirect and resource.
    expect(mock.issued).toEqual(['oaiapp_mock_1']);
    expect(tokenRequests()[0]?.form).toMatchObject({
      grant_type: 'authorization_code',
      client_id: 'oaiapp_mock_1',
      redirect_uri: asked?.query['redirect_uri'],
      resource: 'https://api.openai.com/v1'
    });
    const kept = await readChatGpt(dir);
    expect(kept.hostId).toBe(asked?.query['ext_agent_host_id']);
    expect(kept.lastClientId).toBe('oaiapp_mock_1');
    expect(kept.registrations).toEqual([
      expect.objectContaining({
        clientId: 'oaiapp_mock_1',
        subject: MOCK_SUBJECT,
        dataSettingsConfirmed: false
      })
    ]);
    expect(await lastPage()).toMatchObject({
      status: 200,
      page: expect.stringContaining('<h1>Signed in</h1>') as string
    });
  });

  it('keeps the tokens encrypted in secrets.json, never in plain text, and tells the page none of them', async () => {
    const status = await auth().signIn({ another: false });
    const onDisk = await fs.readFile(secretsPath(dir), 'utf8');
    const shown = JSON.stringify(status);
    for (const secret of secrets().filter((s) => !s.startsWith('urn:uuid:') && !s.startsWith('oaiapp_'))) {
      expect(onDisk).not.toContain(secret);
    }
    for (const secret of secrets()) expect(shown).not.toContain(secret);
    expect(shown).not.toContain(MOCK_SUBJECT);
    expect(onDisk).not.toContain(MOCK_EMAIL);
    const session = (await readChatGpt(dir)).session;
    expect(session?.plan).toBe('Plus');
    const plain = fakeVault().decryptString(Buffer.from(session?.ciphertext ?? '', 'base64'));
    expect(JSON.parse(plain)).toMatchObject({
      accessToken: mock.secrets.accessTokens[0],
      refreshToken: mock.secrets.refreshTokens[0],
      idToken: mock.secrets.idTokens[0]
    });
  });

  it('gives fresh state, nonce and PKCE values each attempt, and one host id for every attempt', async () => {
    const one = auth();
    await one.signIn({ another: false });
    await one.signOut();
    await one.signIn({ another: false });
    const [a, b] = authorizations();
    for (const name of ['state', 'nonce', 'code_challenge']) expect(a?.query[name]).not.toBe(b?.query[name]);
    expect(a?.query['ext_agent_host_id']).toBe(b?.query['ext_agent_host_id']);
    expect(a?.query['redirect_uri']).not.toBe(b?.query['redirect_uri']);
  });

  it('says signed in with no plan when the sign-in names none', async () => {
    mock.scenario = 'noplantype';
    expect(await auth().signIn({ another: false })).toMatchObject({ signedIn: true, plan: null });
  });
});

describe('a later sign-in (codex.2)', () => {
  it('reuses the client id without the name, on the same host id, after a sign-out and after a restart', async () => {
    await auth().signIn({ another: false });
    await auth().signOut();
    // A new instance stands for a restart of the app.
    expect(await auth().signIn({ another: false })).toMatchObject({ signedIn: true });
    const [first, second] = authorizations();
    expect(second?.query['client_id']).toBe('oaiapp_mock_1');
    expect(second?.query).not.toHaveProperty('agent_name_hint');
    expect(second?.query['ext_agent_host_id']).toBe(first?.query['ext_agent_host_id']);
    expect(mock.issued).toEqual(['oaiapp_mock_1']);
    expect(tokenRequests()[1]?.form['client_id']).toBe('oaiapp_mock_1');
  });

  it('registers anew for Use another account, on the same host id', async () => {
    await auth().signIn({ another: false });
    await auth().signOut();
    await auth().signIn({ another: true });
    const [first, second] = authorizations();
    expect(second?.query['client_id']).toBe('dynamic_agent_client');
    expect(second?.query['agent_name_hint']).toBe(APP_NAME);
    expect(second?.query['ext_agent_host_id']).toBe(first?.query['ext_agent_host_id']);
    expect(mock.issued).toEqual(['oaiapp_mock_1', 'oaiapp_mock_2']);
    expect((await readChatGpt(dir)).registrations.map((r) => r.clientId)).toEqual([
      'oaiapp_mock_1',
      'oaiapp_mock_2'
    ]);
  });

  it("refuses an answer that names another client id, and another account's sign-in on a kept registration", async () => {
    await auth().signIn({ another: false });
    await auth().signOut();
    mock.scenario = 'otherclient';
    expect((await failure(auth().signIn({ another: false }))).message).toBe(
      signInFailureMessage('client-mismatch')
    );
    mock.scenario = 'othersubject';
    const other = await failure(auth().signIn({ another: false }));
    expect(other.message).toBe(signInFailureMessage('other-account'));
    // The sign-in that was not kept was ended at OpenAI, after the first sign-in's at Sign out.
    expect(mock.revoked).toEqual([mock.secrets.refreshTokens[0], mock.secrets.refreshTokens.at(-1)]);
    expect((await auth().status()).signedIn).toBe(false);
  });

  it('refuses to sign in again while signed in, before the browser opens', async () => {
    await auth().signIn({ another: false });
    const again = await failure(auth().signIn({ another: false }));
    expect(again.code).toBe('invalid-input');
    expect(opened).toHaveLength(1);
  });
});

describe('a sign-in that does not finish (codex.2)', () => {
  it.each([
    ['denied', 'denied'],
    ['refused', 'refused'],
    ['noclientid', 'registration']
  ] as const)('%s: says why, in the app and the browser, and keeps nothing', async (scenario, reason) => {
    mock.scenario = scenario;
    const stop = await failure(auth().signIn({ another: false }));
    expect(stop.code).toBe('chatgpt-sign-in-failed');
    expect(stop.message).toBe(
      signInFailureMessage(reason, scenario === 'refused' ? 'server_error' : undefined)
    );
    expect(await lastPage()).toMatchObject({
      page: expect.stringContaining('<h1>Not signed in</h1>') as string
    });
    expect(tokenRequests()).toHaveLength(0);
    expect((await readChatGpt(dir)).session).toBeNull();
  });

  it.each(['badnonce', 'badsignature', 'expired', 'wrongissuer', 'wrongaudience'] as const)(
    '%s: an ID token that fails its checks is not kept',
    async (scenario) => {
      mock.scenario = scenario;
      const stop = await failure(auth().signIn({ another: false }));
      expect(stop.message).toBe(signInFailureMessage('id-token'));
      expect((await readChatGpt(dir)).session).toBeNull();
      expect((await auth().status()).signedIn).toBe(false);
    }
  );

  it('keeps the issued client id when the code is refused, and the next sign-in reuses it', async () => {
    mock.scenario = 'invalidgrant';
    expect((await failure(auth().signIn({ another: false }))).message).toBe(
      signInFailureMessage('invalid-grant')
    );
    expect((await readChatGpt(dir)).registrations).toEqual([
      expect.objectContaining({ clientId: 'oaiapp_mock_1', subject: null })
    ]);
    mock.scenario = 'ok';
    expect((await auth().signIn({ another: false })).signedIn).toBe(true);
    expect(authorizations()[1]?.query['client_id']).toBe('oaiapp_mock_1');
    expect(mock.issued).toEqual(['oaiapp_mock_1']);
  });

  /* codex.2 review: each request to OpenAI that fails says how, and which
     endpoint, and blames the connection only when no answer came. */
  it.each([
    ['tokenerror', 'server', { endpoint: 'token', status: 500 }, 'it answered with an error (status 500)'],
    ['notokens', 'malformed', { endpoint: 'token' }, 'was not in the form'],
    ['jwksfails', 'server', { endpoint: 'keys', status: 500 }, 'it answered with an error (status 500)'],
    ['jwksjunk', 'malformed', { endpoint: 'keys' }, 'was not in the form']
  ] as const)(
    '%s: says %s, in the app and the browser, logs which endpoint, and keeps no sign-in',
    async (scenario, reason, fields, words) => {
      mock.scenario = scenario;
      const stop = await failure(auth().signIn({ another: false }));
      expect(stop.code).toBe('chatgpt-sign-in-failed');
      expect(stop.message).toBe(signInFailureMessage(reason, 'status' in fields ? '500' : undefined));
      expect(stop.message).toContain(words);
      expect(stop.message).not.toContain('connection');
      const tab = await lastPage();
      expect(tab.page).toContain('<h1>Not signed in</h1>');
      expect(tab.page).toContain(words);
      expect((await readChatGpt(dir)).session).toBeNull();
      expect((await auth().status()).signedIn).toBe(false);
      // The client id came with the answer, so it is kept for the next sign-in.
      expect((await readChatGpt(dir)).registrations).toEqual([
        expect.objectContaining({ clientId: 'oaiapp_mock_1', subject: null })
      ]);
      expect(logs.find((l) => l.event === 'chatgpt.sign-in.failed')?.fields).toMatchObject({
        reason,
        ...fields
      });
    }
  );

  it.each([
    ['token', '/api/accounts/oauth/token'],
    ['keys', '/.well-known/jwks.json']
  ] as const)(
    'says no answer came, and to check the connection, when the %s request fails',
    async (endpoint, at) => {
      const stop = await failure(
        auth({
          fetch: (input, init) =>
            new URL(input).pathname === at
              ? Promise.reject(new TypeError('fetch failed'))
              : fetch(input, init)
        }).signIn({ another: false })
      );
      const reason: SignInFailure = 'no-answer';
      expect(stop.message).toBe(signInFailureMessage(reason));
      expect(stop.message).toContain('Check your connection');
      expect((await lastPage()).page).toContain('<h1>Not signed in</h1>');
      expect((await readChatGpt(dir)).session).toBeNull();
      const failed = logs.find((l) => l.event === 'chatgpt.sign-in.failed');
      expect(failed?.fields).toMatchObject({ reason, endpoint });
      expect(failed?.fields).not.toHaveProperty('status');
    }
  );

  it("ends a sign-in that did not grant the plan's use, and asks for consent next time", async () => {
    mock.scenario = 'noplanscope';
    expect((await failure(auth().signIn({ another: false }))).message).toBe(
      signInFailureMessage('no-plan-use')
    );
    expect(mock.revoked).toEqual([mock.secrets.refreshTokens[0]]);
    expect((await readChatGpt(dir)).session).toBeNull();
    mock.scenario = 'ok';
    await auth().signIn({ another: false });
    expect(authorizations()[1]?.query['prompt']).toBe('consent');
    expect((await readChatGpt(dir)).registrations[0]?.consentNeeded).toBe(false);
  });

  it('stops waiting on Cancel, and the listener is gone', async () => {
    approve = false;
    const one = auth();
    const signing = waiting(one.signIn({ another: false }));
    await waitUntil(() => opened.length === 1);
    expect((await one.status()).signingIn).toBe(true);
    one.cancelSignIn();
    expect((await failure(signing)).code).toBe('cancelled');
    expect((await one.status()).signingIn).toBe(false);
    const redirect = new URL(opened[0] ?? '').searchParams.get('redirect_uri') ?? '';
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it('replaces the sign-in waiting with a new one, whose answer counts', async () => {
    approve = false;
    const one = auth();
    const first = waiting(one.signIn({ another: false }));
    await waitUntil(() => opened.length === 1);
    approve = true;
    const second = one.signIn({ another: false });
    expect((await failure(first)).code).toBe('cancelled');
    expect((await second).signedIn).toBe(true);
  });

  it('opens no browser for a sign-in replaced before it got that far', async () => {
    const one = auth();
    const first = waiting(one.signIn({ another: false }));
    const second = one.signIn({ another: false });
    expect((await failure(first)).code).toBe('cancelled');
    expect((await second).signedIn).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it('gives up after the wait, saying so', async () => {
    approve = false;
    const stop = await failure(auth({ waitMs: 50 }).signIn({ another: false }));
    expect(stop.message).toBe(signInFailureMessage('timeout'));
  });

  it('is ended by quitting, through the controllers quitting aborts', async () => {
    approve = false;
    const signing = waiting(auth({ track: registerController }).signIn({ another: false }));
    await waitUntil(() => opened.length === 1);
    abortAll();
    expect((await failure(signing)).code).toBe('cancelled');
  });

  it('says so when the browser cannot be opened, and keeps no listener', async () => {
    const stop = await failure(
      auth({
        shell: () => ({
          openExternal: (url) => {
            opened.push(url);
            return Promise.reject(new Error('no browser'));
          },
          openPath: () => Promise.resolve(''),
          showItemInFolder: () => undefined
        })
      }).signIn({ another: false })
    );
    expect(stop.message).toBe(signInFailureMessage('browser'));
    const redirect = new URL(opened[0] ?? '').searchParams.get('redirect_uri') ?? '';
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it('refuses before anything is opened or written when Windows cannot encrypt', async () => {
    const stop = await failure(auth({ vault: fakeVault(false) }).signIn({ another: false }));
    expect(stop.code).toBe('not-configured');
    expect(opened).toEqual([]);
    await expect(fs.access(secretsPath(dir))).rejects.toThrow();
    expect((await auth({ vault: fakeVault(false) }).status()).encryptionAvailable).toBe(false);
  });
});

describe('the loopback listener (codex.2)', () => {
  /** A raw request to the listener, with any Host header. */
  function raw(
    url: string,
    options: { method?: string; host?: string } = {}
  ): Promise<{ status: number; body: string }> {
    const target = new URL(url);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: options.method ?? 'GET',
          headers: options.host ? { host: options.host } : {}
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it("answers only its own callback, from its own address, with this attempt's state", async () => {
    approve = false;
    const one = auth();
    const signing = waiting(one.signIn({ another: false }));
    await waitUntil(() => opened.length === 1);
    const redirect = new URL(opened[0] ?? '').searchParams.get('redirect_uri') ?? '';
    expect(redirect.startsWith('http://127.0.0.1:')).toBe(true);
    const { origin } = new URL(redirect);
    // OpenAI's real answer, with this attempt's state and a code, sent first
    // as a web page that rebinds a name to 127.0.0.1 would send it, then as a
    // POST: neither is taken.
    const answer = await fetch(opened[0] ?? '', { redirect: 'manual' });
    const location = answer.headers.get('location') ?? '';
    expect(location.startsWith(`${redirect}?`)).toBe(true);
    const rebound = await raw(location, { host: 'rebound.example.com' });
    expect(rebound).toEqual({ status: 400, body: '' });
    expect((await raw(location, { method: 'POST' })).status).toBe(405);
    expect((await raw(`${origin}/elsewhere`)).status).toBe(404);
    const wrong = await raw(`${redirect}?state=not-this-one&code=y`);
    expect(wrong.status).toBe(400);
    expect(wrong.body).toContain('<h1>Not this sign-in</h1>');
    expect(wrong.body).not.toContain('not-this-one');
    expect(wrong.body).not.toMatch(/<script/i);
    // The wait went on, and the same answer from the listener's own address signs in.
    const real = await raw(location);
    expect(real.status).toBe(200);
    expect(real.body).toContain('<h1>Signed in</h1>');
    expect((await signing).signedIn).toBe(true);
    expect(tokenRequests()).toHaveLength(1);
  });
});

describe('Sign out (codex.2)', () => {
  it('ends the sign-in at OpenAI and removes it here, keeping the registration and the host id', async () => {
    const one = auth();
    await one.signIn({ another: false });
    const before = await readChatGpt(dir);
    const out = await one.signOut();
    expect(out).toEqual({
      revoked: true,
      status: { ...SIGNED_IN, signedIn: false, plan: null, devServer: mock.url }
    });
    expect(mock.revoked).toEqual([mock.secrets.refreshTokens[0]]);
    const revocation = mock.requests.find((r) => r.path === '/api/accounts/oauth/revoke');
    expect(revocation?.form).toEqual({
      token: mock.secrets.refreshTokens[0],
      token_type_hint: 'refresh_token',
      client_id: 'oaiapp_mock_1'
    });
    const after = await readChatGpt(dir);
    expect(after.session).toBeNull();
    expect(after.hostId).toBe(before.hostId);
    expect(after.registrations).toEqual(before.registrations);
    const onDisk = await fs.readFile(secretsPath(dir), 'utf8');
    for (const secret of [...mock.secrets.accessTokens, ...mock.secrets.refreshTokens]) {
      expect(onDisk).not.toContain(secret);
    }
  });

  it('still removes the sign-in when OpenAI does not confirm, and says so', async () => {
    const one = auth();
    await one.signIn({ another: false });
    mock.scenario = 'revokefails';
    const out = await one.signOut();
    expect(out.revoked).toBe(false);
    expect(out.status.signedIn).toBe(false);
    expect(mock.requests.filter((r) => r.path === '/api/accounts/oauth/revoke')).toHaveLength(3);
  });

  it('stops a sign-in that is waiting', async () => {
    approve = false;
    const one = auth();
    const signing = waiting(one.signIn({ another: false }));
    await waitUntil(() => opened.length === 1);
    await one.signOut();
    expect((await failure(signing)).code).toBe('cancelled');
  });
});

describe('the data settings box (codex.2)', () => {
  it('is kept for the account: through a sign-out and a sign-in, not for another registration', async () => {
    const one = auth();
    await expect(one.confirmDataSettings(true)).rejects.toThrow(/Sign in with ChatGPT first/);
    await one.signIn({ another: false });
    expect((await one.confirmDataSettings(true)).dataSettingsConfirmed).toBe(true);
    const out = await one.signOut();
    expect(out.status.dataSettingsConfirmed).toBe(false);
    expect((await one.signIn({ another: false })).dataSettingsConfirmed).toBe(true);
    expect((await one.confirmDataSettings(false)).dataSettingsConfirmed).toBe(false);
    expect((await one.confirmDataSettings(true)).dataSettingsConfirmed).toBe(true);
    await one.signOut();
    expect((await one.signIn({ another: true })).dataSettingsConfirmed).toBe(false);
  });
});

describe('secrets.json holds the key and the sign-in side by side (codex.2)', () => {
  it('keeps each when the other is saved or removed', async () => {
    const vault = fakeVault();
    await storeOpenAiKey(vault, dir, 'sk-proj-THISISATESTKEY1234abcd', {}); // check-public: allow
    const one = auth();
    await one.signIn({ another: false });
    expect(await openAiKey(vault, dir, {})).toBe('sk-proj-THISISATESTKEY1234abcd'); // check-public: allow
    await clearOpenAiKey(vault, dir, {});
    expect((await one.status()).signedIn).toBe(true);
    await storeOpenAiKey(vault, dir, 'sk-proj-ANOTHERTESTKEY5678wxyz', {}); // check-public: allow
    await one.signOut();
    expect(await openAiKey(vault, dir, {})).toBe('sk-proj-ANOTHERTESTKEY5678wxyz'); // check-public: allow
    expect((await readSecrets(dir)).version).toBe(1);
  });
});

/* codex.2 review: a read of secrets.json that fails is never taken for an
   empty file, here as in secrets.test.ts: nothing is written and nothing is
   decided on it. */
describe('a secrets.json that cannot be read for a moment (codex.2 review)', () => {
  function busy(): NodeJS.ErrnoException {
    return Object.assign(new Error(`EBUSY: resource busy or locked, open '${secretsPath(dir)}'`), {
      code: 'EBUSY',
      errno: -4082,
      syscall: 'open',
      path: secretsPath(dir)
    });
  }

  it('writes none of the sign-in over it, so the key, the registrations and the host id stay', async () => {
    const vault = fakeVault();
    await storeOpenAiKey(vault, dir, 'sk-proj-THISISATESTKEY1234abcd', {}); // check-public: allow
    const one = auth();
    await one.signIn({ another: false });
    const kept = await readChatGpt(dir);
    const bytes = await fs.readFile(secretsPath(dir));

    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    await expect(updateChatGpt(dir, (c) => c)).rejects.toMatchObject({ code: 'io' });
    vi.restoreAllMocks();
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    await expect(one.confirmDataSettings(true)).rejects.toMatchObject({ code: 'io' });
    vi.restoreAllMocks();
    // ensureHostId's own first read is a status read: the next read finds
    // the file again, and the same host id is kept.
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    expect(await ensureHostId(dir)).toBe(kept.hostId);
    vi.restoreAllMocks();
    vi.spyOn(fs, 'readFile').mockRejectedValue(busy());
    await expect(
      ensureHostId(dir, () => 'urn:uuid:00000000-0000-4000-8000-000000000000')
    ).rejects.toMatchObject({ code: 'io' });
    vi.restoreAllMocks();

    expect(await fs.readFile(secretsPath(dir))).toEqual(bytes);
    expect(await openAiKey(vault, dir, {})).toBe('sk-proj-THISISATESTKEY1234abcd'); // check-public: allow
    expect(await readChatGpt(dir)).toEqual(kept);
  });

  it('tells the page what it last read or wrote while the file cannot be read, not "not signed in"', async () => {
    const one = auth();
    await one.signIn({ another: false });
    vi.spyOn(fs, 'readFile').mockRejectedValue(busy());
    expect(await one.status()).toEqual({ ...SIGNED_IN, devServer: mock.url });
    // A failed tick of the box changes nothing, and the page, asking again, still sees the sign-in.
    await expect(one.confirmDataSettings(true)).rejects.toMatchObject({ code: 'io' });
    expect(await one.status()).toEqual({ ...SIGNED_IN, devServer: mock.url });
    // With nothing read yet in this run, it reads as nothing kept, as before.
    expect((await auth().status()).signedIn).toBe(false);
    vi.restoreAllMocks();
    // The write reads the file and goes through; the reads after it fail, and
    // the page is told what was written, the box ticked.
    const real = fs.readFile.bind(fs);
    vi.spyOn(fs, 'readFile').mockImplementationOnce(real).mockRejectedValue(busy());
    expect((await one.confirmDataSettings(true)).dataSettingsConfirmed).toBe(true);
    expect((await one.status()).dataSettingsConfirmed).toBe(true);
    vi.restoreAllMocks();
    expect((await readChatGpt(dir)).registrations[0]?.dataSettingsConfirmed).toBe(true);
  });

  it('neither signs out nor starts a sign-in on a read that failed', async () => {
    const one = auth();
    await one.signIn({ another: false });
    const bytes = await fs.readFile(secretsPath(dir));
    vi.spyOn(fs, 'readFile').mockRejectedValue(busy());
    // Sign out: no "OpenAI ended it" for a sign-in it could not read, and no revocation.
    expect((await failure(one.signOut())).code).toBe('io');
    vi.restoreAllMocks();
    expect(mock.revoked).toEqual([]);
    expect((await one.status()).signedIn).toBe(true);
    expect(await fs.readFile(secretsPath(dir))).toEqual(bytes);

    await one.signOut();
    const before = authorizations().length;
    // A sign-in whose first read fails, once: no browser, rather than
    // registering the app again for want of the kept registration.
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(busy());
    expect((await failure(one.signIn({ another: false }))).code).toBe('io');
    vi.restoreAllMocks();
    expect(authorizations()).toHaveLength(before);
    expect(opened).toHaveLength(1);
    expect(mock.issued).toEqual(['oaiapp_mock_1']);
  });
});

describe('the log (codex.2, CLAUDE.md rule 9)', () => {
  it('records what happened, never a token, the code, the client id, the state, the nonce, the host id or the email', async () => {
    const one = auth();
    await one.signIn({ another: false });
    await one.confirmDataSettings(true);
    await one.signOut();
    mock.scenario = 'badnonce';
    await failure(one.signIn({ another: false }));
    mock.scenario = 'denied';
    await failure(one.signIn({ another: true }));
    expect(logs.map((l) => l.event)).toEqual([
      'chatgpt.sign-in.start',
      'chatgpt.sign-in.done',
      'chatgpt.data-settings',
      'chatgpt.sign-out',
      'chatgpt.sign-in.start',
      'chatgpt.sign-in.failed',
      'chatgpt.sign-in.start',
      'chatgpt.sign-in.failed'
    ]);
    expect(logs[1]?.fields).toMatchObject({ registration: 'new', plan: 'Plus' });
    expect(logs[5]?.fields).toMatchObject({ reason: 'id-token', problem: 'nonce' });
    expect(logs[7]?.fields).toMatchObject({ reason: 'denied' });
    const text = JSON.stringify(logs);
    for (const secret of secrets()) expect(text).not.toContain(secret);
    expect(text).not.toContain(MOCK_SUBJECT);
    for (const call of logs) {
      for (const value of Object.values(call.fields)) {
        expect(['string', 'number', 'boolean'].includes(typeof value) || value === null).toBe(true);
      }
    }
  });
});

/**
 * A sign-in left waiting while the test does something else: its rejection is
 * looked at later, so it is marked as handled now.
 */
function waiting<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** Wait until `test` holds, a few seconds at most. */
async function waitUntil(test: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
