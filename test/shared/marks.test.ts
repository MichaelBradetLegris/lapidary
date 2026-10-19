import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRenderBlocks } from '../../src/shared/render';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkStatus } from '../../src/shared/types';
import { marginMarks, markAnchorName } from '../../src/shared/ui/marks';

/* small.8 (PLAN 11.7): which changes get a mark in the rail, and the anchor
   names the marks are placed by. */

const TEXT = 'By the time she caught up with Mira who had crossed the bridge, the rain had stopped.';

function h(id: string, find: string, original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = TEXT.indexOf(find) + (find.length - original.length);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'punctuation',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

const segments = (hunks: Hunk[]) => buildRenderBlocks(TEXT, splitParagraphs(TEXT), hunks)[0]!.segments;
const marks = (hunks: Hunk[], focused: string | null = null, hidden: Hunk['category'][] = []) =>
  marginMarks(segments(hunks), focused, hidden as never).map((m) => `${m.kind} ${m.hunk.id}`);

describe('marginMarks', () => {
  it('marks a pending small change, and not a word-sized one', () => {
    const comma = h('comma', 'Mira', '', ',');
    comma.start = comma.end = TEXT.indexOf('Mira') + 4;
    const word = h('word', 'crossed', 'crossed', 'reached', { category: 'word-choice' });
    expect(marks([comma, word])).toEqual(['bar comma']);
  });

  it('marks no decided small change, so a worked chapter goes quiet', () => {
    for (const status of ['accepted', 'dismissed'] as HunkStatus[]) {
      expect(marks([h('stop', 'stopped.', '.', '!', { status })])).toEqual([]);
    }
  });

  it('gives the focused change the arrowhead, whatever its size, and focus wins over a bar', () => {
    const stop = h('stop', 'stopped.', '.', '!');
    const word = h('word', 'crossed', 'crossed', 'reached');
    expect(marks([stop, word], 'word')).toEqual(['focus word', 'bar stop']);
    expect(marks([stop, word], 'stop')).toEqual(['focus stop']);
    expect(marks([h('done', 'stopped.', '.', '!', { status: 'accepted' })], 'done')).toEqual(['focus done']);
  });

  it('never marks a stale change or one the chips hide', () => {
    const stop = h('stop', 'stopped.', '.', '!');
    const stale = { ...h('lost', 'bridge,', ',', ';'), anchor: 'stale' as const };
    const seg = segments([stop]);
    // A stale change is never in the line; were one there, it would get no mark.
    const forced = [
      ...seg,
      { kind: 'hunk' as const, hunk: stale, text: ',', flushBefore: false, flushAfter: false }
    ];
    expect(marginMarks(forced, 'lost').map((m) => m.hunk.id)).toEqual(['stop']);
    expect(marks([stop], 'stop', ['punctuation'])).toEqual([]);
    expect(marks([stop], null, ['grammar'])).toEqual(['bar stop']);
  });

  it('gives each mark the index of its segment', () => {
    const stop = h('stop', 'stopped.', '.', '!');
    const seg = segments([stop]);
    const [mark] = marginMarks(seg, null);
    expect(seg[mark!.index]).toMatchObject({ kind: 'hunk', hunk: { id: 'stop' } });
  });
});

describe('markAnchorName', () => {
  it('gives a dashed ident for a block key and a segment', () => {
    expect(markAnchorName('p12', 3)).toBe('--mark-p12-3');
    expect(markAnchorName('frontmatter', 0)).toBe('--mark-frontmatter-0');
  });

  it('gives a valid dashed ident for any block key, and two keys never one name (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), fc.nat(500), (a, b, index) => {
        const name = markAnchorName(a, index);
        expect(name).toMatch(/^--[A-Za-z0-9_-]+$/);
        if (a !== b) expect(markAnchorName(b, index)).not.toBe(name);
      })
    );
    expect(markAnchorName('a_41_', 1)).not.toBe(markAnchorName('aA', 1));
    expect(markAnchorName('p 1', 1)).toBe('--mark-p_20_1-1');
  });
});
