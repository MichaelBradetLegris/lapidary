import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppFailure, fail } from '../../src/main/errors';
import { runHandler } from '../../src/main/ipcEnvelope';
import { LOG_FILE, flushLog, initLog, log } from '../../src/main/log';
import {
  reviewRequestFields,
  runtimeFields,
  tokenFields,
  withLogging
} from '../../src/main/providers/logged';
import { testConnection } from '../../src/main/providers/connectionTest';
import { createOpenAiProvider } from '../../src/main/providers/openai';
import type { ReviewProvider } from '../../src/main/providers/types';
import { listReviews, loadLatestReview, loadReviewFile } from '../../src/main/reviews';
import type {
  ConnectionTestResult,
  IpcResult,
  RateLimitInfo,
  ReviewRequest,
  RuntimeStatus
} from '../../src/shared/ipc';
import { renderChapter } from '../../src/shared/prompt/chapter';
import { buildSystemPrompt } from '../../src/shared/prompt/system';
import { chapterName, chapterSlug } from '../../src/shared/review';
import { normalizeText } from '../../src/shared/text/eol';
import { nextLastFailure, setupView, testSetupEvent } from '../../src/shared/ui/setup';
import { CANNED_REVIEW, PROSE_REPLY, startMockOpenAi, type MockOpenAi } from '../helpers/mockOpenAi';

/* hardening.3b: what the log holds after reviews, runtime checks and failed
   requests. Mock reviews (success, malformed, prose) run through withLogging
   and the IPC envelope into the app's real log file, and nothing of the
   chapter, the prompt, the guidelines, the reply or the key may be in it.
   Nor may anything of a corrupt review file. No real key and no network. */

const SAMPLE = path.join(
  import.meta.dirname,
  '..',
  '..',
  'samples',
  'manuscript',
  'Chapter 01 - The Flood.md'
);
const SOURCE = 'C:/vault/Chapter 01 - The Flood.md';
const CHAPTER_SENTINEL = 'CHAPTER-SENTINEL-8e2d';
const GUIDELINES_SENTINEL = 'GUIDELINES-SENTINEL-41b7';
const REVIEW_SENTINEL = 'REVIEW-SENTINEL-5c1f';
const PAYLOAD_SENTINEL = 'PAYLOAD-SENTINEL-d09a';
const GUIDELINES = `# House style\n\n${GUIDELINES_SENTINEL}: use British spelling, and keep "towards" rather than "toward".`;
/** The mock's scenario is in the key; all three end in the same last four characters. */
const KEYS = { ok: 'sk-test-ok-QZ7W', malformed: 'sk-test-malformed-QZ7W', prose: 'sk-test-prose-QZ7W' };
const MALFORMED_REPLY = '{"changes": [{"paragraph": 0, "before": "had began", "after": ';

let mock: MockOpenAi;
let root: string;
let chapter: string;
let key: string = KEYS.ok;

/** What happened, for the tests to read. */
const outcome: {
  runtime?: RuntimeStatus;
  models?: number;
  done?: IpcResult<unknown>;
  malformed?: IpcResult<unknown>;
  prose?: IpcResult<unknown>;
  failures: AppFailure[];
  lastFailures: (string | null)[];
  corrupt: IpcResult<unknown>[];
  saved?: IpcResult<unknown>;
} = { failures: [], lastFailures: [], corrupt: [] };

function request(): ReviewRequest {
  return {
    requestId: 'req-logged',
    provider: 'openai',
    sourcePath: SOURCE,
    text: chapter,
    model: 'gpt-5-mini',
    effort: 'low',
    guidelines: GUIDELINES
  };
}

const hooks = { onProgress: (): void => undefined, signal: new AbortController().signal };

/** The log file as written, every line flushed. */
async function logText(): Promise<string> {
  flushLog();
  return fs.readFile(path.join(root, 'logs', LOG_FILE), 'utf8');
}

/** The lines of one event. */
async function linesOf(event: string): Promise<string[]> {
  return (await logText()).split('\n').filter((line) => line.split(' ')[2] === event);
}

/** Every run of six words in `text`, or the whole text when it is shorter. */
function phrases(text: string, size = 6): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= size) return words.length > 0 ? [words.join(' ')] : [];
  return words.slice(0, words.length - size + 1).map((_, i) => words.slice(i, i + size).join(' '));
}

/**
 * The phrases of `text` the log holds, as written or as `formatFields` quotes
 * a value (JSON), with line breaks taken as spaces.
 */
async function leaked(text: string): Promise<string[]> {
  const flat = (await logText()).replace(/\s+/g, ' ');
  return phrases(text).filter(
    (phrase) => flat.includes(phrase) || flat.includes(JSON.stringify(phrase).slice(1, -1))
  );
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lapidary-logged-'));
  initLog(path.join(root, 'logs'));
  mock = await startMockOpenAi();
  const sample = normalizeText(await fs.readFile(SAMPLE, 'utf8')).text;
  chapter = `${sample}\n${CHAPTER_SENTINEL}: the river kept its own counsel that night.\n`;

  const openai = withLogging(
    createOpenAiProvider({
      key: () => Promise.resolve(key),
      status: () => Promise.resolve({ configured: true, source: 'stored' as const, last4: key.slice(-4) }),
      baseUrl: () => mock.url,
      maxRetries: 0
    }),
    { log }
  );
  // As the IPC bridge runs them: a review's failure is withLogging's to log, never the envelope's.
  const review = (): Promise<IpcResult<unknown>> =>
    runHandler('ai:review', request(), (payload) => openai.review(payload as ReviewRequest, hooks), log);
  const note = (result: IpcResult<unknown>): void => {
    if (!result.ok) outcome.failures.push(new AppFailure(result.error.code, result.error.message));
    outcome.lastFailures.push(openai.lastFailure()?.code ?? null);
  };

  outcome.runtime = await openai.runtime();
  outcome.models = (await openai.models()).length;
  outcome.done = await review();
  note(outcome.done);
  key = KEYS.malformed;
  outcome.malformed = await review();
  note(outcome.malformed);
  key = KEYS.prose;
  outcome.prose = await review();
  note(outcome.prose);
  key = KEYS.ok;
  note(await review());

  // A failed request whose payload carries text: the envelope logs the channel and the error, never the payload.
  outcome.saved = await runHandler(
    'files:save',
    { path: SOURCE, text: `${PAYLOAD_SENTINEL} and the chapter's words` },
    () => Promise.reject(fail('io', 'Could not save.')),
    log
  );

  // Corrupt review files in the chapter's folder of a reviews folder, read as the page reads them.
  const reviews = path.join(root, 'reviews');
  const folder = path.join(reviews, chapterSlug(SOURCE));
  await fs.mkdir(folder, { recursive: true });
  const corrupt: Record<string, string> = {
    // cut off part way through the chapter's text
    '2026-10-20T08-00-00-000Z.review.json': `{"version": 3, "sourcePath": "${SOURCE}", "base": {"text": "${REVIEW_SENTINEL} It was the third night of rain`,
    // V8 quotes about ten characters of it, the line break too, in its message
    '2026-10-20T08-01-00-000Z.review.json': `\nat ZQXR ${REVIEW_SENTINEL} and the rest of the file`,
    // JSON, but not a review
    '2026-10-20T08-02-00-000Z.review.json': JSON.stringify({ note: `${REVIEW_SENTINEL} was here` }),
    '.last-open.json': `{"version": 1, "chapters": [{"sourcePath": "${REVIEW_SENTINEL}`
  };
  for (const [name, text] of Object.entries(corrupt)) await fs.writeFile(path.join(folder, name), text);
  for (const name of Object.keys(corrupt).filter((n) => n.endsWith('.review.json'))) {
    const file = path.join(folder, name);
    outcome.corrupt.push(await runHandler('reviews:load', { path: file }, () => loadReviewFile(file), log));
  }
  outcome.corrupt.push(
    await runHandler('reviews:list', { sourcePath: SOURCE }, () => listReviews(reviews, SOURCE), log),
    await runHandler(
      'reviews:load-latest',
      { sourcePath: SOURCE },
      () => loadLatestReview(reviews, SOURCE),
      log
    )
  );
});

afterAll(async () => {
  await mock.close();
  flushLog();
  await fs.rm(root, { recursive: true, force: true });
});

describe('a provider wrapped in withLogging, against the mock', () => {
  it('logs the runtime check with the fields diagnostics show, never the key or its last four', async () => {
    expect(outcome.runtime).toMatchObject({ state: 'ready', keyLast4: 'QZ7W' });
    const [line] = await linesOf('ai.runtime');
    expect(line).toMatch(
      / INFO ai\.runtime provider=openai state=ready apiKeySource=Settings keySource=stored durationMs=\d+$/
    );
    expect(await linesOf('ai.models')).toEqual([
      expect.stringMatching(
        new RegExp(` INFO ai\\.models provider=openai count=${outcome.models} durationMs=\\d+$`)
      )
    ]);
  });

  it('logs a review that worked as counts: words, suggestions, comments, tokens', async () => {
    expect(outcome.done?.ok).toBe(true);
    const starts = await linesOf('ai.review.start');
    expect(starts).toHaveLength(4);
    const words = reviewRequestFields(request())['words'];
    expect(starts[0]).toMatch(
      new RegExp(
        ` INFO ai\\.review\\.start provider=openai model=gpt-5-mini effort=low words=${words} chars=${chapter.length} paragraphs=\\d+ guidelinesChars=${GUIDELINES.length}$`
      )
    );
    const done = await linesOf('ai.review.done');
    expect(done).toHaveLength(2);
    expect(done[0]).toMatch(
      new RegExp(
        ` INFO ai\\.review\\.done provider=openai model=gpt-5-mini-2026-06-01 changes=${CANNED_REVIEW.changes.length} comments=${CANNED_REVIEW.comments.length} inputTokens=2400 outputTokens=\\d+(?: costUsd=[\\d.]+ costEstimated=true)? durationMs=\\d+$`
      )
    );
  });

  it('logs only the code of a reply that is not JSON or is prose, once, and not as ipc.failed', async () => {
    expect(outcome.malformed).toMatchObject({ ok: false, error: { code: 'openai-invalid-output' } });
    expect(outcome.prose).toMatchObject({ ok: false, error: { code: 'openai-invalid-output' } });
    // The page is told what V8 said of the prose; the log is not.
    expect(outcome.failures.map((f) => f.message).join(' ')).toContain('Here is my');
    expect(await linesOf('ai.review.failed')).toEqual([
      expect.stringMatching(
        / WARN ai\.review\.failed provider=openai code=openai-invalid-output durationMs=\d+$/
      ),
      expect.stringMatching(
        / WARN ai\.review\.failed provider=openai code=openai-invalid-output durationMs=\d+$/
      )
    ]);
    expect((await linesOf('ipc.failed')).filter((line) => line.includes('ai:review'))).toEqual([]);
  });

  // The renderer keeps Claude's last failure only; main keeps one for each provider.
  it("keeps OpenAI's last failure too: set by a failed review, cleared by one that worked", () => {
    expect(outcome.lastFailures).toEqual([null, 'openai-invalid-output', 'openai-invalid-output', null]);
  });

  it('logs a failed request with its channel and error, never its payload', async () => {
    expect(outcome.saved).toMatchObject({ ok: false, error: { code: 'io', message: 'Could not save.' } });
    expect(await linesOf('ipc.failed')).toContainEqual(
      expect.stringMatching(/ WARN ipc\.failed channel=files:save code=io message="Could not save\."$/)
    );
    expect(await logText()).not.toContain(PAYLOAD_SENTINEL);
  });
});

describe('the log after all of it', () => {
  it('holds no chapter text, prompt or guidelines', async () => {
    const text = await logText();
    expect(text).not.toContain(CHAPTER_SENTINEL);
    expect(text).not.toContain(GUIDELINES_SENTINEL);
    expect(await leaked(chapter)).toEqual([]);
    expect(await leaked(renderChapter(chapter, chapterName(SOURCE)))).toEqual([]);
    expect(await leaked(buildSystemPrompt(GUIDELINES))).toEqual([]);
    expect(await leaked(GUIDELINES)).toEqual([]);
  });

  it('holds no reply text: not the review, not the malformed reply, not the prose', async () => {
    const text = await logText();
    const strings = [
      ...CANNED_REVIEW.changes.flatMap((c) => [c.before, c.after, c.reason]),
      ...CANNED_REVIEW.comments.flatMap((c) => [c.quote ?? '', c.text])
    ].filter((s) => s.length > 0);
    for (const s of strings) expect(text).not.toContain(s);
    expect(await leaked(JSON.stringify(CANNED_REVIEW))).toEqual([]);
    expect(await leaked(MALFORMED_REPLY)).toEqual([]);
    expect(text).not.toContain('had began');
    expect(await leaked(PROSE_REPLY)).toEqual([]);
    expect(text).not.toContain('Here is my');
  });

  it('holds no key, nor its last four characters', async () => {
    const text = await logText();
    for (const k of Object.values(KEYS)) expect(text).not.toContain(k);
    expect(text).not.toContain('sk-test');
    expect(text).not.toContain('QZ7W');
    expect(text).not.toContain('[key]');
  });

  it('holds nothing of a corrupt review file, though each read is logged', async () => {
    const text = await logText();
    expect(text).not.toContain(REVIEW_SENTINEL);
    expect(text).not.toContain('REVIEW');
    expect(text).not.toContain('ZQXR');
    expect(text).not.toContain('third night');
    const [cutOff, quoted, notReview, list, latest] = outcome.corrupt;
    expect(cutOff).toMatchObject({ ok: false, error: { code: 'unknown' } });
    expect(quoted).toMatchObject({ ok: false, error: { code: 'unknown' } });
    // V8's message quotes the file to the page, and its quote holds a line that starts with "at".
    expect(quoted?.ok === false && quoted.error.message).toContain('\nat ZQXR');
    expect(notReview).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(list).toEqual({ ok: true, value: [] });
    expect(latest).toEqual({ ok: true, value: null });
    const failed = await linesOf('ipc.failed');
    expect(
      failed.filter((line) => line.includes('channel=reviews:load name=SyntaxError frames="at JSON.parse'))
    ).toHaveLength(2);
    expect(failed.filter((line) => line.includes('channel=reviews:load code=invalid-input'))).toHaveLength(1);
    // A failure without words of its own is a fault, so an error; the others are warnings.
    expect(failed.filter((line) => / ERROR ipc\.failed /.test(line))).toHaveLength(2);
  });
});

describe('the fields withLogging takes', () => {
  const status: RuntimeStatus = {
    provider: 'claude',
    state: 'ready',
    executablePath: path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    cliVersion: '2.1.300',
    minCliVersion: '2.1.266',
    credential: 'subscription',
    authMethod: 'claude.ai',
    planWarning: 'A free plan cannot run Claude Code.',
    checkedAt: '2026-10-20T08:00:00.000Z',
    email: 'ann@example.com',
    subscriptionType: 'max',
    apiKeySource: 'none',
    message: 'PROBE-SAID-SENTINEL'
  };

  it('logs a Claude runtime as Copy diagnostics shows it, never the email, message or time', () => {
    expect(runtimeFields(status)).toEqual({
      provider: 'claude',
      state: 'ready',
      credential: 'subscription',
      cliVersion: '2.1.300',
      minCliVersion: '2.1.266',
      executable: status.executablePath,
      authMethod: 'claude.ai',
      plan: 'max',
      planWarning: true,
      apiKeySource: 'none'
    });
    expect(
      runtimeFields({ provider: 'openai', state: 'ready', keySource: 'stored', keyLast4: 'QZ7W' })
    ).toEqual({
      provider: 'openai',
      state: 'ready',
      keySource: 'stored'
    });
  });

  it("reads tokens from either provider's usage", () => {
    expect(tokenFields({ input_tokens: 10, output_tokens: 4, total_tokens: 14 })).toEqual({
      inputTokens: 10,
      outputTokens: 4
    });
    expect(
      tokenFields({
        'claude-opus-5-5': { inputTokens: 900, outputTokens: 42, costUSD: 0.1 },
        'claude-haiku-4-5': { inputTokens: 100, outputTokens: 8 }
      })
    ).toEqual({ inputTokens: 1000, outputTokens: 50 });
    // Claude Code counts the cached part of the prompt apart, and it is most of a review's.
    expect(
      tokenFields({
        'claude-opus-5-5': {
          inputTokens: 4,
          cacheCreationInputTokens: 2300,
          cacheReadInputTokens: 11000,
          outputTokens: 300,
          webSearchRequests: 0,
          costUSD: 0.02,
          contextWindow: 200000
        },
        'claude-haiku-4-5': { inputTokens: 10, cacheReadInputTokens: 90, outputTokens: 5, costUSD: 0.001 }
      })
    ).toEqual({ inputTokens: 13404, outputTokens: 305 });
    expect(tokenFields(undefined)).toEqual({});
    expect(tokenFields({})).toEqual({});
  });

  it('remembers the last runtime and follows a sign-in failure through the checks after it', async () => {
    const lines: [string, string, Readonly<Record<string, unknown>>][] = [];
    let state: RuntimeStatus['state'] = 'ready';
    let reviewFailure = fail('claude-login-expired', 'Your Claude sign-in has ended.');
    const stub: ReviewProvider = {
      id: 'claude',
      label: 'Claude',
      runtime: () => Promise.resolve({ ...status, state }),
      models: () => Promise.resolve([]),
      review: () => Promise.reject(reviewFailure),
      test: (testHooks) =>
        testHooks.signal.aborted
          ? Promise.reject(fail('cancelled', 'Test cancelled.'))
          : Promise.resolve({ model: 'claude-haiku-4-5' })
    };
    const logged = withLogging(stub, {
      log: (level, event, fields = {}) => lines.push([level, event, fields])
    });
    expect(logged.lastRuntime()).toBeNull();
    await logged.runtime();
    expect(logged.lastRuntime()).toMatchObject({ state: 'ready', cliVersion: '2.1.300' });

    await expect(logged.review(request(), hooks)).rejects.toThrow('sign-in has ended');
    const expired = {
      code: 'claude-login-expired',
      executablePath: status.executablePath,
      cliVersion: '2.1.300'
    };
    expect(logged.lastFailure()).toEqual(expired);
    // A review the author cancels is logged at info, and says nothing about setup.
    reviewFailure = fail('cancelled', 'Review cancelled.');
    await expect(logged.review(request(), hooks)).rejects.toThrow('Review cancelled.');
    expect(lines.at(-1)).toEqual([
      'info',
      'ai.review.failed',
      {
        provider: 'claude',
        code: 'cancelled',
        message: 'Review cancelled.',
        durationMs: expect.any(Number) as number
      }
    ]);
    expect(logged.lastFailure()).toEqual(expired);
    reviewFailure = fail('claude-login-expired', 'Your Claude sign-in has ended.');

    // A plain re-check never clears a sign-in failure; signed out, then ready, does.
    await logged.runtime();
    expect(logged.lastFailure()?.code).toBe('claude-login-expired');
    state = 'not-signed-in';
    await logged.runtime();
    state = 'ready';
    await logged.runtime();
    expect(logged.lastFailure()).toBeNull();

    // As the ai:test handler runs a test: one that quitting cancels says nothing; one that went through clears a failure.
    await expect(logged.review(request(), hooks)).rejects.toThrow();
    const quitting = await testConnection(logged, {
      track: (controller) => {
        controller.abort();
        return () => undefined;
      }
    });
    expect(quitting.error?.code).toBe('cancelled');
    logged.noteTest(quitting);
    expect(logged.lastFailure()).toEqual(expired);
    const passed = await testConnection(logged);
    expect(passed.ok).toBe(true);
    logged.noteTest(passed);
    expect(logged.lastFailure()).toBeNull();

    const events = lines.map(([level, event]) => `${level} ${event}`);
    expect(events).toEqual([
      'info ai.runtime',
      'info ai.review.start',
      'warn ai.review.failed',
      'info ai.review.start',
      'info ai.review.failed',
      'info ai.runtime',
      'info ai.runtime',
      'info ai.runtime',
      'info ai.review.start',
      'warn ai.review.failed'
    ]);
    expect(JSON.stringify(lines)).not.toContain('example.com');
    expect(JSON.stringify(lines)).not.toContain('PROBE-SAID');
  });

  it('moves the last failure with the answer a test gives the page, and with a check that throws, as the renderer does', async () => {
    type Test = NonNullable<ReviewProvider['test']>;
    const SPEND_LIMIT = "Your organisation's spend limit has been reached.";
    let runtimeNow: () => Promise<RuntimeStatus> = () => Promise.resolve(status);
    let reviewFailure = fail('claude-login-expired', 'Your Claude sign-in has ended.');
    let testNow: Test = () => Promise.resolve({});
    // A notice that one of the plan's limits was reached, from the reviews before the tests.
    let reviewNotice: RateLimitInfo | null = { status: 'rejected', kind: 'five_hour' };
    const stub: ReviewProvider = {
      id: 'claude',
      label: 'Claude',
      runtime: () => runtimeNow(),
      models: () => Promise.resolve([]),
      review: (_request, reviewHooks) => {
        if (reviewNotice) reviewHooks.onRateLimit?.(reviewNotice);
        return Promise.reject(reviewFailure);
      },
      test: (testHooks) => testNow(testHooks)
    };
    const logged = withLogging(stub, { log: () => undefined });
    const at = { executablePath: status.executablePath, cliVersion: '2.1.300' };
    await logged.runtime();

    /** One test as the ai:test handler runs it; main's last failure is then the renderer's (useAi's testConnection). */
    async function run(test: Test, timeoutMs = 2000): Promise<ConnectionTestResult> {
      testNow = test;
      const before = logged.lastFailure();
      const result = await testConnection(logged, { timeoutMs });
      logged.noteTest(result);
      const event = testSetupEvent(result, logged.lastRuntime());
      expect(logged.lastFailure()).toEqual(event ? nextLastFailure(before, event) : before);
      return result;
    }

    // A test that throws something unforeseen is a failed test to the page, not an unknown fault.
    await expect(logged.review(request(), hooks)).rejects.toThrow();
    expect(setupView(status, logged.lastFailure())).toBe('expired');
    const threw = await run(() => Promise.reject(new Error('socket hang up')));
    expect(threw.error?.code).toBe('claude-failed');
    expect(logged.lastFailure()).toEqual({ code: 'claude-failed', ...at });

    // A test that runs out of time ends inside as cancelled, but the page is told it failed,
    // which replaces the sign-in failure, so Setup no longer says the sign-in has ended.
    await expect(logged.review(request(), hooks)).rejects.toThrow();
    expect(logged.lastFailure()?.code).toBe('claude-login-expired');
    const timedOut = await run(
      (testHooks) =>
        new Promise((_resolve, reject) => {
          testHooks.signal.addEventListener('abort', () => reject(fail('cancelled', 'Test cancelled.')));
        }),
      20
    );
    expect(timedOut.error?.code).toBe('claude-failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logged.lastFailure()).toEqual({ code: 'claude-failed', ...at });
    expect(setupView(status, logged.lastFailure())).toBe('ready');

    // A usage limit is read with the test's own notice, not with a review's from before it.
    const limited = await run(() => Promise.reject(fail('claude-usage-limit', SPEND_LIMIT)));
    expect(limited.rateLimit).toBeUndefined();
    expect(logged.lastFailure()).toEqual({ code: 'claude-usage-limit', ...at, planLimit: false });
    await run((testHooks) => {
      testHooks.onRateLimit?.({ status: 'rejected', kind: 'five_hour' });
      return Promise.reject(fail('claude-usage-limit', SPEND_LIMIT));
    });
    expect(logged.lastFailure()).toEqual({ code: 'claude-usage-limit', ...at, planLimit: true });
    // A review's failure is read with the last notice, a test's included, as the page's is.
    reviewNotice = null;
    await run((testHooks) => {
      testHooks.onRateLimit?.({ status: 'rejected', usingOverage: true });
      return Promise.resolve({});
    });
    expect(logged.lastFailure()).toBeNull();
    reviewFailure = fail('claude-usage-limit', SPEND_LIMIT);
    await expect(logged.review(request(), hooks)).rejects.toThrow();
    expect(logged.lastFailure()).toEqual({ code: 'claude-usage-limit', ...at, planLimit: false });

    // A check that throws stands as the error status the page puts in its place, which clears an outdated failure.
    reviewFailure = fail('claude-outdated', 'Claude Code is older than this app needs.');
    await expect(logged.review(request(), hooks)).rejects.toThrow();
    const outdated = logged.lastFailure();
    expect(outdated).toEqual({ code: 'claude-outdated', ...at });
    runtimeNow = () => Promise.reject(new Error('the check could not start'));
    await expect(logged.runtime()).rejects.toThrow('the check could not start');
    const shown: RuntimeStatus = { provider: 'claude', state: 'error', message: 'the check could not start' };
    expect(logged.lastRuntime()).toEqual(shown);
    expect(logged.lastFailure()).toEqual(nextLastFailure(outdated, { type: 'check', runtime: shown }));
    expect(logged.lastFailure()).toBeNull();
  });

  it('gives a provider without a connection test none', () => {
    const plain: ReviewProvider = {
      id: 'openai',
      label: 'OpenAI',
      runtime: () => Promise.reject(new Error('unused')),
      models: () => Promise.resolve([]),
      review: () => Promise.reject(new Error('unused'))
    };
    expect('test' in withLogging(plain, { log: () => undefined })).toBe(false);
  });
});
