import { useEffect, useRef, type MouseEvent } from 'react';
import { ghostContent, hunkFaces } from '../../shared/render';
import { isAuthored } from '../../shared/edit';
import { isSmallLive, sideText } from '../../shared/ui/small';
import { TOOLTIP_DELAY_MS } from '../../shared/ui/tooltip';
import type { Hunk } from '../../shared/types';
import { IconArrow, IconUndo, IconX } from './icons';

interface Props {
  hunk: Hunk;
  focused: boolean;
  hovered: boolean;
  /** a neighbour touches it on that side, so a small change's capsule stops at its edge (11.7) */
  flushBefore?: boolean;
  flushAfter?: boolean;
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
  flushBefore = false,
  flushAfter = false,
  onToggleAccept,
  onToggleDismiss,
  onHover,
  onHoverEnd
}: Props): React.JSX.Element {
  const { live } = hunkFaces(hunk);
  const content = ghostContent(hunk);
  const isInsertion = hunk.original.length === 0;
  const small = isSmallLive(hunk);
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
    hunk.anchor === 'fuzzy' || hunk.anchor === 'ambiguous' ? 'hunk--uncertain' : '',
    /* A comma, a space or a one-letter word in the line gets a capsule under
       it, drawn by app.css (11.7, small.6). */
    small ? 'hunk--small' : '',
    small && flushBefore ? 'hunk--flush-before' : '',
    small && flushAfter ? 'hunk--flush-after' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    onToggleDismiss(hunk.id);
  };

  /* "Insertion" lives in the label, not in a visually hidden word in the line:
     hidden text is still text, so it came along whenever the author copied a
     paragraph, and the find bar matched it. Each side is spoken as the list
     writes it, a space or a comma by its name (11.7, small.5). */
  const label = `${hunk.category ?? 'change'}${isInsertion ? ' insertion' : ''}: original ${sideText(
    hunk.original
  )}, suggested ${sideText(hunk.replacement)}`;

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
      <span className={`hunk__above${content.key ? ' hunk__above--key' : ''}`}>
        <span className={`hunk__ghost hunk__ghost--${content.role}`} aria-hidden="true">
          {/* An SVG arrow, not a glyph: this file must survive an encoding round trip. */}
          {/* An accepted insertion has no original to show. It used to read
              "was keep", which says the opposite of what happened; it now
              reads "added" (Phase 5d, where the author's own edits make
              inserted words common). ghostContent chooses (11.7, small.4). */}
          <span className="hunk__role">{content.label === 'arrow' ? <IconArrow /> : content.label}</span>
          {content.tag ? <span className="hunk__tag">{content.tag}</span> : null}
          {/* A small ghost sits in a box, a space or a break by its name in
              small caps, so a comma or a hyphen is plain at a glance and a
              space is not an arrow pointing at nothing (11.7, small.7). The
              box is an inline-block, so a replaced original's line-through
              does not reach it; its "was" says it was replaced. */}
          {content.key ? (
            <span className={`hunk__key${content.key.name ? ' hunk__key--name' : ''}`}>
              {content.key.text}
            </span>
          ) : (
            content.text
          )}
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
