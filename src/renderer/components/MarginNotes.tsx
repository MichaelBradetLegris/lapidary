import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { COLLAPSED_CARD_HEIGHT, commentDigest } from '../../shared/ui/comments';
import { stackCards, type CardBox } from '../../shared/ui/stack';
import type { ReviewComment } from '../../shared/types';
import { editFromComment } from '../state/edit';
import { useApp } from '../state/store';
import { IconCheck, IconPencil, IconUndo } from './icons';

interface Props {
  comments: ReviewComment[];
  proseRef: RefObject<HTMLDivElement | null>;
  onSetStatus: (id: string, status: ReviewComment['status']) => void;
  /** bumped whenever the prose relayouts, so the cards remeasure */
  layoutKey: number;
}

type Tops = Record<string, number>;

function sameTops(a: Tops, b: Tops): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.5);
}

/**
 * Comments as margin notes (plan 5a, item 7). Each card lines up with the top of
 * its paragraph and is pushed down when it would cover the card above it, the
 * way a word processor stacks margin comments. The sidebar list stays, and both
 * views share `activeCommentId`, so clicking either one highlights the same
 * paragraph.
 *
 * Resolving no longer removes a card (item 4). A resolved comment stays in place
 * as one greyed line, expands when clicked, and can be unresolved from there. It
 * is measured at a smaller height so it does not push the open comments around.
 */
export function MarginNotes({ comments, proseRef, onSetStatus, layoutKey }: Props): React.JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Tops>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeId = useApp((s) => s.activeCommentId);
  const setActive = useApp((s) => s.setActiveComment);

  const isOpen = (comment: ReviewComment): boolean =>
    comment.status === 'open' || expanded[comment.id] === true;

  useLayoutEffect(() => {
    const prose = proseRef.current;
    const gutter = gutterRef.current;
    if (!prose || !gutter) return;
    const proseTop = prose.getBoundingClientRect().top;

    const boxes: CardBox[] = comments.map((comment, order) => {
      const para = document.getElementById(`para-${comment.paragraph ?? 0}`);
      const card = gutter.querySelector<HTMLElement>(`[data-comment-id="${comment.id}"]`);
      const showing = comment.status === 'open' || expanded[comment.id] === true;
      return {
        id: comment.id,
        // Comments whose paragraph is off the page keep their reading order.
        desiredTop: para ? para.getBoundingClientRect().top - proseTop : order,
        // A collapsed resolved card is one line tall, so it stays out of the
        // open comments' way instead of pushing them down the page (item 4).
        height: card?.offsetHeight ?? (showing ? 72 : COLLAPSED_CARD_HEIGHT)
      };
    });

    const next: Tops = {};
    for (const placed of stackCards(boxes, 10)) next[placed.id] = placed.top;
    setTops((prev) => (sameTops(prev, next) ? prev : next));
  }, [comments, layoutKey, proseRef, expanded]);

  return (
    <div className="gutter" ref={gutterRef}>
      {comments.map((comment) => {
        const open = isOpen(comment);
        const resolved = comment.status === 'resolved';
        return (
          <div
            key={comment.id}
            data-comment-id={comment.id}
            className={`note-card cat-${comment.category} ${
              comment.id === activeId ? 'note-card--active' : ''
            } ${resolved ? 'note-card--resolved' : ''} ${open ? '' : 'note-card--collapsed'}`}
            style={{ top: tops[comment.id] ?? 0 }}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActive(comment.id);
              if (resolved) setExpanded((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setActive(comment.id);
                if (resolved) setExpanded((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }));
              }
            }}
          >
            <div className="note-card__head">
              <span className="note-card__cat">{comment.category}</span>
              {comment.paragraph !== null ? (
                // Written as an escape so the pilcrow survives any encoding round trip.
                <span className="note-card__para">{`¶ ${paragraphNumber(comment.paragraph)}`}</span>
              ) : null}
              {resolved && !open ? (
                <span className="note-card__digest">{commentDigest(comment)}</span>
              ) : (
                <span className="spacer" />
              )}
              {open ? (
                <>
                  <button
                    type="button"
                    className="note-card__act"
                    aria-label="Edit the text this comment is about"
                    title="Edit text"
                    onClick={(event) => {
                      event.stopPropagation();
                      editFromComment(comment);
                    }}
                  >
                    <IconPencil />
                  </button>
                  <button
                    type="button"
                    className="note-card__act"
                    aria-label={resolved ? 'Unresolve comment' : 'Resolve comment'}
                    title={resolved ? 'Unresolve' : 'Resolve'}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetStatus(comment.id, resolved ? 'open' : 'resolved');
                      if (resolved) setExpanded((prev) => ({ ...prev, [comment.id]: false }));
                    }}
                  >
                    {resolved ? <IconUndo /> : <IconCheck />}
                  </button>
                </>
              ) : null}
            </div>
            {open ? (
              <>
                {comment.quote ? <blockquote>{comment.quote}</blockquote> : null}
                <p>{comment.text}</p>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
