import { useEffect, useRef, type RefObject } from 'react';
import { indexesOf } from '../../shared/ui/find';
import { proseTextNodes } from './prose';
import { scrollRectIntoView } from './scroll';
import { useApp } from './store';

/**
 * Ctrl+F over the manuscript pane (item 11).
 *
 * Matches are painted with the CSS Custom Highlight API, which draws over
 * existing text nodes instead of wrapping them in <mark> elements. That matters
 * here: the hunk spans and their absolutely positioned ghosts must survive a
 * search untouched, and no hunk offset may move because the author typed in a
 * search box. Ghost text is skipped, so the count only ever refers to prose the
 * chapter actually contains.
 */

type HighlightCtor = new (...ranges: Range[]) => object;

interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

function highlightCtor(): HighlightCtor | null {
  return (globalThis as { Highlight?: HighlightCtor }).Highlight ?? null;
}

function collectRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  for (const node of proseTextNodes(root)) {
    for (const at of indexesOf(node.data, query)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + query.length);
      ranges.push(range);
    }
  }
  return ranges;
}

function clear(): void {
  const reg = registry();
  reg?.delete('find');
  reg?.delete('find-active');
}

/**
 * Paint the matches, and scroll to the active one when the author asked to go
 * there. The two are separate on purpose (round 4, item 1): the page is redrawn
 * every time a suggestion is accepted, and the matches must be found again then,
 * but scrolling on every redraw sent the pane back to the match after each
 * click, for as long as the bar stayed open.
 */
export function useFindHighlight(proseRef: RefObject<HTMLElement | null>, revision: unknown): void {
  const open = useApp((s) => s.find.open);
  const query = useApp((s) => s.find.query);
  const index = useApp((s) => s.find.index);
  const seek = useApp((s) => s.find.seek);
  const setFindMatches = useApp((s) => s.setFindMatches);
  const ranges = useRef<Range[]>([]);
  const servedSeek = useRef(seek);

  useEffect(() => {
    const root = proseRef.current;
    if (!root || !open || query.length === 0) {
      ranges.current = [];
      clear();
      setFindMatches(0);
      return;
    }
    ranges.current = collectRanges(root, query);
    setFindMatches(ranges.current.length);
    return clear;
  }, [open, query, revision, proseRef, setFindMatches]);

  useEffect(() => {
    const found = ranges.current;
    const reg = registry();
    const Ctor = highlightCtor();
    if (found.length === 0) {
      clear();
      // A request with nothing to go to is still answered, so a later redraw
      // that happens to create a match does not scroll on its own.
      servedSeek.current = seek;
      return;
    }
    const active = index >= 0 ? found[index] : undefined;
    if (reg && Ctor) {
      reg.set('find', new Ctor(...found));
      if (active) reg.set('find-active', new Ctor(active));
      else reg.delete('find-active');
    }
    if (!active || seek === servedSeek.current) return;
    servedSeek.current = seek;

    // Centre the match in the scroller without touching the document.
    const container = proseRef.current?.closest('.center');
    if (!(container instanceof HTMLElement)) return;
    scrollRectIntoView(container, active.getBoundingClientRect(), 'center');
  }, [index, seek, query, open, revision, proseRef]);
}
