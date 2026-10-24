import { APIError, OpenAI } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { NO_DEV_SWITCHES, readDevSwitches, setDevSwitches } from '../../src/main/devSwitches';
import { mapChatGptError } from '../../src/main/providers/chatgpt';
import {
  OPENAI_BASE_URL,
  clientOptions,
  incompleteFailure,
  outputTextOf
} from '../../src/main/providers/openai';
import { createRegistry } from '../../src/main/providers/registry';
import type { ReviewProvider } from '../../src/main/providers/types';
import { replyLimitMessage } from '../../src/shared/ai/replyLimit';
import { PROVIDERS } from '../../src/shared/types';

/* The Responses request of src/main/providers/openai.ts, which the ChatGPT
   provider sends (codex.3) and which stayed when codex.6 took out the OpenAI
   API key's provider: the reading of a reply, a reply cut short, the
   client's options, and the registry of the providers left. These were the
   key provider's tests until then; the review end to end is in
   test/main/chatgptProvider.test.ts. */

describe('reading a reply', () => {
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

  it('says what stopped an incomplete reply other than the output limit, under the code it is given (files.10)', () => {
    const facts = { words: 3_000, effort: 'high' as const };
    const filtered = incompleteFailure(
      { model: 'gpt-5.5', incomplete_details: { reason: 'content_filter' } },
      'gpt-5',
      facts,
      'chatgpt-failed'
    );
    expect(filtered).toMatchObject({
      code: 'chatgpt-failed',
      message:
        "OpenAI's content filter stopped the reply from gpt-5.5 before it was finished, so no suggestions came back. Try again, or choose another model.",
      detail: 'content_filter'
    });
    expect(incompleteFailure({ incomplete_details: null }, 'gpt-5', facts, 'chatgpt-failed').message).toBe(
      'OpenAI stopped the reply from gpt-5 before it was finished (no reason given), so no suggestions came back. Try again.'
    );
    // At the output limit with no usage, the limit goes unnamed.
    expect(
      incompleteFailure(
        { incomplete_details: { reason: 'max_output_tokens' } },
        'gpt-5',
        facts,
        'chatgpt-failed'
      ).message
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
        facts,
        'chatgpt-failed'
      ).message
    ).toMatch(/^gpt-5 reached its output limit \(16,000 tokens\)/);
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
    const chapterFacts = { who: 'gpt-5.5', words: 140_250, effort: 'high' as const };
    const err = mapChatGptError(tooLong, 'review the chapter', chapterFacts);
    expect(err.code).toBe('chatgpt-failed');
    expect(err.message).toBe(
      'The chapter is too long for gpt-5.5 to read in one request (140,250 words), so nothing came back. Split it into shorter files and review each.'
    );
    expect(err.detail).toContain('context window');
    // Without a chapter, as for the model list, it stays a refused request.
    expect(mapChatGptError(tooLong, 'list the models').message).toMatch(
      /^OpenAI refused the request to list the models on your ChatGPT plan \(status 400\)/
    );
  });

  it('words a plain error without inventing an HTTP status', () => {
    const err = mapChatGptError(new Error('boom'), 'review the chapter');
    expect(err.code).toBe('chatgpt-failed');
    expect(err.message).toBe('OpenAI could not review the chapter on your ChatGPT plan.');
    expect(err.detail).toBe('boom');
  });
});

/* hardening.1: nothing in the environment may move the bearer. The SDK reads
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
      return new OpenAI(clientOptions({ maxRetries: 0 }, 'a-bearer'));
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

  it('lets an injected test URL win, and takes the retries it is given', () => {
    const options = clientOptions({ baseUrl: () => 'http://127.0.0.1:1/v1', maxRetries: 0 }, 'k');
    expect(options.baseURL).toBe('http://127.0.0.1:1/v1');
    expect(options.maxRetries).toBe(0);
    expect(options.apiKey).toBe('k');
  });
});

describe('provider registry', () => {
  const stub = (id: ReviewProvider['id']): ReviewProvider => ({
    id,
    label: id,
    runtime: () => Promise.resolve({ provider: id, state: 'ready' }),
    models: () => Promise.resolve([]),
    review: () => Promise.reject(new Error('not used'))
  });

  it('serves Claude and ChatGPT by id, the providers left once the OpenAI API key went (codex.6)', () => {
    expect(PROVIDERS).toEqual(['claude', 'chatgpt']);
    const registry = createRegistry([stub('claude'), stub('chatgpt')]);
    expect(registry.ids().sort()).toEqual(['chatgpt', 'claude']);
    expect(registry.get('claude').id).toBe('claude');
    expect(registry.get('chatgpt').id).toBe('chatgpt');
  });

  it('refuses a registry that leaves a provider out or lists one twice', () => {
    expect(() => createRegistry([stub('claude')])).toThrow(/chatgpt/);
    expect(() => createRegistry([stub('chatgpt')])).toThrow(/claude/);
    expect(() => createRegistry([stub('claude'), stub('chatgpt'), stub('chatgpt')])).toThrow(/twice/);
  });

  it("answers an unknown id from another process with an app error, the API key's openai among them", () => {
    const registry = createRegistry([stub('claude'), stub('chatgpt')]);
    expect(() => registry.get('openai' as 'claude')).toThrow(/Unknown AI provider: openai/);
    expect(() => registry.get('gemini' as 'claude')).toThrow(/Unknown AI provider/);
  });
});
