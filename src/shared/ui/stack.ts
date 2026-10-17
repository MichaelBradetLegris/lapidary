/**
 * Margin-note stacking (plan 7, item 7). Each comment card wants to sit level
 * with the top of its paragraph; when two cards would overlap, the later one is
 * pushed down, the way a word processor stacks margin comments.
 */

export interface CardBox {
  id: string;
  /** where the card would like to sit, relative to the top of the prose */
  desiredTop: number;
  height: number;
}

export interface PlacedCard {
  id: string;
  top: number;
  /** how far the card had to move to avoid its neighbour */
  offset: number;
}

/**
 * Place cards top to bottom. Input order does not matter: cards are sorted by
 * desired position first, so the result is a pure function of the boxes.
 */
export function stackCards(cards: readonly CardBox[], gap = 8): PlacedCard[] {
  const sorted = cards.slice().sort((a, b) => a.desiredTop - b.desiredTop || a.id.localeCompare(b.id));

  const placed: PlacedCard[] = [];
  let cursor = Number.NEGATIVE_INFINITY;
  for (const card of sorted) {
    const top = Math.max(card.desiredTop, cursor);
    placed.push({ id: card.id, top, offset: top - card.desiredTop });
    cursor = top + card.height + gap;
  }
  return placed;
}
