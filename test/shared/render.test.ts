import { describe, expect, it } from 'vitest';
import { diffToHunks } from '../../src/shared/diff/wordDiff';
import { buildRenderBlocks, ghostRole, hunkFaces, type RenderBlock } from '../../src/shared/render';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk } from '../../src/shared/types';

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
