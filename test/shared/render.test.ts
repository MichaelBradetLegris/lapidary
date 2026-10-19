import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { diffToHunks } from '../../src/shared/diff/wordDiff';
import {
  buildRenderBlocks,
  ghostContent,
  ghostRole,
  hunkFaces,
  type GhostContent,
  type GhostKey,
  type RenderBlock
} from '../../src/shared/render';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkStatus } from '../../src/shared/types';
import { whitespaceName } from '../../src/shared/ui/small';

const TEXT = '---\ntitle: A\n---\n\nThe river had began.\n\nShe nodded her head.';

function blocksFor(text: string, hunks: Hunk[]): RenderBlock[] {
  return buildRenderBlocks(text, splitParagraphs(text), hunks);
}

function flatten(block: RenderBlock): string {
  return block.segments.map((s) => s.text).join('');
}

describe('buildRenderBlocks', () => {
  it('gives frontmatter a block of its own', () => {
    const blocks = blocksFor(TEXT, []);
    expect(blocks[0]).toMatchObject({ isFrontmatter: true, paragraphs: [-1] });
    expect(flatten(blocks[0]!)).toBe('---\ntitle: A\n---');
  });

  it('gives each paragraph a block whose segments rebuild it exactly', () => {
    const blocks = blocksFor(TEXT, []);
    expect(blocks).toHaveLength(3);
    expect(flatten(blocks[1]!)).toBe('The river had began.');
    expect(flatten(blocks[2]!)).toBe('She nodded her head.');
  });

  it('splits a paragraph around its hunk', () => {
    const hunks = diffToHunks(TEXT, TEXT.replace('had began', 'had begun'));
    const blocks = blocksFor(TEXT, hunks);
    const body = blocks[1]!;
    expect(body.segments.map((s) => s.kind)).toEqual(['text', 'hunk', 'text']);
    expect(body.segments[1]).toMatchObject({ kind: 'hunk', text: 'began' });
    expect(flatten(body)).toBe('The river had began.');
  });

  it('merges paragraphs when a hunk straddles the blank line between them', () => {
    const original = 'Keep this.\n\nDrop this.\n\nKeep this too.';
    const hunks = diffToHunks(original, 'Keep this.\n\nKeep this too.');
    const blocks = blocksFor(original, hunks);
    const merged = blocks.find((b) => b.paragraphs.length > 1);
    expect(merged).toBeDefined();
    expect(merged!.paragraphs).toEqual([1, 2]);
    expect(flatten(merged!)).toBe('Drop this.\n\nKeep this too.');
  });

  it('never renders a stale hunk inline', () => {
    const stale: Hunk = {
      id: 's',
      start: 0,
      end: 0,
      baseSide: 'original',
      original: 'x',
      replacement: 'y',
      paragraph: 0,
      source: 'claude',
      status: 'pending',
      anchor: 'stale'
    };
    const blocks = blocksFor(TEXT, [stale]);
    expect(blocks.every((b) => b.segments.every((s) => s.kind === 'text'))).toBe(true);
  });

  it('keeps every character of every paragraph', () => {
    const hunks = diffToHunks(TEXT, TEXT.replace('nodded her head', 'nodded'));
    for (const block of blocksFor(TEXT, hunks)) {
      expect(flatten(block)).toBe(TEXT.slice(block.start, block.end));
    }
  });

  it('renders a zero-length insertion as its own segment', () => {
    const original = 'walked to store';
    const hunks = diffToHunks(original, 'walked to the store');
    const blocks = blocksFor(original, hunks);
    const hunkSegment = blocks[0]!.segments.find((s) => s.kind === 'hunk');
    expect(hunkSegment).toMatchObject({ kind: 'hunk', text: '' });
    expect(flatten(blocks[0]!)).toBe(original);
  });
});

describe('hunkFaces', () => {
  const hunk: Hunk = {
    id: 'h',
    start: 0,
    end: 5,
    baseSide: 'original',
    original: 'began',
    replacement: 'begun',
    paragraph: 0,
    source: 'claude',
    status: 'pending',
    anchor: 'exact'
  };

  it('shows the original in the line while pending or dismissed', () => {
    expect(hunkFaces(hunk)).toEqual({ live: 'began', ghost: 'begun', role: 'suggestion' });
    expect(hunkFaces({ ...hunk, status: 'dismissed' })).toEqual({
      live: 'began',
      ghost: 'begun',
      role: 'suggestion'
    });
  });

  it('swaps the two once accepted', () => {
    expect(hunkFaces({ ...hunk, status: 'accepted' })).toEqual({
      live: 'begun',
      ghost: 'began',
      role: 'original'
    });
  });

  it('names the ghost by role, so the marker in front of it is never wrong', () => {
    // The renderer prints "was" before an original and an arrow before a
    // suggestion, whichever way round the two texts currently sit (item 6).
    expect(ghostRole(hunk)).toBe('suggestion');
    expect(ghostRole({ ...hunk, status: 'dismissed' })).toBe('suggestion');
    expect(ghostRole({ ...hunk, status: 'accepted' })).toBe('original');
  });
});

/* small.4 (PLAN 11.7): what the ghost row shows, for the table's shapes in
   each status, and the flags that keep a capsule off a touching suggestion. */

function shaped(original: string, replacement: string, status: HunkStatus): Hunk {
  return {
    id: 'g',
    start: 4,
    end: 4 + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    source: 'claude',
    status,
    anchor: 'exact'
  };
}

type Row = [label: GhostContent['label'], tag: GhostContent['tag'], key: GhostKey | null, text: string];
const key = (text: string, name = false): GhostKey => ({ text, name });

const MATRIX: { name: string; original: string; replacement: string; rows: Record<HunkStatus, Row> }[] = [
  {
    name: 'comma inserted (case 2)',
    original: '',
    replacement: ',',
    rows: {
      pending: ['arrow', null, key(','), ''],
      accepted: ['added', null, key(','), ''],
      dismissed: ['arrow', null, key(','), '']
    }
  },
  {
    name: 'comma deleted',
    original: ',',
    replacement: '',
    rows: {
      pending: ['arrow', 'delete', null, ''],
      accepted: ['was', null, key(','), ''],
      dismissed: ['arrow', 'delete', null, '']
    }
  },
  {
    name: 'doubled space deleted',
    original: ' ',
    replacement: '',
    rows: {
      pending: ['arrow', 'delete', key('space', true), ''],
      accepted: ['was', null, key('space', true), ''],
      dismissed: ['arrow', 'delete', key('space', true), '']
    }
  },
  {
    name: 'full stop to comma',
    original: '.',
    replacement: ',',
    rows: {
      pending: ['arrow', null, key(','), ''],
      accepted: ['was', null, key('.'), ''],
      dismissed: ['arrow', null, key(','), '']
    }
  },
  {
    name: 'hyphen to space (case 1)',
    original: '-',
    replacement: ' ',
    rows: {
      pending: ['arrow', null, key('space', true), ''],
      accepted: ['was', null, key('-'), ''],
      dismissed: ['arrow', null, key('space', true), '']
    }
  },
  {
    name: 'one-letter word',
    original: 'i',
    replacement: 'I',
    rows: {
      pending: ['arrow', null, key('I'), ''],
      accepted: ['was', null, key('i'), ''],
      dismissed: ['arrow', null, key('I'), '']
    }
  },
  {
    name: 'paragraphs joined',
    original: '\n\n',
    replacement: ' ',
    rows: {
      pending: ['arrow', null, key('space', true), ''],
      accepted: ['was', null, key('paragraph break', true), ''],
      dismissed: ['arrow', null, key('space', true), '']
    }
  },
  {
    name: 'a word',
    original: 'began',
    replacement: 'begun',
    rows: {
      pending: ['arrow', null, null, 'begun'],
      accepted: ['was', null, null, 'began'],
      dismissed: ['arrow', null, null, 'begun']
    }
  },
  {
    name: 'words inserted',
    original: '',
    replacement: 'most of ',
    rows: {
      pending: ['arrow', null, null, 'most of '],
      accepted: ['added', null, null, ''],
      dismissed: ['arrow', null, null, 'most of ']
    }
  },
  {
    name: 'a word deleted',
    original: 'the ',
    replacement: '',
    rows: {
      pending: ['arrow', 'delete', null, ''],
      accepted: ['was', null, null, 'the '],
      dismissed: ['arrow', 'delete', null, '']
    }
  }
];

describe('ghostContent', () => {
  for (const shape of MATRIX) {
    for (const status of ['pending', 'accepted', 'dismissed'] as const) {
      it(`${shape.name}, ${status}`, () => {
        const content = ghostContent(shaped(shape.original, shape.replacement, status));
        const [label, tag, k, text] = shape.rows[status];
        expect(content).toEqual({
          role: status === 'accepted' ? 'original' : 'suggestion',
          label,
          tag,
          key: k,
          text
        });
      });
    }
  }

  it('boxes the ghost side or its name, never the live face, except what an accepted insertion added', () => {
    const side = fc.oneof(
      fc.constantFrom('', ',', '.', ' ', '  ', '-', '\u2014', 'i', 'I', '\n\n', '\u00a0', '...'),
      fc.string({ minLength: 0, maxLength: 6 })
    );
    fc.assert(
      fc.property(
        side,
        side,
        fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'),
        (o, r, status) => {
          fc.pre(o !== r);
          const h = shaped(o, r, status);
          const { live, ghost } = hunkFaces(h);
          const content = ghostContent(h);
          if (!content.key) return;
          const addedInsertion = status === 'accepted' && o.length === 0;
          const deletionOnOffer = status !== 'accepted' && r.length === 0;
          if (content.key.name) {
            // A name, such as "space": of the ghost side, or of what an accepted
            // insertion added or a deletion on offer takes out.
            expect(content.key.text).toBe(whitespaceName(addedInsertion || deletionOnOffer ? live : ghost));
          } else {
            expect(content.key.text).toBe(addedInsertion ? live : ghost);
            if (!addedInsertion) expect(content.key.text).not.toBe(live);
          }
          expect(content.text).toBe('');
        }
      )
    );
  });
});

describe('flush flags (small.4)', () => {
  it('marks a side touching another suggestion', () => {
    const text = 'Mara counted slowly she counted.';
    const start = text.indexOf('slowly');
    const word = { ...shaped('slowly', 'carefully', 'pending'), id: 'w', start, end: start + 6 };
    const comma = { ...shaped('', ',', 'pending'), id: 'c', start: start + 6, end: start + 6 };
    const segments = blocksFor(text, [word, comma])[0]!.segments;
    expect(
      segments.map((s) => (s.kind === 'hunk' ? [s.hunk.id, s.flushBefore, s.flushAfter] : s.text))
    ).toEqual(['Mara counted ', ['w', false, true], ['c', true, false], ' she counted.']);
  });

  it('marks a side with text under two characters before the next suggestion, and nothing at the ends of a block', () => {
    const text = 'Yes she said no.';
    const a = { ...shaped('', ',', 'pending'), id: 'a', start: 3, end: 3 };
    const b = { ...shaped('she', 'he', 'pending'), id: 'b', start: 4, end: 7 };
    const segments = blocksFor(text, [a, b])[0]!.segments;
    expect(
      segments.map((s) => (s.kind === 'hunk' ? [s.hunk.id, s.flushBefore, s.flushAfter] : s.text))
    ).toEqual(['Yes', ['a', false, true], ' ', ['b', true, false], ' said no.']);
    const first = { ...shaped('Yes', 'Yes,', 'pending'), id: 'f', start: 0, end: 3 };
    const last = { ...shaped('.', '!', 'pending'), id: 'l', start: text.length - 1, end: text.length };
    const ends = blocksFor(text, [first, last])[0]!.segments.filter((s) => s.kind === 'hunk');
    expect(ends.map((s) => [s.flushBefore, s.flushAfter])).toEqual([
      [false, false],
      [false, false]
    ]);
  });

  it('keeps the segments joining up to the block, whatever the flags (property)', () => {
    const text = 'ab, cd ef. gh-ij kl  mn o p.';
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: text.length }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        (points, wide) => {
          const hunks: Hunk[] = [];
          let floor = 0;
          [...points]
            .sort((x, y) => x - y)
            .forEach((at, i) => {
              if (at < floor) return;
              const end = wide[i] && at < text.length ? at + 1 : at;
              hunks.push({ ...shaped(text.slice(at, end), ',', 'pending'), id: `h${i}`, start: at, end });
              floor = end;
            });
          const block = blocksFor(text, hunks)[0]!;
          expect(flatten(block)).toBe(text.slice(block.start, block.end));
          block.segments.forEach((s, i) => {
            if (s.kind !== 'hunk') return;
            const prev = block.segments[i - 1];
            const next = block.segments[i + 1];
            expect(s.flushBefore).toBe(!!prev && (prev.kind === 'hunk' || [...prev.text].length < 2));
            expect(s.flushAfter).toBe(!!next && (next.kind === 'hunk' || [...next.text].length < 2));
          });
        }
      )
    );
  });
});
