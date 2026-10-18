import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  commentEditBlocked,
  commentList,
  commentPlace,
  commentsHeading,
  groupComments,
  gutterComments,
  isUnanchored,
  sortComments
} from '../../src/shared/ui/comments';
import type { ReviewComment } from '../../src/shared/types';

/* ui.7: the side panel lists every comment under one heading that counts the
   resolved ones: the open comments, then those whose paragraph left the file,
   then the resolved, each run in reading order, an unanchored comment by the
   paragraph it had. The panel itself is rendered in
   test/renderer/sidePanelComments.render.test.ts. */

function c(
  id: string,
  paragraph: number | null,
  status: ReviewComment['status'] = 'open',
  wasParagraph?: number
): ReviewComment {
  return {
    id,
    paragraph,
    ...(wasParagraph === undefined ? {} : { wasParagraph }),
    category: 'other',
    text: id,
    status
  };
}

const MIXED = [
  c('open-9', 8),
  c('lost-12', null, 'open', 11),
  c('resolved-7', 6, 'resolved'),
  c('chapter', null),
  c('open-2', 1),
  c('resolved-lost-1', null, 'resolved', 0),
  c('lost-4', null, 'open', 3),
  c('resolved-chapter', null, 'resolved'),
  c('resolved-3', 2, 'resolved')
];

describe('one comments list (ui.7)', () => {
  it('tells a comment that lost its paragraph from one about the whole chapter', () => {
    expect(isUnanchored(c('x', null, 'open', 4))).toBe(true);
    expect(isUnanchored(c('x', null, 'open', 0))).toBe(true);
    expect(isUnanchored(c('x', null))).toBe(false);
    expect(isUnanchored(c('x', 3))).toBe(false);
  });

  it('lists the open comments, then the unanchored, then the resolved, each in reading order', () => {
    expect(commentList(MIXED).map((x) => x.id)).toEqual([
      'open-2',
      'open-9',
      'chapter',
      'lost-4',
      'lost-12',
      'resolved-lost-1',
      'resolved-3',
      'resolved-7',
      'resolved-chapter'
    ]);
  });

  it('groups the same runs, a resolved comment with the resolved however it is anchored', () => {
    const groups = groupComments(MIXED);
    expect(groups.open.map((x) => x.id)).toEqual(['open-2', 'open-9', 'chapter']);
    expect(groups.unanchored.map((x) => x.id)).toEqual(['lost-4', 'lost-12']);
    expect(groups.resolved.map((x) => x.id)).toEqual([
      'resolved-lost-1',
      'resolved-3',
      'resolved-7',
      'resolved-chapter'
    ]);
  });

  it('sorts an unanchored comment by the paragraph it had, ties in the order they came', () => {
    const sorted = sortComments([
      c('a', 5),
      c('whole', null),
      c('c', 9),
      c('lost', null, 'open', 5),
      c('b', 4)
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a', 'lost', 'c', 'whole']);
  });

  it('keeps an unanchored comment out of the margin', () => {
    expect(gutterComments(MIXED).map((x) => x.id)).toEqual(['open-2', 'resolved-3', 'resolved-7', 'open-9']);
  });

  it('heads the list with how many of all the comments are resolved', () => {
    expect(commentsHeading(MIXED)).toBe('Comments (4 of 9 resolved)');
    expect(commentsHeading([c('a', 1), c('b', 2)])).toBe('Comments (0 of 2 resolved)');
    expect(commentsHeading([c('a', 1, 'resolved')])).toBe('Comments (1 of 1 resolved)');
    expect(commentsHeading([])).toBe('Comments (0)');
  });

  it('says where a comment is in the numbers the author sees', () => {
    expect(commentPlace(c('x', 11))).toBe('paragraph 12');
    expect(commentPlace(c('x', null, 'open', 11))).toBe('unanchored (was paragraph 12)');
    expect(commentPlace(c('x', null, 'resolved', 0))).toBe('unanchored (was paragraph 1)');
    expect(commentPlace(c('x', null))).toBe('chapter');
  });

  it('says why Edit text opens no paragraph, in different words for a lost comment and a chapter one', () => {
    const lost =
      "That comment's paragraph is no longer in the chapter, so there is no one paragraph to edit.";
    const chapter = 'That comment is about the chapter as a whole, so there is no one paragraph to edit.';
    expect(commentEditBlocked(c('x', null, 'open', 11))).toBe(lost);
    expect(commentEditBlocked(c('x', null, 'open', 0))).toBe(lost);
    expect(commentEditBlocked(c('x', null))).toBe(chapter);
    expect(commentEditBlocked(c('x', 11))).toBeNull();
    expect(commentEditBlocked(c('x', 0))).toBeNull();
  });

  it('loses no comment and keeps each run whole and in order, whatever comes in', () => {
    const comment = fc
      .record({
        paragraph: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
        was: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined }),
        resolved: fc.boolean()
      })
      .map(({ paragraph, was, resolved }) =>
        c('', paragraph, resolved ? 'resolved' : 'open', paragraph === null ? was : undefined)
      );
    fc.assert(
      fc.property(fc.array(comment, { maxLength: 25 }), (raw) => {
        const comments = raw.map((x, i) => ({ ...x, id: `c${i}`, text: `c${i}` }));
        const listed = commentList(comments);
        expect([...listed].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
          [...comments].sort((a, b) => a.id.localeCompare(b.id))
        );
        const run = (x: ReviewComment): number => (x.status === 'resolved' ? 2 : isUnanchored(x) ? 1 : 0);
        const rank = (x: ReviewComment): number => x.paragraph ?? x.wasParagraph ?? Number.POSITIVE_INFINITY;
        for (let i = 1; i < listed.length; i += 1) {
          const [a, b] = [listed[i - 1]!, listed[i]!];
          expect(run(a)).toBeLessThanOrEqual(run(b));
          if (run(a) === run(b)) {
            expect(rank(a)).toBeLessThanOrEqual(rank(b));
            if (rank(a) === rank(b)) expect(comments.indexOf(a)).toBeLessThan(comments.indexOf(b));
          }
        }
      })
    );
  });
});
