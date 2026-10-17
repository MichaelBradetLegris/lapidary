import { joinProsePieces, type ProsePiece } from '../../shared/ui/copy';

/**
 * Everything inside the manuscript pane that is not the chapter's own text:
 * ghosts and their labels, the dismiss x, the paragraph rail, open paragraph
 * editors, and the margin. Find and copy both skip it, so a search and the
 * clipboard only ever see words the chapter contains.
 */
export const NOT_PROSE = '.hunk__ghost, .hunk__x, .para__rail, .para-editor, .gutter';

/** The chapter's non-empty text nodes under `root`, in page order. */
export function proseTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement;
      if (!parent || parent.closest(NOT_PROSE)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) nodes.push(node);
  }
  return nodes;
}

/**
 * The chapter text `range` covers, as the page currently reads it, with a blank
 * line between paragraphs. Null when it covers none, so the browser's own copy
 * can run.
 */
export function proseInRange(root: HTMLElement, range: Range): string | null {
  const blocks = new Map<Element, number>();
  const pieces: ProsePiece[] = [];
  for (const node of proseTextNodes(root)) {
    if (!range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.data.length;
    const block = node.parentElement?.closest('.para, .frontmatter') ?? root;
    let index = blocks.get(block);
    if (index === undefined) {
      index = blocks.size;
      blocks.set(block, index);
    }
    pieces.push({ block: index, text: node.data.slice(from, to) });
  }
  const text = joinProsePieces(pieces);
  return text.length > 0 ? text : null;
}
