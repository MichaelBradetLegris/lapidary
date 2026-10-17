import { describe, expect, it } from 'vitest';
import {
  OPENAI_EFFORTS,
  defaultOpenAiModel,
  estimateTokens,
  isTextModel,
  openAiKeyLine,
  toOpenAiEffort,
  usableModels
} from '../../src/shared/ai/openai';
import { parseOpenAiText, stripOptionalNulls, toStrictJsonSchema } from '../../src/shared/ai/openaiReply';
import { estimateCostUsd, priceFor } from '../../src/shared/ai/pricing';
import { reviewOutputJsonSchema } from '../../src/shared/prompt/schema';
import { createReview, upgradeLoadedReview, withGeneratorProvider } from '../../src/shared/review';
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

/* The provider-independent half of Phase 5c: the strict schema, reply parsing,
   the model list rules, effort, pricing, key wording, and the review-file
   upgrade for `generator.provider`. */

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

describe('OpenAI model list', () => {
  const listed = [
    { id: 'gpt-5.5', created: 300 },
    { id: 'gpt-5-mini', created: 200 },
    { id: 'gpt-6-preview-mock', created: 400 },
    { id: 'gpt-4o', created: 100 },
    { id: 'o3', created: 150 },
    { id: 'text-embedding-3-large', created: 500 },
    { id: 'whisper-1', created: 50 },
    { id: 'tts-1-hd', created: 60 },
    { id: 'dall-e-3', created: 70 },
    { id: 'gpt-image-1', created: 350 },
    { id: 'omni-moderation-latest', created: 360 },
    { id: 'gpt-4o-realtime-preview', created: 370 },
    { id: 'gpt-4o-transcribe', created: 380 },
    { id: 'ft:gpt-4o:acme::abc', created: 390 }
  ];

  it('keeps only models that answer text', () => {
    expect(usableModels(listed).map((m) => m.id)).toEqual([
      'gpt-6-preview-mock',
      'gpt-5.5',
      'gpt-5-mini',
      'o3',
      'gpt-4o'
    ]);
  });

  it('rejects embeddings, speech, images, moderation, realtime and fine-tunes', () => {
    for (const id of [
      'text-embedding-3-large',
      'whisper-1',
      'tts-1-hd',
      'dall-e-3',
      'gpt-image-1',
      'omni-moderation-latest',
      'gpt-4o-realtime-preview',
      'gpt-4o-transcribe',
      'gpt-4o-audio-preview',
      'gpt-4o-search-preview',
      'ft:gpt-4o:acme::abc',
      'davinci-002'
    ]) {
      expect(isTextModel(id), id).toBe(false);
    }
  });

  it('defaults to the newest gpt-5 even when a newer family exists', () => {
    expect(defaultOpenAiModel(listed)).toBe('gpt-5.5');
  });

  it('falls back to the newest text model when there is no gpt-5', () => {
    expect(
      defaultOpenAiModel([
        { id: 'gpt-4o', created: 1 },
        { id: 'o3', created: 2 }
      ])
    ).toBe('o3');
    expect(defaultOpenAiModel([{ id: 'whisper-1', created: 1 }])).toBeNull();
    expect(defaultOpenAiModel([])).toBeNull();
  });

  it('orders ties by id so the list is stable', () => {
    expect(usableModels([{ id: 'gpt-5-b' }, { id: 'gpt-5-a' }]).map((m) => m.id)).toEqual([
      'gpt-5-a',
      'gpt-5-b'
    ]);
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

describe('OpenAI price estimate', () => {
  it('prices a dated snapshot by its family', () => {
    expect(priceFor('gpt-5-mini-2026-06-01')).toEqual(priceFor('gpt-5-mini'));
    expect(priceFor('gpt-5.5-pro')?.output).toBe(180);
  });

  it('refuses to guess a price for a model it does not know', () => {
    expect(priceFor('gpt-6-preview-mock')).toBeNull();
    expect(estimateCostUsd('gpt-6-preview-mock', { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });

  it('bills cached input at the cached rate', () => {
    // gpt-5: $1.25 in, $0.125 cached, $10 out per million.
    const usd = estimateCostUsd('gpt-5', {
      inputTokens: 1_000_000,
      cachedInputTokens: 400_000,
      outputTokens: 100_000
    });
    expect(usd).toBeCloseTo(0.6 * 1.25 + 0.4 * 0.125 + 0.1 * 10, 6);
  });
});

describe('progress and key wording', () => {
  it('estimates tokens from characters while streaming', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(400)).toBe(100);
  });

  it('describes the key without ever needing it', () => {
    expect(openAiKeyLine(null)).toMatch(/checking/);
    expect(
      openAiKeyLine({ configured: true, source: 'stored', last4: 'wxyz', encryptionAvailable: true })
    ).toBe('saved in Settings, encrypted (ends wxyz)');
    expect(
      openAiKeyLine({ configured: true, source: 'environment', last4: 'abcd', encryptionAvailable: true })
    ).toMatch(/OPENAI_API_KEY.*abcd/);
    expect(
      openAiKeyLine({ configured: false, source: 'none', last4: '', encryptionAvailable: true })
    ).toMatch(/missing/);
  });
});

describe('providers in settings', () => {
  it('offers both providers, each with a label and a short name', () => {
    expect(PROVIDERS).toEqual(['claude', 'openai']);
    for (const provider of PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
      expect(PROVIDER_NAMES[provider]).toBeTruthy();
    }
    expect(PROVIDER_LABELS.openai).toBe('OpenAI (API key)');
    // Plain name only: Claude Code may run on a plan or an API key (opensource.6).
    expect(PROVIDER_LABELS.claude).toBe('Claude');
  });

  it('keeps a model setting per provider so neither is sent the other one', () => {
    const settings = { ...DEFAULT_SETTINGS, model: 'opus', openaiModel: 'gpt-5.5' };
    expect(modelFor(settings, 'claude')).toBe('opus');
    expect(modelFor(settings, 'openai')).toBe('gpt-5.5');
    expect(modelPatch('openai', 'gpt-5-mini')).toEqual({ openaiModel: 'gpt-5-mini' });
    expect(modelPatch('claude', 'sonnet')).toEqual({ model: 'sonnet' });
    expect(DEFAULT_SETTINGS.provider).toBe('claude');
    expect(DEFAULT_SETTINGS.openaiModel).toBe('');
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

  it('leaves a review that already names its provider untouched', () => {
    const current = stored({ kind: 'openai', provider: 'openai', model: 'gpt-5.5' });
    expect(withGeneratorProvider(current)).toBe(current);
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
