/**
 * A tiny stand-in for the two OpenAI endpoints this app uses, so the OpenAI
 * path can be exercised end to end without a real key or a network. Dev-only:
 * nothing in `src/` imports it.
 *
 * - GET  /v1/models     a fixed model list mixing text and non-text models
 * - POST /v1/responses  a streamed (SSE) or plain structured reply
 *
 * The API key picks the scenario, so the real app can be driven through every
 * path from its own Settings dialog: a key containing `unauthorized` gets a 401,
 * `ratelimit` a 429, `servererror` a 500, `malformed` a reply that is not JSON,
 * `prose` a reply written as prose (`PROSE_REPLY`), as a model that ignored
 * the schema might send (hardening.3b), `wrongshape` JSON of the wrong shape,
 * `slow` a reply that trickles out over several seconds (for Cancel), or an
 * unstreamed one that comes after them (for a connection test's time limit),
 * `obsidian` the review of the Obsidian sample chapter (`OBSIDIAN_REVIEW`),
 * `outputlimit` a streamed reply cut off at the model's output limit, which
 * ends `incomplete` (files.10), `unverified` the 400 OpenAI gives a streamed
 * request from an organisation that has not verified its identity, while an
 * unstreamed one is answered (`UNVERIFIED_STREAM_MESSAGE`, hardening.10),
 * `skippedonly` a model list holding only models the default passes over while
 * it has any other (`SKIPPED_ONLY_MODELS`, hardening.10), and anything else
 * the canned review of Chapter 01.
 *
 * Two ways to use it:
 *   vitest:  const mock = await startMockOpenAi(); ... mock.url ... await mock.close();
 *   by hand: node test/helpers/mockOpenAi.ts --port 4599
 *            (Node 22.18+ strips the types itself), then start the app with
 *            MANUSCRIPT_REVIEW_OPENAI_BASE_URL=http://127.0.0.1:4599/v1
 *            (a development switch: `npm run dev` honours it, a packaged build
 *            ignores it, see src/main/devSwitches.ts)
 *
 * The file has no relative imports so Node can run it directly.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Scenario =
  | 'ok'
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
  close: () => Promise<void>;
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

const MODELS = [
  { id: 'gpt-5.5', created: 1_780_000_000, object: 'model', owned_by: 'openai' },
  { id: 'gpt-5-mini', created: 1_755_000_000, object: 'model', owned_by: 'openai' },
  { id: 'gpt-5', created: 1_754_000_000, object: 'model', owned_by: 'openai' },
  // Newer than every gpt-5, to prove the default prefers the gpt-5 family.
  { id: 'gpt-6-preview-mock', created: 1_790_000_000, object: 'model', owned_by: 'openai' },
  // Each newer than a gpt-5 the default could take, and never the default (hardening.10).
  // The first three are listed; o3-deep-research is left out as a search model.
  { id: 'gpt-5.5-pro', created: 1_781_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-5-codex', created: 1_758_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-5-chat-latest', created: 1_754_500_000, object: 'model', owned_by: 'system' },
  { id: 'o3-deep-research', created: 1_749_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-4o', created: 1_715_000_000, object: 'model', owned_by: 'system' },
  { id: 'o3', created: 1_744_000_000, object: 'model', owned_by: 'system' },
  { id: 'text-embedding-3-large', created: 1_705_000_000, object: 'model', owned_by: 'system' },
  { id: 'whisper-1', created: 1_677_000_000, object: 'model', owned_by: 'openai-internal' },
  { id: 'tts-1-hd', created: 1_699_000_000, object: 'model', owned_by: 'system' },
  { id: 'dall-e-3', created: 1_698_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-image-1', created: 1_745_000_000, object: 'model', owned_by: 'system' },
  { id: 'omni-moderation-latest', created: 1_731_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-4o-realtime-preview', created: 1_727_000_000, object: 'model', owned_by: 'system' }
];

/**
 * The `skippedonly` scenario's model list (hardening.10): a -pro, a -codex
 * and a -chat model, newest first in that order, and one that is not text.
 * With nothing else to take, the default is the codex, never the newer pro
 * the list opens with.
 */
export const SKIPPED_ONLY_MODELS = [
  { id: 'gpt-5.5-pro', created: 1_781_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-5-codex', created: 1_758_000_000, object: 'model', owned_by: 'system' },
  { id: 'gpt-5-chat-latest', created: 1_754_500_000, object: 'model', owned_by: 'system' },
  { id: 'whisper-1', created: 1_677_000_000, object: 'model', owned_by: 'openai-internal' }
];

export function scenarioForKey(authorization: string): Scenario {
  const key = authorization.toLowerCase();
  if (key.includes('unauthorized')) return 'unauthorized';
  if (key.includes('ratelimit')) return 'ratelimit';
  if (key.includes('servererror')) return 'servererror';
  if (key.includes('malformed')) return 'malformed';
  if (key.includes('prose')) return 'prose';
  if (key.includes('wrongshape')) return 'wrongshape';
  if (key.includes('slow')) return 'slow';
  if (key.includes('obsidian')) return 'obsidian';
  if (key.includes('outputlimit')) return 'outputlimit';
  if (key.includes('unverified')) return 'unverified';
  if (key.includes('skippedonly')) return 'skippedonly';
  return 'ok';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
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
  cutOff = false
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  let seq = 0;
  const send = (event: Record<string, unknown>): void => {
    res.write(
      `event: ${String(event['type'])}\ndata: ${JSON.stringify({ ...event, sequence_number: seq++ })}\n\n`
    );
  };

  send({ type: 'response.created', response: responseObject(model, 'in_progress', null, 0) });
  send({ type: 'response.in_progress', response: responseObject(model, 'in_progress', null, 0) });
  for (const delta of pieces(text, 12)) {
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

export async function startMockOpenAi(options: { port?: number; log?: boolean } = {}): Promise<MockOpenAi> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const body = await readBody(req);
      const authorization = String(req.headers['authorization'] ?? '');
      requests.push({ method: req.method ?? 'GET', path: url.pathname, authorization, body });
      const scenario = scenarioForKey(authorization);
      if (options.log) console.log(`[mock-openai] ${req.method ?? ''} ${url.pathname} -> ${scenario}`);

      if (!authorization.startsWith('Bearer ')) {
        apiError(res, 401, 'invalid_request_error', 'missing_api_key', 'You did not provide an API key.');
        return;
      }
      if (scenario === 'unauthorized') {
        apiError(
          res,
          401,
          'invalid_request_error',
          'invalid_api_key',
          'Incorrect API key provided: sk-...ized.'
        );
        return;
      }
      if (scenario === 'ratelimit' && url.pathname.endsWith('/responses')) {
        res.setHeader('retry-after', '0');
        apiError(res, 429, 'insufficient_quota', 'insufficient_quota', 'You exceeded your current quota.');
        return;
      }
      if (scenario === 'servererror' && url.pathname.endsWith('/responses')) {
        res.setHeader('retry-after', '0');
        apiError(
          res,
          500,
          'server_error',
          'server_error',
          'The server had an error while processing your request.'
        );
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        sendJson(res, 200, {
          object: 'list',
          data: scenario === 'skippedonly' ? SKIPPED_ONLY_MODELS : MODELS
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/responses') {
        const request = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
        if (scenario === 'unverified' && request['stream'] === true) {
          apiError(
            res,
            400,
            'invalid_request_error',
            'unsupported_value',
            UNVERIFIED_STREAM_MESSAGE,
            'stream'
          );
          return;
        }
        const requested = typeof request['model'] === 'string' ? request['model'] : 'gpt-5';
        // The API answers with a dated snapshot of the model that was asked for.
        const model = `${requested}-2026-06-01`;
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

        if (request['stream'] === true) {
          await streamResponse(res, model, text, scenario === 'slow' ? 600 : 15, scenario === 'outputlimit');
        } else {
          // As slow as the streamed reply, all at the end (a connection test that runs out of time).
          if (scenario === 'slow') await sleep(600 * 12);
          if (res.destroyed) return;
          const response = responseObject(model, 'completed', text, Math.ceil(text.length / 4));
          sendJson(res, 200, { ...response, output_text: text });
        }
        return;
      }

      apiError(
        res,
        404,
        'invalid_request_error',
        'not_found',
        `No mock for ${req.method ?? ''} ${url.pathname}`
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
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
