/**
 * Where the custom hunk tooltip goes (plan 7, item 13). The ghost text floats
 * above the live text, so the tooltip prefers to sit below the hunk and only
 * flips above when there is no room. Pure geometry: no DOM types here.
 */

/** Hover has to feel instant, so this is well under the native tooltip's delay. */
export const TOOLTIP_DELAY_MS = 100;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A stretch of the window from a top edge to a bottom edge, in CSS pixels. */
export interface Span {
  top: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  placement: 'below' | 'above' | 'left';
}

/**
 * A card that would rather stand beside its anchor, to its left (polish.19):
 * Settings' (?) stand in one column at the right edge of the box (polish.15),
 * and a card under one lay over the (?) of the next row. `gap` is from the
 * card's right edge to the anchor's left edge. `band` is the stretch of the
 * window the card keeps inside where it is tall enough to, Settings' box
 * between its head and its foot.
 */
export interface Beside {
  side: 'left';
  gap: number;
  band?: Span | null;
}

/**
 * Place `tip` against `anchor` inside `viewport`. Below the anchor when it fits,
 * otherwise above it, and always clamped so the whole card stays on screen. The
 * caller positions the tooltip with `position: fixed`, so nothing scrolls.
 * `align` puts the card's middle under the anchor's; with `start`, its left
 * edge under the anchor's (polish.4); with `end`, its right edge under the
 * anchor's, as Settings' (?) did from the right end of its row (polish.15),
 * so that its card runs back over the row it explains rather than out of the
 * dialog. The clamp to the viewport wins over any of them.
 *
 * With `beside` (polish.19), the card stands to the left of the anchor
 * instead, its right edge `beside.gap` from the anchor's left edge and its
 * top at the anchor's top, moved up or down only as far as it takes to keep
 * it inside `beside.band` and the window; a card taller than the band starts
 * at the band's top. Only where the window is too narrow for the card beside
 * the anchor does it go below or above as without `beside`, with `gap` and
 * `align`.
 */
export function placeTooltip(
  anchor: Box,
  tip: Size,
  viewport: Size,
  gap = 10,
  margin = 8,
  align: 'middle' | 'start' | 'end' = 'middle',
  beside?: Beside
): Placement {
  const maxTop = Math.max(margin, viewport.height - tip.height - margin);

  if (beside) {
    const left = anchor.left - beside.gap - tip.width;
    if (left >= margin) {
      const lo = Math.max(margin, beside.band?.top ?? margin);
      const hi = Math.min(viewport.height - margin, beside.band?.bottom ?? viewport.height - margin);
      const inBand = Math.max(lo, Math.min(anchor.top, hi - tip.height));
      return { left, top: Math.min(inBand, maxTop), placement: 'left' };
    }
  }

  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - tip.height - gap;
  const fitsBelow = below + tip.height + margin <= viewport.height;
  const fitsAbove = above >= margin;
  // The ghost sits above the words, so below wins whenever it fits at all.
  const placement: 'below' | 'above' = fitsBelow || !fitsAbove ? 'below' : 'above';

  const rawTop = placement === 'below' ? below : above;
  const top = Math.min(Math.max(margin, rawTop), maxTop);

  const wanted =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - tip.width
        : anchor.left + anchor.width / 2 - tip.width / 2;
  const maxLeft = Math.max(margin, viewport.width - tip.width - margin);
  const left = Math.min(Math.max(margin, wanted), maxLeft);

  return { left, top, placement };
}

/**
 * Whether `anchor` lies wholly inside `band`, to half a pixel either way.
 * Settings' (?) shows its card only while it does, the band being the part of
 * the box between its head and its foot, which stay in view as it scrolls
 * (`HelpTip`, polish.4 review): a (?) that the box has scrolled under the head
 * or the foot, or out of sight, has its card hidden, so that no card stands
 * over the title with nothing to show which row it belongs to.
 */
export function insideBand(anchor: Span, band: Span): boolean {
  return anchor.top >= band.top - 0.5 && anchor.bottom <= band.bottom + 0.5;
}
