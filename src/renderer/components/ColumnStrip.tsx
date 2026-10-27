import { stripText, type Column } from '../../shared/ui/columns';
import { drawerId } from '../state/columns';
import { IconChevronLeft, IconChevronRight } from './icons';

interface Props {
  column: Column;
  /** its drawer is open */
  open: boolean;
  onToggle: () => void;
}

/**
 * A folded side column (ui.3, PLAN 7 "Narrow windows"): one button the height
 * of the column, with a chevron that points the way the drawer opens and the
 * column's name written down it. It opens the column as a drawer over the edge
 * of the prose, and closes it again. Its name is the column's, "Chapters" or
 * "Suggestions", and `aria-expanded` says whether the drawer is open; the
 * tooltip says which it will do, Open or Close, never the Show or Hide of the
 * column's button in the toolbar, which hides the strip too (`stripText`).
 */
export function ColumnStrip({ column, open, onToggle }: Props): React.JSX.Element {
  const text = stripText(column, open);
  // The chevron points where the drawer goes: out from the window's edge when
  // it is closed, back to it when it is open.
  const pointsRight = column === 'files' ? !open : open;
  return (
    <button
      type="button"
      className={`strip strip--${column}`}
      aria-label={text.label}
      aria-expanded={open}
      aria-controls={drawerId(column)}
      title={text.title}
      onClick={onToggle}
    >
      {pointsRight ? <IconChevronRight /> : <IconChevronLeft />}
      <span className="strip__label" aria-hidden="true">
        {text.label}
      </span>
    </button>
  );
}
