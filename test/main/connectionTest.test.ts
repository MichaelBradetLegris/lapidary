import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fail } from '../../src/main/errors';
import { CONNECTION_TEST_MODEL, runCliTest, type CliDeps } from '../../src/main/providers/claudeCli';
import { BASE_CLAUDE_ARGS } from '../../src/main/providers/claudeOptions';
import {
  CONNECTION_TEST_PROMPT,
  CONNECTION_TEST_SYSTEM_PROMPT,
  CONNECTION_TEST_TIMEOUT_MS,
  testConnection
} from '../../src/main/providers/connectionTest';
import { createChatGptProvider } from '../../src/main/providers/chatgpt';
import { abortAll, liveControllerCount, registerController } from '../../src/main/providers/controllers';
import type { ProviderTestHooks, ReviewProvider } from '../../src/main/providers/types';
import type { RateLimitInfo } from '../../src/shared/ipc';

/* setup.8: Test the connection. The Claude test is the review's exchange with
   Claude Code with a one-line prompt, run against test/helpers/fakeClaude.ts,
   which plays one scenario each. ChatGPT has none (codex.3), and the OpenAI
   API key's, against test/helpers/mockOpenAi.ts, went with that provider
   (codex.6). `testConnection` is what `ai:test` answers with: it times the
   test, stops it after 60 s and turns every outcome into an answer, never a
   thrown error. Each outcome is covered: ok, refused, signed out, rate and
   usage limits, and a timeout. */

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fakeClaude.ts');

interface Watched {
  deps: CliDeps;
  stderr: string[];
  children: ChildProcess[];
}

/** deps that run the fake in `scenario`, keep what it says on stderr and remember the processes it starts */
function fake(scenario: string): Watched {
  const stderr: string[] = [];
  const children: ChildProcess[] = [];
  const spawnWatched = ((...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    children.push(child);
    return child;
  }) as typeof spawn;
  return {
    stderr,
    children,
    deps: {
      spawn: spawnWatched,
      executable: process.execPath,
      prefixArgs: [FAKE],
      cwd: path.dirname(FAKE),
      env: { ...(process.env as Record<string, string>), FAKE_CLAUDE_SCENARIO: scenario },
      onStderr: (line) => stderr.push(line),
      track: registerController,
      killTree: (child) => child.kill()
    }
  };
}

/** A Claude provider whose test runs the fake, as claude.ts runs the user's Claude Code. */
function claudeOn(run: Watched): ReviewProvider {
  return {
    id: 'claude',
    label: 'Claude',
    runtime: () => Promise.reject(new Error('not used')),
    models: () => Promise.resolve([]),
    review: () => Promise.reject(new Error('not used')),
    test: (hooks) => runCliTest(run.deps, hooks)
  };
}

function hooks(signal = new AbortController().signal): ProviderTestHooks & { rateLimits: RateLimitInfo[] } {
  const rateLimits: RateLimitInfo[] = [];
  return { signal, onRateLimit: (info) => rateLimits.push(info), rateLimits };
}

const argsOf = (stderr: string[]): string[] =>
  JSON.parse(stderr.find((l) => l.startsWith('ARGS '))?.slice(5) ?? '[]') as string[];

const ended = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

/** Wait until every process the fake started has gone, for at most 5 s. */
async function allEnded(children: ChildProcess[]): Promise<boolean> {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (children.length > 0 && children.every(ended)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return children.every(ended);
}

describe('the Claude test, through Claude Code (runCliTest)', () => {
  it('asks Haiku, in one turn, for the single word OK, through the review flags and nothing more', async () => {
    const run = fake('success');
    const h = hooks();
    const result = await runCliTest(run.deps, h);
    expect(result).toEqual({ model: 'claude-haiku-4-5-20251001' });
    expect(CONNECTION_TEST_MODEL).toBe('haiku');
    // The same command line as a review: no tools, no settings, no MCP, never --bare (CLAUDE.md rule 6).
    expect(argsOf(run.stderr)).toEqual([...BASE_CLAUDE_ARGS, '--model', 'haiku', '--max-turns', '1']);
    expect(argsOf(run.stderr)).not.toContain('--bare');
    // The system prompt travels in initialize, with no schema; the one user message is the prompt.
    const init = JSON.parse(run.stderr.find((l) => l.startsWith('INIT '))?.slice(5) ?? '{}') as {
      systemPrompt: unknown;
      hasSchema: boolean;
    };
    expect(init).toEqual({ systemPrompt: ['Reply with the single word OK.'], hasSchema: false });
    expect(CONNECTION_TEST_SYSTEM_PROMPT).toBe('Reply with the single word OK.');
    expect(run.stderr.filter((l) => l.startsWith('USER '))).toEqual([
      `USER ${JSON.stringify(CONNECTION_TEST_PROMPT)}`
    ]);
    expect(h.rateLimits).toEqual([
      {
        status: 'allowed',
        resetsAt: new Date(1790000000 * 1000).toISOString(),
        kind: 'five_hour',
        usingOverage: false
      }
    ]);
    expect(await allEnded(run.children)).toBe(true);
  });

  it('names the model from the init message when the result has no usage', async () => {
    await expect(runCliTest(fake('no-model-usage').deps, hooks())).resolves.toEqual({
      model: 'claude-haiku-4-5-20251001'
    });
  });

  it('reads "Not logged in" as signed out', async () => {
    await expect(runCliTest(fake('is-error').deps, hooks())).rejects.toMatchObject({
      code: 'claude-not-signed-in'
    });
  });

  it("reports the model's refusal in its own words", async () => {
    await expect(runCliTest(fake('refusal').deps, hooks())).rejects.toMatchObject({
      code: 'claude-refusal',
      message: 'The model declined this request.'
    });
  });

  it('reports a Claude Code that refused the request', async () => {
    const err = (await runCliTest(fake('init-refused').deps, hooks()).catch((e: unknown) => e)) as {
      code: string;
      message: string;
    };
    expect(err.code).toBe('claude-failed');
    expect(err.message).toBe('Claude Code refused the request: nope');
  });

  it('recognises the usage limit and a rate limit', async () => {
    await expect(runCliTest(fake('usage-limit').deps, hooks())).rejects.toMatchObject({
      code: 'claude-usage-limit'
    });
    await expect(runCliTest(fake('assistant-error').deps, hooks())).rejects.toMatchObject({
      code: 'claude-rate-limit'
    });
  });

  it('says a Claude Code that stopped did so before the test, not the review', async () => {
    const err = (await runCliTest(fake('bad-flag').deps, hooks()).catch((e: unknown) => e)) as {
      message: string;
    };
    expect(err.message).toContain('claude update');
    const ended = (await runCliTest(fake('ends-early').deps, hooks()).catch((e: unknown) => e)) as {
      code: string;
    };
    expect(ended.code).toBe('claude-failed');
  });

  it('is cancelled by its signal, and by quitting, and ends its process', async () => {
    const controller = new AbortController();
    const run = fake('slow');
    const pending = runCliTest(run.deps, hooks(controller.signal));
    setTimeout(() => controller.abort(), 300);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled', message: 'Test cancelled.' });
    expect(await allEnded(run.children)).toBe(true);

    const quit = fake('slow');
    const quitting = runCliTest(quit.deps, hooks());
    setTimeout(() => abortAll(), 300);
    await expect(quitting).rejects.toMatchObject({ code: 'cancelled' });
    expect(await allEnded(quit.children)).toBe(true);
    expect(liveControllerCount()).toBe(0);
  });
});

describe('testConnection, what ai:test answers', () => {
  it('answers a test that went through with the model, the time it took and the rate-limit notice', async () => {
    let clock = 1000;
    const result = await testConnection(claudeOn(fake('success')), {
      now: () => (clock += 1500)
    });
    expect(result).toEqual({
      ok: true,
      model: 'claude-haiku-4-5-20251001',
      durationMs: 1500,
      rateLimit: {
        status: 'allowed',
        resetsAt: new Date(1790000000 * 1000).toISOString(),
        kind: 'five_hour',
        usingOverage: false
      }
    });
  });

  it('answers a failed test with the reason, rather than throwing: signed out, refused, limited', async () => {
    const signedOut = await testConnection(claudeOn(fake('is-error')));
    expect(signedOut.ok).toBe(false);
    expect(signedOut.error?.code).toBe('claude-not-signed-in');
    expect(signedOut.durationMs).toBeGreaterThanOrEqual(0);
    expect(signedOut.model).toBeUndefined();
    // The notice that came before the result is kept.
    expect(signedOut.rateLimit?.status).toBe('allowed');

    expect((await testConnection(claudeOn(fake('refusal')))).error).toMatchObject({
      code: 'claude-refusal',
      message: 'The model declined this request.'
    });
    expect((await testConnection(claudeOn(fake('usage-limit')))).error?.code).toBe('claude-usage-limit');
    expect((await testConnection(claudeOn(fake('assistant-error')))).error?.code).toBe('claude-rate-limit');
  });

  it('stops a test that runs out of time, answers at once, and leaves no process or controller behind', async () => {
    const run = fake('slow');
    const started = Date.now();
    const result = await testConnection(claudeOn(run), { timeoutMs: 1000, track: registerController });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'claude-failed',
        message: 'Claude did not answer within 1 second, so the test was stopped. Try again in a minute.'
      }
    });
    expect(await allEnded(run.children)).toBe(true);
    await vi.waitFor(() => expect(liveControllerCount()).toBe(0));
  });

  it('gives a test 60 seconds unless told otherwise', async () => {
    expect(CONNECTION_TEST_TIMEOUT_MS).toBe(60_000);
    vi.useFakeTimers();
    try {
      let aborted = false;
      const never: ReviewProvider = {
        ...claudeOn(fake('success')),
        test: (h) =>
          new Promise((_resolve, reject) => {
            h.signal.addEventListener('abort', () => {
              aborted = true;
              reject(fail('cancelled', 'Test cancelled.'));
            });
          })
      };
      let answer: Awaited<ReturnType<typeof testConnection>> | null = null;
      void testConnection(never).then((result) => (answer = result));
      await vi.advanceTimersByTimeAsync(59_999);
      expect(answer).toBeNull();
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(aborted).toBe(true);
      expect(answer).toMatchObject({
        ok: false,
        error: {
          message: 'Claude did not answer within 60 seconds, so the test was stopped. Try again in a minute.'
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers a test cancelled by quitting as cancelled', async () => {
    const pending = testConnection(claudeOn(fake('slow')), { track: registerController });
    setTimeout(() => abortAll(), 300);
    expect((await pending).error?.code).toBe('cancelled');
  });

  it('registers its own controller, so quitting ends a test that holds none of its own', async () => {
    // The Claude test above is also ended through the exchange's controller,
    // so it would pass without this one; a provider's test that, like this
    // stub, only listens to the signal it is given needs it (setup.8 review).
    let heard = false;
    const listening: ReviewProvider = {
      ...claudeOn(fake('success')),
      test: (h) =>
        new Promise((_resolve, reject) => {
          h.signal.addEventListener('abort', () => {
            heard = true;
            reject(fail('cancelled', 'Test cancelled.'));
          });
        })
    };
    expect(liveControllerCount()).toBe(0);
    const pending = testConnection(listening, { track: registerController });
    expect(liveControllerCount()).toBe(1);
    expect(abortAll()).toBe(1);
    expect(heard).toBe(true);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(liveControllerCount()).toBe(0);
  });

  it('says so for a provider with no test, and words an unforeseen error as a failed test, never a file error', async () => {
    const withoutTest: ReviewProvider = {
      id: 'claude',
      label: 'Claude',
      runtime: () => Promise.reject(new Error('not used')),
      models: () => Promise.resolve([]),
      review: () => Promise.reject(new Error('not used'))
    };
    expect(await testConnection(withoutTest)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input', message: 'Claude has no connection test.' }
    });
    const broken: ReviewProvider = {
      ...withoutTest,
      test: () => Promise.reject(Object.assign(new Error('EACCES: boom'), { code: 'EACCES' }))
    };
    expect((await testConnection(broken)).error).toEqual({
      code: 'claude-failed',
      message: 'The test failed: EACCES: boom'
    });
  });

  it('answers ChatGPT, which has no test, without asking its sign-in for anything (codex.3)', async () => {
    let asked = false;
    const chatgpt = createChatGptProvider({
      session: () => {
        asked = true;
        throw new Error('not used');
      }
    });
    expect('test' in chatgpt).toBe(false);
    expect(await testConnection(chatgpt)).toMatchObject({
      ok: false,
      error: { code: 'invalid-input', message: 'ChatGPT has no connection test.' }
    });
    expect(asked).toBe(false);
  });
});
