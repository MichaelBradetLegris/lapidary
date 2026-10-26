import type { PointerEvent } from 'react';
import { columnCaretPoints, columnCaretText } from '../../shared/ui/columnHandle';
import type { Column } from '../../shared/ui/columns';
import { setColumnHidden } from '../state/columnHandles';
import { drawerId } from '../state/columns';
import { IconColumnCaret } from './icons';

interface Props {
  column: Column;
  /** the column is folded away: this is its edge strip, which brings it back */
  hidden: boolean;
}

/**
 * A side column's caret (polish.26, PLAN 7 "Column widths"). With the column
 * in place it is a small button at the top of the handle on its inner edge,
 * pointing at the window's edge, "Hide the chapter list" or "Hide the side
 * panel", which folds the column away. Folded away, the column is the edge
 * strip at the window's edge, as wide as the handle and the height of the
 * column: one button with the caret at its top pointing in, "Show the chapter
 * list" or "Show the side panel", which brings the column back at the width
 * it had. A press by the pointer leaves the focus where it was, as a press on
 * the handle does; Tab reaches either, and Enter or Space presses it.
 */
export function ColumnCaret({ column, hidden }: Props): React.JSX.Element {
  const text = columnCaretText(column, hidden);
  return (
    <button
      type="button"
      className={hidden ? `column-edge column-edge--${column}` : `column-caret column-caret--${column}`}
      aria-label={text}
      aria-controls={drawerId(column)}
      title={text}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.button === 0) event.preventDefault();
      }}
      onClick={(event) => setColumnHidden(column, !hidden, event.currentTarget)}
    >
      <IconColumnCaret points={columnCaretPoints(column, hidden)} />
    </button>
  );
}
