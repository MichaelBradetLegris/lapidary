import { useLayoutEffect, useRef } from 'react';
import { placeTooltip } from '../../shared/ui/tooltip';
import { editHunk } from '../state/edit';
import { hoverHold, hoverOff } from '../state/hover';
import { useApp } from '../state/store';
import { IconPencil } from './icons';

/**
 * The custom hover card (item 13). It replaces the native `title` tooltip, which
 * took a second to appear and said only one thing.
 *
 * The card is measured where it stands and then moved by writing its style
 * directly: `position: fixed` plus getBoundingClientRect means showing it can
 * never scroll the pane. It prefers to sit below the words, because the ghost
 * floats above them.
 *
 * It now carries a pencil (item 3a), so the pointer has to be able to reach it:
 * leaving the words schedules the card's removal instead of doing it at once,
 * and entering the card cancels that (`src/renderer/state/hover.ts`).
 */
export function HunkTooltip(): React.JSX.Element | null {
  const hoveredId = useApp((s) => s.hoveredHunkId);
  const review = useApp((s) => s.review);
  const cardRef = useRef<HTMLDivElement>(null);

  const hunk = hoveredId ? (review?.hunks.find((h) => h.id === hoveredId) ?? null) : null;
  const hunkId = hunk?.id ?? null;
  const status = hunk?.status ?? null;

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !hunkId) return;
    const anchor = document.querySelector(`[data-hunk-id="${hunkId}"]`);
    if (!anchor) return;

    card.style.visibility = 'hidden';
    card.style.left = '0px';
    card.style.top = '0px';
    const tip = card.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const placed = placeTooltip(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: tip.width, height: tip.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    card.style.left = `${placed.left}px`;
    card.style.top = `${placed.top}px`;
    card.dataset['placement'] = placed.placement;
    card.style.visibility = 'visible';
  }, [hunkId, status]);

  if (!hunk) return null;

  return (
    <div
      ref={cardRef}
      className={`tip cat-${hunk.category ?? 'other'}`}
      role="tooltip"
      onMouseEnter={hoverHold}
      onMouseLeave={hoverOff}
    >
      <div className="tip__head">
        <span className="tip__cat">{hunk.category ?? 'change'}</span>
        {hunk.anchor !== 'exact' ? <span className="tip__anchor">{hunk.anchor}</span> : null}
        <span className="spacer" />
        <button
          type="button"
          className="tip__edit"
          aria-label="Edit this suggestion"
          title="Edit"
          onClick={() => editHunk(hunk.id)}
        >
          <IconPencil size={11} />
        </button>
      </div>
      {hunk.reason ? <p className="tip__reason">{hunk.reason}</p> : null}
      <dl className="pair">
        <dt>Original:</dt>
        <dd className="pair__original">{hunk.original || '(nothing)'}</dd>
        <dt>Suggested:</dt>
        <dd className="pair__suggested">{hunk.replacement || '(nothing)'}</dd>
      </dl>
    </div>
  );
}
