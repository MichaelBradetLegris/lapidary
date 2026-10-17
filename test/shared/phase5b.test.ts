import { describe, expect, it } from 'vitest';
import { chapterExtension, chapterSlug, createReview, migrateReview } from '../../src/shared/review';
import { chapterStats, countWords } from '../../src/shared/text/stats';
import { PROVIDERS, PROVIDER_LABELS, type Review } from '../../src/shared/types';
import {
  COLLAPSED_CARD_HEIGHT,
  commentDigest,
  groupComments,
  gutterComments
} from '../../src/shared/ui/comments';

/* The pieces Phase 5b added outside the editing model: chapter stats for the
   review dialog, the resolved-comment grouping, and the review-file migration
   that came with renaming paste mode. Branding moved to test/branding.test.ts. */

describe('chapter slugs across extensions', () => {
  it('reads the extension off any platform s separators', () => {
    expect(chapterExtension('C:/vault/Chapter 01.md')).toBe('.md');
    expect(chapterExtension('C:\\vault\\Chapter 01.TXT')).toBe('.txt');
    expect(chapterExtension('/home/a/notes')).toBe(''); // check-public: allow
  });

  it('keeps the bare slug for .md, so existing review folders still resolve', () => {
    expect(chapterSlug('C:/vault/Chapter 01 - The Flood.md')).toBe('chapter-01-the-flood');
  });

  it('gives a .txt chapter a folder of its own', () => {
    // Two files that differ only by extension must not share a review folder.
    expect(chapterSlug('C:/vault/Chapter 01.md')).not.toBe(chapterSlug('C:/vault/Chapter 01.txt'));
    expect(chapterSlug('C:/vault/Chapter 01.txt')).toBe('chapter-01-txt');
  });
});

describe('review migration', () => {
  function stored(kind: string): Review {
    const review = createReview({
      sourcePath: 'C:/vault/Chapter 01.md',
      base: { text: 'x', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [],
      generator: { kind: 'manual' },
      now: '2026-09-01T00:00:00.000Z'
    });
    return { ...review, generator: { ...review.generator, kind: kind as Review['generator']['kind'] } };
  }

  it('renames the old paste kind so older review files still open', () => {
    const migrated = migrateReview(stored('paste'));
    expect(migrated.generator.kind).toBe('manual');
  });

  it('leaves everything else exactly as it was', () => {
    const claude = stored('claude');
    expect(migrateReview(claude)).toBe(claude);
    const manual = stored('manual');
    expect(migrateReview(manual)).toBe(manual);
  });
});

describe('chapter stats', () => {
  it('counts words as runs of non-whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
    expect(countWords('one two  three')).toBe(3);
    expect(countWords('*emphasis* counts once')).toBe(3);
  });

  it('counts body paragraphs only, never the frontmatter', () => {
    const text = '---\ntitle: One\ntags: [a]\n---\n\nFirst paragraph here.\n\nSecond one.';
    expect(chapterStats(text)).toMatchObject({ paragraphs: 2, words: 5 });
  });

  it('is zero for an empty chapter', () => {
    expect(chapterStats('')).toMatchObject({ paragraphs: 0, words: 0 });
  });
});

describe('comments in two groups', () => {
  const comments = [
    {
      id: 'a',
      paragraph: 0,
      category: 'flow' as const,
      text: 'Long sentence here.',
      status: 'open' as const
    },
    {
      id: 'b',
      paragraph: 2,
      category: 'plot' as const,
      text: 'Did she already know this?',
      status: 'resolved' as const
    },
    { id: 'c', paragraph: null, category: 'pov' as const, text: 'Whole chapter.', status: 'open' as const }
  ];

  it('splits open from resolved without losing any', () => {
    const groups = groupComments(comments);
    expect(groups.open.map((c) => c.id)).toEqual(['a', 'c']);
    expect(groups.resolved.map((c) => c.id)).toEqual(['b']);
  });

  it('keeps a resolved comment in the margin, so resolving does not look like losing', () => {
    expect(gutterComments(comments).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('digests a comment down to one line', () => {
    expect(commentDigest({ text: 'Short one.' })).toBe('Short one.');
    const long = commentDigest({
      text: 'She would not have known about the bridge yet, since the letter arrives later.'
    });
    expect(long.length).toBeLessThanOrEqual(43);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('She would not')).toBe(true);
  });

  it('flattens newlines out of the digest', () => {
    expect(commentDigest({ text: 'One\n\ntwo   three' })).toBe('One two three');
  });

  it('reserves a small height for a collapsed card', () => {
    expect(COLLAPSED_CARD_HEIGHT).toBeGreaterThan(0);
    expect(COLLAPSED_CARD_HEIGHT).toBeLessThan(40);
  });
});

describe('provider setting', () => {
  it('offers Claude today and is ready for a second name', () => {
    expect(PROVIDERS).toContain('claude');
    for (const provider of PROVIDERS) {
      expect(PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });
});
