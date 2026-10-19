import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import {
  cliInitialize,
  runCliReview,
  type CliDeps,
  type CliReviewInput
} from '../../src/main/providers/claudeCli';
import { BASE_CLAUDE_ARGS } from '../../src/main/providers/claudeOptions';
import { abortAll, liveControllerCount, registerController } from '../../src/main/providers/controllers';
import type { ProgressPhase } from '../../src/main/providers/types';
import { replyLimitMessage } from '../../src/shared/ai/replyLimit';
import { reviewOutputJsonSchema } from '../../src/shared/prompt/schema';

/* cli.1: the app talks to the user's own Claude Code over stream-json. These
   tests run the real code against test/helpers/fakeClaude.ts, a Node script
   that plays one scenario each. */

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fakeClaude.ts');

function deps(scenario: string, stderr: string[] = [], extraEnv: Record<string, string> = {}): CliDeps {
  return {
    spawn,
    executable: process.execPath,
    prefixArgs: [FAKE],
    cwd: path.dirname(FAKE),
    env: { ...(process.env as Record<string, string>), FAKE_CLAUDE_SCENARIO: scenario, ...extraEnv },
    onStderr: (line) => stderr.push(line),
    track: registerController,
    killTree: (child) => child.kill()
  };
}

const INPUT = {
  systemPrompt: 'You are a copy editor.',
  jsonSchema: reviewOutputJsonSchema,
  prompt: '[1] It was teh night.',
  model: 'haiku',
  effort: 'low' as const
};

function hooks(signal = new AbortController().signal) {
  const phases: ProgressPhase[] = [];
  const rateLimits: unknown[] = [];
  return {
    phases,
    rateLimits,
    hooks: {
      onProgress: (phase: ProgressPhase) => phases.push(phase),
      onRateLimit: (info: unknown) => rateLimits.push(info),
      signal
    }
  };
}

describe('runCliReview', () => {
  it('returns the parsed review, the model, the cost and the rate limit', async () => {
    const stderr: string[] = [];
    const h = hooks();
    const result = await runCliReview(deps('success', stderr), INPUT, h.hooks);
    expect(result.output.changes).toHaveLength(1);
    expect(result.output.comments).toHaveLength(1);
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.costUsd).toBe(0.0123);
    expect(result.costEstimated).toBe(false);
    expect(result.durationMs).toBe(1234);
    // The usage notice, as Claude Code 2.1.302 sends it (setup.9), reduced to what the app reads:
    // `allowed` comes with no share used, which only `allowed_warning` carries (C.64).
    const notice = {
      status: 'allowed',
      resetsAt: new Date(1790000000 * 1000).toISOString(),
      kind: 'five_hour',
      usingOverage: false
    };
    expect(result.rateLimit).toEqual(notice);
    expect(h.rateLimits).toEqual([notice]);
    expect(h.phases[0]).toBe('starting');
    expect(h.phases).toContain('thinking');
    expect(h.phases).toContain('streaming');
    expect(h.phases).toContain('parsing');
    expect(h.phases.at(-1)).toBe('done');
    // The chapter went in as the user message, not on the command line.
    expect(stderr.some((l) => l.startsWith('USER "[1] It was teh night.'))).toBe(true);
  });

  it('passes the pinned flags, the model and the effort, and nothing else', async () => {
    const stderr: string[] = [];
    await runCliReview(deps('success', stderr), INPUT, hooks().hooks);
    const argsLine = stderr.find((l) => l.startsWith('ARGS '));
    const args = JSON.parse(argsLine?.slice(5) ?? '[]') as string[];
    expect(args).toEqual([
      ...BASE_CLAUDE_ARGS,
      '--model',
      'haiku',
      '--effort',
      'low',
      '--max-turns',
      '3',
      '--include-partial-messages'
    ]);
    expect(args).not.toContain('--bare');
    expect(args.join(' ')).not.toContain('copy editor');
  });

  it('leaves out --model for the Default model', async () => {
    const stderr: string[] = [];
    await runCliReview(deps('success', stderr), { ...INPUT, model: 'default' }, hooks().hooks);
    const args = JSON.parse(stderr.find((l) => l.startsWith('ARGS '))?.slice(5) ?? '[]') as string[];
    expect(args).not.toContain('--model');
  });

  it('ignores lines that are not messages', async () => {
    const result = await runCliReview(deps('malformed'), INPUT, hooks().hooks);
    expect(result.output.changes).toHaveLength(1);
  });

  it('reads a failure reported as a success with is_error', async () => {
    await expect(runCliReview(deps('is-error'), INPUT, hooks().hooks)).rejects.toMatchObject({
      code: 'claude-not-signed-in'
    });
  });

  it('recognises a usage limit, after a notice that names the limit reached', async () => {
    const h = hooks();
    await expect(runCliReview(deps('usage-limit'), INPUT, h.hooks)).rejects.toMatchObject({
      code: 'claude-usage-limit'
    });
    // The notice reaches the page before the failure, so the card can name the limit (setup.9);
    // a `rejected` notice has no share used (C.64).
    expect(h.rateLimits).toEqual([
      {
        status: 'rejected',
        resetsAt: new Date(1790000000 * 1000).toISOString(),
        kind: 'five_hour',
        usingOverage: false
      }
    ]);
  });

  it('reads the limit, the share used and extra usage from each usage notice (setup.9)', async () => {
    // Claude Code 2.1.302's two notices that carry more: its own warning, the only one with
    // a share used, and a plan limit refused while extra usage pays.
    const warning = {
      status: 'allowed_warning',
      resetsAt: 1790003600,
      rateLimitType: 'seven_day',
      utilization: 0.91,
      isUsingOverage: false,
      surpassedThreshold: 0.9,
      unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 1790000000 } }
    };
    const extraUsage = {
      status: 'rejected',
      resetsAt: 1790003600,
      rateLimitType: 'five_hour',
      isUsingOverage: true,
      overageStatus: 'allowed',
      overageResetsAt: 1792000000
    };
    const read = [
      {
        status: 'allowed_warning',
        resetsAt: new Date(1790003600 * 1000).toISOString(),
        kind: 'seven_day',
        utilization: 0.91,
        usingOverage: false
      },
      {
        status: 'rejected',
        resetsAt: new Date(1790003600 * 1000).toISOString(),
        kind: 'five_hour',
        usingOverage: true
      }
    ];
    for (const [i, info] of [warning, extraUsage].entries()) {
      const h = hooks();
      const result = await runCliReview(
        deps('success', [], { FAKE_CLAUDE_RATE_LIMIT: JSON.stringify(info) }),
        INPUT,
        h.hooks
      );
      expect(result.rateLimit).toEqual(read[i]);
      expect(h.rateLimits).toEqual([read[i]]);
    }
  });

  it("reports a refusal with the model's explanation", async () => {
    await expect(runCliReview(deps('refusal'), INPUT, hooks().hooks)).rejects.toMatchObject({
      code: 'claude-refusal',
      message: 'The model declined this request.'
    });
  });

  it('maps an assistant error', async () => {
    await expect(runCliReview(deps('assistant-error'), INPUT, hooks().hooks)).rejects.toMatchObject({
      code: 'claude-rate-limit'
    });
  });

  it('says so when the output does not match the schema', async () => {
    await expect(runCliReview(deps('wrong-shape'), INPUT, hooks().hooks)).rejects.toMatchObject({
      code: 'claude-invalid-output'
    });
  });

  it('points at "claude update" when Claude Code rejects a flag', async () => {
    const err = (await runCliReview(deps('bad-flag'), INPUT, hooks().hooks).catch((e: unknown) => e)) as {
      code: string;
      message: string;
    };
    expect(err.code).toBe('claude-failed');
    expect(err.message).toContain('claude update');
  });

  it('fails clearly when Claude Code ends without a result', async () => {
    await expect(runCliReview(deps('ends-early'), INPUT, hooks().hooks)).rejects.toMatchObject({
      code: 'claude-failed'
    });
  });

  it('cancels a running review promptly and leaves nothing tracked', async () => {
    const controller = new AbortController();
    const h = hooks(controller.signal);
    const started = Date.now();
    const pending = runCliReview(deps('slow'), INPUT, h.hooks);
    setTimeout(() => controller.abort(), 500);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(Date.now() - started).toBeLessThan(6000);
    expect(liveControllerCount()).toBe(0);
  });

  it('is aborted by quitting', async () => {
    const pending = runCliReview(deps('slow'), INPUT, hooks().hooks);
    setTimeout(() => abortAll(), 500);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

/* files.10: a reply that runs out of room, in the shapes Claude Code 2.1.302
   sends (test/helpers/fakeClaude.ts, PLAN C.77), says so, with what helps. */
describe('a review whose reply runs out of room (files.10)', () => {
  const LONG = { ...INPUT, effort: 'high' as const, words: 52_300 };

  async function failure(
    scenario: string,
    input: CliReviewInput = INPUT,
    extraEnv: Record<string, string> = {}
  ): Promise<AppFailure> {
    try {
      await runCliReview(deps(scenario, [], extraEnv), input, hooks().hooks);
    } catch (err) {
      if (err instanceof AppFailure) return err;
      throw err;
    }
    throw new Error('expected a failure');
  }

  it('names the output limit once Claude Code stops resuming the reply, with what helps', async () => {
    const err = await failure('output-limit', LONG);
    expect(err.code).toBe('claude-failed');
    expect(err.message).toBe(
      "Claude reached its output limit (32,000 tokens) before it had written every suggestion, so none came back. The model's thinking counts against the same limit, so a lower effort in Review with AI leaves more of it for the suggestions. At 52,300 words the chapter is long for one review: if a lower effort is not enough, split it into two files and review each."
    );
    // Claude Code's own words name a variable the app does not set (CLAUDE.md rule 6); they go to the detail.
    expect(err.detail).toContain('CLAUDE_CODE_MAX_OUTPUT_TOKENS');
    expect(err.message).not.toContain('CLAUDE_CODE_MAX_OUTPUT_TOKENS');
  });

  it('says to try again after a low-effort review of a short chapter', async () => {
    const err = await failure('output-limit');
    expect(err.message).toBe(
      'Claude reached its output limit (32,000 tokens) before it had written every suggestion, so none came back. Try again, or choose another model.'
    );
  });

  it('tells a full context window from the output limit, which share one error', async () => {
    const err = await failure('context-limit', LONG);
    expect(err.message).toBe(replyLimitMessage('context', { who: 'Claude', words: 52_300, effort: 'high' }));
    expect(err.message).toMatch(/^Claude ran out of room for the chapter and its reply together/);
  });

  it('says a chapter too long to send is too long to read', async () => {
    const err = await failure('prompt-too-long', LONG);
    expect(err.message).toBe(
      'The chapter is too long for Claude to read in one request (52,300 words), so nothing came back. Split it into shorter files and review each.'
    );
    expect(err.detail).toBe('Prompt is too long');
  });

  it('reads running out of turns after a reply cut off at the limit as the limit, by the last reply', async () => {
    const limit = replyLimitMessage('output', { who: 'Claude', words: 52_300, effort: 'high' });
    expect((await failure('max-turns', LONG, { FAKE_CLAUDE_STOPS: 'max_tokens' })).message).toBe(limit);
    expect((await failure('max-turns', LONG, { FAKE_CLAUDE_STOPS: 'tool_use,max_tokens' })).message).toBe(
      limit
    );
    // A reply cut off and then resumed is not why the run failed.
    for (const stops of ['max_tokens,tool_use', '']) {
      const err = await failure('max-turns', LONG, { FAKE_CLAUDE_STOPS: stops });
      expect(err.message).toBe('Claude ran out of turns before producing a result.');
      expect(err.detail).toBe('Reached maximum number of turns (3)');
    }
  });

  it('reads running out of schema retries after a cut-off reply as the limit', async () => {
    expect((await failure('schema-retries', LONG, { FAKE_CLAUDE_STOPS: 'max_tokens' })).message).toBe(
      replyLimitMessage('output', { who: 'Claude', words: 52_300, effort: 'high' })
    );
    expect(await failure('schema-retries', LONG)).toMatchObject({
      code: 'claude-invalid-output',
      message: 'Claude could not produce output matching the schema after several tries.'
    });
  });

  it('reads a success with no output after a cut-off reply as the limit, not as a reply of the wrong shape', async () => {
    const limit = replyLimitMessage('output', { who: 'Claude', words: 52_300, effort: 'high' });
    expect((await failure('no-output', LONG, { FAKE_CLAUDE_RESULT_STOP: 'max_tokens' })).message).toBe(limit);
    // With no stop reason in the result, the last streamed reply's decides.
    expect(
      (await failure('no-output', LONG, { FAKE_CLAUDE_STOPS: 'max_tokens', FAKE_CLAUDE_RESULT_STOP: 'none' }))
        .message
    ).toBe(limit);
    // The result's own stop reason outranks the stream's.
    expect(await failure('no-output', LONG, { FAKE_CLAUDE_STOPS: 'max_tokens' })).toMatchObject({
      code: 'claude-invalid-output'
    });
    expect(await failure('no-output', LONG)).toMatchObject({ code: 'claude-invalid-output' });
  });
});

describe('cliInitialize', () => {
  it('returns the models and the account without sending a prompt', async () => {
    const stderr: string[] = [];
    const info = await cliInitialize(deps('success', stderr));
    expect(info.models.map((m) => m.value)).toEqual(['default', 'haiku']);
    expect(info.models[0]?.description).toContain('Opus 5.5');
    // The organisation in the reply is never kept.
    expect(info.account).toEqual({ email: 'ann@example.com', subscriptionType: 'Claude Max' });
    expect(stderr.some((l) => l.startsWith('USER'))).toBe(false);
  });

  it('reports a refused initialize', async () => {
    await expect(cliInitialize(deps('init-refused'))).rejects.toMatchObject({ code: 'claude-failed' });
  });

  it('reports a Claude Code that would not start', async () => {
    await expect(cliInitialize(deps('bad-flag'))).rejects.toMatchObject({ code: 'claude-failed' });
  });
});

describe('the initialize handshake always ends the process (setup.4)', () => {
  /** deps that remember the child they started, to see that it is gone afterwards */
  function watched(scenario: string) {
    const children: ChildProcess[] = [];
    const base = deps(scenario);
    const spawnWatched = ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      children.push(child);
      return child;
    }) as typeof spawn;
    return { children, deps: { ...base, spawn: spawnWatched } };
  }

  const ended = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

  it('on success', async () => {
    const run = watched('success');
    await cliInitialize(run.deps);
    expect(run.children.length).toBe(1);
    expect(run.children.every(ended)).toBe(true);
  });

  it('on a refusal', async () => {
    const run = watched('init-refused');
    await expect(cliInitialize(run.deps)).rejects.toMatchObject({ code: 'claude-failed' });
    expect(run.children.every(ended)).toBe(true);
  });

  it('on a timeout, promptly, and leaves nothing tracked', async () => {
    const run = watched('init-silent');
    const started = Date.now();
    await expect(cliInitialize(run.deps, 400)).rejects.toThrow('Claude Code did not answer in time.');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(run.children.every(ended)).toBe(true);
    expect(liveControllerCount()).toBe(0);
  });
});
