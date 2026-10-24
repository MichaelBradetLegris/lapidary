import { createElement, useMemo, type ReactNode } from 'react';
import { composeReview } from '../../shared/diff/compose';
import { chapterName } from '../../shared/review';
import { toRoyalRoadHtml } from '../../shared/text/royalroad';
import type { Review } from '../../shared/types';
import { PREVIEW_EMPTY, previewImageText, previewLabel } from '../../shared/ui/modes';
import { previewTree, type PreviewNode } from '../../shared/ui/preview';

interface Props {
  review: Review;
}

/**
 * One node of the preview page, drawn with the page's own elements. A link
 * keeps its look and its address as a tooltip, with no `href`, so nothing in
 * the preview navigates; a web image shows its words in a frame rather than
 * fetching the picture, as the page's policy allows no image from the web.
 */
function draw(node: PreviewNode, key: number): ReactNode {
  if (typeof node === 'string') return node;
  const children = node.children.map(draw);
  switch (node.tag) {
    case 'br':
      return <br key={key} />;
    case 'hr':
      return <hr key={key} />;
    case 'img':
      return (
        <span key={key} className="preview__image" title={node.href}>
          {previewImageText(node.alt ?? '')}
        </span>
      );
    case 'a':
      return (
        <a key={key} className="preview__link" title={node.href}>
          {children}
        </a>
      );
    case 'ol':
      return (
        <ol key={key} start={node.start}>
          {children}
        </ol>
      );
    default:
      return createElement(node.tag, { key, className: node.className }, ...children);
  }
}

/**
 * Preview (rr.2): the chapter as it reads now, every decision applied and no
 * suggestion marks, drawn from the HTML Export HTML gives (`toRoyalRoadHtml`,
 * rr.1) in a style near Royal Road's reader page, its paragraph spacing and a
 * serif of the app's own, in both themes, so the author sees the tight blocks,
 * the rules and the headings as readers will. Read-only, and nothing of Royal
 * Road's is fetched. The HTML is read back into the page's own elements
 * (`previewTree`), so nothing of the chapter's can reach the page as markup.
 */
export function PreviewPane({ review }: Props): React.JSX.Element {
  const nodes = useMemo(() => previewTree(toRoyalRoadHtml(composeReview(review))), [review]);
  return (
    <div className="preview">
      <article className="preview__page" aria-label={previewLabel(chapterName(review.sourcePath))}>
        {nodes.length > 0 ? nodes.map(draw) : <p className="preview__empty">{PREVIEW_EMPTY}</p>}
      </article>
    </div>
  );
}
