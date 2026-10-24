import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChatGptAuth, type ChatGptAuth, type ChatGptAuthDeps } from '../../src/main/chatgpt';
import { RENEW_BEFORE_MS } from '../../src/main/chatgpt/oauth';
import { openTokens, readChatGpt } from '../../src/main/chatgpt/store';
import { AppFailure } from '../../src/main/errors';
import { createChatGptProvider } from '../../src/main/providers/chatgpt';
import { withLogging } from '../../src/main/providers/logged';
import type { ProgressPhase, ReviewProvider } from '../../src/main/providers/types';
import type { KeyVault } from '../../src/main/secrets';
import type { ShellApi } from '../../src/main/shellApi';
import { CHATGPT_LIMITS_UNKNOWN } from '../../src/shared/ai/chatgpt';
import { replyLimitMessage } from '../../src/shared/ai/replyLimit';
import type { RateLimitInfo, ReviewRequest } from '../../src/shared/ipc';
import { renderChapter } from '../../src/shared/prompt/chapter';
import { buildSystemPrompt } from '../../src/shared/prompt/system';
import { normalizeText } from '../../src/shared/text/eol';
import { chapterStats } from '../../src/shared/text/stats';
import {
  CHATGPT_REVIEW_FAILURES,
  DATA_SETTINGS_GATE_TEXT,
  notSignedInText,
  renewServerText
} from '../../src/shared/ui/chatgpt';
import { describeRateLimit } from '../../src/shared/ui/usage';
import { MOCK_EMAIL, startMockChatGptAuth, type MockChatGptAuth } from '../helpers/mockChatGptAuth';
import {
  CANNED_REVIEW,
  CHATGPT_REFUSED_PARAMETERS,
  PROSE_REPLY,
  startMockOpenAi,
  type MockOpenAi,
  type RecordedRequest
} from '../helpers/mockOpenAi';

/* codex.3: a review on the author's ChatGPT plan, end to end, against the two
   stand-ins: test/helpers/mockChatGptAuth.ts for OpenAI's sign-in server,
   which signs the app in and renews its tokens, and test/helpers/mockOpenAi.ts,
   whose ChatGPT route answers a sign-in's access token as OpenAI's pages on
   models and inference, preview limitations and errors describe it (PLAN 5.8,
   Appendix A). No ChatGPT account and no network: the author's own review on
   a Plus plan is the real check. */

const SAMPLE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'samples',
  'manuscript',
  'Chapter 01 - The Flood.md'
);

function fakeVault(): KeyVault {
  return {
    isEncryptionAvailable: () => true,
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

let authMock: MockChatGptAuth;
let api: MockOpenAi;
let chapter: string;
let dir: string;
let logs: LogCall[];
/** Set to make the sign-in server's renewals wait, or fail to arrive, for a test. */
let tokenFetch: ((input: string, init: RequestInit) => Promise<Response>) | null;

beforeAll(async () => {
  authMock = await startMockChatGptAuth();
  api = await startMockOpenAi();
  chapter = normalizeText(await fs.readFile(SAMPLE, 'utf8')).text;
});

afterAll(async () => {
  await authMock.close();
  await api.close();
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-chatgpt-review-'));
  logs = [];
  tokenFetch = null;
  authMock.scenario = 'ok';
  authMock.apiScenario = '';
  api.chatGptScenario = null;
  api.requests.length = 0;
  authMock.requests.length = 0;
  authMock.renewed.length = 0;
  authMock.revoked.length = 0;
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const vault = fakeVault();

/**
 * The browser: the shell hands the mock the address the app opened, and the
 * mock follows it back. Not waited for: the app answers the browser's tab only
 * once it has the answer, after the shell has returned.
 */
const shell: ShellApi = {
  openExternal: (url) => {
    void authMock.approve(url).catch(() => undefined);
    return Promise.resolve();
  },
  openPath: () => Promise.resolve(''),
  showItemInFolder: () => undefined
};

function auth(patch: Partial<ChatGptAuthDeps> = {}): ChatGptAuth {
  return createChatGptAuth({
    userDataDir: () => dir,
    vault,
    shell: () => shell,
    fetch: (input, init) => {
      const refresh = typeof init.body === 'string' && init.body.includes('grant_type=refresh_token');
      return refresh && tokenFetch ? tokenFetch(input, init) : fetch(input, init);
    },
    authBase: () => authMock.url,
    log: (level, event, fields = {}) => logs.push({ level, event, fields: { ...fields } }),
    sleep: () => Promise.resolve(),
    ...patch
  });
}

function provider(session: ChatGptAuth): ReviewProvider {
  return createChatGptProvider({ session: () => session, baseUrl: () => api.url });
}

/** Signed in with the plan, the data settings box ticked unless said otherwise. */
async function signedIn(options: { confirmed?: boolean } = {}): Promise<ChatGptAuth> {
  const session = auth();
  await session.signIn({ another: false });
  if (options.confirmed !== false) await session.confirmDataSettings(true);
  return session;
}

function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    requestId: 'req-chatgpt',
    provider: 'chatgpt',
    sourcePath: 'C:/vault/Chapter 01 - The Flood.md',
    text: chapter,
    model: '',
    effort: 'medium',
    guidelines: '# Guidelines\n\nUse British spelling.',
    ...overrides
  };
}

function hooks(signal = new AbortController().signal): {
  phases: ProgressPhase[];
  notices: RateLimitInfo[];
  onProgress: (phase: ProgressPhase, outputTokens?: number) => void;
  onRateLimit: (info: RateLimitInfo) => void;
  signal: AbortSignal;
} {
  const phases: ProgressPhase[] = [];
  const notices: RateLimitInfo[] = [];
  return {
    phases,
    notices,
    signal,
    onProgress: (phase) => phases.push(phase),
    onRateLimit: (info) => notices.push(info)
  };
}

async function failure(promise: Promise<unknown>): Promise<AppFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppFailure) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

/** The requests the ChatGPT route got, by path. */
function apiRequests(pathname: string): RecordedRequest[] {
  return api.requests.filter((r) => r.path === pathname);
}

/** The renewals the sign-in server got. */
function renewals(): Array<Record<string, string>> {
  return authMock.requests
    .filter((r) => r.path === '/api/accounts/oauth/token' && r.form['grant_type'] === 'refresh_token')
    .map((r) => r.form);
}

async function keptTokens(): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const session = (await readChatGpt(dir)).session;
  return session ? openTokens(vault, session.ciphertext) : null;
}

describe('the model list a ChatGPT sign-in allows (codex.3)', () => {
  it('lists the models OpenAI shows, in its order, by their names, the first that is not a codex model as the default', async () => {
    const session = await signedIn();
    const list = await provider(session).models();
    expect(list).toEqual([
      { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex', description: 'gpt-5.5-codex' },
      { value: 'gpt-5.5', label: 'GPT-5.5 (default)', isDefault: true, description: 'gpt-5.5' },
      { value: 'gpt-5-mini', label: 'GPT-5 mini', description: 'gpt-5-mini' }
    ]);
    const [asked] = apiRequests('/v1/models');
    // The sign-in's access token as the bearer, as OpenAI's page says.
    expect(asked?.authorization).toBe(`Bearer ${authMock.secrets.accessTokens.at(-1) ?? ''}`);
  });

  it('is empty when the plan lists none, and a review with no model chosen then says so', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'nomodels';
    expect(await provider(session).models()).toEqual([]);
    const failed = await failure(provider(session).review(request(), hooks()));
    expect(failed.code).toBe('chatgpt-failed');
    expect(failed.message).toBe(CHATGPT_REVIEW_FAILURES.noModels);
    expect(apiRequests('/v1/responses')).toHaveLength(0);
  });
});

describe('a review on the plan (codex.3)', () => {
  it("sends the API key's streamed, store: false request, with the chapter as one user message and the bearer", async () => {
    const session = await signedIn();
    const watch = hooks();
    const result = await provider(session).review(request(), watch);
    expect(result.output.changes).toHaveLength(CANNED_REVIEW.changes.length);
    expect(result.output.comments).toHaveLength(CANNED_REVIEW.comments.length);
    // The list's default, answered as itself; a plan has no cost per token.
    expect(result.model).toBe('gpt-5.5');
    expect(result.costUsd).toBeUndefined();
    expect(watch.phases).toEqual(
      expect.arrayContaining(['starting', 'thinking', 'streaming', 'parsing', 'done'])
    );

    const [sent] = apiRequests('/v1/responses');
    expect(sent?.authorization).toBe(`Bearer ${authMock.secrets.accessTokens.at(-1) ?? ''}`);
    const body = sent?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      instructions: buildSystemPrompt(request().guidelines),
      input: [{ role: 'user', content: renderChapter(chapter, 'Chapter 01 - The Flood') }],
      reasoning: { effort: 'medium' },
      text: { format: { type: 'json_schema', name: 'manuscript_review', strict: true } },
      store: false,
      stream: true
    });
    // None of what the route refuses (OpenAI's page on preview limitations).
    for (const name of CHATGPT_REFUSED_PARAMETERS) expect(body, name).not.toHaveProperty(name);
  });

  it('sends the model chosen, when one is, without listing the models', async () => {
    const session = await signedIn();
    const result = await provider(session).review(request({ model: 'gpt-5-mini' }), hooks());
    expect(result.model).toBe('gpt-5-mini');
    expect(apiRequests('/v1/models')).toHaveLength(0);
  });

  it("reads the plan's limits from the answer, and words them as Claude's are from 80%", async () => {
    const session = await signedIn();
    api.chatGptScenario = 'nearlimit';
    const watch = hooks();
    const result = await provider(session).review(request(), watch);
    expect(watch.notices).toHaveLength(1);
    const [notice] = watch.notices;
    expect(notice).toMatchObject({
      provider: 'chatgpt',
      status: 'allowed',
      kind: 'five_hour',
      utilization: 0.85
    });
    expect(result.rateLimit).toEqual(notice);
    const reset = new Date(notice?.resetsAt ?? '');
    expect(reset.getTime() - Date.now()).toBeGreaterThan(90 * 60 * 1000);
    expect(describeRateLimit(notice, new Date())).toMatch(/^5-hour limit 85% used, resets \d\d:\d\d$/);
  });

  it('takes the scenario from the token, keyed as an API key picks its own', async () => {
    authMock.apiScenario = 'weeklylimit';
    const session = await signedIn();
    const watch = hooks();
    await provider(session).review(request(), watch);
    // The weekly limit reached (the 5-hour one at 30%) is the one that matters.
    expect(watch.notices[0]).toMatchObject({ provider: 'chatgpt', status: 'rejected', kind: 'seven_day' });
    expect(describeRateLimit(watch.notices[0], new Date())).toMatch(/^Weekly limit reached, resets /);
  });

  it('clears an earlier notice with one that says nothing when the answer carries no limits', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'noheaders';
    const watch = hooks();
    await provider(session).review(request(), watch);
    expect(watch.notices).toEqual([{ ...CHATGPT_LIMITS_UNKNOWN }]);
    expect(describeRateLimit(watch.notices[0], new Date())).toBeNull();
  });
});

describe('the gate before a review (codex.3, PLAN 5.7 item 7)', () => {
  it('is not signed in, and sends nothing, when no sign-in is kept', async () => {
    const failed = await failure(provider(auth()).review(request(), hooks()));
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('signed-out'));
    expect(api.requests).toHaveLength(0);
  });

  it('refuses the first review until the account has ticked I have confirmed my data settings', async () => {
    const session = await signedIn({ confirmed: false });
    const failed = await failure(provider(session).review(request(), hooks()));
    expect(failed.code).toBe('chatgpt-data-settings');
    expect(failed.message).toBe(DATA_SETTINGS_GATE_TEXT);
    expect(api.requests).toHaveLength(0);
    await session.confirmDataSettings(true);
    await expect(provider(session).review(request(), hooks())).resolves.toBeDefined();
  });
});

describe('renewing the access token (codex.3)', () => {
  it('renews an ended access token first, keeps the rotated refresh token, and sends the new one', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    const before = await keptTokens();
    await provider(session).review(request(), hooks());
    // One renewal, as OpenAI's page on sessions gives it: no scope.
    expect(renewals()).toEqual([
      {
        grant_type: 'refresh_token',
        client_id: authMock.issued.at(-1),
        refresh_token: before?.refreshToken,
        resource: 'https://api.openai.com/v1'
      }
    ]);
    const after = await keptTokens();
    expect(after?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    for (const sent of apiRequests('/v1/responses')) {
      expect(sent.authorization).toBe(`Bearer ${after?.accessToken ?? ''}`);
    }
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'chatgpt.refresh',
        fields: expect.objectContaining({ outcome: 'done' }) as unknown
      })
    );
  });

  it('makes one renewal for requests that need it at once', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    const tokens = await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(renewals()).toHaveLength(1);
  });

  it('renews once a token the API refused with a 401, and sends the request again', async () => {
    authMock.scenario = 'staleaccess';
    const session = await signedIn();
    authMock.scenario = 'ok';
    const result = await provider(session).review(request({ model: 'gpt-5.5' }), hooks());
    expect(result.output.changes.length).toBeGreaterThan(0);
    const sent = apiRequests('/v1/responses');
    expect(sent).toHaveLength(2);
    expect(sent[0]?.authorization).not.toBe(sent[1]?.authorization);
    expect(renewals()).toHaveLength(1);
  });

  it('says a request OpenAI still refuses after the renewal failed, keeping the sign-in', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'invaliduser';
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(failed.code).toBe('chatgpt-failed');
    expect(failed.message).toBe(CHATGPT_REVIEW_FAILURES.signInNotAccepted);
    expect(renewals()).toHaveLength(1);
    expect((await session.status()).signedIn).toBe(true);
  });

  it('shows a sign-in OpenAI will no longer renew as not signed in, keeping the registration', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refreshfails';
    const failed = await failure(provider(session).review(request(), hooks()));
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('ended'));
    expect(api.requests).toHaveLength(0);
    const status = await session.status();
    expect(status.signedIn).toBe(false);
    expect(status.registered).toBe(true);
    expect(logs).toContainEqual({
      level: 'warn',
      event: 'chatgpt.refresh',
      fields: expect.objectContaining({ outcome: 'ended', reason: 'invalid_grant', status: 400 }) as unknown
    });
  });

  it("ends it for an expired refresh token too, as OpenAI's page names it", async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refreshexpired';
    expect((await failure(session.accessToken())).code).toBe('chatgpt-not-signed-in');
    expect((await session.status()).signedIn).toBe(false);
  });

  it('keeps the sign-in when the renewal meets a server error or no answer', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refresherror';
    const server = await failure(provider(session).review(request(), hooks()));
    expect(server.code).toBe('chatgpt-server');
    expect(server.message).toBe(renewServerText(500));
    expect((await session.status()).signedIn).toBe(true);

    authMock.scenario = 'ok';
    tokenFetch = () => Promise.reject(new TypeError('fetch failed'));
    const gone = await failure(session.accessToken());
    expect(gone.code).toBe('chatgpt-server');
    expect(gone.message).toBe(CHATGPT_REVIEW_FAILURES.renewNoAnswer);
    expect((await session.status()).signedIn).toBe(true);
  });

  it('drops a renewal without the plan, ending it at OpenAI, and asks for consent at the next sign-in', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refreshnoplan';
    const failed = await failure(session.accessToken());
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('no-plan-use'));
    expect(authMock.revoked).toContain(authMock.secrets.refreshTokens.at(-1));
    authMock.scenario = 'ok';
    await session.signIn({ another: false });
    const asked = authMock.requests.filter((r) => r.path === '/api/accounts/authorize').at(-1);
    expect(asked?.query['prompt']).toBe('consent');
  });

  it('takes the plan a renewal names', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refreshpro';
    await session.accessToken();
    expect((await session.status()).plan).toBe('Pro');
  });

  it('keeps no renewal made while the sign-in was ended, and ends it at OpenAI', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // OpenAI renews it, and its answer arrives only after the sign-out.
    tokenFetch = async (input, init) => {
      const answer = await fetch(input, init);
      await held;
      return answer;
    };
    const asking = session.accessToken();
    while (authMock.renewed.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    await session.signOut();
    release();
    const failed = await failure(asking);
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('signed-out'));
    expect((await session.status()).signedIn).toBe(false);
    // The renewal's own refresh token, which nothing keeps, is ended at OpenAI.
    expect(authMock.revoked).toContain(authMock.secrets.refreshTokens.at(-1));
    expect(await keptTokens()).toBeNull();
  });

  it('keeps a sign-in made while a renewal was under way, and gives the request its token', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    tokenFetch = async (input, init) => {
      const answer = await fetch(input, init);
      await held;
      return answer;
    };
    const asking = session.accessToken();
    while (authMock.renewed.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const renewal = authMock.secrets.refreshTokens.at(-1);
    await session.signOut();
    await session.signIn({ another: false });
    const kept = await keptTokens();
    release();
    // The new sign-in's own token, which the renewal is not written over; the renewal ends at OpenAI.
    expect(await asking).toBe(kept?.accessToken);
    expect(await keptTokens()).toEqual(kept);
    expect(authMock.revoked).toContain(renewal);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'chatgpt.refresh',
        fields: expect.objectContaining({ outcome: 'ended', reason: 'replaced' }) as unknown
      })
    );
  });

  it('ends a renewal for another account, and keeps nothing of it', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'refreshotheraccount';
    const failed = await failure(session.accessToken());
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('ended'));
    expect((await session.status()).signedIn).toBe(false);
    expect(authMock.revoked).toContain(authMock.secrets.refreshTokens.at(-1));
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'chatgpt.refresh',
        fields: expect.objectContaining({ outcome: 'ended', reason: 'other-account' }) as unknown
      })
    );
  });

  it('finishes a renewal the review stopped waiting for, so the rotated token is not lost', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    tokenFetch = async (input, init) => {
      await held;
      return fetch(input, init);
    };
    const stop = new AbortController();
    const asking = session.accessToken({ signal: stop.signal });
    stop.abort();
    await expect(asking).rejects.toThrow();
    release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await keptTokens())?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
  });

  it('holds a renewal secrets.json would not take, and writes it with the next request, so the rotated token is not lost', async () => {
    authMock.scenario = 'shortlived';
    let refuseWrites = false;
    const session = auth({
      // The way a sync tool holding secrets.json refuses a write (codex.2 review).
      write: (work) => (refuseWrites ? Promise.reject(new Error('secrets.json is held')) : work())
    });
    await session.signIn({ another: false });
    await session.confirmDataSettings(true);
    authMock.scenario = 'ok';
    const before = await keptTokens();
    refuseWrites = true;
    const renewed = await session.accessToken();
    // OpenAI rotated it, the file still holds the old one, and the review goes on.
    expect(renewals()).toHaveLength(1);
    expect((await keptTokens())?.refreshToken).toBe(before?.refreshToken);
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'chatgpt.refresh',
        fields: expect.objectContaining({ outcome: 'done', kept: 'later' }) as unknown
      })
    );
    // The next request, the file free again, writes it, and needs no renewal of its own.
    refuseWrites = false;
    expect(await session.accessToken()).toBe(renewed);
    expect((await keptTokens())?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
    expect(renewals()).toHaveLength(1);
  });

  it(`renews a token before it ends, within ${RENEW_BEFORE_MS / 1000} s of its end, and not long before`, async () => {
    const session = await signedIn();
    const kept = await keptTokens();
    await session.accessToken();
    expect(renewals()).toHaveLength(0);
    expect(await session.accessToken()).toBe(kept?.accessToken);
  });
});

describe("the plan's errors (codex.3, OpenAI's page on errors and recovery)", () => {
  it('stops at the usage limit, says so, and passes the limit that was reached to the status bar', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'usagelimit';
    const watch = hooks();
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), watch));
    expect(failed.code).toBe('chatgpt-usage-limit');
    expect(failed.message).toBe(CHATGPT_REVIEW_FAILURES.usageLimit);
    expect(watch.notices.at(-1)).toMatchObject({
      provider: 'chatgpt',
      status: 'rejected',
      kind: 'five_hour'
    });
    expect(describeRateLimit(watch.notices.at(-1), new Date())).toMatch(/^5-hour limit reached, resets /);
  });

  it("names no limit and no reset when the refusal carries none, as OpenAI's page warns", async () => {
    const session = await signedIn();
    api.chatGptScenario = 'usagelimitbare';
    const watch = hooks();
    expect((await failure(provider(session).review(request({ model: 'gpt-5.5' }), watch))).code).toBe(
      'chatgpt-usage-limit'
    );
    expect(watch.notices.at(-1)).toEqual({ provider: 'chatgpt', status: 'rejected' });
    expect(describeRateLimit(watch.notices.at(-1), new Date())).toBe('Usage limit reached');
  });

  it('stops a reply that reaches the limit while it streams', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'usagelimitstream';
    const watch = hooks();
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), watch));
    expect(failed.code).toBe('chatgpt-usage-limit');
    expect(failed.message).toBe(CHATGPT_REVIEW_FAILURES.usageLimitDuring);
    expect(watch.notices.at(-1)).toMatchObject({ status: 'rejected', kind: 'five_hour' });
  });

  it('says plainly when the route refuses structured output, the open question of codex.3', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'noschema';
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(failed.code).toBe('chatgpt-failed');
    expect(failed.message).toBe(CHATGPT_REVIEW_FAILURES.structuredOutput);
    expect(failed.detail).toContain('Structured output is not supported.');
  });

  it('says an account that may not use its plan here, and usage that is not available, each in its words', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'noteligible';
    const notEligible = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(notEligible).toMatchObject({
      code: 'chatgpt-failed',
      message: CHATGPT_REVIEW_FAILURES.notEligible
    });
    api.chatGptScenario = 'unavailable';
    const unavailable = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(unavailable).toMatchObject({
      code: 'chatgpt-server',
      message: CHATGPT_REVIEW_FAILURES.usageUnavailable
    });
  });

  it("says a reply of the wrong shape without quoting it, and a reply cut off at the model's limit", async () => {
    const session = await signedIn();
    api.chatGptScenario = 'prose';
    const prose = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(prose.code).toBe('chatgpt-invalid-output');
    expect(prose.message).not.toContain(PROSE_REPLY.slice(0, 40));
    api.chatGptScenario = 'outputlimit';
    const cut = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(cut.code).toBe('chatgpt-failed');
    expect(cut.message).toBe(
      replyLimitMessage('output', {
        who: 'gpt-5.5',
        maxTokens: 128_000,
        words: chapterStats(chapter).words,
        effort: 'medium'
      })
    );
  });

  it('is cancelled by Cancel', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'slow';
    const stop = new AbortController();
    const running = provider(session).review(request({ model: 'gpt-5.5' }), hooks(stop.signal));
    setTimeout(() => stop.abort(), 300);
    expect((await failure(running)).code).toBe('cancelled');
  });
});

describe('the runtime, and the log (codex.3)', () => {
  it('is ready with the plan while signed in, and not signed in otherwise, reading only the file', async () => {
    expect(await provider(auth()).runtime()).toMatchObject({ provider: 'chatgpt', state: 'not-signed-in' });
    const session = await signedIn();
    expect(await provider(session).runtime()).toMatchObject({
      provider: 'chatgpt',
      state: 'ready',
      plan: 'Plus'
    });
    expect(api.requests).toHaveLength(0);
  });

  it('logs the renewals and the review as fixed words and counts, never a token or the email', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    const lines: string[] = [];
    const logged = withLogging(provider(session), {
      log: (level, event, fields = {}) => lines.push(`${level} ${event} ${JSON.stringify(fields)}`)
    });
    await logged.runtime();
    await logged.review(request(), hooks());
    api.chatGptScenario = 'usagelimit';
    await failure(logged.review(request({ model: 'gpt-5.5' }), hooks()));
    const all = [...lines, ...logs.map((l) => `${l.level} ${l.event} ${JSON.stringify(l.fields)}`)].join(
      '\n'
    );
    expect(all).toContain('ai.review.done');
    expect(all).toContain('"plan":"Plus"');
    const secrets = [
      ...authMock.secrets.accessTokens,
      ...authMock.secrets.refreshTokens,
      ...authMock.secrets.idTokens,
      ...authMock.issued,
      MOCK_EMAIL
    ];
    for (const secret of secrets) expect(all).not.toContain(secret);
  });
});

describe("the mock's ChatGPT route holds the app to OpenAI's rules (codex.3)", () => {
  it('refuses what the route does not take, and a token that has ended', async () => {
    const session = await signedIn();
    const token = await session.accessToken();
    const post = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${api.url}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    const ok = { model: 'gpt-5.5', input: [{ role: 'user', content: 'x' }], store: false, stream: true };
    for (const [body, param] of [
      [{ ...ok, max_output_tokens: 100 }, 'max_output_tokens'],
      [{ ...ok, temperature: 0.2 }, 'temperature'],
      [{ ...ok, store: true }, 'store'],
      [{ ...ok, stream: false }, 'stream'],
      [{ ...ok, input: 'x' }, 'input'],
      [{ ...ok, input: [{ role: 'system', content: 'x' }] }, 'input']
    ] as const) {
      const answer = await post(body);
      expect(answer.status, param).toBe(400);
      expect(((await answer.json()) as { error: { code: string; param: string } }).error).toMatchObject({
        code: 'subscription_sharing_unsupported_capability',
        param
      });
    }
    const [header = '', payload = '', signature = ''] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    const ended = Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString('base64url');
    const refused = await fetch(`${api.url}/models`, {
      headers: { authorization: `Bearer ${header}.${ended}.${signature}` }
    });
    expect(refused.status).toBe(401);
  });
});
