import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LOWER_EFFORT_ADVICE, groupDigits, replyLimitMessage } from '../../src/shared/ai/replyLimit';
import { EFFORT_LEVELS } from '../../src/shared/types';

/* files.10: the words of a review whose chapter or reply did not fit, which
   both providers use (claudeStatus.ts, providers/openai.ts). */

describe('groupDigits', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1,000'],
    [32_000, '32,000'],
    [52_300, '52,300'],
    [1_234_567, '1,234,567'],
    [127_999.6, '128,000']
  ])('writes %d as %s', (value, text) => {
    expect(groupDigits(value)).toBe(text);
  });
});

describe('replyLimitMessage', () => {
  const HEAD =
    'Claude reached its output limit (32,000 tokens) before it had written every suggestion, so none came back.';

  it('names the limit and says a lower effort helps, for a short chapter', () => {
    expect(
      replyLimitMessage('output', { who: 'Claude', maxTokens: 32_000, words: 3_000, effort: 'high' })
    ).toBe(`${HEAD} ${LOWER_EFFORT_ADVICE}`);
    expect(LOWER_EFFORT_ADVICE).toBe(
      "The model's thinking counts against the same limit, so a lower effort in Review with AI leaves more of it for the suggestions."
    );
  });

  it('adds splitting the chapter from 12,000 words, and not below', () => {
    expect(
      replyLimitMessage('output', { who: 'Claude', maxTokens: 32_000, words: 11_999, effort: 'high' })
    ).toBe(`${HEAD} ${LOWER_EFFORT_ADVICE}`);
    expect(
      replyLimitMessage('output', { who: 'Claude', maxTokens: 32_000, words: 12_000, effort: 'high' })
    ).toBe(
      `${HEAD} ${LOWER_EFFORT_ADVICE} At 12,000 words the chapter is long for one review: if a lower effort is not enough, split it into two files and review each.`
    );
  });

  it('leaves out a lower effort after a review at low', () => {
    expect(
      replyLimitMessage('output', { who: 'Claude', maxTokens: 32_000, words: 52_300, effort: 'low' })
    ).toBe(
      `${HEAD} At 52,300 words the chapter is long for one review: split it into two files and review each.`
    );
    expect(replyLimitMessage('output', { who: 'Claude', maxTokens: 32_000, words: 900, effort: 'low' })).toBe(
      `${HEAD} Try again, or choose another model.`
    );
  });

  it('says a lower effort helps when the effort is not known', () => {
    expect(replyLimitMessage('output', { who: 'Claude' })).toBe(
      `Claude reached its output limit before it had written every suggestion, so none came back. ${LOWER_EFFORT_ADVICE}`
    );
  });

  it('names an OpenAI model, and leaves out a limit or a count that is not a positive number', () => {
    expect(
      replyLimitMessage('output', {
        who: 'gpt-5-mini-2026-06-01',
        maxTokens: Number.NaN,
        words: 0,
        effort: 'low'
      })
    ).toBe(
      'gpt-5-mini-2026-06-01 reached its output limit before it had written every suggestion, so none came back. Try again, or choose another model.'
    );
  });

  it('words a full context window, with the same advice', () => {
    expect(replyLimitMessage('context', { who: 'Claude', words: 41_000, effort: 'max' })).toBe(
      `Claude ran out of room for the chapter and its reply together (its context window) before it had written every suggestion, so none came back. ${LOWER_EFFORT_ADVICE} At 41,000 words the chapter is long for one review: if a lower effort is not enough, split it into two files and review each.`
    );
  });

  it('says a chapter too long to read can only be split', () => {
    expect(replyLimitMessage('input', { who: 'gpt-4o', words: 140_250, effort: 'high' })).toBe(
      'The chapter is too long for gpt-4o to read in one request (140,250 words), so nothing came back. Split it into shorter files and review each.'
    );
    expect(replyLimitMessage('input', { who: 'Claude' })).toBe(
      'The chapter is too long for Claude to read in one request, so nothing came back. Split it into shorter files and review each.'
    );
  });

  it('always gives whole sentences, with no missing value, whatever it is told (500 runs)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('output', 'context', 'input'),
        fc.option(fc.integer({ min: -5, max: 300_000 }), { nil: undefined }),
        fc.option(fc.integer({ min: -5, max: 500_000 }), { nil: undefined }),
        fc.option(fc.constantFrom(...EFFORT_LEVELS), { nil: undefined }),
        (limit, maxTokens, words, effort) => {
          const message = replyLimitMessage(limit, {
            who: 'Claude',
            ...(maxTokens === undefined ? {} : { maxTokens }),
            ...(words === undefined ? {} : { words }),
            ...(effort === undefined ? {} : { effort })
          });
          expect(message).toMatch(/^[A-Z].*\.$/s);
          expect(message).not.toMatch(/undefined|NaN|\(0 |\(-| {2}/);
          // Splitting is offered for a long chapter, or a chapter too long to read, and only then.
          expect(message.includes('review each')).toBe(limit === 'input' || (words ?? 0) >= 12_000);
          expect(message.includes('lower effort')).toBe(limit !== 'input' && effort !== 'low');
        }
      ),
      { numRuns: 500 }
    );
  });
});
