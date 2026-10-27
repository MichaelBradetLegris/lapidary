import { columnHidden, panelButtonText, USUAL_COLUMN_WIDTHS, type Column } from '../../shared/ui/columns';
import { setColumnHidden } from '../state/columnHandles';
import { drawerId } from '../state/columns';
import { useApp } from '../state/store';
import { IconPanelLeft, IconPanelRight } from './icons';

/**
 * A side column's button at an end of the toolbar (polish.28, PLAN 7 "Column
 * widths"), Obsidian's way: at the far left, before the Mode select, the
 * chapter list's; at the far right, after full screen, the side panel's. Its
 * icon is a window with that side's pane marked off, filled while the column
 * shows and hollow while it is hidden, and its name and tooltip say what a
 * press does, "Hide the chapter list" or "Show the chapter list" ("the side
 * panel" for the other). A press hides the column, which is then drawn as
 * nothing and leaves the prose its room, or brings it back at the width it
 * had; the flag is `columnWidths`' (`filesHidden`, `sideHidden`), kept for the
 * next start. The eye's size and colour, as the full-screen button is.
 */
export function PanelButton({ column }: { column: Column }): React.JSX.Element {
  const hidden = useApp((s) => columnHidden(s.settings?.columnWidths ?? USUAL_COLUMN_WIDTHS, column));
  const text = panelButtonText(column, hidden);
  const Icon = column === 'files' ? IconPanelLeft : IconPanelRight;
  return (
    <button
      type="button"
      className={`toolbar__icon toolbar__panel toolbar__panel--${column}`}
      aria-label={text}
      aria-controls={drawerId(column)}
      title={text}
      onClick={() => setColumnHidden(column, !hidden)}
    >
      <Icon filled={!hidden} />
    </button>
  );
}
