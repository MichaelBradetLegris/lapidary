import { useEffect, useRef, type MouseEvent } from 'react';
import { hunkFaces } from '../../shared/render';
import { isAuthored } from '../../shared/edit';
import { TOOLTIP_DELAY_MS } from '../../shared/ui/tooltip';
import type { Hunk } from '../../shared/types';
import { IconArrow, IconUndo, IconX } from './icons';

interface Props {
  hunk: Hunk;
  focused: boolean;
  hovered: boolean;
  onToggleAccept: (id: string) => void;
  onToggleDismiss: (id: string) => void;
  onHover: (id: string) => void;
  onHoverEnd: () => void;
}

/**
 * One suggestion in the line. The live text sits in the prose; the other side
 * floats above it as a ghost, which the extra line height leaves room for.
 *
 * The ghost is labelled by role, not by position: "was" in front of an original
 * the author has replaced, an arrow in front of a suggestion still on offer
 * (item 6). Hovering only opens the tooltip. It deliberately does not move
 * focus, because focus scrolls, and a suggestion that slid out from under the
 * pointer was the thing the author complained about most (plan 5a, item 3).
 *
 * The dismiss "x" is part of the ghost row rather than pinned to the corner of
 * the span. Pinned to the corner it landed on top of the ghost's last letters
 * whenever the ghost was wider than the live text, which is most of the time
 * (item 2). Trailing the ghost, it cannot collide with it at any width.
 */
export function HunkSpan({
  hunk,
  focused,
  hovered,
  onToggleAccept,
  onToggleDismiss,
  onHover,
  onHoverEnd
}: Props): React.JSX.Element {
  const { live, ghost, role } = hunkFaces(hunk);
  const isInsertion = hunk.original.length === 0;
  const isDeletion = hunk.replacement.length === 0;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const startHover = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onHover(hunk.id), TOOLTIP_DELAY_MS);
  };

  const endHover = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    onHoverEnd();
  };

  const classes = [
    'hunk',
    `hunk--${hunk.status}`,
    `cat-${hunk.category ?? 'other'}`,
    focused ? 'hunk--focused' : '',
    hovered ? 'hunk--hovered' : '',
    isAuthored(hunk) ? 'hunk--authored' : '',
    hunk.anchor === 'fuzzy' || hunk.anchor === 'ambiguous' ? 'hunk--uncertain' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    onToggleDismiss(hunk.id);
  };

  /* "Insertion" lives in the label, not in a visually hidden word in the line:
     hidden text is still text, so it came along whenever the author copied a
     paragraph, and the find bar matched it. */
  const label = `${hunk.category ?? 'change'}${isInsertion ? ' insertion' : ''}: original ${
    hunk.original || '(nothing)'
  }, suggested ${hunk.replacement || '(nothing)'}`;

  return (
    <span
      className={classes}
      data-hunk-id={hunk.id}
      data-hunk-start={hunk.start}
      data-hunk-end={hunk.end}
      data-status={hunk.status}
      role="button"
      tabIndex={-1}
      aria-label={label}
      onClick={() => onToggleAccept(hunk.id)}
      onContextMenu={handleContextMenu}
      onMouseEnter={startHover}
      onMouseLeave={endHover}
    >
      {/* The row above the line: the ghost, then the x trailing it. The row
          belongs to the suggestion for the pointer too, so the x stays shown
          all the way from the word up to it (round 4, item 2). */}
      <span className="hunk__above">
        <span className={`hunk__ghost hunk__ghost--${role}`} aria-hidden="true">
          {/* An SVG arrow, not a glyph: this file must survive an encoding round trip. */}
          {/* An accepted insertion has no original to show. It used to read
              "was keep", which says the opposite of what happened; it now
              reads "added" (Phase 5d, where the author's own edits make
              inserted words common). */}
          <span className="hunk__role">
            {role === 'original' ? ghost.length === 0 ? 'added' : 'was' : <IconArrow />}
          </span>
          {isDeletion && hunk.status !== 'accepted' ? <span className="hunk__tag">delete</span> : ghost}
        </span>
        {/* Out of the tab order: the x is invisible until hovered, and the
            keyboard dismisses with d. */}
        <button
          type="button"
          tabIndex={-1}
          className="hunk__x"
          aria-label={hunk.status === 'dismissed' ? 'Undismiss suggestion' : 'Dismiss suggestion'}
          onClick={(event) => {
            event.stopPropagation();
            onToggleDismiss(hunk.id);
          }}
        >
          {hunk.status === 'dismissed' ? <IconUndo size={11} /> : <IconX size={11} />}
        </button>
      </span>
      <span className="hunk__live">
        {live.length === 0 ? <span className="hunk__caret" aria-hidden="true" /> : live}
      </span>
    </span>
  );
}
