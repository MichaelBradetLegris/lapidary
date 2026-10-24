import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatGptAuth, type ChatGptAuth, type ChatGptAuthDeps } from '../../src/main/chatgpt';
import { RENEW_BEFORE_MS } from '../../src/main/chatgpt/oauth';
import { openTokens, readChatGpt } from '../../src/main/chatgpt/store';
import type * as StoreModule from '../../src/main/chatgpt/store';
import { APP_NAME } from '../../src/shared/branding';
import { AppFailure } from '../../src/main/errors';
import { createChatGptProvider } from '../../src/main/providers/chatgpt';
import { withLogging } from '../../src/main/providers/logged';
import type { ProgressPhase, ReviewProvider } from '../../src/main/providers/types';
import type { KeyVault } from '../../src/main/secrets';
import type { ShellApi } from '../../src/main/shellApi';
import { CHATGPT_LIMITS_UNKNOWN } from '../../src/shared/ai/chatgpt';
import { replyLimitMessage } from '../../src/shared/ai/replyLimit';
import type { RateLimitInfo, ReviewRequest } from '../../src/shared/ipc';
import { fromPromptNumbering, renderChapter } from '../../src/shared/prompt/chapter';
import { buildSystemPrompt } from '../../src/shared/prompt/system';
import { createAiReview, toChangeCategory } from '../../src/shared/review';
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
  CHATGPT_SCENARIOS,
  MOCK_OUTPUT_LIMIT,
  OBSIDIAN_REVIEW,
  PROSE_REPLY,
  UNVERIFIED_STREAM_MESSAGE,
  chatGptScenarioFor,
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

/* The checked read of secrets.json, as it is, but for one test that holds a
   read's answer back (`readGate.next`) until another request's renewal has
   been written, to show a read that came before that write is not used to
   renew again (codex.3 review). */
const readGate = vi.hoisted(() => ({ next: null as Promise<void> | null }));
vi.mock('../../src/main/chatgpt/store', async (importOriginal) => {
  const real = await importOriginal<typeof StoreModule>();
  return {
    ...real,
    readChatGptChecked: async (dir: string) => {
      const gate = readGate.next;
      readGate.next = null;
      const read = await real.readChatGptChecked(dir);
      if (gate) await gate;
      return read;
    }
  };
});

const SAMPLE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'samples',
  'manuscript',
  'Chapter 01 - The Flood.md'
);
const OBSIDIAN_SAMPLE = path.join(path.dirname(SAMPLE), 'Chapter 03 - Obsidian.md');

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
  readGate.next = null;
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
  it('sends the streamed, store: false Responses request, with the chapter as one user message and the bearer', async () => {
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

  it("takes the scenario from the token's mock_scenario claim, which the sign-in mock puts in its tokens", async () => {
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

  /**
   * Signed in with a token about to end, with secrets.json refusing writes
   * while `refuse.on`, or the next `refuse.next` writes, and a clock the test
   * moves.
   */
  async function heldSession(): Promise<{
    session: ChatGptAuth;
    refuse: { on: boolean; next: number };
    clock: { at: number };
  }> {
    authMock.scenario = 'shortlived';
    const refuse = { on: false, next: 0 };
    const clock = { at: Date.now() };
    const session = auth({
      write: (work) => {
        if (refuse.next > 0) refuse.next -= 1;
        else if (!refuse.on) return work();
        return Promise.reject(new Error('secrets.json is held'));
      },
      now: () => new Date(clock.at)
    });
    await session.signIn({ another: false });
    await session.confirmDataSettings(true);
    authMock.scenario = 'ok';
    return { session, refuse, clock };
  }

  it('renews a held renewal that has ended by the next request from the sign-in it was written as, and keeps it (codex.3 review)', async () => {
    const { session, refuse, clock } = await heldSession();
    refuse.on = true;
    await session.accessToken();
    refuse.on = false;
    // The next review comes two hours later: the held token has ended by then.
    clock.at += 2 * 60 * 60 * 1000;
    const token = await session.accessToken();
    expect(token).toBe(authMock.secrets.accessTokens.at(-1));
    expect(renewals()).toHaveLength(2);
    expect(authMock.revoked).toEqual([]);
    expect((await keptTokens())?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
    expect((await session.status()).signedIn).toBe(true);
    // And the request after that takes it as it is.
    expect(await session.accessToken()).toBe(token);
    expect(renewals()).toHaveLength(2);
    expect(
      logs.filter((l) => l.event === 'chatgpt.refresh').map((l) => [l.fields['outcome'], l.fields['kept']])
    ).toEqual([
      ['done', 'later'],
      ['done', undefined]
    ]);
  });

  it('renews a held renewal OpenAI refuses with a 401 from the sign-in it was written as, and keeps it (codex.3 review)', async () => {
    const { session, refuse } = await heldSession();
    refuse.on = true;
    const held = await session.accessToken();
    refuse.on = false;
    const token = await session.accessToken({ rejected: held });
    expect(token).not.toBe(held);
    expect(token).toBe(authMock.secrets.accessTokens.at(-1));
    expect(renewals()).toHaveLength(2);
    expect(authMock.revoked).toEqual([]);
    expect((await keptTokens())?.accessToken).toBe(token);
    expect((await session.status()).signedIn).toBe(true);
  });

  it('renews a held renewal that secrets.json still refuses from the sign-in on disk, and holds the new one (codex.3 review)', async () => {
    const { session, refuse, clock } = await heldSession();
    const before = await keptTokens();
    refuse.on = true;
    await session.accessToken();
    clock.at += 2 * 60 * 60 * 1000;
    const token = await session.accessToken();
    expect(renewals()).toHaveLength(2);
    expect(authMock.revoked).toEqual([]);
    expect((await keptTokens())?.refreshToken).toBe(before?.refreshToken);
    refuse.on = false;
    expect(await session.accessToken()).toBe(token);
    expect((await keptTokens())?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
    expect(renewals()).toHaveLength(2);
  });

  it('renews a held renewal from the sign-in it was written as when secrets.json takes it only as the renewal starts (codex.3 review)', async () => {
    const { session, refuse, clock } = await heldSession();
    refuse.on = true;
    await session.accessToken();
    refuse.on = false;
    clock.at += 2 * 60 * 60 * 1000;
    // The request's read cannot write the held renewal; the renewal's own read, a moment later, can.
    refuse.next = 1;
    const token = await session.accessToken();
    expect(token).toBe(authMock.secrets.accessTokens.at(-1));
    expect(renewals()).toHaveLength(2);
    expect(authMock.revoked).toEqual([]);
    expect((await keptTokens())?.refreshToken).toBe(authMock.secrets.refreshTokens.at(-1));
    expect((await session.status()).signedIn).toBe(true);
  });

  it('ends the held refresh token at Sign out, the one OpenAI still takes (codex.3 review)', async () => {
    const { session, refuse } = await heldSession();
    refuse.on = true;
    await session.accessToken();
    refuse.on = false;
    const out = await session.signOut();
    expect(authMock.revoked).toContain(authMock.secrets.refreshTokens.at(-1));
    expect(out.revoked).toBe(true);
    expect(out.status.signedIn).toBe(false);
    expect(await keptTokens()).toBeNull();
    // Nothing held is written over a later sign-in.
    await session.signIn({ another: false });
    const kept = await keptTokens();
    expect(await session.accessToken()).toBe(kept?.accessToken);
  });

  it('takes a renewal written after its own read rather than renewing with a spent refresh token (codex.3 review)', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    authMock.scenario = 'ok';
    let release: () => void = () => undefined;
    // The first request's read of secrets.json comes back only after the second request's renewal is written.
    readGate.next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = session.accessToken();
    const first = await session.accessToken();
    release();
    expect(await late).toBe(first);
    expect(renewals()).toHaveLength(1);
    expect((await session.status()).signedIn).toBe(true);
    expect(logs.filter((l) => l.event === 'chatgpt.refresh' && l.fields['outcome'] !== 'done')).toEqual([]);
  });

  it('ends the sign-in on invalid_client, and registers the app anew at the next plain Sign in (codex.3 review)', async () => {
    authMock.scenario = 'shortlived';
    const session = await signedIn();
    const refused = authMock.issued.at(-1);
    const host = authMock.requests.filter((r) => r.path === '/api/accounts/authorize').at(-1)?.query[
      'ext_agent_host_id'
    ];
    authMock.scenario = 'refreshinvalidclient';
    const failed = await failure(session.accessToken());
    expect(failed.code).toBe('chatgpt-not-signed-in');
    expect(failed.message).toBe(notSignedInText('ended'));
    expect(logs).toContainEqual({
      level: 'warn',
      event: 'chatgpt.refresh',
      fields: expect.objectContaining({ outcome: 'ended', reason: 'invalid_client', status: 400 }) as unknown
    });
    const status = await session.status();
    expect(status.signedIn).toBe(false);
    // Use another account is not offered for a registration OpenAI refused.
    expect(status.registered).toBe(false);
    authMock.scenario = 'ok';
    await session.signIn({ another: false });
    const asked = authMock.requests.filter((r) => r.path === '/api/accounts/authorize').at(-1);
    expect(asked?.query['client_id']).toBe('dynamic_agent_client');
    expect(asked?.query['agent_name_hint']).toBe(APP_NAME);
    expect(asked?.query['ext_agent_host_id']).toBe(host);
    expect(authMock.issued.at(-1)).not.toBe(refused);
    expect((await session.status()).signedIn).toBe(true);
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

/* codex.6: the scenarios an OpenAI API key's words picked until that provider
   went, through the ChatGPT route, where a window run picks them too (the
   sign-in mock's `--api-scenario`, or the API mock's POST /mock/scenario);
   and the key provider's end-to-end checks, made on the plan. */
describe('the scenarios an API key picked until codex.6, on the ChatGPT route', () => {
  const KEY_SCENARIOS = [
    'unauthorized',
    'ratelimit',
    'servererror',
    'malformed',
    'prose',
    'wrongshape',
    'slow',
    'obsidian',
    'outputlimit',
    'unverified',
    'skippedonly'
  ] as const;

  it('knows every one, and picks it from a name in any case, the longest first', () => {
    for (const name of KEY_SCENARIOS) {
      expect(CHATGPT_SCENARIOS, name).toContain(name);
      expect(chatGptScenarioFor(`mock-${name.toUpperCase()}-7Qa2`), name).toBe(name);
    }
    expect(chatGptScenarioFor('usagelimitbare')).toBe('usagelimitbare');
    expect(chatGptScenarioFor('usagelimitstream')).toBe('usagelimitstream');
    expect(chatGptScenarioFor('anything else')).toBe('ok');
  });

  it("takes one from the tokens the sign-in mock makes, as --api-scenario gives it, and the API mock's own over it", async () => {
    authMock.apiScenario = 'ratelimit';
    const session = await signedIn();
    const limited = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(limited.message).toBe(
      'OpenAI is limiting requests from your ChatGPT sign-in just now, so it could not review the chapter. Wait a moment and try again.'
    );
    api.chatGptScenario = 'servererror';
    const broken = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(broken.message).toBe('OpenAI had a server error (500). Wait a moment and try again.');
  });

  it('unauthorized: a 401 for every request, renewed once, then said as a sign-in OpenAI does not accept, the sign-in kept', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'unauthorized';
    const listing = await failure(provider(session).models());
    expect(listing).toMatchObject({
      code: 'chatgpt-failed',
      message: CHATGPT_REVIEW_FAILURES.signInNotAccepted
    });
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(failed).toMatchObject({
      code: 'chatgpt-failed',
      message: CHATGPT_REVIEW_FAILURES.signInNotAccepted
    });
    expect(failed.detail).toContain('Incorrect API key provided.');
    // Each 401 renewed the token once and sent the request again.
    expect(renewals()).toHaveLength(2);
    expect(apiRequests('/v1/responses')).toHaveLength(2);
    expect((await session.status()).signedIn).toBe(true);
  });

  it('ratelimit and servererror: a review refused with a 429 or a 500 in plain words, the model list still answering', async () => {
    const session = await signedIn();
    for (const [scenario, words] of [
      [
        'ratelimit',
        'OpenAI is limiting requests from your ChatGPT sign-in just now, so it could not review the chapter. Wait a moment and try again.'
      ],
      ['servererror', 'OpenAI had a server error (500). Wait a moment and try again.']
    ] as const) {
      api.chatGptScenario = scenario;
      api.requests.length = 0;
      expect(await provider(session).models(), scenario).toHaveLength(3);
      const watch = hooks();
      const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), watch));
      expect(failed, scenario).toMatchObject({ code: 'chatgpt-server', message: words });
      // Not the plan's usage limit, and sent once: the route retries nothing.
      expect(watch.notices, scenario).toEqual([]);
      expect(apiRequests('/v1/responses'), scenario).toHaveLength(1);
    }
  });

  it('malformed and wrongshape: a reply that is not JSON, or JSON of the wrong shape, named by its model, never quoted', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'malformed';
    const malformed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(malformed.code).toBe('chatgpt-invalid-output');
    expect(malformed.message).toMatch(/^gpt-5\.5 answered but the response did not match the expected shape/);
    expect(malformed.message).not.toContain('had began');
    expect(malformed.detail).toMatch(/not JSON/);
    api.chatGptScenario = 'wrongshape';
    const wrong = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(wrong.code).toBe('chatgpt-invalid-output');
    expect(wrong.detail).toMatch(/changes/);
  });

  it('unverified: the 400 a stream to an unverified organisation gets, said as a request the route refused', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'unverified';
    // The model list is not refused; only the review's streamed request is.
    expect(await provider(session).models()).toHaveLength(3);
    const failed = await failure(provider(session).review(request({ model: 'gpt-5.5' }), hooks()));
    expect(failed).toMatchObject({
      code: 'chatgpt-failed',
      message:
        'OpenAI refused the request to review the chapter on your ChatGPT plan (status 400). The model or the effort level may not be available on it: choose another under Model or Effort in Review with AI.'
    });
    // Not a refusal of structured output, and OpenAI's own words stay in `detail`, which is never logged.
    expect(failed.message).not.toBe(CHATGPT_REVIEW_FAILURES.structuredOutput);
    expect(failed.detail).toContain(UNVERIFIED_STREAM_MESSAGE);
  });

  it('skippedonly: a list of only the models the default passes over, whose first is the default, never a hidden one', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'skippedonly';
    expect(await provider(session).models()).toEqual([
      { value: 'gpt-5.5-pro', label: 'GPT-5.5 Pro (default)', isDefault: true, description: 'gpt-5.5-pro' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'gpt-5-codex' },
      { value: 'gpt-5-chat-latest', label: 'GPT-5 Chat', description: 'gpt-5-chat-latest' }
    ]);
    api.requests.length = 0;
    const result = await provider(session).review(request({ model: '' }), hooks());
    expect(result.model).toBe('gpt-5.5-pro');
    expect((apiRequests('/v1/responses')[0]?.body as Record<string, unknown>)['model']).toBe('gpt-5.5-pro');
  });

  it('obsidian: the review of the Obsidian sample, which the guard sorts (files.9)', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'obsidian';
    const text = normalizeText(await fs.readFile(OBSIDIAN_SAMPLE, 'utf8')).text;
    const sourcePath = 'C:/vault/Chapter 03 - Obsidian.md';
    const result = await provider(session).review(request({ text, sourcePath, model: 'gpt-5.5' }), hooks());
    const sent = apiRequests('/v1/responses')[0]?.body as { input: Array<{ content: string }> };
    expect(sent.input[0]?.content).toContain('paragraphs="21"');
    expect(result.raw).toEqual(OBSIDIAN_REVIEW);
    const output = fromPromptNumbering(result.output);
    const review = createAiReview({
      sourcePath,
      base: { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      changes: output.changes.map((c) => ({ ...c, category: toChangeCategory(c.category) })),
      comments: output.comments,
      generator: { kind: 'chatgpt', provider: 'chatgpt', model: result.model ?? '' },
      raw: result.raw
    });
    expect(review.hunks.filter((h) => h.anchor !== 'stale')).toHaveLength(13);
    expect(review.hunks.filter((h) => h.keptOut !== undefined)).toHaveLength(10);
    expect(review.hunks).toHaveLength(23);
  });

  it('produces hunks and comments that anchor in the sample chapter, with a progress count that only climbs', async () => {
    const session = await signedIn();
    const tokens: number[] = [];
    const result = await provider(session).review(request({ model: 'gpt-5.5' }), {
      ...hooks(),
      onProgress: (_phase, count) => {
        if (count !== undefined) tokens.push(count);
      }
    });
    const streamed = tokens.slice(0, -1);
    expect(streamed.length).toBeGreaterThan(3);
    expect([...streamed].sort((a, b) => a - b)).toEqual(streamed);
    // As the renderer does: the model answers in the prompt's numbers, from 1.
    const output = fromPromptNumbering(result.output);
    const review = createAiReview({
      sourcePath: 'C:/vault/Chapter 01 - The Flood.md',
      base: { text: chapter, hash: 'h', eol: 'crlf', bom: true, trailingNewline: true },
      changes: output.changes.map((c) => ({ ...c, category: toChangeCategory(c.category) })),
      comments: output.comments,
      generator: { kind: 'chatgpt', provider: 'chatgpt', model: result.model ?? '' },
      raw: result.raw
    });
    expect(review.hunks).toHaveLength(6);
    expect(review.hunks.every((h) => h.anchor === 'exact')).toBe(true);
    expect(review.hunks.map((h) => h.replacement)).toEqual(['begun', 'have', '', 'lose', "It's", 'came']);
    expect(review.comments.map((c) => c.paragraph)).toEqual([5, 6, null]);
  });

  it("sends the Obsidian rule, and a note's paragraph only as its number and the hidden line (files.8)", async () => {
    const session = await signedIn();
    const text = `${chapter.trimEnd()}\n\n%% Ellen, not Mara: change it in chapter 3. %%\n`;
    await provider(session).review(request({ text, model: 'gpt-5.5' }), hooks());
    const sent = apiRequests('/v1/responses')[0]?.body as {
      instructions: string;
      input: Array<{ content: string }>;
    };
    expect(sent.instructions).toContain('The chapter is a note in an Obsidian vault');
    expect(sent.input[0]?.content).toContain('paragraphs="11"');
    expect(sent.input[0]?.content).toContain("\n\n[11] (author's note or code, hidden; skip it)\n</chapter>");
    expect(JSON.stringify(sent)).not.toContain('Ellen');
  });

  it('outputlimit: says a long chapter cut off at the limit after a low-effort review is to be split (files.10)', async () => {
    const session = await signedIn();
    api.chatGptScenario = 'outputlimit';
    // The sample chapter, repeated past 40,000 words: what Review with AI warns about.
    const paragraphs = chapter.trim().split('\n\n');
    const copies = Math.ceil(40_000 / chapterStats(chapter).words);
    const text = `${Array.from({ length: copies }, () => paragraphs.join('\n\n')).join('\n\n')}\n`;
    const words = chapterStats(text).words;
    expect(words).toBeGreaterThanOrEqual(40_000);
    const failed = await failure(
      provider(session).review(request({ text, effort: 'low', model: 'gpt-5.5' }), hooks())
    );
    expect(failed.message).toBe(
      replyLimitMessage('output', { who: 'gpt-5.5', maxTokens: MOCK_OUTPUT_LIMIT, words, effort: 'low' })
    );
    expect(failed.message).toMatch(/split it into two files and review each\.$/);
    expect(failed.detail).toBe('max_output_tokens');
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

  it("refuses a bearer that is not a ChatGPT sign-in's token, such as an API key, which no provider sends since codex.6", async () => {
    const asKey = await fetch(`${api.url}/models`, { headers: { authorization: 'Bearer sk-test-ok-7Qa2' } });
    expect(asKey.status).toBe(401);
    expect(((await asKey.json()) as { error: { code: string } }).error.code).toBe('invalid_api_key');
    const none = await fetch(`${api.url}/responses`, { method: 'POST', body: '{}' });
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('missing_api_key');
  });
});
