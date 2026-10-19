import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hoverCancel, hoverOn, markHover } from '../../src/renderer/state/hover';
import { useApp } from '../../src/renderer/state/store';
import { TOOLTIP_DELAY_MS } from '../../src/shared/ui/tooltip';

/* The small review (PLAN 11.7, small.8): a margin mark's card stayed open over
   the prose once the mark had gone from under a resting pointer, as React
   fires no leave for an element that has gone. `markHover` is what a mark
   hands React; its `gone`, called as the mark unmounts, closes the card the
   mark opened, or was about to open, as a leave would. The tests run without
   a DOM, on vitest's timers. */

/** Past the grace period a leave gives the pointer to reach the card. */
const PAST_GRACE_MS = 200;

const hovered = (): string | null => useApp.getState().hoveredHunkId;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  hoverCancel();
  vi.useRealTimers();
});

describe('a margin mark and its card (small review)', () => {
  it('opens the card after the usual delay and closes it when the pointer leaves', () => {
    const mark = markHover('comma');
    mark.enter();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(hovered()).toBe(null);
    vi.advanceTimersByTime(1);
    expect(hovered()).toBe('comma');
    mark.leave();
    vi.advanceTimersByTime(PAST_GRACE_MS);
    expect(hovered()).toBe(null);
  });

  it('closes the card when the mark goes from under the pointer, which fires no leave', () => {
    const mark = markHover('comma');
    mark.enter();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(hovered()).toBe('comma');
    mark.gone();
    vi.advanceTimersByTime(PAST_GRACE_MS);
    expect(hovered()).toBe(null);
  });

  it('never opens a card for a mark that went before the delay was up', () => {
    const mark = markHover('comma');
    mark.enter();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS / 2);
    mark.gone();
    vi.advanceTimersByTime(1000);
    expect(hovered()).toBe(null);
  });

  it('leaves alone a card something else opened after the pointer left the mark', () => {
    const mark = markHover('comma');
    mark.enter();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    mark.leave();
    hoverOn('word');
    mark.gone();
    vi.advanceTimersByTime(1000);
    expect(hovered()).toBe('word');
  });

  it('does nothing when a mark the pointer never reached goes', () => {
    hoverOn('word');
    markHover('comma').gone();
    vi.advanceTimersByTime(1000);
    expect(hovered()).toBe('word');
  });

  /* A source check, as the tests have no DOM: the pane's mark hands React the
     leave whatever its kind, so the arrowhead a hovered bar became still
     closes the card, and calls `gone` as it unmounts.
     test/renderer/marks.render.test.ts checks that the two kinds are the same
     element. */
  it("is what the pane's margin mark hands React, the arrowhead's leave included", () => {
    const src = readFileSync(path.join(__dirname, '../../src/renderer/components/ReviewPane.tsx'), 'utf8');
    const button = /function MarkButton\([\s\S]*?\n\}\n/.exec(src)?.[0] ?? '';
    expect(button).toContain('const hover = useMemo(() => markHover(id), [id]);');
    expect(button).toContain('useEffect(() => hover.gone, [hover]);');
    expect(button).toContain('onMouseLeave={hover.leave}');
    expect(src).toMatch(/<MarkButton\s+key=\{`mark-\$\{mark\.hunk\.id\}`\}/);
  });
});
