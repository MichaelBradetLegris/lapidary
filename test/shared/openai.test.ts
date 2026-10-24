import { describe, expect, it } from 'vitest';
import {
  NOT_DEFAULT_MODEL,
  OPENAI_EFFORTS,
  OPENAI_FALLBACK_MODEL,
  OPENAI_MATURITY,
  defaultOpenAiModel,
  estimateTokens,
  isTextModel,
  openAiKeyLine,
  openAiKeyRowLabel,
  openAiMaturityNote,
  openAiMaturitySentence,
  openAiMaturityWord,
  openAiModelToSend,
  openAiProviderLabel,
  toOpenAiEffort,
  usableModels
} from '../../src/shared/ai/openai';
import { APP_NAME } from '../../src/shared/branding';
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

/* hardening.10: the default over a list shaped like the one OpenAI's models
   endpoint gives a key in 2026. The names are OpenAI's; the `created` times
   are illustrative, in the order the models came out, so each -pro, -codex,
   -deep-research and -chat model is newer than the model the default should
   take. */
describe('OpenAI default model', () => {
  const OPENAI_LIST = [
    { id: 'gpt-4o', created: 1_715_367_049 },
    { id: 'gpt-4o-mini', created: 1_721_172_741 },
    { id: 'chatgpt-4o-latest', created: 1_723_515_131 },
    { id: 'o1', created: 1_734_375_816 },
    { id: 'o3-mini', created: 1_737_146_383 },
    { id: 'o1-pro', created: 1_742_251_791 },
    { id: 'o3', created: 1_744_225_308 },
    { id: 'o4-mini', created: 1_744_225_351 },
    { id: 'gpt-4.1', created: 1_744_316_542 },
    { id: 'gpt-4.1-mini', created: 1_744_318_173 },
    { id: 'gpt-4.1-nano', created: 1_744_321_707 },
    { id: 'codex-mini-latest', created: 1_746_673_257 },
    { id: 'o3-pro', created: 1_748_475_349 },
    { id: 'o4-mini-deep-research', created: 1_749_685_485 },
    { id: 'o3-deep-research', created: 1_749_840_121 },
    { id: 'gpt-5-chat-latest', created: 1_754_073_306 },
    { id: 'gpt-5-2025-08-07', created: 1_754_075_360 },
    { id: 'gpt-5', created: 1_754_425_777 },
    { id: 'gpt-5-mini-2025-08-07', created: 1_754_425_867 },
    { id: 'gpt-5-mini', created: 1_754_425_928 },
    { id: 'gpt-5-nano-2025-08-07', created: 1_754_426_303 },
    { id: 'gpt-5-nano', created: 1_754_426_384 },
    { id: 'gpt-5-codex', created: 1_757_527_818 },
    { id: 'gpt-5-pro', created: 1_759_469_707 },
    { id: 'gpt-5-pro-2025-10-06', created: 1_759_469_822 },
    { id: 'gpt-5-search-api', created: 1_759_514_629 },
    { id: 'gpt-5.1-chat-latest', created: 1_762_547_951 },
    { id: 'gpt-5.1-2025-11-13', created: 1_762_800_353 },
    { id: 'gpt-5.1', created: 1_762_800_673 },
    { id: 'gpt-5.1-codex', created: 1_762_988_221 },
    { id: 'gpt-5.1-codex-mini', created: 1_763_007_109 },
    { id: 'gpt-5.1-codex-max', created: 1_763_600_000 },
    { id: 'gpt-5.2-2025-12-11', created: 1_765_400_000 },
    { id: 'gpt-5.2', created: 1_765_400_100 },
    { id: 'gpt-5.2-chat-latest', created: 1_765_400_200 },
    { id: 'gpt-5.2-pro', created: 1_765_400_300 },
    { id: 'gpt-5.2-codex', created: 1_768_000_000 },
    { id: 'gpt-5.4', created: 1_772_000_000 },
    { id: 'gpt-5.4-mini', created: 1_772_100_000 },
    { id: 'gpt-5.4-nano', created: 1_772_200_000 },
    { id: 'gpt-5.4-pro', created: 1_772_300_000 },
    { id: 'gpt-5.5', created: 1_778_000_000 },
    { id: 'gpt-5.5-pro', created: 1_778_100_000 },
    { id: 'gpt-realtime', created: 1_756_000_000 },
    { id: 'gpt-audio', created: 1_756_100_000 },
    { id: 'gpt-4o-transcribe', created: 1_742_000_000 },
    { id: 'gpt-image-1', created: 1_745_000_000 },
    { id: 'text-embedding-3-large', created: 1_705_000_000 },
    { id: 'omni-moderation-latest', created: 1_731_000_000 },
    { id: 'sora-2', created: 1_759_700_000 }
  ];

  /** The list without the ids a pattern matches, as an account without those models would see it. */
  const without = (pattern: RegExp): typeof OPENAI_LIST =>
    OPENAI_LIST.filter((model) => !pattern.test(model.id));

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

  it('lists the skipped models but takes none as the default while another is listed', () => {
    const listed = usableModels(OPENAI_LIST).map((m) => m.id);
    // `isTextModel` already leaves out the deep research models, as search
    // models, and gpt-5.1-codex-mini with codex-mini-latest.
    const notListed = ['gpt-5.1-codex-mini', 'o3-deep-research', 'o4-mini-deep-research'];
    for (const id of SKIPPED) expect(listed.includes(id), id).toBe(!notListed.includes(id));
    // Newest first, the list opens with gpt-5.5-pro; the default is the newest full gpt-5.
    expect(listed[0]).toBe('gpt-5.5-pro');
    expect(defaultOpenAiModel(OPENAI_LIST)).toBe('gpt-5.5');
  });

  it('takes a full gpt-5 before a newer mini, a mini before a newer nano, and a nano before any other', () => {
    // gpt-5.4 is older than gpt-5.4-mini, which is older than gpt-5.4-nano.
    expect(defaultOpenAiModel(without(/^gpt-5\.5/))).toBe('gpt-5.4');
    const noFull = without(/^gpt-5(\.\d+)?(-\d{4}-\d{2}-\d{2})?$/);
    expect(defaultOpenAiModel(noFull)).toBe('gpt-5.4-mini');
    const noMini = noFull.filter((m) => !/^gpt-5(\.\d+)?-mini/.test(m.id));
    expect(defaultOpenAiModel(noMini)).toBe('gpt-5.4-nano');
    // A nano comes before any other gpt-5, even a newer one.
    expect(defaultOpenAiModel([...noMini, { id: 'gpt-5.6-preview', created: 1_790_000_000 }])).toBe(
      'gpt-5.4-nano'
    );
    const noNano = noMini.filter((m) => !/^gpt-5(\.\d+)?-nano/.test(m.id));
    // Any other gpt-5 that is not skipped comes before another family.
    expect(defaultOpenAiModel([...noNano, { id: 'gpt-5.6-preview', created: 1 }])).toBe('gpt-5.6-preview');
    // Only skipped gpt-5s are left: another family's newest model that is neither
    // a mini nor a nano, though gpt-4.1-mini and gpt-4.1-nano are newer.
    expect(defaultOpenAiModel(noNano)).toBe('gpt-4.1');
    // Then the newest mini (gpt-4.1-mini is newer than o4-mini and gpt-4o-mini), then a nano.
    const smallOnly = noNano.filter((m) => /-(mini|nano)$/.test(m.id));
    expect(defaultOpenAiModel(smallOnly)).toBe('gpt-4.1-mini');
    expect(defaultOpenAiModel(smallOnly.filter((m) => !m.id.endsWith('-mini')))).toBe('gpt-4.1-nano');
  });

  it('takes the alias over its dated snapshot, whichever is newer', () => {
    expect(
      defaultOpenAiModel([
        { id: 'gpt-5.1', created: 1 },
        { id: 'gpt-5.1-2025-11-13', created: 2 }
      ])
    ).toBe('gpt-5.1');
    expect(
      defaultOpenAiModel([
        { id: 'gpt-5-mini', created: 1 },
        { id: 'gpt-5-mini-2025-08-07', created: 2 },
        { id: 'gpt-5-nano', created: 3 }
      ])
    ).toBe('gpt-5-mini');
    // A snapshot whose alias is not listed is the default itself, in its tier.
    expect(defaultOpenAiModel([{ id: 'gpt-5-2025-08-07', created: 1 }])).toBe('gpt-5-2025-08-07');
    expect(
      defaultOpenAiModel([
        { id: 'gpt-5-2025-08-07', created: 1 },
        { id: 'gpt-5-mini', created: 2 }
      ])
    ).toBe('gpt-5-2025-08-07');
    expect(
      defaultOpenAiModel([
        { id: 'gpt-5-mini-2025-08-07', created: 1 },
        { id: 'gpt-5-nano', created: 2 }
      ])
    ).toBe('gpt-5-mini-2025-08-07');
  });

  it('takes a skipped model only when every text model is one, and a -pro model last of all', () => {
    // Every skipped model of the list: the list opens with gpt-5.5-pro, but the
    // default is the newest gpt-5 that is no -pro.
    const skippedOnly = OPENAI_LIST.filter((model) => NOT_DEFAULT_MODEL.test(model.id));
    expect(usableModels(skippedOnly)[0]?.id).toBe('gpt-5.5-pro');
    expect(defaultOpenAiModel(skippedOnly)).toBe('gpt-5.2-codex');
    // A chat model before a newer pro.
    expect(
      defaultOpenAiModel([
        { id: 'gpt-5.5-pro', created: 3 },
        { id: 'gpt-5-chat-latest', created: 1 },
        { id: 'whisper-1', created: 4 }
      ])
    ).toBe('gpt-5-chat-latest');
    // Only pro models: by the same tiers, a gpt-5 before a newer o3-pro, the alias
    // before its newer snapshot.
    expect(
      defaultOpenAiModel([
        { id: 'o3-pro', created: 3 },
        { id: 'gpt-5-pro-2025-10-06', created: 2 },
        { id: 'gpt-5-pro', created: 1 }
      ])
    ).toBe('gpt-5-pro');
    // No text model at all, the deep research models being search models.
    expect(
      defaultOpenAiModel([
        { id: 'o3-deep-research', created: 1 },
        { id: 'whisper-1', created: 4 }
      ])
    ).toBeNull();
  });

  it('sends the choice, else the default, else gpt-5', () => {
    expect(openAiModelToSend(' gpt-5.5-pro ', OPENAI_LIST)).toBe('gpt-5.5-pro');
    expect(openAiModelToSend('', OPENAI_LIST)).toBe('gpt-5.5');
    // Only skipped models: the default the dialog marks, not the pro in its first row.
    const skippedOnly = [
      { id: 'gpt-5-codex', created: 2 },
      { id: 'gpt-5.5-pro', created: 3 },
      { id: 'whisper-1', created: 4 }
    ];
    expect(openAiModelToSend('', skippedOnly)).toBe('gpt-5-codex');
    // No text model listed.
    expect(openAiModelToSend('  ', [{ id: 'whisper-1', created: 1 }])).toBe(OPENAI_FALLBACK_MODEL);
    // The list could not be read.
    expect(openAiModelToSend('', null)).toBe('gpt-5');
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
  it('offers the three providers, each with a label and a short name', () => {
    // codex.3: ChatGPT between them, as the review dialog and the Review menu list them.
    expect(PROVIDERS).toEqual(['claude', 'chatgpt', 'openai']);
    for (const provider of PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
      expect(PROVIDER_NAMES[provider]).toBeTruthy();
    }
    expect(PROVIDER_LABELS.openai).toBe('OpenAI (API key, experimental)');
    expect(PROVIDER_LABELS.openai).toBe(openAiProviderLabel(OPENAI_MATURITY));
    // Plain name only: Claude Code may run on a plan or an API key (opensource.6).
    expect(PROVIDER_LABELS.claude).toBe('Claude');
    // The short name never carries the label: the status bar and History say only who answered.
    expect(PROVIDER_NAMES.openai).toBe('OpenAI');
    // ChatGPT runs on the plan: its label is its plain name too.
    expect(PROVIDER_LABELS.chatgpt).toBe('ChatGPT');
    expect(PROVIDER_NAMES.chatgpt).toBe('ChatGPT');
  });

  it('keeps a model setting per provider so none is sent another one', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      model: 'opus',
      openaiModel: 'gpt-5.5',
      chatgptModel: 'gpt-5-mini'
    };
    expect(modelFor(settings, 'claude')).toBe('opus');
    expect(modelFor(settings, 'openai')).toBe('gpt-5.5');
    expect(modelFor(settings, 'chatgpt')).toBe('gpt-5-mini');
    expect(modelPatch('openai', 'gpt-5-mini')).toEqual({ openaiModel: 'gpt-5-mini' });
    expect(modelPatch('claude', 'sonnet')).toEqual({ model: 'sonnet' });
    expect(modelPatch('chatgpt', 'gpt-5.5')).toEqual({ chatgptModel: 'gpt-5.5' });
    expect(DEFAULT_SETTINGS.provider).toBe('claude');
    expect(DEFAULT_SETTINGS.openaiModel).toBe('');
    expect(DEFAULT_SETTINGS.chatgptModel).toBe('');
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

describe('how far OpenAI has been tried (hardening.11)', () => {
  it('labels it experimental, in the words of the task', () => {
    expect(openAiMaturityWord('experimental')).toBe('experimental');
    expect(openAiProviderLabel('experimental')).toBe('OpenAI (API key, experimental)');
    expect(openAiKeyRowLabel('experimental')).toBe('OpenAI API key (experimental)');
    expect(openAiMaturitySentence('experimental')).toBe(`OpenAI in ${APP_NAME} is experimental.`);
    expect(openAiMaturityNote('experimental')).toBe(
      `OpenAI in ${APP_NAME} is experimental. It has been tested only with a stand-in for OpenAI's service, not with a real key, so a review may fail in ways not yet seen.`
    );
  });

  it('drops the label, the sentence and the note once OpenAI is tested', () => {
    expect(openAiMaturityWord('tested')).toBeNull();
    expect(openAiProviderLabel('tested')).toBe('OpenAI (API key)');
    expect(openAiKeyRowLabel('tested')).toBe('OpenAI API key');
    expect(openAiMaturitySentence('tested')).toBeNull();
    expect(openAiMaturityNote('tested')).toBeNull();
  });

  it('reads OPENAI_MATURITY when no maturity is given', () => {
    expect(openAiMaturityWord()).toBe(openAiMaturityWord(OPENAI_MATURITY));
    expect(openAiProviderLabel()).toBe(openAiProviderLabel(OPENAI_MATURITY));
    expect(openAiKeyRowLabel()).toBe(openAiKeyRowLabel(OPENAI_MATURITY));
    expect(openAiMaturitySentence()).toBe(openAiMaturitySentence(OPENAI_MATURITY));
    expect(openAiMaturityNote()).toBe(openAiMaturityNote(OPENAI_MATURITY));
  });
});
