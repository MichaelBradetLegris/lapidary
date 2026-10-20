import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APIError, OpenAI } from 'openai';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NO_DEV_SWITCHES, readDevSwitches, setDevSwitches } from '../../src/main/devSwitches';
import { AppFailure } from '../../src/main/errors';
import {
  OPENAI_BASE_URL,
  clientOptions,
  createOpenAiProvider,
  incompleteFailure,
  mapOpenAiError,
  outputTextOf
} from '../../src/main/providers/openai';
import { createRegistry } from '../../src/main/providers/registry';
import type { ProgressPhase, ReviewProvider } from '../../src/main/providers/types';
import { LOWER_EFFORT_ADVICE, groupDigits, replyLimitMessage } from '../../src/shared/ai/replyLimit';
import type { ReviewRequest } from '../../src/shared/ipc';
import { fromPromptNumbering } from '../../src/shared/prompt/chapter';
import { createAiReview, toChangeCategory } from '../../src/shared/review';
import { normalizeText } from '../../src/shared/text/eol';
import { chapterStats } from '../../src/shared/text/stats';
import {
  MOCK_OUTPUT_LIMIT,
  OBSIDIAN_REVIEW,
  scenarioForKey,
  startMockOpenAi,
  type MockOpenAi
} from '../helpers/mockOpenAi';

/* The OpenAI provider driven over real HTTP against the local mock in
   test/helpers/mockOpenAi.ts: model listing, a streamed review, the error
   mapping for 401, 429, 5xx and a dead server, a malformed reply, and Cancel.
   The key picks the mock's scenario. No real key and no network. */

const SAMPLE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'samples',
  'manuscript',
  'Chapter 01 - The Flood.md'
);
const OBSIDIAN_SAMPLE = path.join(path.dirname(SAMPLE), 'Chapter 03 - Obsidian.md');

let mock: MockOpenAi;
let chapter: string;

beforeAll(async () => {
  mock = await startMockOpenAi();
  chapter = normalizeText(await fs.readFile(SAMPLE, 'utf8')).text;
});

afterAll(async () => {
  await mock.close();
});

function provider(key: string | null, baseUrl?: string): ReviewProvider {
  return createOpenAiProvider({
    key: () => Promise.resolve(key),
    status: () =>
      Promise.resolve(
        key
          ? { configured: true, source: 'stored' as const, last4: key.slice(-4) }
          : { configured: false, source: 'none' as const, last4: '' }
      ),
    baseUrl: () => baseUrl ?? mock.url,
    maxRetries: 0
  });
}

function request(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    requestId: 'req-test',
    provider: 'openai',
    sourcePath: 'C:/vault/Chapter 01 - The Flood.md',
    text: chapter,
    model: 'gpt-5-mini',
    effort: 'xhigh',
    guidelines: '# Guidelines\n\nUse British spelling.',
    ...overrides
  };
}

function hooks(signal = new AbortController().signal): {
  phases: ProgressPhase[];
  tokens: number[];
  onProgress: (phase: ProgressPhase, outputTokens?: number) => void;
  signal: AbortSignal;
} {
  const phases: ProgressPhase[] = [];
  const tokens: number[] = [];
  return {
    phases,
    tokens,
    signal,
    onProgress: (phase, outputTokens) => {
      phases.push(phase);
      if (outputTokens !== undefined) tokens.push(outputTokens);
    }
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

describe('OpenAI provider against the local mock', () => {
  it('reports ready with a key and not-signed-in without one, never the key itself', async () => {
    const ready = await provider('sk-test-ok-1234').runtime();
    expect(ready).toMatchObject({
      provider: 'openai',
      state: 'ready',
      keySource: 'stored',
      keyLast4: '1234'
    });
    expect(JSON.stringify(ready)).not.toContain('sk-test-ok');
    expect((await provider(null).runtime()).state).toBe('not-signed-in');
  });

  it('lists text models newest first and marks the newest gpt-5 as the default', async () => {
    const models = await provider('sk-test-ok-1234').models();
    const ids = models.map((m) => m.value);
    expect(ids).toEqual(['gpt-6-preview-mock', 'gpt-5.5', 'gpt-5-mini', 'gpt-5', 'o3', 'gpt-4o']);
    expect(models.filter((m) => m.isDefault).map((m) => m.value)).toEqual(['gpt-5.5']);
  });

  it('streams a review and returns the parsed output, model, usage and an estimated cost', async () => {
    const before = mock.requests.length;
    const h = hooks();
    const result = await provider('sk-test-ok-1234').review(request(), h);

    expect(result.output.changes).toHaveLength(6);
    expect(result.output.comments).toHaveLength(3);
    expect(result.model).toBe('gpt-5-mini-2026-06-01');
    expect(result.usage).toMatchObject({ input_tokens: 2400, output_tokens: expect.any(Number) as number });
    expect(result.costEstimated).toBe(true);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Progress: the label moves while text streams, and ends with 'done'.
    expect(h.phases[0]).toBe('starting');
    expect(h.phases).toContain('streaming');
    expect(h.phases[h.phases.length - 1]).toBe('done');
    const streamed = h.tokens.slice(0, -1);
    expect(streamed.length).toBeGreaterThan(3);
    expect([...streamed].sort((a, b) => a - b)).toEqual(streamed);

    // What was sent: the same prompt pieces as Claude, strict JSON schema, effort, no storage.
    const sent = mock.requests.slice(before).find((r) => r.path === '/v1/responses');
    const body = sent?.body as Record<string, unknown>;
    expect(sent?.authorization).toBe('Bearer sk-test-ok-1234');
    expect(body['model']).toBe('gpt-5-mini');
    expect(body['stream']).toBe(true);
    expect(body['store']).toBe(false);
    expect(body['reasoning']).toEqual({ effort: 'xhigh' });
    expect(String(body['instructions'])).toContain('You are a copyeditor');
    expect(String(body['instructions'])).toContain('Use British spelling.');
    expect(String(body['input'])).toContain('<chapter file="Chapter 01 - The Flood"');
    expect(String(body['input'])).toContain('[1] It was the third night of rain');
    const format = (body['text'] as { format: Record<string, unknown> }).format;
    expect(format).toMatchObject({ type: 'json_schema', name: 'manuscript_review', strict: true });
    expect(JSON.stringify(format['schema'])).not.toContain('maxLength');
  });

  it("sends the Obsidian rule, and a note's paragraph only as its number and the hidden line (files.8)", async () => {
    const before = mock.requests.length;
    const text = `${chapter.trimEnd()}\n\n%% Ellen, not Mara: change it in chapter 3. %%\n`;
    await provider('sk-test-ok-1234').review(request({ text }), hooks());
    const sent = mock.requests.slice(before).find((r) => r.path === '/v1/responses');
    const body = sent?.body as Record<string, unknown>;
    expect(String(body['instructions'])).toContain('The chapter is a note in an Obsidian vault');
    expect(String(body['input'])).toContain('paragraphs="11"');
    expect(String(body['input'])).toContain("\n\n[11] (author's note or code, hidden; skip it)\n</chapter>");
    expect(String(body['input'])).not.toContain('Ellen');
    expect(JSON.stringify(sent?.body)).not.toContain('Ellen');
  });

  it('produces hunks and comments that anchor in the sample chapter', async () => {
    const result = await provider('sk-test-ok-1234').review(request(), hooks());
    // As the renderer does: the model answers in the prompt's numbers, from 1.
    const output = fromPromptNumbering(result.output);
    const review = createAiReview({
      sourcePath: 'C:/vault/Chapter 01 - The Flood.md',
      base: { text: chapter, hash: 'h', eol: 'crlf', bom: true, trailingNewline: true },
      changes: output.changes.map((c) => ({ ...c, category: toChangeCategory(c.category) })),
      comments: output.comments,
      generator: { kind: 'openai', provider: 'openai', model: result.model ?? '' },
      raw: result.raw
    });
    expect(review.hunks).toHaveLength(6);
    expect(review.hunks.every((h) => h.anchor === 'exact')).toBe(true);
    expect(review.hunks.map((h) => h.replacement)).toEqual(['begun', 'have', '', 'lose', "It's", 'came']);
    expect(review.comments.map((c) => c.paragraph)).toEqual([5, 6, null]);
    expect(review.generator.provider).toBe('openai');
  });

  it('answers a key holding "obsidian" with the review of the Obsidian sample, which the guard sorts (files.9)', async () => {
    expect(scenarioForKey('Bearer sk-test-obsidian')).toBe('obsidian');
    const text = normalizeText(await fs.readFile(OBSIDIAN_SAMPLE, 'utf8')).text;
    const sourcePath = 'C:/vault/Chapter 03 - Obsidian.md';
    const before = mock.requests.length;
    const result = await provider('sk-test-obsidian').review(request({ text, sourcePath }), hooks());
    const sent = mock.requests.slice(before).find((r) => r.path === '/v1/responses');
    expect(String((sent?.body as Record<string, unknown>)['input'])).toContain('paragraphs="21"');
    expect(result.raw).toEqual(OBSIDIAN_REVIEW);

    const output = fromPromptNumbering(result.output);
    const review = createAiReview({
      sourcePath,
      base: { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      changes: output.changes.map((c) => ({ ...c, category: toChangeCategory(c.category) })),
      comments: output.comments,
      generator: { kind: 'openai', provider: 'openai', model: result.model ?? '' },
      raw: result.raw
    });
    expect(review.hunks.filter((h) => h.anchor !== 'stale')).toHaveLength(13);
    expect(review.hunks.filter((h) => h.keptOut !== undefined)).toHaveLength(10);
    expect(review.hunks).toHaveLength(23);
  });

  it('resolves an empty model setting to the newest gpt-5', async () => {
    const before = mock.requests.length;
    const result = await provider('sk-test-ok-1234').review(request({ model: '' }), hooks());
    expect(result.model).toBe('gpt-5.5-2026-06-01');
    // No price for gpt-5.5 snapshots is guessed from gpt-5's.
    const sent = mock.requests.slice(before).find((r) => r.path === '/v1/responses');
    expect((sent?.body as Record<string, unknown>)['model']).toBe('gpt-5.5');
  });

  it('maps 401 to an invalid key that points at Settings', async () => {
    const err = await failure(provider('sk-test-unauthorized-0000').review(request(), hooks())); // check-public: allow
    expect(err.code).toBe('openai-invalid-key');
    expect(err.message).toMatch(/Settings/);
    const listing = await failure(provider('sk-test-unauthorized-0000').models()); // check-public: allow
    expect(listing.code).toBe('openai-invalid-key');
  });

  it('maps 429 to rate limited or out of credit', async () => {
    const err = await failure(provider('sk-test-ratelimit-0000').review(request(), hooks()));
    expect(err.code).toBe('openai-rate-limit');
    expect(err.message).toMatch(/rate limit/i);
    expect(err.message).toMatch(/credit/);
  });

  it('maps 5xx to a retry hint', async () => {
    const err = await failure(provider('sk-test-servererror-0000').review(request(), hooks())); // check-public: allow
    expect(err.code).toBe('openai-server');
    expect(err.message).toMatch(/500/);
    expect(err.message).toMatch(/try again/i);
  });

  it('maps an unreachable server to a connection message with a retry hint', async () => {
    const dead = provider('sk-test-ok-1234', 'http://127.0.0.1:9/v1');
    const err = await failure(dead.review(request(), hooks()));
    expect(err.code).toBe('openai-server');
    expect(err.message).toMatch(/Could not reach OpenAI/);
  });

  it('names the model when the reply is not JSON', async () => {
    const err = await failure(provider('sk-test-malformed-0000').review(request(), hooks()));
    expect(err.code).toBe('openai-invalid-output');
    expect(err.message).toContain('gpt-5-mini-2026-06-01');
    expect(err.detail).toMatch(/not JSON/);
  });

  it('names the model when the reply is JSON of the wrong shape', async () => {
    const err = await failure(provider('sk-test-wrongshape-0000').review(request(), hooks())); // check-public: allow
    expect(err.code).toBe('openai-invalid-output');
    expect(err.message).toContain('gpt-5-mini-2026-06-01');
    expect(err.detail).toMatch(/changes/);
  });

  it('refuses to start without a key', async () => {
    const err = await failure(provider(null).review(request(), hooks()));
    expect(err.code).toBe('openai-no-key');
  });

  it('names the output limit when the reply is cut off there, with what helps (files.10)', async () => {
    expect(scenarioForKey('Bearer sk-test-outputlimit')).toBe('outputlimit');
    const h = hooks();
    const err = await failure(provider('sk-test-outputlimit-0000').review(request(), h)); // check-public: allow
    expect(err.code).toBe('openai-failed');
    expect(err.message).toBe(
      replyLimitMessage('output', {
        who: 'gpt-5-mini-2026-06-01',
        maxTokens: MOCK_OUTPUT_LIMIT,
        words: chapterStats(chapter).words,
        effort: 'xhigh'
      })
    );
    expect(err.message).toBe(
      `gpt-5-mini-2026-06-01 reached its output limit (128,000 tokens) before it had written every suggestion, so none came back. ${LOWER_EFFORT_ADVICE}`
    );
    expect(err.detail).toBe('max_output_tokens');
    expect(h.phases.at(-1)).toBe('done');
  });

  it('says a long chapter cut off at the limit after a low-effort review is to be split', async () => {
    // The sample chapter, repeated past 40,000 words: what Review with AI warns about.
    const paragraphs = chapter.trim().split('\n\n');
    const copies = Math.ceil(40_000 / chapterStats(chapter).words);
    const text = `${Array.from({ length: copies }, () => paragraphs.join('\n\n')).join('\n\n')}\n`;
    const words = chapterStats(text).words;
    expect(words).toBeGreaterThanOrEqual(40_000);
    const err = await failure(
      provider('sk-test-outputlimit-0000').review(request({ text, effort: 'low' }), hooks()) // check-public: allow
    );
    expect(err.message).toBe(
      `gpt-5-mini-2026-06-01 reached its output limit (128,000 tokens) before it had written every suggestion, so none came back. At ${groupDigits(words)} words the chapter is long for one review: split it into two files and review each.`
    );
  });

  it('cancels a streaming review through the abort signal', async () => {
    const controller = new AbortController();
    const h = hooks(controller.signal);
    const running = provider('sk-test-slow-0000').review(request(), h);
    setTimeout(() => controller.abort(), 700);
    const err = await failure(running);
    expect(err.code).toBe('cancelled');
    expect(h.phases[h.phases.length - 1]).toBe('done');
  });
});

describe('OpenAI helpers', () => {
  it('reads output text from the output array when the convenience field is absent', () => {
    expect(
      outputTextOf({
        output: [
          { type: 'reasoning', content: [] },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: '{"a":' },
              { type: 'output_text', text: '1}' }
            ]
          }
        ]
      })
    ).toBe('{"a":1}');
    expect(outputTextOf({ output_text: 'x', output: [] })).toBe('x');
    expect(outputTextOf(null)).toBe('');
  });

  it('maps plain errors without inventing an HTTP status', () => {
    const err = mapOpenAiError(new Error('boom'), 'review the chapter') as AppFailure;
    expect(err.code).toBe('openai-failed');
    expect(err.message).toContain('boom');
  });

  it('says a chapter longer than the context window is too long to read, for a review only (files.10)', () => {
    const tooLong = APIError.generate(
      400,
      {
        error: {
          message:
            'Your input exceeds the context window of this model. Please adjust your input and try again.',
          type: 'invalid_request_error',
          param: 'input',
          code: 'context_length_exceeded'
        }
      },
      undefined,
      new Headers()
    );
    const chapterFacts = { who: 'gpt-4o', words: 140_250, effort: 'high' as const };
    const err = mapOpenAiError(tooLong, 'review the chapter', chapterFacts) as AppFailure;
    expect(err.code).toBe('openai-failed');
    expect(err.message).toBe(
      'The chapter is too long for gpt-4o to read in one request (140,250 words), so nothing came back. Split it into shorter files and review each.'
    );
    expect(err.detail).toContain('context window');
    // Without a chapter, as for the model list or a connection test, it stays a refused request.
    expect((mapOpenAiError(tooLong, 'answer the test') as AppFailure).message).toMatch(
      /^OpenAI refused the request to answer the test: /
    );
    // Any other 400 keeps its usual words.
    const other = APIError.generate(
      400,
      { error: { message: 'Unsupported value', code: 'unsupported_value' } },
      undefined,
      new Headers()
    );
    expect((mapOpenAiError(other, 'review the chapter', chapterFacts) as AppFailure).message).toMatch(
      /The model or the effort level may not be available/
    );
  });

  it('says what stopped an incomplete reply other than the output limit (files.10)', () => {
    const facts = { words: 3_000, effort: 'high' as const };
    const filtered = incompleteFailure(
      { model: 'gpt-5-2026-06-01', incomplete_details: { reason: 'content_filter' } },
      'gpt-5',
      facts
    );
    expect(filtered).toMatchObject({
      code: 'openai-failed',
      message:
        "OpenAI's content filter stopped the reply from gpt-5-2026-06-01 before it was finished, so no suggestions came back. Try again, or choose another model.",
      detail: 'content_filter'
    });
    expect(incompleteFailure({ incomplete_details: null }, 'gpt-5', facts).message).toBe(
      'OpenAI stopped the reply from gpt-5 before it was finished (no reason given), so no suggestions came back. Try again.'
    );
    // At the output limit with no usage, the limit goes unnamed.
    expect(
      incompleteFailure({ incomplete_details: { reason: 'max_output_tokens' } }, 'gpt-5', facts).message
    ).toBe(replyLimitMessage('output', { who: 'gpt-5', ...facts }));
    // A limit the request had set is the one named.
    expect(
      incompleteFailure(
        {
          incomplete_details: { reason: 'max_output_tokens' },
          max_output_tokens: 16_000,
          usage: { output_tokens: 16_000 }
        },
        'gpt-5',
        facts
      ).message
    ).toMatch(/^gpt-5 reached its output limit \(16,000 tokens\)/);
  });
});

/* hardening.1: nothing in the environment may move the key. The SDK reads
   OPENAI_BASE_URL, OPENAI_ORG_ID, OPENAI_PROJECT_ID and OPENAI_ADMIN_KEY by
   itself when an option is left out, so a real client is built here with all of
   them set to hostile values and must still point at OpenAI with no extras. */
describe('client options', () => {
  const hostile = {
    OPENAI_BASE_URL: 'https://attacker.example/v1',
    OPENAI_ORG_ID: 'org-attacker',
    OPENAI_PROJECT_ID: 'proj-attacker',
    OPENAI_ADMIN_KEY: 'sk-admin-attacker',
    OPENAI_LOG: 'debug'
  };

  function hostileClient(): OpenAI {
    for (const [name, value] of Object.entries(hostile)) vi.stubEnv(name, value);
    try {
      return new OpenAI(clientOptions({}, 'sk-test'));
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it('ignores a hostile environment in a packaged build', () => {
    setDevSwitches(readDevSwitches({ env: {}, packaged: true, isolatedUserData: null }));
    try {
      const client = hostileClient();
      expect(client.baseURL).toBe(OPENAI_BASE_URL);
      expect(client.organization).toBeNull();
      expect(client.project).toBeNull();
      expect(client.logLevel).toBe('off');
    } finally {
      setDevSwitches(NO_DEV_SWITCHES);
    }
  });

  it('ignores it in development too, unless the dev switch names a URL', () => {
    setDevSwitches(readDevSwitches({ env: {}, packaged: false, isolatedUserData: null }));
    try {
      expect(hostileClient().baseURL).toBe(OPENAI_BASE_URL);
      setDevSwitches(
        readDevSwitches({
          env: { MANUSCRIPT_REVIEW_OPENAI_BASE_URL: 'http://127.0.0.1:4599/v1' },
          packaged: false,
          isolatedUserData: null
        })
      );
      const client = hostileClient();
      expect(client.baseURL).toBe('http://127.0.0.1:4599/v1');
      expect(client.organization).toBeNull();
    } finally {
      setDevSwitches(NO_DEV_SWITCHES);
    }
  });

  it('lets an injected test URL win', () => {
    expect(clientOptions({ baseUrl: () => 'http://127.0.0.1:1/v1' }, 'k').baseURL).toBe(
      'http://127.0.0.1:1/v1'
    );
  });
});

describe('provider registry', () => {
  const stub = (id: 'claude' | 'openai'): ReviewProvider => ({
    id,
    label: id,
    runtime: () => Promise.resolve({ provider: id, state: 'ready' }),
    models: () => Promise.resolve([]),
    review: () => Promise.reject(new Error('not used'))
  });

  it('serves every provider by id', () => {
    const registry = createRegistry([stub('claude'), stub('openai')]);
    expect(registry.ids().sort()).toEqual(['claude', 'openai']);
    expect(registry.get('openai').id).toBe('openai');
    expect(registry.get('claude').id).toBe('claude');
  });

  it('refuses a registry that leaves a provider out or lists one twice', () => {
    expect(() => createRegistry([stub('claude')])).toThrow(/openai/);
    expect(() => createRegistry([stub('claude'), stub('openai'), stub('openai')])).toThrow(/twice/);
  });

  it('answers an unknown id from another process with an app error', () => {
    const registry = createRegistry([stub('claude'), stub('openai')]);
    expect(() => registry.get('gemini' as 'claude')).toThrow(/Unknown AI provider/);
  });
});
