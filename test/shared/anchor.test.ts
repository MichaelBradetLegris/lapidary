import { describe, expect, it } from 'vitest';
import { anchorChanges, resolveOverlaps, type ChangeInput } from '../../src/shared/diff/anchor';
import { composeText } from '../../src/shared/diff/compose';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk } from '../../src/shared/types';

const TEXT = [
  '---',
  'title: Chapter 12',
  '---',
  '',
  'It was the third night of rain, and the river had began to climb the steps.',
  '',
  '"You should of told me," Mara said. She said it again, and she said it once more.',
  '',
  'She nodded her head, then looked away toward the grey water.'
].join('\n');

const paragraphs = splitParagraphs(TEXT);

function anchor(changes: ChangeInput[]): Hunk[] {
  return anchorChanges(TEXT, paragraphs, changes);
}

describe('anchorChanges', () => {
  it('anchors an exact quote inside the stated paragraph', () => {
    const [h] = anchor([
      { paragraph: 0, before: 'had began', after: 'had begun', category: 'grammar', reason: 'tense' }
    ]);
    expect(h).toBeDefined();
    expect(h?.anchor).toBe('exact');
    expect(h?.original).toBe('began');
    expect(h?.replacement).toBe('begun');
    expect(h?.paragraph).toBe(0);
    expect(TEXT.slice(h!.start, h!.end)).toBe('began');
    expect(h?.category).toBe('grammar');
    expect(h?.reason).toBe('tense');
  });

  it('never anchors inside frontmatter', () => {
    const [h] = anchor([{ paragraph: 0, before: 'had began', after: 'had begun' }]);
    expect(h!.start).toBeGreaterThan(TEXT.indexOf('It was'));
  });

  it('finds the quote in a neighbouring paragraph when Claude miscounts', () => {
    const [h] = anchor([{ paragraph: 0, before: 'nodded her head', after: 'nodded' }]);
    expect(h?.anchor).toBe('exact');
    expect(h?.paragraph).toBe(2);
    expect(h?.original).toBe(' her head');
    expect(h?.replacement).toBe('');
  });

  it('marks a quote that occurs twice in the paragraph as ambiguous', () => {
    const [h] = anchor([{ paragraph: 1, before: 'said it', after: 'repeated it' }]);
    expect(h?.anchor).toBe('ambiguous');
    expect(h?.original).toBe('said');
    expect(h?.replacement).toBe('repeated');
  });

  it('falls back to a fuzzy match when the quote is slightly wrong', () => {
    const [h] = anchor([{ paragraph: 0, before: 'the river has began', after: 'the river had begun' }]);
    expect(h?.anchor).toBe('fuzzy');
    expect(TEXT.slice(h!.start, h!.end)).toBe(h?.original);
  });

  it('marks a quote that is nowhere in the chapter as stale', () => {
    const [h] = anchor([
      { paragraph: 0, before: 'a sentence that never appeared in this chapter at all', after: 'x' }
    ]);
    expect(h?.anchor).toBe('stale');
    expect(h?.start).toBe(0);
    expect(h?.end).toBe(0);
    expect(h?.original).toBe('a sentence that never appeared in this chapter at all');
    expect(h?.reason).toContain('Could not find');
  });

  it('drops a change that asks for the text it already has', () => {
    expect(anchor([{ paragraph: 0, before: 'had began', after: 'had began' }])).toEqual([]);
  });

  it('rejects an empty before', () => {
    const [h] = anchor([{ paragraph: 0, before: '', after: 'something' }]);
    expect(h?.anchor).toBe('stale');
  });

  it('demotes a hunk that overlaps an earlier one', () => {
    const hunks = anchor([
      { paragraph: 0, before: 'had began to climb', after: 'had begun to scale' },
      { paragraph: 0, before: 'to climb the steps', after: 'to scale the steps' }
    ]);
    const anchored = hunks.filter((h) => h.anchor !== 'stale');
    const stale = hunks.filter((h) => h.anchor === 'stale');
    expect(anchored).toHaveLength(1);
    expect(stale).toHaveLength(1);
    expect(stale[0]?.reason).toContain('Overlapped');
  });

  it('never takes a fuzzy match that starts before the body, at the line break after the frontmatter (files.7)', () => {
    const text = '---\ntitle: x\n---\nThe frist line of the chapter.';
    const change = {
      paragraph: 0,
      before: '\nThe firts line of the chapter.',
      after: '\nThe first line of the chapter.'
    };
    const [h] = anchorChanges(text, splitParagraphs(text), [change]);
    expect(h?.anchor).toBe('stale');
    // The same quote one line further down, past the body's start, is found.
    const later = '---\ntitle: x\n---\nA line.\nThe frist line of the chapter.';
    const [found] = anchorChanges(later, splitParagraphs(later), [change]);
    expect(found).toMatchObject({ anchor: 'fuzzy', original: 'frist', replacement: 'first' });
  });

  it('screens the located hunks before overlaps are resolved, and only those', () => {
    const changes = [
      { paragraph: 0, before: 'had began to climb', after: 'had begun to scale' },
      { paragraph: 0, before: 'to climb the steps', after: 'to scale the steps' },
      { paragraph: 0, before: 'words that are nowhere in it', after: 'x' }
    ];
    let seen: Hunk[] = [];
    const hunks = anchorChanges(TEXT, paragraphs, changes, {
      screen: (located) => {
        seen = located;
        return located.map((h, i) => (i === 0 ? { ...h, anchor: 'stale' as const, start: 0, end: 0 } : h));
      }
    });
    // Both overlapping hunks reach the screen still on the page; the one never found does not.
    expect(seen.map((h) => [h.original, h.anchor])).toEqual([
      ['began to climb', 'exact'],
      ['climb', 'exact']
    ]);
    // The first, screened out, no longer pushes the second off the page.
    expect(hunks.map((h) => [h.original, h.anchor])).toEqual([
      ['began to climb', 'stale'],
      ['climb', 'exact'],
      ['words that are nowhere in it', 'stale']
    ]);
    expect(hunks[1]?.reason).toBeUndefined();
  });

  it('produces hunks that compose cleanly', () => {
    const hunks = anchor([
      { paragraph: 0, before: 'had began', after: 'had begun' },
      { paragraph: 1, before: 'should of', after: 'should have' },
      { paragraph: 2, before: 'nodded her head', after: 'nodded' }
    ]).map((h) => ({ ...h, status: 'accepted' as const }));
    const out = composeText(TEXT, hunks);
    expect(out).toContain('had begun');
    expect(out).toContain('should have');
    expect(out).toContain('She nodded, then looked away');
    expect(out.startsWith('---\ntitle: Chapter 12\n---')).toBe(true);
  });
});

describe('resolveOverlaps', () => {
  const base = {
    baseSide: 'original' as const,
    original: 'x',
    replacement: 'y',
    paragraph: 0,
    source: 'claude' as const,
    status: 'pending' as const,
    anchor: 'exact' as const
  };

  it('keeps the earlier hunk and stales the later one', () => {
    const out = resolveOverlaps([
      { ...base, id: 'b', start: 5, end: 12 },
      { ...base, id: 'a', start: 0, end: 8 }
    ]);
    expect(out.find((h) => h.id === 'a')?.anchor).toBe('exact');
    expect(out.find((h) => h.id === 'b')?.anchor).toBe('stale');
  });

  it('leaves already-stale hunks where they are', () => {
    const out = resolveOverlaps([{ ...base, id: 's', start: 0, end: 0, anchor: 'stale' }]);
    expect(out[0]?.anchor).toBe('stale');
  });
});
