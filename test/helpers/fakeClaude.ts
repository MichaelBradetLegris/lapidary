/**
 * A stand-in for the user's Claude Code, for test/main/claudeCli.test.ts.
 *
 * It speaks the same newline-delimited JSON as `claude -p --input-format
 * stream-json --output-format stream-json`: it answers the `initialize` control
 * request, and after the user message it plays the scenario named by
 * FAKE_CLAUDE_SCENARIO. It also answers `--version` and `auth status --json`,
 * and echoes its arguments to stderr as `ARGS [...]`, and what the `initialize`
 * request carried as `INIT {...}`, so the test can check them. An `initialize`
 * without a schema is a connection test (setup.8, test/main/connectionTest.test.ts),
 * whose success is the word OK.
 *
 * Node runs it directly (22.18+ strips the types itself), so it has no relative
 * imports, like mockOpenAi.ts.
 */
import readline from 'node:readline';

const args = process.argv.slice(2);
const scenario = process.env['FAKE_CLAUDE_SCENARIO'] ?? 'success';
process.stderr.write(`ARGS ${JSON.stringify(args)}\n`);

function out(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (args[0] === '--version') {
  process.stdout.write(`${process.env['FAKE_CLAUDE_VERSION'] ?? '2.1.283'} (Claude Code)\n`);
  process.exit(0);
}

if (args[0] === 'auth') {
  const loggedIn = scenario !== 'signed-out';
  const status = {
    loggedIn,
    authMethod: loggedIn ? 'claude.ai' : 'none',
    apiProvider: 'firstParty',
    email: 'ann@example.com',
    orgId: '00000000-0000-0000-0000-000000000000',
    orgName: "ann@example.com's Organization",
    ...(loggedIn ? { subscriptionType: 'max' } : {})
  };
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  process.exit(loggedIn ? 0 : 1);
}

if (scenario === 'bad-flag') {
  process.stderr.write("error: unknown option '--include-partial-messages'\n");
  process.exit(1);
}

const REVIEW = {
  changes: [{ paragraph: 1, before: 'teh', after: 'the', category: 'typo', reason: 'Spelling.' }],
  comments: [{ paragraph: null, category: 'pacing', text: 'The middle drags a little.' }]
};

/**
 * The `rate_limit_info` of the `rate_limit_event` sent before the result, in
 * the shape of Claude Code 2.1.302's schema (the Agent SDK's
 * `SDKRateLimitInfo`; `readRateLimit` in claudeResult.ts, setup.9): the
 * status (`allowed`, `allowed_warning` or `rejected`), the reset in Unix
 * seconds, which limit (`rateLimitType`) and whether extra usage is paying
 * (`isUsingOverage`), beside fields the app does not read. The share used
 * (`utilization`, a fraction) comes only with `allowed_warning`, which 2.1.302
 * sends when it warns, so neither notice here has one (C.64). A usage limit
 * comes after a `rejected` one. FAKE_CLAUDE_RATE_LIMIT, as JSON, replaces it.
 */
function rateLimitInfo(name: string): unknown {
  const given = process.env['FAKE_CLAUDE_RATE_LIMIT'];
  if (given) return JSON.parse(given) as unknown;
  const unread = { overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled' };
  return {
    status: name === 'usage-limit' ? 'rejected' : 'allowed',
    resetsAt: 1790000000,
    rateLimitType: 'five_hour',
    isUsingOverage: false,
    ...unread
  };
}

/**
 * Whether the `initialize` request carried an output schema. Without one the
 * request is a connection test (setup.8), and a success is the word it asked
 * for rather than a review.
 */
let withSchema = true;

/*
 * A reply that ran out of room (files.10), in the shapes Claude Code 2.1.302
 * sends, read from its bundled code (PLAN C.77). A reply cut off at the output
 * limit streams a `message_delta` whose `delta.stop_reason` is `max_tokens`;
 * Claude Code then tries to resume it, and once those attempts are used up it
 * sends an assistant message whose `error` and `api_error` are
 * `max_output_tokens`, with the text below, which the error result repeats. A
 * full context window comes with the same error and its own text; a chapter
 * too long to send is "Prompt is too long", an `invalid_request`.
 * FAKE_CLAUDE_STOPS, a comma-separated list, plays a `message_delta` with each
 * stop reason before any scenario's result, as replies cut off and resumed.
 */
const OUTPUT_LIMIT_TEXT =
  "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.";
const CONTEXT_LIMIT_TEXT = 'API Error: The model has reached its context window limit.';
const PROMPT_TOO_LONG_TEXT = 'Prompt is too long';

/** The assistant message that reports an API error, as 2.1.302 sends it. */
function apiErrorMessage(error: string, text: string, apiError?: string): unknown {
  return {
    type: 'assistant',
    error,
    is_api_error_message: true,
    ...(apiError ? { api_error: apiError } : {}),
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: 'sess-1'
  };
}

function play(name: string): void {
  out({
    type: 'system',
    subtype: 'init',
    model: 'claude-haiku-4-5-20251001',
    tools: withSchema ? ['StructuredOutput'] : []
  });
  if (name === 'malformed') process.stdout.write('this is not json\n{"no type": 1}\n');
  out({ type: 'stream_event', event: { type: 'content_block_start' } });
  out({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 42 } } });
  out({ type: 'rate_limit_event', rate_limit_info: rateLimitInfo(name), uuid: 'rl-1', session_id: 'sess-1' });
  for (const stop of (process.env['FAKE_CLAUDE_STOPS'] ?? '').split(',').filter(Boolean)) {
    out({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 32000 }
      }
    });
  }
  const base = { type: 'result', duration_ms: 1234, session_id: 'sess-1', total_cost_usd: 0.0123 };
  switch (name) {
    case 'success':
    case 'malformed':
      out(
        withSchema
          ? {
              ...base,
              subtype: 'success',
              is_error: false,
              result: JSON.stringify(REVIEW),
              structured_output: REVIEW,
              modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 900, outputTokens: 42 } }
            }
          : {
              ...base,
              subtype: 'success',
              is_error: false,
              result: 'OK',
              modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 21, outputTokens: 4 } }
            }
      );
      break;
    case 'no-model-usage':
      // A success that names no model in its usage: the init message's model stands.
      out({ ...base, subtype: 'success', is_error: false, result: 'OK' });
      break;
    case 'wrong-shape':
      out({
        ...base,
        subtype: 'success',
        is_error: false,
        structured_output: { changes: 'none' },
        modelUsage: {}
      });
      break;
    case 'is-error':
      out({
        ...base,
        subtype: 'success',
        is_error: true,
        result: 'Not logged in · Please run /login',
        modelUsage: {}
      });
      break;
    case 'usage-limit':
      out({
        ...base,
        subtype: 'success',
        is_error: true,
        result: "You've hit your limit · resets 3pm",
        modelUsage: {}
      });
      break;
    case 'refusal':
      out({
        type: 'system',
        subtype: 'model_refusal_no_fallback',
        original_model: 'claude-opus-5',
        api_refusal_explanation: 'The model declined this request.'
      });
      out({
        ...base,
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['refused'],
        modelUsage: {}
      });
      break;
    case 'assistant-error':
      out({ type: 'assistant', error: 'rate_limit', message: { content: [] } });
      out({
        ...base,
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['rate limited'],
        modelUsage: {}
      });
      break;
    case 'output-limit':
      // The attempts to resume a reply cut off at the limit are used up.
      out({
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens', stop_sequence: null },
          usage: { output_tokens: 32000 }
        }
      });
      out(apiErrorMessage('max_output_tokens', OUTPUT_LIMIT_TEXT, 'max_output_tokens'));
      out({
        ...base,
        subtype: 'success',
        is_error: true,
        result: OUTPUT_LIMIT_TEXT,
        api_error: 'max_output_tokens',
        modelUsage: {}
      });
      break;
    case 'context-limit':
      out(apiErrorMessage('max_output_tokens', CONTEXT_LIMIT_TEXT, 'max_output_tokens'));
      out({ ...base, subtype: 'success', is_error: true, result: CONTEXT_LIMIT_TEXT, modelUsage: {} });
      break;
    case 'prompt-too-long':
      out(apiErrorMessage('invalid_request', PROMPT_TOO_LONG_TEXT));
      out({ ...base, subtype: 'success', is_error: true, result: PROMPT_TOO_LONG_TEXT, modelUsage: {} });
      break;
    case 'max-turns':
      out({
        ...base,
        subtype: 'error_max_turns',
        is_error: true,
        errors: ['Reached maximum number of turns (3)'],
        modelUsage: {}
      });
      break;
    case 'schema-retries':
      out({
        ...base,
        subtype: 'error_max_structured_output_retries',
        is_error: true,
        errors: ['Failed to provide valid structured output after 5 attempts'],
        modelUsage: {}
      });
      break;
    case 'no-output': {
      // A success with no structured output; FAKE_CLAUDE_RESULT_STOP gives its stop_reason, `none` null.
      const stop = process.env['FAKE_CLAUDE_RESULT_STOP'] ?? 'end_turn';
      out({
        ...base,
        subtype: 'success',
        is_error: false,
        result: '',
        stop_reason: stop === 'none' ? null : stop,
        modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 900, outputTokens: 32000 } }
      });
      break;
    }
    case 'ends-early':
      process.exit(0);
      break;
    case 'slow':
      // Never answers: the test cancels.
      break;
    default:
      out({
        ...base,
        subtype: 'error_during_execution',
        is_error: true,
        errors: [`unknown scenario ${name}`]
      });
  }
}

interface Incoming {
  type?: string;
  request_id?: string;
  request?: { subtype?: string; systemPrompt?: unknown; jsonSchema?: unknown };
  message?: { content?: unknown };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line) as Incoming;
  if (message.type === 'control_request' && message.request?.subtype === 'initialize') {
    withSchema = Boolean(message.request.jsonSchema);
    process.stderr.write(
      `INIT ${JSON.stringify({ systemPrompt: message.request.systemPrompt ?? null, hasSchema: withSchema })}\n`
    );
    // A Claude Code that hangs at start-up: the caller's time budget has to end it.
    if (scenario === 'init-silent') return;
    if (scenario === 'init-refused') {
      out({
        type: 'control_response',
        response: { subtype: 'error', request_id: message.request_id, error: 'nope' }
      });
      return;
    }
    out({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: {
          models: [
            {
              value: 'default',
              displayName: 'Default (recommended)',
              description: 'Opus 5.5 · Best for everyday'
            },
            { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest' }
          ],
          account: { email: 'ann@example.com', subscriptionType: 'Claude Max', organization: 'Org' },
          // Echoed so a test can see what the initialize request carried.
          echo: {
            systemPrompt: message.request.systemPrompt ?? null,
            hasSchema: Boolean(message.request.jsonSchema)
          }
        }
      }
    });
    return;
  }
  if (message.type === 'user') {
    process.stderr.write(`USER ${JSON.stringify(message.message?.content).slice(0, 60)}\n`);
    play(scenario);
  }
});
rl.on('close', () => process.exit(0));
