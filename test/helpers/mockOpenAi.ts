/**
 * A tiny stand-in for the two OpenAI endpoints a ChatGPT review uses, so it
 * can be run end to end with no ChatGPT account and no network (codex.3,
 * PLAN 5.8). Dev-only: nothing in `src/` imports it.
 *
 * - GET  /v1/models     the models a ChatGPT sign-in may use
 * - POST /v1/responses  a streamed (SSE) structured reply
 *
 * It answers a bearer that is a ChatGPT sign-in's access token, a JWT for
 * `https://api.openai.com/v1` granting `chatgpt.tokens.use.direct`, as
 * test/helpers/mockChatGptAuth.ts makes them, as OpenAI's pages on models and
 * inference, preview limitations and errors describe that route (Appendix A):
 * the model list as a `models` array of `slug`, `display_name` and
 * `visibility` (`CHATGPT_MODELS`); a review only with `store: false`,
 * `stream: true`, `input` as a list and none of the parameters the route
 * refuses, each refused as `subscription_sharing_unsupported_capability`
 * naming it; a token whose `exp` has passed refused with a 401; and the
 * plan's limits in the headers Codex reads (`x-codex-primary-used-percent`
 * and the rest). Any other bearer, such as an OpenAI API key, which no
 * provider has sent since codex.6, gets the 401 OpenAI gives a key it does
 * not know.
 *
 * The scenario changes the answers (`ChatGptScenario`, matched by
 * `chatGptScenarioFor`: the first of `CHATGPT_SCENARIOS` the name holds, in
 * any case). The plan's own: `nearlimit` the 5-hour limit 85% used,
 * `weeklylimit` the weekly limit reached, `usagelimit` a 429 for the plan's
 * usage limit with the 5-hour limit reached in its headers, `usagelimitbare`
 * the same 429 with no headers, `usagelimitstream` that limit reached during
 * a streamed reply (`response.failed`), `noheaders` an answer with no limits,
 * `noteligible` a 403 for an account that may not use its plan, `noschema` a
 * 400 for `text.format`, the route refusing structured output, `unavailable`
 * a 503 for usage that is not available, `invaliduser` a 401 with the plan's
 * code for every request, and `nomodels` an empty model list. Those an
 * OpenAI API key's words picked until codex.6 took that provider out:
 * `unauthorized` a 401 for every request (`invalid_api_key`); `ratelimit` a
 * 429 (`rate_limit_exceeded`) and `servererror` a 500 for a review, while the
 * model list still answers; `malformed` a reply that is not JSON; `prose` a
 * reply written as prose (`PROSE_REPLY`), as a model that ignored the schema
 * might send (hardening.3b); `wrongshape` JSON of the wrong shape; `slow` a
 * reply that trickles out over about seven seconds (for Cancel); `obsidian`
 * the review of the Obsidian sample chapter (`OBSIDIAN_REVIEW`, files.9);
 * `outputlimit` a reply cut off at the model's output limit, which ends
 * `incomplete` (files.10); `unverified` the 400 OpenAI gives a streamed
 * request from an organisation that has not verified its identity
 * (`UNVERIFIED_STREAM_MESSAGE`, hardening.10), while the model list answers;
 * and `skippedonly` a model list holding only models the default passes over
 * while it has any other (`CHATGPT_SKIPPED_ONLY_MODELS`, hardening.10).
 * Anything else is the canned review of Chapter 01, the limits low.
 *
 * Where the scenario comes from: the access token's `mock_scenario` claim,
 * which test/helpers/mockChatGptAuth.ts puts in every token it makes once it
 * is given one (`--api-scenario <name>` as it starts, or `POST
 * /mock/api-scenario` for the tokens of the next sign-in or renewal); or
 * `POST /mock/scenario` here with a name, which sets the scenario of every
 * ChatGPT request from then on, over the token's, and an empty body clears it.
 *
 * Two ways to use it:
 *   vitest:  const mock = await startMockOpenAi(); ... mock.url ... await mock.close();
 *   by hand: node test/helpers/mockOpenAi.ts --port 4599
 *            (Node 22.18+ strips the types itself), with the sign-in mock
 *            (node test/helpers/mockChatGptAuth.ts --port 4600), then start
 *            the app with MANUSCRIPT_REVIEW_OPENAI_BASE_URL=http://127.0.0.1:4599/v1
 *            and MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL=http://127.0.0.1:4600
 *            (development switches: `npm run dev` honours them, a packaged
 *            build ignores them, see src/main/devSwitches.ts) and sign in
 *            with ChatGPT as the sign-in mock's header says
 *
 * The file has no relative imports so Node can run it directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The output limit the `outputlimit` scenario's reply reaches: gpt-5's 128,000 tokens. */
export const MOCK_OUTPUT_LIMIT = 128_000;

/**
 * The `unverified` scenario's refusal (hardening.10), worded as OpenAI's API
 * words it for a streamed request to gpt-5 or o3 from an organisation that
 * has not verified its identity: status 400, `invalid_request_error`, `param`
 * `stream`, code `unsupported_value`.
 */
export const UNVERIFIED_STREAM_MESSAGE =
  'Your organization must be verified to stream this model. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate.';

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string;
  body: unknown;
}

export interface MockOpenAi {
  /** base URL to hand the SDK, ending in /v1 */
  url: string;
  requests: RecordedRequest[];
  /** the scenario of every ChatGPT request over its token's own, or null (codex.3) */
  chatGptScenario: ChatGptScenario | null;
  close: () => Promise<void>;
}

/**
 * What a ChatGPT sign-in's request may meet (codex.3); see the comment at the
 * top. The last eleven are those an OpenAI API key's words picked until
 * codex.6; six of them, `malformed` to `outputlimit`, this route had already.
 */
export type ChatGptScenario =
  | 'ok'
  | 'nearlimit'
  | 'weeklylimit'
  | 'usagelimit'
  | 'usagelimitbare'
  | 'usagelimitstream'
  | 'noheaders'
  | 'noteligible'
  | 'noschema'
  | 'unavailable'
  | 'invaliduser'
  | 'nomodels'
  | 'unauthorized'
  | 'ratelimit'
  | 'servererror'
  | 'malformed'
  | 'prose'
  | 'wrongshape'
  | 'slow'
  | 'obsidian'
  | 'outputlimit'
  | 'unverified'
  | 'skippedonly';

/** Every ChatGPT scenario but `ok`, longest first, so `usagelimitbare` is not read as `usagelimit`. */
export const CHATGPT_SCENARIOS: readonly ChatGptScenario[] = [
  'usagelimitstream',
  'usagelimitbare',
  'unauthorized',
  'weeklylimit',
  'servererror',
  'skippedonly',
  'outputlimit',
  'invaliduser',
  'noteligible',
  'unavailable',
  'usagelimit',
  'unverified',
  'wrongshape',
  'nearlimit',
  'noheaders',
  'ratelimit',
  'malformed',
  'noschema',
  'nomodels',
  'obsidian',
  'prose',
  'slow'
];

/** The scenario a token's `mock_scenario` claim, or a name, gives: the first of `CHATGPT_SCENARIOS` it holds, in any case. */
export function chatGptScenarioFor(claim: unknown): ChatGptScenario {
  const word = typeof claim === 'string' ? claim.toLowerCase() : '';
  return CHATGPT_SCENARIOS.find((name) => word.includes(name)) ?? 'ok';
}

/**
 * The models a ChatGPT sign-in may use, in the shape OpenAI's page gives
 * (codex.3): a codex model first, which the default passes over, a model the
 * list hides, and two it shows. The default is gpt-5.5.
 */
export const CHATGPT_MODELS = [
  { slug: 'gpt-5.5-codex', display_name: 'GPT-5.5 Codex', visibility: 'list' },
  { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
  { slug: 'gpt-5.5-internal', display_name: 'GPT-5.5 Internal', visibility: 'hide' },
  { slug: 'gpt-5-mini', display_name: 'GPT-5 mini', visibility: 'list' }
];

/**
 * The `skippedonly` scenario's model list (hardening.10, on this route since
 * codex.6): only models `NOT_DEFAULT_MODEL` names, a -pro, a -codex and a
 * -chat one, and gpt-5.5 hidden, which the list never shows. With nothing
 * else to take, the default is the first listed, gpt-5.5-pro
 * (`defaultChatGptModel`), never the hidden one.
 */
export const CHATGPT_SKIPPED_ONLY_MODELS = [
  { slug: 'gpt-5.5-pro', display_name: 'GPT-5.5 Pro', visibility: 'list' },
  { slug: 'gpt-5-codex', display_name: 'GPT-5 Codex', visibility: 'list' },
  { slug: 'gpt-5-chat-latest', display_name: 'GPT-5 Chat', visibility: 'list' },
  { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'hide' }
];

/** The parameters OpenAI's page on preview limitations says the ChatGPT route refuses (Appendix A). */
export const CHATGPT_REFUSED_PARAMETERS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'previous_response_id',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user'
];

/** The claims of a ChatGPT sign-in's access token, or null for a bearer that is not one, such as an API key. */
export function chatGptClaims(authorization: string): Record<string, unknown> | null {
  const token = authorization.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as unknown;
    if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
    const record = claims as Record<string, unknown>;
    const aud = record['aud'];
    const audiences = Array.isArray(aud) ? aud : [aud];
    const scope = typeof record['scope'] === 'string' ? record['scope'].split(' ') : [];
    return audiences.includes('https://api.openai.com/v1') && scope.includes('chatgpt.tokens.use.direct')
      ? record
      : null;
  } catch {
    return null;
  }
}

/**
 * The plan's limits for a scenario, in the headers Codex reads (codex.3): the
 * 5-hour limit (300 minutes) and the weekly one (10,080), each with how much
 * of it is used and when it resets, as Unix seconds.
 */
export function chatGptLimitHeaders(scenario: ChatGptScenario, now = Date.now()): Record<string, string> {
  if (scenario === 'noheaders' || scenario === 'usagelimitbare') return {};
  const at = (minutes: number): string => String(Math.floor(now / 1000) + minutes * 60);
  const [primary, secondary] =
    scenario === 'nearlimit'
      ? [85, 40]
      : scenario === 'weeklylimit'
        ? [30, 100]
        : scenario === 'usagelimit' || scenario === 'usagelimitstream'
          ? [100, 70]
          : [12, 5];
  return {
    'x-codex-primary-used-percent': String(primary),
    'x-codex-primary-window-minutes': '300',
    'x-codex-primary-reset-at': at(95),
    'x-codex-secondary-used-percent': String(secondary),
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-secondary-reset-at': at(3 * 24 * 60 + 30)
  };
}

/**
 * Six corrections and three comments for `samples/manuscript/Chapter 01 - The
 * Flood.md`, numbered from 1 as the prompt numbers paragraphs (Phase 5d), in
 * the exact shape the strict schema asks for: every property
 * present, `quote: null` where there is no quote, and one chapter-level comment
 * with `paragraph: null`.
 */
export const CANNED_REVIEW = {
  changes: [
    {
      paragraph: 1,
      before: 'had began',
      after: 'had begun',
      category: 'tense',
      reason: '"Began" is the simple past; the past perfect needs "begun".'
    },
    {
      paragraph: 2,
      before: 'should of',
      after: 'should have',
      category: 'grammar',
      reason: '"Should of" is a mishearing of "should have".'
    },
    {
      paragraph: 3,
      before: 'the the frayed',
      after: 'the frayed',
      category: 'typo',
      reason: 'Doubled word.'
    },
    {
      paragraph: 4,
      before: 'would loose',
      after: 'would lose',
      category: 'homophone',
      reason: '"Loose" means not tight; "lose" is the verb wanted here.'
    },
    {
      paragraph: 7,
      before: 'Its a sound',
      after: "It's a sound",
      category: 'punctuation',
      reason: 'Contraction of "it is" needs an apostrophe.'
    },
    {
      paragraph: 9,
      before: 'water come across',
      after: 'water came across',
      category: 'tense',
      reason: 'The narration is in the past tense.'
    }
  ],
  comments: [
    {
      paragraph: 6,
      quote: 'She nodded her head.',
      category: 'style',
      text: 'Consider "She nodded." A nod is always of the head.'
    },
    {
      paragraph: 7,
      quote: null,
      category: 'pov',
      text: 'The jump to thirty years later steps outside the scene; check that the flash-forward is intended here.'
    },
    {
      paragraph: null,
      quote: null,
      category: 'pacing',
      text: 'The chapter holds one tense moment well. The last two paragraphs could land harder with a shorter final line.'
    }
  ]
};

/**
 * The review of `samples/manuscript/Chapter 03 - Obsidian.md` (`files.9`), in
 * the same strict shape and numbering as `CANNED_REVIEW`. It answers as a
 * model that mostly keeps the prompt's Obsidian rule (PLAN 5.4) might: it
 * skips the hidden paragraphs 14 to 17, and besides thirteen fixes to the
 * prose, an alias, a link's text, a heading, a callout's title, footnote text
 * and the words between HTML tags, which stay in the text, it offers ten that
 * reach into syntax: a block ID, an embed, a comment, an internal link, a sum
 * written with `$`, a web address, inline code, a footnote mark, an image and
 * a tag. The guard keeps those out of the text and lists them under
 * Unanchored with their notes (`files.7`, PLAN 11.3 k);
 * `test/shared/obsidianSample.test.ts` says which is which.
 */
export const OBSIDIAN_REVIEW = {
  changes: [
    {
      paragraph: 2,
      before: "it was'nt black",
      after: "it wasn't black",
      category: 'punctuation',
      reason: 'The apostrophe stands for the missing letter: "wasn\'t".'
    },
    {
      paragraph: 2,
      before: 'an old bottle. ^stone',
      after: 'an old bottle.',
      category: 'formatting',
      reason: 'Stray characters after the last sentence.'
    },
    {
      paragraph: 3,
      before: 'the night of the flod',
      after: 'the night of the flood',
      category: 'spelling',
      reason: 'Typo for "flood".'
    },
    {
      paragraph: 4,
      before: '![[Chapter 02 - After]]',
      after: '![[Chapter 02 – After]]',
      category: 'punctuation',
      reason: 'A spaced dash between words is an en dash.'
    },
    {
      paragraph: 5,
      before: '*realy* foolish',
      after: '*really* foolish',
      category: 'spelling',
      reason: 'Typo for "really".'
    },
    {
      paragraph: 5,
      before: 'It had laid in the mud',
      after: 'It had lain in the mud',
      category: 'grammar',
      reason: '"Laid" needs an object; the stone "had lain" there.'
    },
    {
      paragraph: 6,
      before: 'chekc whether',
      after: 'check whether',
      category: 'typo',
      reason: 'Typo for "check".'
    },
    {
      paragraph: 8,
      before: 'The leter',
      after: 'The letter',
      category: 'spelling',
      reason: 'Typo for "letter".'
    },
    {
      paragraph: 9,
      before: '[[Millers Lane]]',
      after: "[[Miller's Lane]]",
      category: 'punctuation',
      reason: "The lane is the miller's, so it takes an apostrophe."
    },
    {
      paragraph: 9,
      before: 'had never wrote a letter',
      after: 'had never written a letter',
      category: 'tense',
      reason: 'The past perfect needs the participle "written".'
    },
    {
      paragraph: 10,
      before: '<u>wrok</u>',
      after: '<u>work</u>',
      category: 'typo',
      reason: 'Typo for "work".'
    },
    {
      paragraph: 10,
      before: 'leaves me 3 dollars',
      after: 'leaves me $3',
      category: 'consistency',
      reason: 'The letter writes the other sums as "$5" and "$2".'
    },
    {
      paragraph: 10,
      before: 'alot of evenings',
      after: 'a lot of evenings',
      category: 'spelling',
      reason: '"A lot" is two words.'
    },
    {
      paragraph: 12,
      before: 'route agianst the',
      after: 'route against the',
      category: 'spelling',
      reason: 'Typo for "against".'
    },
    {
      paragraph: 12,
      before: '[teh tithe map]',
      after: '[the tithe map]',
      category: 'typo',
      reason: 'Typo for "the".'
    },
    {
      paragraph: 12,
      before: 'parish/regsiters',
      after: 'parish/registers',
      category: 'spelling',
      reason: 'Typo for "registers".'
    },
    {
      paragraph: 12,
      before: '`recieved`',
      after: '`received`',
      category: 'spelling',
      reason: '"Received" is spelt with "ei".'
    },
    {
      paragraph: 13,
      before: 'wheel[^1].',
      after: 'wheel.[^1]',
      category: 'punctuation',
      reason: 'A footnote mark goes after the full stop.'
    },
    {
      paragraph: 13,
      before: 'copies was lost',
      after: 'copies were lost',
      category: 'agreement',
      reason: '"Copies" is plural.'
    },
    {
      paragraph: 18,
      before: 'a skecth of the stone',
      after: 'a sketch of the stone',
      category: 'spelling',
      reason: 'Typo for "sketch".'
    },
    {
      paragraph: 19,
      before: 'where she fond it',
      after: 'where she found it',
      category: 'typo',
      reason: 'Typo for "found".'
    },
    {
      paragraph: 20,
      before: '#continuty',
      after: '#continuity',
      category: 'spelling',
      reason: 'Typo for "continuity".'
    },
    {
      paragraph: 21,
      before: '1840, wich is',
      after: '1840, which is',
      category: 'spelling',
      reason: 'Typo for "which".'
    }
  ],
  comments: [
    {
      paragraph: 2,
      quote: 'the deep green of an old bottle',
      category: 'style',
      text: 'A good image, and it comes back when the light goes through the stone on the sill.'
    },
    {
      paragraph: 10,
      quote: 'I think of the field.',
      category: 'style',
      text: 'The plainest line in the letter carries the most; consider leaving the letter as rough as it is.'
    },
    {
      paragraph: null,
      quote: null,
      category: 'plot',
      text: 'The stone and the price in the ledger are set up well. The chapter leaves open who wrote that price, which seems intended.'
    }
  ]
};

/**
 * The `prose` scenario's reply (hardening.3b): the review written out as
 * prose rather than JSON, quoting the chapter, so a test can show that none
 * of it reaches the log when the reply is refused.
 */
export const PROSE_REPLY =
  'Here is my review of the chapter. In the first paragraph, "the river had began to climb the steps" should read "the river had begun to climb the steps". ' +
  'In the second, "should of" is a mishearing of "should have". The ending lands well; I would keep the last line short.';

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function apiError(
  res: ServerResponse,
  status: number,
  type: string,
  code: string,
  message: string,
  param: string | null = null
): void {
  sendJson(res, status, { error: { message, type, param, code } });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Split a string into n roughly equal pieces, as a model's deltas would be. */
function pieces(text: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function responseObject(
  model: string,
  status: string,
  text: string | null,
  outputTokens: number
): Record<string, unknown> {
  return {
    id: 'resp_mock_1',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    error: null,
    incomplete_details: null,
    output:
      text === null
        ? []
        : [
            {
              type: 'message',
              id: 'msg_mock_1',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text, annotations: [] }]
            }
          ],
    usage:
      text === null
        ? null
        : {
            input_tokens: 2400,
            input_tokens_details: { cached_tokens: 400, cache_write_tokens: 0 },
            output_tokens: outputTokens,
            output_tokens_details: { reasoning_tokens: 180 },
            total_tokens: 2400 + outputTokens
          }
  };
}

async function streamResponse(
  res: ServerResponse,
  model: string,
  text: string,
  delayMs: number,
  cutOff = false,
  extra: { headers?: Record<string, string>; failWith?: { code: string; message: string } } = {}
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...(extra.headers ?? {})
  });
  let seq = 0;
  const send = (event: Record<string, unknown>): void => {
    res.write(
      `event: ${String(event['type'])}\ndata: ${JSON.stringify({ ...event, sequence_number: seq++ })}\n\n`
    );
  };

  send({ type: 'response.created', response: responseObject(model, 'in_progress', null, 0) });
  send({ type: 'response.in_progress', response: responseObject(model, 'in_progress', null, 0) });
  for (const [index, delta] of pieces(text, 12).entries()) {
    if (res.destroyed) return;
    await sleep(delayMs);
    send({
      type: 'response.output_text.delta',
      item_id: 'msg_mock_1',
      output_index: 0,
      content_index: 0,
      delta,
      logprobs: []
    });
    if (extra.failWith && index === 3) {
      /* A failure after the reply had begun, as OpenAI's page says a plan's
         usage limit can arrive (codex.3): `response.failed`, with the code. */
      send({
        type: 'response.failed',
        response: { ...responseObject(model, 'failed', null, 0), error: extra.failWith }
      });
      res.end();
      return;
    }
  }
  if (cutOff) {
    /* A reply cut off at the model's output limit (files.10): no text.done and
       no completed, but `response.incomplete`, whose details give the reason.
       No max_output_tokens was asked for, so the limit is the model's own and
       the reply has used all of it. */
    send({
      type: 'response.incomplete',
      response: {
        ...responseObject(model, 'incomplete', text, MOCK_OUTPUT_LIMIT),
        incomplete_details: { reason: 'max_output_tokens' },
        max_output_tokens: null
      }
    });
    res.end();
    return;
  }
  send({
    type: 'response.output_text.done',
    item_id: 'msg_mock_1',
    output_index: 0,
    content_index: 0,
    text,
    logprobs: []
  });
  send({
    type: 'response.completed',
    response: responseObject(model, 'completed', text, Math.ceil(text.length / 4))
  });
  res.end();
}

/**
 * The ChatGPT route (codex.3): what a request with a ChatGPT sign-in's token
 * gets, in the scenario its claims, or the mock's own, name.
 */
async function answerChatGpt(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  claims: Record<string, unknown>,
  scenario: ChatGptScenario
): Promise<void> {
  const refuse = (status: number, code: string, message: string, param: string | null = null): void =>
    sendJson(res, status, { error: { message, type: 'invalid_request_error', param, code } });
  const exp = claims['exp'];
  if (typeof exp !== 'number' || exp * 1000 <= Date.now()) {
    // Admission refuses an ended token before any stream, as OpenAI's page describes (Appendix A).
    sendJson(res, 401, { detail: 'The access token has expired.' });
    return;
  }
  if (scenario === 'invaliduser') {
    refuse(
      401,
      'subscription_sharing_invalid_user',
      'The ChatGPT account could not be used for this request.'
    );
    return;
  }
  if (scenario === 'unauthorized') {
    // As OpenAI answers a bearer it does not take, with no plan's code (codex.6; an API key's until then).
    refuse(401, 'invalid_api_key', 'Incorrect API key provided.');
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    const models =
      scenario === 'nomodels'
        ? []
        : scenario === 'skippedonly'
          ? CHATGPT_SKIPPED_ONLY_MODELS
          : CHATGPT_MODELS;
    sendJson(res, 200, { models });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/v1/responses') {
    refuse(
      403,
      'subscription_sharing_route_not_supported',
      `No ChatGPT route for ${req.method ?? ''} ${url.pathname}`
    );
    return;
  }
  const request = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (request['store'] !== false) {
    refuse(400, 'subscription_sharing_unsupported_capability', 'store must be false.', 'store');
    return;
  }
  if (request['stream'] !== true) {
    refuse(400, 'subscription_sharing_unsupported_capability', 'stream must be true.', 'stream');
    return;
  }
  const refused = CHATGPT_REFUSED_PARAMETERS.find((name) => name in request);
  if (refused) {
    refuse(400, 'subscription_sharing_unsupported_capability', `${refused} is not supported.`, refused);
    return;
  }
  const input = request['input'];
  const system =
    Array.isArray(input) &&
    input.some(
      (item) => typeof item === 'object' && item !== null && (item as { role?: unknown }).role === 'system'
    );
  if (!Array.isArray(input) || system) {
    refuse(
      400,
      'subscription_sharing_unsupported_capability',
      'input must be a list without system messages.',
      'input'
    );
    return;
  }
  const format = (request['text'] as { format?: { type?: unknown } } | undefined)?.format;
  if (scenario === 'noschema' && format?.type === 'json_schema') {
    refuse(
      400,
      'subscription_sharing_unsupported_capability',
      'Structured output is not supported.',
      'text.format'
    );
    return;
  }
  const limits = chatGptLimitHeaders(scenario);
  if (scenario === 'usagelimit' || scenario === 'usagelimitbare') {
    sendJson(
      res,
      429,
      {
        error: {
          message: 'Usage limit reached.',
          type: 'usage_limit',
          param: null,
          code: 'subscription_sharing_usage_limit_exceeded'
        }
      },
      limits
    );
    return;
  }
  if (scenario === 'noteligible') {
    refuse(403, 'subscription_sharing_user_not_eligible', 'This account cannot use its plan here.');
    return;
  }
  if (scenario === 'unavailable') {
    refuse(503, 'subscription_sharing_usage_unavailable', 'Plan usage is not available right now.');
    return;
  }
  /* What an API key's words picked until codex.6 took that provider out: a
     rate limit with no plan's code, a server error, and the refusal of a
     stream to an organisation that has not verified its identity, each for a
     review only, the model list still answering. */
  if (scenario === 'ratelimit') {
    sendJson(
      res,
      429,
      {
        error: {
          message: 'Rate limit reached for requests. Please try again shortly.',
          type: 'requests',
          param: null,
          code: 'rate_limit_exceeded'
        }
      },
      { 'retry-after': '0' }
    );
    return;
  }
  if (scenario === 'servererror') {
    sendJson(
      res,
      500,
      {
        error: {
          message: 'The server had an error while processing your request.',
          type: 'server_error',
          param: null,
          code: 'server_error'
        }
      },
      { 'retry-after': '0' }
    );
    return;
  }
  if (scenario === 'unverified') {
    refuse(400, 'unsupported_value', UNVERIFIED_STREAM_MESSAGE, 'stream');
    return;
  }
  const requested = typeof request['model'] === 'string' ? request['model'] : 'gpt-5.5';
  const full = JSON.stringify(scenario === 'obsidian' ? OBSIDIAN_REVIEW : CANNED_REVIEW);
  const text =
    scenario === 'malformed'
      ? '{"changes": [{"paragraph": 0, "before": "had began", "after": '
      : scenario === 'prose'
        ? PROSE_REPLY
        : scenario === 'wrongshape'
          ? JSON.stringify({ edits: [{ where: 0, what: 'had began' }] })
          : scenario === 'outputlimit'
            ? full.slice(0, Math.floor(full.length / 2))
            : full;
  await streamResponse(res, requested, text, scenario === 'slow' ? 600 : 15, scenario === 'outputlimit', {
    headers: limits,
    ...(scenario === 'usagelimitstream'
      ? { failWith: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Usage limit reached.' } }
      : {})
  });
}

export async function startMockOpenAi(
  options: { port?: number; log?: boolean; chatGptScenario?: ChatGptScenario } = {}
): Promise<MockOpenAi> {
  const requests: RecordedRequest[] = [];
  const mock: { chatGptScenario: ChatGptScenario | null } = {
    chatGptScenario: options.chatGptScenario ?? null
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const body = await readBody(req);
      const authorization = String(req.headers['authorization'] ?? '');
      requests.push({ method: req.method ?? 'GET', path: url.pathname, authorization, body });

      if (req.method === 'POST' && url.pathname === '/mock/scenario') {
        // The ChatGPT route's scenario over the token's; an empty body clears it (codex.3).
        const name = (typeof body === 'string' ? body : '').trim();
        mock.chatGptScenario = name === '' ? null : chatGptScenarioFor(name);
        sendJson(res, 200, { chatGptScenario: mock.chatGptScenario });
        return;
      }

      const claims = chatGptClaims(authorization);
      if (claims) {
        const chosen = mock.chatGptScenario ?? chatGptScenarioFor(claims['mock_scenario']);
        if (options.log)
          console.log(`[mock-openai] ${req.method ?? ''} ${url.pathname} -> chatgpt ${chosen}`);
        await answerChatGpt(req, res, url, body, claims, chosen);
        return;
      }

      /* Any other bearer, such as an OpenAI API key, which no provider sends
         since codex.6: refused as OpenAI refuses a key it does not know. */
      if (options.log)
        console.log(`[mock-openai] ${req.method ?? ''} ${url.pathname} -> not a ChatGPT token`);
      if (!authorization.startsWith('Bearer ')) {
        apiError(res, 401, 'invalid_request_error', 'missing_api_key', 'You did not provide an API key.');
        return;
      }
      apiError(res, 401, 'invalid_request_error', 'invalid_api_key', 'Incorrect API key provided.');
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    get chatGptScenario() {
      return mock.chatGptScenario;
    },
    set chatGptScenario(value: ChatGptScenario | null) {
      mock.chatGptScenario = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

/* Run directly: `node test/helpers/mockOpenAi.ts --port 4599`. */
const invokedDirectly = /mockOpenAi\.ts$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  const flag = process.argv.indexOf('--port');
  const port = flag >= 0 ? Number(process.argv[flag + 1]) : 4599;
  void startMockOpenAi({ port, log: true }).then((mock) => {
    console.log(`[mock-openai] listening on ${mock.url}`);
  });
}
