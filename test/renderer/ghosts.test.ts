import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* ui.2 (found by the M5 review): a long inserted sentence's ghost ran past the
   right edge of the prose and gave the manuscript pane a horizontal scrollbar.
   `clipGhosts` now stops every ghost at that edge, using the pure
   `ghostMaxWidths` tested in test/shared/ghosts.test.ts. These are source
   checks: the tests run without a DOM. The window check is in PLAN (ui.2). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const GHOSTS = read('renderer/state/ghosts.ts');
const PANE = read('renderer/components/ReviewPane.tsx');
const CSS = withoutComments(readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8'));

/** Every declaration made for exactly this selector, across app.css. */
function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('clipGhosts stops every ghost at the edge of the prose (ui.2)', () => {
  it('takes its widths from ghostMaxWidths, measured against the right edge of the prose text', () => {
    expect(GHOSTS).toContain("import { ghostMaxWidths } from '../../shared/ui/ghosts';");
    // One definition of the gap and the minimum: the shared module's.
    expect(GHOSTS).not.toMatch(/const (GAP|MIN_WIDTH|LINE_TOLERANCE)\b/);
    expect(GHOSTS).toMatch(
      /const edge =\s*prose\.getBoundingClientRect\(\)\.right -\s*\(parseFloat\(style\.paddingRight\) \|\| 0\) -\s*\(parseFloat\(style\.borderRightWidth\) \|\| 0\);/
    );
    expect(GHOSTS).toMatch(/const widths = ghostMaxWidths\(\s*measured\.map\([\s\S]*?\),\s*edge\s*\);/);
    expect(GHOSTS).toContain('ghost.style.maxWidth = `${width}px`;');
  });

  it('measures a lone ghost too, which has no neighbour but can still run past the edge', () => {
    // It used to return when there were fewer than two rows.
    expect(GHOSTS).toContain('if (rows.length === 0) return;');
    expect(GHOSTS).not.toMatch(/rows\.length < 2/);
  });

  it('resets every ghost before measuring, then reads every row before changing any', () => {
    const reset = GHOSTS.indexOf("ghost.style.maxWidth = '';");
    const measure = GHOSTS.indexOf('row.getBoundingClientRect()');
    const apply = GHOSTS.indexOf('ghost.style.maxWidth = `${width}px`;');
    expect(reset).toBeGreaterThan(-1);
    expect(measure).toBeGreaterThan(reset);
    expect(GHOSTS.indexOf('ghostMaxWidths(')).toBeGreaterThan(measure);
    expect(apply).toBeGreaterThan(GHOSTS.indexOf('ghostMaxWidths('));
  });

  it('runs after every layout change of the prose or the scroller, and as the margin column comes or goes', () => {
    expect(PANE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*clipGhosts\(proseRef\.current\);\s*\}, \[blocks, layout\.version, layout\.width, showGutter\]\);/
    );
    // After the observer's effect, so a resize it reports is measured first.
    expect(PANE.indexOf('clipGhosts(proseRef.current)')).toBeGreaterThan(
      PANE.indexOf('new ResizeObserver(measure)')
    );
  });
});

describe('Nothing in the prose scrolls sideways (ui.2)', () => {
  it('keeps the ghost on one line, clipped with an ellipsis', () => {
    const ghost = declsFor('.hunk__ghost');
    expect(ghost.get('white-space')).toBe('pre');
    expect(ghost.get('overflow')).toBe('hidden');
    expect(ghost.get('text-overflow')).toBe('ellipsis');
  });

  it('wraps a word too long for its line', () => {
    expect(declsFor('.prose').get('overflow-wrap')).toBe('break-word');
  });

  it('clips anything else at the pane, which does not become a scroller of its own', () => {
    const pane = declsFor('.pane');
    expect(pane.get('overflow-x')).toBe('clip');
    expect(pane.has('overflow')).toBe(false);
    expect(pane.has('overflow-y')).toBe(false);
    // Room for the active paragraph's 6 px glow and a ghost's x at the very edge.
    expect(pane.get('padding')).toBe('28px 40px 120px');
  });

  it('lets the pane shrink beside the position strip instead of pushing it out', () => {
    expect(declsFor('.pane').get('min-width')).toBe('0');
    expect(declsFor('.pane').get('flex')).toBe('0 1 auto');
    expect(declsFor('.minimap').get('flex')).toBe('0 0 14px');
  });
});
