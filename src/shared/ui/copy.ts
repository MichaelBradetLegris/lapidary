/**
 * What a copy from the manuscript pane puts on the clipboard.
 *
 * The browser's own copy took the page as it is built, not as it reads: every
 * suggestion's ghost row is a box of its own, so a blank line appeared in front
 * of each one, and the hidden word "insertion" came along with every insertion.
 * The pane now hands over the chapter's text and nothing else. The renderer
 * collects the runs of chapter text the selection covers; this joins them.
 */

/** One run of chapter text the selection covers, and the paragraph block it sits in. */
export interface ProsePiece {
  /** Blocks are numbered in page order; only equality matters. */
  block: number;
  text: string;
}

/**
 * The runs in order, with a blank line wherever the block changes, which is how
 * the chapter itself separates paragraphs. Empty runs are dropped first, so a
 * selection that merely touches the edge of a block adds no blank line for it.
 */
export function joinProsePieces(pieces: readonly ProsePiece[]): string {
  let out = '';
  let last: number | null = null;
  for (const piece of pieces) {
    if (piece.text.length === 0) continue;
    if (last !== null && piece.block !== last) out += '\n\n';
    out += piece.text;
    last = piece.block;
  }
  return out;
}
