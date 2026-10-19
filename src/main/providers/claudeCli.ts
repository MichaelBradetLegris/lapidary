import type { ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import type { SdkModel } from '../../shared/ai/claudeModels';
import { classifyClaudeFailure, type ClaudeAccount } from '../../shared/ai/claudeStatus';
import type { RateLimitInfo } from '../../shared/ipc';
import { parseReviewOutput } from '../../shared/prompt/schema';
import type { EffortLevel } from '../../shared/types';
import { fail } from '../errors';
import { claudeArgs } from './claudeOptions';
import {
  cutOffReply,
  endedWithoutResult,
  readRateLimit,
  resultToError,
  type ResultContext
} from './claudeResult';
import { CONNECTION_TEST_PROMPT, CONNECTION_TEST_SYSTEM_PROMPT } from './connectionTest';
import type { ProviderHooks, ProviderResult, ProviderTestHooks, ProviderTestResult } from './types';

/**
 * Talking to the user's own Claude Code (PLAN 11.3 q, C.42).
 *
 * The app ships nothing of Anthropic's. It runs the `claude` the user installed,
 * with the flags in claudeOptions.ts, and speaks the same newline-delimited JSON
 * on stdin and stdout that Anthropic's SDK speaks:
 *
 * - an `initialize` control request first, which carries the system prompt and
 *   the output schema and is answered with the model list and the account;
 * - then the chapter as one user message;
 * - then a stream of `system`, `stream_event`, `assistant`, `rate_limit_event`
 *   and finally `result` messages.
 *
 * Test the connection (setup.8) is the same exchange with a one-line prompt.
 *
 * Nothing here touches credentials: Claude Code signs in on its own (CLAUDE.md
 * rule 2). No electron import; `spawn` and the executable are passed in, so
 * test/main/claudeCli.test.ts drives the same code against a fake.
 */

export interface CliDeps {
  spawn: typeof nodeSpawn;
  /** the Claude Code executable (tests pass Node and a fake script in `prefixArgs`) */
  executable: string;
  /** arguments placed before Claude Code's own */
  prefixArgs?: readonly string[];
  /** never the vault (CLAUDE.md rule 6) */
  cwd: string;
  env: Record<string, string>;
  onStderr?: (line: string) => void;
  /** registers a run's controller so quitting aborts it (controllers.ts) */
  track?: (controller: AbortController) => () => void;
  /** ends a process and its children; the default is `taskkill /T /F` on Windows */
  killTree?: (child: ChildProcess) => void;
}

/** One message on Claude Code's stdout, loosely typed: only the fields read here are named. */
export interface CliMessage {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

interface ControlResponse {
  subtype?: string;
  request_id?: string;
  response?: Record<string, unknown>;
  error?: unknown;
}

const STDERR_TAIL = 4096;

/** An error field from a control response, as text. */
function errorText(value: unknown): string {
  if (typeof value === 'string' && value) return value;
  if (value === undefined || value === null) return 'unknown error';
  return JSON.stringify(value);
}

function defaultKillTree(spawn: typeof nodeSpawn): (child: ChildProcess) => void {
  return (child) => {
    if (child.exitCode !== null || child.pid === undefined) return;
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
          'error',
          () => child.kill()
        );
        return;
      } catch {
        // fall through to a plain kill
      }
    }
    child.kill();
  };
}

/** One running `claude` process and its message streams. */
class CliRun {
  readonly exit: Promise<number | null>;
  stderrTail = '';
  malformed = 0;
  private readonly child: ChildProcess;
  private buffer = '';
  private readonly queue: CliMessage[] = [];
  private readonly waiters: ((message: CliMessage | null) => void)[] = [];
  private readonly pending = new Map<string, (response: ControlResponse | null) => void>();
  private closed = false;
  private seq = 0;
  private readonly killTree: (child: ChildProcess) => void;

  constructor(deps: CliDeps, args: readonly string[]) {
    this.killTree = deps.killTree ?? defaultKillTree(deps.spawn);
    this.child = deps.spawn(deps.executable, [...(deps.prefixArgs ?? []), ...args], {
      cwd: deps.cwd,
      env: deps.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdin?.on('error', () => undefined);
    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL);
      for (const line of chunk.split(/\r?\n/)) if (line.trim()) deps.onStderr?.(line);
    });
    this.exit = new Promise((resolve) => {
      const done = (code: number | null): void => {
        this.closed = true;
        for (const waiter of this.waiters.splice(0)) waiter(null);
        for (const resolvePending of this.pending.values()) resolvePending(null);
        this.pending.clear();
        resolve(code);
      };
      this.child.on('error', (err) => {
        this.stderrTail = `${this.stderrTail}\n${err.message}`.slice(-STDERR_TAIL);
        done(null);
      });
      this.child.on('close', (code) => done(code));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let message: CliMessage;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as CliMessage).type !== 'string') {
        this.malformed += 1;
        return;
      }
      message = parsed as CliMessage;
    } catch {
      this.malformed += 1;
      return;
    }
    if (message.type === 'control_response') {
      const response = message['response'] as ControlResponse | undefined;
      const id = response?.request_id;
      const resolve = id ? this.pending.get(id) : undefined;
      if (id && resolve) {
        this.pending.delete(id);
        resolve(response ?? null);
      }
      return;
    }
    if (message.type === 'control_request') {
      // With every tool removed there is nothing to approve; refuse whatever is asked.
      const id = message['request_id'];
      this.write({
        type: 'control_response',
        response: { subtype: 'error', request_id: id, error: 'Not supported by this app.' }
      });
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.queue.push(message);
  }

  private write(message: unknown): void {
    if (this.closed) return;
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  /** A control request; resolves with the response, or null if the process ended first. */
  request(subtype: string, payload: Record<string, unknown> = {}): Promise<ControlResponse | null> {
    if (this.closed) return Promise.resolve(null);
    this.seq += 1;
    const id = `req-${this.seq}`;
    const answer = new Promise<ControlResponse | null>((resolve) => this.pending.set(id, resolve));
    this.write({ type: 'control_request', request_id: id, request: { subtype, ...payload } });
    return answer;
  }

  sendUser(text: string): void {
    this.write({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: ''
    });
  }

  /** The next message, or null once the process has ended and nothing is left. */
  next(): Promise<CliMessage | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  end(): void {
    if (!this.closed) this.child.stdin?.end();
  }

  kill(): void {
    if (!this.closed) this.killTree(this.child);
  }
}

/* ------------------------------------------------------------------ */
/* The initialize exchange                                             */
/* ------------------------------------------------------------------ */

/** The account in the initialize reply: only the fields `classifyClaude` reads, never the organisation. */
export type CliAccount = ClaudeAccount;

export interface CliInitInfo {
  models: SdkModel[];
  account: CliAccount;
}

function toModels(value: unknown): SdkModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SdkModel[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const e = entry as Record<string, unknown>;
    if (typeof e['value'] !== 'string') return [];
    return [
      {
        value: e['value'],
        ...(typeof e['displayName'] === 'string' ? { displayName: e['displayName'] } : {}),
        ...(typeof e['description'] === 'string' ? { description: e['description'] } : {}),
        ...(typeof e['resolvedModel'] === 'string' ? { resolvedModel: e['resolvedModel'] } : {})
      }
    ];
  });
}

const ACCOUNT_FIELDS = ['email', 'subscriptionType', 'tokenSource', 'apiKeySource', 'apiProvider'] as const;

function toAccount(value: unknown): CliAccount {
  const a = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const account: CliAccount = {};
  for (const field of ACCOUNT_FIELDS) {
    const text = a[field];
    if (typeof text === 'string' && text !== '') account[field] = text;
  }
  return account;
}

/**
 * Start Claude Code, ask for its models and account, and stop it again. No
 * prompt is sent, so this costs no usage.
 */
export async function cliInitialize(deps: CliDeps, timeoutMs = 60_000): Promise<CliInitInfo> {
  const run = new CliRun(deps, claudeArgs());
  const controller = new AbortController();
  const release = deps.track?.(controller) ?? ((): void => undefined);
  controller.signal.addEventListener('abort', () => run.kill(), { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await run.request('initialize');
    if (!response) {
      const detail = run.stderrTail.trim();
      if (controller.signal.aborted) {
        throw fail('claude-failed', 'Claude Code did not answer in time.', detail || undefined);
      }
      const failure = classifyClaudeFailure({ text: detail });
      if (failure.code !== 'claude-failed') throw fail(failure.code, failure.message, failure.detail);
      throw fail(
        'claude-failed',
        `Claude Code stopped before it was ready.${detail ? ` ${detail.split('\n')[0]}` : ''}`,
        detail || undefined
      );
    }
    if (response.subtype !== 'success') {
      throw fail('claude-failed', `Claude Code refused to start: ${errorText(response.error)}`);
    }
    const body = response.response ?? {};
    return { models: toModels(body['models']), account: toAccount(body['account']) };
  } finally {
    clearTimeout(timer);
    run.end();
    // Give it a moment to exit by itself; then make sure.
    await Promise.race([run.exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
    run.kill();
    release();
  }
}

/* ------------------------------------------------------------------ */
/* The review                                                          */
/* ------------------------------------------------------------------ */

export interface CliReviewInput {
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
  /** the numbered chapter, sent as the one user message */
  prompt: string;
  model: string;
  effort: EffortLevel;
  /** the chapter's words (`chapterStats`), for the message when the reply runs out of room (files.10) */
  words?: number;
}

interface Context extends ResultContext {
  /** the model the `system` init message named */
  model?: string;
  fallbackNote?: string;
  rateLimit?: RateLimitInfo;
}

/** A stream event's fields that drive the progress label, and why a reply stopped (files.10). */
interface StreamEvent {
  type?: string;
  usage?: { output_tokens?: number };
  delta?: { stop_reason?: unknown };
}

/** One request to Claude: what a review and a connection test have in common. */
interface Exchange<T> {
  args: string[];
  /** the fields of the `initialize` control request: the system prompt, and a review's schema */
  init: Record<string, unknown>;
  /** the one user message */
  prompt: string;
  signal: AbortSignal;
  /** what is being asked for, in the words of a failure: "review" or "test" */
  what: string;
  /** a review's chapter words and effort, which word a reply that ran out of room (files.10) */
  limitFacts?: ResultContext['limitFacts'];
  onStreamEvent?: (event: StreamEvent) => void;
  onRateLimit?: (info: RateLimitInfo) => void;
  /** the `result` message has arrived */
  onResult?: () => void;
  /** read the `result` message; throws for a failed run */
  finish: (message: CliMessage, context: Context) => T;
}

/** "Review cancelled.", "Test cancelled." */
function cancelledText(what: string): string {
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} cancelled.`;
}

/**
 * Start Claude Code, send the `initialize` request and the one user message,
 * read its messages up to the `result`, and always end the process. Aborting
 * `signal`, or quitting through `deps.track`, kills it and throws `cancelled`.
 */
async function exchange<T>(deps: CliDeps, ex: Exchange<T>): Promise<T> {
  const run = new CliRun(deps, ex.args);
  const controller = new AbortController();
  const release = deps.track?.(controller) ?? ((): void => undefined);
  const abort = (): void => controller.abort();
  if (ex.signal.aborted) abort();
  else ex.signal.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => run.kill(), { once: true });

  const context: Context = ex.limitFacts ? { limitFacts: ex.limitFacts } : {};
  const cancelled = cancelledText(ex.what);

  try {
    const init = await run.request('initialize', ex.init);
    if (controller.signal.aborted) throw fail('cancelled', cancelled);
    if (!init || init.subtype !== 'success') {
      throw startFailure(run, init, ex.what);
    }
    run.sendUser(ex.prompt);

    for (let message = await run.next(); message; message = await run.next()) {
      switch (message.type) {
        case 'stream_event': {
          const event = (message['event'] ?? {}) as StreamEvent;
          // The last reply's reason wins: one cut off and then resumed is not a failure (files.10).
          const stop = event.delta?.stop_reason;
          if (event.type === 'message_delta' && typeof stop === 'string' && stop) context.stopReason = stop;
          ex.onStreamEvent?.(event);
          break;
        }
        case 'assistant': {
          if (typeof message['error'] === 'string') context.assistantError = message['error'];
          break;
        }
        case 'system': {
          noteSystem(message, context);
          break;
        }
        case 'rate_limit_event': {
          context.rateLimit = readRateLimit(message['rate_limit_info']);
          ex.onRateLimit?.(context.rateLimit);
          break;
        }
        case 'result': {
          ex.onResult?.();
          return ex.finish(message, context);
        }
        default:
          break;
      }
    }
    if (controller.signal.aborted) throw fail('cancelled', cancelled);
    throw endedEarly(run, context);
  } catch (err) {
    if (controller.signal.aborted) throw fail('cancelled', cancelled);
    throw err;
  } finally {
    ex.signal.removeEventListener('abort', abort);
    run.end();
    await Promise.race([run.exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
    run.kill();
    release();
  }
}

/**
 * Ask Claude to copyedit one chapter and return its structured answer.
 *
 * `--max-turns 3`: structured output arrives through an internal tool call that
 * is retried on a schema mismatch, and one turn does not always leave room for
 * that (plan risk 1, C.10).
 */
export async function runCliReview(
  deps: CliDeps,
  input: CliReviewInput,
  hooks: ProviderHooks
): Promise<ProviderResult> {
  const progress = hooks.onProgress;
  let tokens = 0;
  progress('starting');
  try {
    return await exchange(deps, {
      args: claudeArgs({ model: input.model, effort: input.effort, maxTurns: 3, partialMessages: true }),
      init: { systemPrompt: [input.systemPrompt], jsonSchema: input.jsonSchema },
      prompt: input.prompt,
      signal: hooks.signal,
      what: 'review',
      limitFacts: { effort: input.effort, ...(input.words === undefined ? {} : { words: input.words }) },
      onStreamEvent: (event) => {
        if (event.type === 'message_delta' && event.usage?.output_tokens) {
          tokens = event.usage.output_tokens;
          progress('streaming', tokens);
        } else if (event.type === 'content_block_start') {
          progress('thinking', tokens);
        }
      },
      ...(hooks.onRateLimit ? { onRateLimit: hooks.onRateLimit } : {}),
      onResult: () => progress('parsing', tokens),
      finish
    });
  } finally {
    progress('done', tokens);
  }
}

/* ------------------------------------------------------------------ */
/* The connection test (setup.8)                                       */
/* ------------------------------------------------------------------ */

/** The model the connection test asks for: the smallest, so it costs the least. */
export const CONNECTION_TEST_MODEL = 'haiku';

/**
 * Test the connection: one very small request through the same command line
 * as a review, so it goes wherever a review would and fails wherever one
 * would. Haiku, one turn, no schema and no partial messages: the system prompt
 * asks for the single word OK, and any answer that is not a failure counts.
 * A failure throws, read as a review's is (`resultToError`, C.47). The time
 * limit belongs to the caller (`testConnection`), which aborts `hooks.signal`.
 */
export async function runCliTest(deps: CliDeps, hooks: ProviderTestHooks): Promise<ProviderTestResult> {
  return exchange(deps, {
    args: claudeArgs({ model: CONNECTION_TEST_MODEL, maxTurns: 1 }),
    init: { systemPrompt: [CONNECTION_TEST_SYSTEM_PROMPT] },
    prompt: CONNECTION_TEST_PROMPT,
    signal: hooks.signal,
    what: 'test',
    ...(hooks.onRateLimit ? { onRateLimit: hooks.onRateLimit } : {}),
    finish: (message, context) => {
      const failure = resultToError(message, context);
      if (failure) throw failure;
      const usage = message['modelUsage'];
      const answered = typeof usage === 'object' && usage !== null ? Object.keys(usage)[0] : undefined;
      const model = answered ?? context.model;
      return model ? { model } : {};
    }
  });
}

function noteSystem(message: CliMessage, context: Context): void {
  const text = (key: string): string | undefined =>
    typeof message[key] === 'string' ? message[key] : undefined;
  if (message.subtype === 'init') {
    const model = text('model');
    if (model) context.model = model;
  } else if (message.subtype === 'model_refusal_fallback') {
    const category = text('api_refusal_category');
    context.fallbackNote = `Answered by ${text('fallback_model') ?? 'another model'} after ${
      text('original_model') ?? 'the chosen model'
    } declined${category ? ` (${category})` : ''}.`;
  } else if (message.subtype === 'model_refusal_no_fallback') {
    context.refusal =
      text('api_refusal_explanation') ??
      `${text('original_model') ?? 'The model'} declined to answer and there was no fallback model.`;
  }
}

function startFailure(run: CliRun, response: ControlResponse | null, what: string): Error {
  const detail = run.stderrTail.trim();
  if (response && response.subtype !== 'success') {
    return fail('claude-failed', `Claude Code refused the request: ${errorText(response.error)}`);
  }
  if (/unknown option|unrecognized|invalid option|error: option/i.test(detail)) {
    return fail(
      'claude-failed',
      'Your Claude Code did not accept a setting this app uses. Run "claude update" in a terminal, then try again.',
      detail
    );
  }
  const known = recognised(detail);
  if (known) return known;
  return fail(
    'claude-failed',
    `Claude Code stopped before the ${what} started.${detail ? ` ${detail.split('\n')[0]}` : ''}`,
    detail || undefined
  );
}

/** A failure the classifier recognises in Claude Code's own words, or null (setup.2). */
function recognised(text: string): Error | null {
  if (!text) return null;
  const failure = classifyClaudeFailure({ text });
  return failure.code === 'claude-failed' ? null : fail(failure.code, failure.message, failure.detail);
}

function endedEarly(run: CliRun, context: Context): Error {
  return endedWithoutResult(context, run.stderrTail.trim(), run.malformed);
}

function finish(message: CliMessage, context: Context): ProviderResult {
  // Error subtypes and a 'success' with is_error both go through the classifier (C.47).
  const failure = resultToError(message, context);
  if (failure) throw failure;

  const parsed = parseReviewOutput(message['structured_output']);
  if (!parsed.ok || !parsed.value) {
    // A reply cut off at the output limit is not the model's mistake (files.10).
    const cutOff = cutOffReply(message, context);
    if (cutOff) throw cutOff;
    throw fail(
      'claude-invalid-output',
      'Claude answered but the response did not match the expected shape.',
      parsed.problem
    );
  }

  const usage = (message['modelUsage'] ?? {}) as Record<string, unknown>;
  const model = Object.keys(usage)[0];
  const cost = message['total_cost_usd'];
  const duration = message['duration_ms'];
  const session = message['session_id'];
  return {
    output: parsed.value,
    raw: message['structured_output'],
    ...(model ? { model } : {}),
    // Claude Code's own figure, not this app's arithmetic.
    ...(typeof cost === 'number' ? { costUsd: cost } : {}),
    costEstimated: false,
    usage,
    ...(typeof duration === 'number' ? { durationMs: duration } : {}),
    ...(typeof session === 'string' ? { sessionId: session } : {}),
    ...(context.fallbackNote ? { fallbackNote: context.fallbackNote } : {}),
    ...(context.rateLimit ? { rateLimit: context.rateLimit } : {})
  };
}
