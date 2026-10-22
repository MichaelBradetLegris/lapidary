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

export interface Placement {
  left: number;
  top: number;
  placement: 'below' | 'above';
}

/**
 * Place `tip` against `anchor` inside `viewport`. Below the anchor when it fits,
 * otherwise above it, and always clamped so the whole card stays on screen. The
 * caller positions the tooltip with `position: fixed`, so nothing scrolls.
 * `align` puts the card's middle under the anchor's, or, with `start`, its
 * left edge under the anchor's, as Settings' (?) does (`HelpTip`, polish.4),
 * so that its card runs over the row it explains rather than out of the dialog.
 */
export function placeTooltip(
  anchor: Box,
  tip: Size,
  viewport: Size,
  gap = 10,
  margin = 8,
  align: 'middle' | 'start' = 'middle'
): Placement {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - tip.height - gap;
  const fitsBelow = below + tip.height + margin <= viewport.height;
  const fitsAbove = above >= margin;
  // The ghost sits above the words, so below wins whenever it fits at all.
  const placement: 'below' | 'above' = fitsBelow || !fitsAbove ? 'below' : 'above';

  const rawTop = placement === 'below' ? below : above;
  const maxTop = Math.max(margin, viewport.height - tip.height - margin);
  const top = Math.min(Math.max(margin, rawTop), maxTop);

  const wanted = align === 'start' ? anchor.left : anchor.left + anchor.width / 2 - tip.width / 2;
  const maxLeft = Math.max(margin, viewport.width - tip.width - margin);
  const left = Math.min(Math.max(margin, wanted), maxLeft);

  return { left, top, placement };
}
