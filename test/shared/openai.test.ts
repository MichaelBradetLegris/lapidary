import { describe, expect, it } from 'vitest';
import {
  NOT_DEFAULT_MODEL,
  OPENAI_EFFORTS,
  estimateTokens,
  toOpenAiEffort
} from '../../src/shared/ai/openai';
import { parseOpenAiText, stripOptionalNulls, toStrictJsonSchema } from '../../src/shared/ai/openaiReply';
import { reviewOutputJsonSchema } from '../../src/shared/prompt/schema';
import { createReview, upgradeLoadedReview, withGeneratorProvider } from '../../src/shared/review';
import { normalizeSettings } from '../../src/shared/settings';
import {
  DEFAULT_SETTINGS,
  EFFORT_LEVELS,
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_NAMES,
  modelFor,
  modelPatch,
  type Review
} from '../../src/shared/types';
import { CANNED_REVIEW } from '../helpers/mockOpenAi';

/* The provider-independent half of OpenAI's Responses API, which the ChatGPT
   provider sends (codex.3): the strict schema, reply parsing, the models the
   default passes over, effort and the progress estimate. And, since codex.6
   took out the OpenAI API key's provider, the providers left in the settings
   and the reviews a key made before it, which still open, named as a key's. */

type Json = Record<string, unknown>;

function walkObjects(schema: unknown, visit: (node: Json) => void): void {
  if (Array.isArray(schema)) {
    schema.forEach((s) => walkObjects(s, visit));
    return;
  }
  if (typeof schema !== 'object' || schema === null) return;
  const node = schema as Json;
  visit(node);
  for (const value of Object.values(node)) walkObjects(value, visit);
}

describe('strict JSON schema for OpenAI', () => {
  const strict = toStrictJsonSchema(reviewOutputJsonSchema);

  it('requires every property and forbids extras on every object', () => {
    let objects = 0;
    walkObjects(strict, (node) => {
      const props = node['properties'];
      if (typeof props !== 'object' || props === null) return;
      objects += 1;
      expect(node['additionalProperties']).toBe(false);
      expect([...(node['required'] as string[])].sort()).toEqual(Object.keys(props).sort());
    });
    // root, change, comment
    expect(objects).toBe(3);
  });

  it('turns an optional property into a required nullable one', () => {
    const comment = ((strict['properties'] as Json)['comments'] as Json)['items'] as Json;
    const quote = (comment['properties'] as Json)['quote'] as Json;
    expect(quote['type']).toEqual(['string', 'null']);
  });

  it('keeps a property that was already nullable as it was', () => {
    const comment = ((strict['properties'] as Json)['comments'] as Json)['items'] as Json;
    const paragraph = (comment['properties'] as Json)['paragraph'] as Json;
    const branches = paragraph['anyOf'] as Json[];
    expect(branches.filter((b) => b['type'] === 'null')).toHaveLength(1);
  });

  it('drops keywords strict mode does not accept and keeps descriptions and enums', () => {
    const text = JSON.stringify(strict);
    for (const keyword of ['$schema', 'minLength', 'maxLength', 'minimum', 'maximum']) {
      expect(text).not.toContain(`"${keyword}"`);
    }
    expect(text).toContain('"description"');
    expect(text).toContain('"enum"');
  });

  it('does not modify the schema Claude uses', () => {
    expect(JSON.stringify(reviewOutputJsonSchema)).toContain('"maxLength"');
    expect(reviewOutputJsonSchema['$schema']).toBe('http://json-schema.org/draft-07/schema#');
  });
});

describe('parsing an OpenAI reply', () => {
  it('parses the canned fixture into the shared review shape', () => {
    const parsed = parseOpenAiText(JSON.stringify(CANNED_REVIEW));
    expect(parsed.ok).toBe(true);
    expect(parsed.value?.changes).toHaveLength(6);
    expect(parsed.value?.comments).toHaveLength(3);
    // `quote: null` is dropped, `paragraph: null` is kept.
    const chapterLevel = parsed.value?.comments[2];
    expect(chapterLevel?.paragraph).toBeNull();
    expect(chapterLevel && 'quote' in chapterLevel).toBe(false);
    // raw keeps exactly what arrived
    expect((parsed.raw as typeof CANNED_REVIEW).comments[2]?.quote).toBeNull();
  });

  it('says the reply was not JSON when it was cut off', () => {
    const parsed = parseOpenAiText('{"changes": [{"paragraph": 0, "before": "had began", "after": ');
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toMatch(/not JSON/);
  });

  it('says where JSON of the wrong shape went wrong', () => {
    const parsed = parseOpenAiText(JSON.stringify({ edits: [] }));
    expect(parsed.ok).toBe(false);
    expect(parsed.problem).toMatch(/changes/);
  });

  it('treats an empty reply as a failure, not as "no changes"', () => {
    expect(parseOpenAiText('   ').ok).toBe(false);
  });

  it('drops nulls only where the original schema made the property optional', () => {
    const input = { changes: [], comments: [{ paragraph: null, quote: null, category: 'plot', text: 'x' }] };
    expect(stripOptionalNulls(input, reviewOutputJsonSchema)).toEqual({
      changes: [],
      comments: [{ paragraph: null, category: 'plot', text: 'x' }]
    });
  });
});

/* hardening.10, for an API key's list then and ChatGPT's since codex.3
   (`defaultChatGptModel`, test/shared/chatgptReviews.test.ts): the models the
   default passes over while the list has any other. */
describe('the models the default passes over', () => {
  const SKIPPED = [
    'o1-pro',
    'o3-pro',
    'gpt-5-pro',
    'gpt-5-pro-2025-10-06',
    'gpt-5.2-pro',
    'gpt-5.4-pro',
    'gpt-5.5-pro',
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-mini',
    'gpt-5.1-codex-max',
    'gpt-5.2-codex',
    'gpt-5.5-codex',
    'o3-deep-research',
    'o4-mini-deep-research',
    'gpt-5-chat-latest',
    'gpt-5.1-chat-latest',
    'gpt-5.2-chat-latest'
  ];

  it('names every -pro, -codex, -deep-research and -chat model, and no other', () => {
    for (const id of SKIPPED) expect(NOT_DEFAULT_MODEL.test(id), id).toBe(true);
    for (const id of [
      'gpt-5',
      'gpt-5.5',
      'gpt-5-2025-08-07',
      'gpt-5-mini',
      'gpt-5.4-nano',
      'gpt-5-nano-2025-08-07',
      'gpt-4.1',
      'o3',
      'o4-mini',
      // Made-up names: the words count only whole, between dashes or at the end.
      'gpt-5-proto',
      'gpt-5-codexer',
      'gpt-5-chatter'
    ]) {
      expect(NOT_DEFAULT_MODEL.test(id), id).toBe(false);
    }
    // Made-up names it must name too. Every -chat id above ends in -chat-latest, so
    // these say what each half of the pattern adds: a -chat model that is no
    // -chat-latest alias, which only the word `chat` names, and a chat-latest whose
    // `chat` follows no dash, which only `chat-latest` names (C.82).
    for (const id of ['gpt-5-chat', 'gpt-5.1-chat-2025-11-13', 'gpt-5-groupchat-latest']) {
      expect(NOT_DEFAULT_MODEL.test(id), id).toBe(true);
    }
  });
});

describe('OpenAI reasoning effort', () => {
  it('maps every app effort level to a value the API accepts', () => {
    for (const level of EFFORT_LEVELS) {
      expect(OPENAI_EFFORTS).toContain(toOpenAiEffort(level));
    }
  });

  it('passes xhigh and max through, since the API accepts both', () => {
    expect(toOpenAiEffort('low')).toBe('low');
    expect(toOpenAiEffort('medium')).toBe('medium');
    expect(toOpenAiEffort('high')).toBe('high');
    expect(toOpenAiEffort('xhigh')).toBe('xhigh');
    expect(toOpenAiEffort('max')).toBe('max');
  });
});

describe('progress', () => {
  it('estimates tokens from characters while streaming', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(400)).toBe(100);
  });
});

describe('providers in settings (codex.6)', () => {
  it('offers Claude and ChatGPT, each with a label and a short name, and names a review saved on a key', () => {
    // codex.3 put ChatGPT second; codex.6 took out OpenAI (API key), ChatGPT being OpenAI's one route.
    expect(PROVIDERS).toEqual(['claude', 'chatgpt']);
    for (const provider of PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
      expect(PROVIDER_NAMES[provider]).toBeTruthy();
    }
    // Plain name only: Claude Code may run on a plan or an API key (opensource.6).
    expect(PROVIDER_LABELS.claude).toBe('Claude');
    // ChatGPT runs on the plan: its label is its plain name too.
    expect(PROVIDER_LABELS.chatgpt).toBe('ChatGPT');
    expect(PROVIDER_NAMES.chatgpt).toBe('ChatGPT');
    expect(PROVIDER_LABELS).not.toHaveProperty('openai');
    // A review saved on an OpenAI API key before codex.6 is named so, never as ChatGPT's.
    expect(PROVIDER_NAMES.openai).toBe('OpenAI (API key)');
  });

  it('keeps a model setting per provider so none is sent another one', () => {
    const settings = { ...DEFAULT_SETTINGS, model: 'opus', chatgptModel: 'gpt-5-mini' };
    expect(modelFor(settings, 'claude')).toBe('opus');
    expect(modelFor(settings, 'chatgpt')).toBe('gpt-5-mini');
    expect(modelPatch('claude', 'sonnet')).toEqual({ model: 'sonnet' });
    expect(modelPatch('chatgpt', 'gpt-5.5')).toEqual({ chatgptModel: 'gpt-5.5' });
    expect(DEFAULT_SETTINGS.provider).toBe('claude');
    expect(DEFAULT_SETTINGS.chatgptModel).toBe('');
    expect(DEFAULT_SETTINGS).not.toHaveProperty('openaiModel');
  });

  it("reads a settings.json from before codex.6 that chose the key: Claude, the key's model left out", () => {
    const read = normalizeSettings({
      provider: 'openai',
      openaiModel: 'gpt-5-mini',
      chatgptModel: 'gpt-5.5',
      model: 'sonnet'
    });
    expect(read.provider).toBe('claude');
    expect(read).not.toHaveProperty('openaiModel');
    expect(read.chatgptModel).toBe('gpt-5.5');
    expect(read.model).toBe('sonnet');
    // So the next save writes neither.
    expect(JSON.stringify(read)).not.toMatch(/openai/i);
  });
});

describe('generator.provider on load', () => {
  function stored(generator: Record<string, unknown>): Review {
    const review = createReview({
      sourcePath: 'C:/vault/Chapter 01.md',
      base: { text: 'x', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [],
      generator: { kind: 'manual' },
      now: '2026-09-01T00:00:00.000Z'
    });
    return { ...review, generator: generator as unknown as Review['generator'] };
  }

  it("fills in 'claude' for a model review written before Phase 5c", () => {
    const old = stored({ kind: 'claude', model: 'claude-opus-5' });
    const upgraded = withGeneratorProvider(old);
    expect(upgraded.generator.provider).toBe('claude');
    expect(upgraded.generator.model).toBe('claude-opus-5');
    expect(old.generator.provider).toBeUndefined();
  });

  it('leaves a review that already names its provider untouched, one saved on an OpenAI key included', () => {
    const current = stored({ kind: 'chatgpt', provider: 'chatgpt', model: 'gpt-5.5' });
    expect(withGeneratorProvider(current)).toBe(current);
    // codex.6 took the key's provider out, but a review it made still opens as it was.
    const onKey = stored({
      kind: 'openai',
      provider: 'openai',
      model: 'gpt-5.5-2026-06-01',
      costUsd: 0.02,
      costEstimated: true
    });
    expect(withGeneratorProvider(onKey)).toBe(onKey);
    expect(upgradeLoadedReview(onKey).generator).toMatchObject({
      kind: 'openai',
      provider: 'openai',
      costEstimated: true
    });
  });

  it("fills in 'openai' for a key's review that does not name its provider", () => {
    expect(withGeneratorProvider(stored({ kind: 'openai' })).generator.provider).toBe('openai');
  });

  it('gives manual and file reviews no provider', () => {
    const manual = stored({ kind: 'manual' });
    expect(withGeneratorProvider(manual)).toBe(manual);
    const file = stored({ kind: 'file' });
    expect(withGeneratorProvider(file)).toBe(file);
  });

  it('runs the Phase 5b rename and the provider default together', () => {
    const paste = upgradeLoadedReview(stored({ kind: 'paste' }));
    expect(paste.generator.kind).toBe('manual');
    expect(paste.generator.provider).toBeUndefined();
    const claude = upgradeLoadedReview(stored({ kind: 'claude' }));
    expect(claude.generator).toEqual({ kind: 'claude', provider: 'claude' });
  });
});
