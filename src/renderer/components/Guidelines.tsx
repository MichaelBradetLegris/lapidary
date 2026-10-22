import type { GuidelinesStatus, OpenGuidelinesVia } from '../../shared/ipc';
import {
  OPEN_IN_OBSIDIAN,
  canOpenInObsidian,
  openGuidelinesTitle,
  styleSheetNote
} from '../../shared/ui/guidelines';

interface ButtonsProps {
  /** the guidelines file, or null until a manuscript folder is chosen */
  path: string | null;
  /** the label of the button that opens it in the system's app: "Open" in Review with AI */
  openLabel: string;
  /** `guidelines:open`, which creates the file from the template first when it is missing */
  onOpen: (via: OpenGuidelinesVia) => void;
  /**
   * What describes a button that has no tooltip, which is while there is no
   * file to open: Settings gives its path line, which says to choose a
   * manuscript folder first (polish.4).
   */
  describedBy?: string;
}

/**
 * Open in Obsidian and Open, for the guidelines file (setup.10b), in Review
 * with AI and Settings. Main builds Obsidian's link from the path it holds;
 * the page only says which way. Obsidian does not show a `.txt` file, so
 * Open in Obsidian is disabled for one, and each button's tooltip says where
 * the file opens.
 */
export function GuidelinesButtons({ path, openLabel, onOpen, describedBy }: ButtonsProps): React.JSX.Element {
  const obsidianTitle = openGuidelinesTitle(path, 'obsidian');
  const defaultTitle = openGuidelinesTitle(path, 'default');
  return (
    <span className="modal__buttons">
      <button
        type="button"
        disabled={!canOpenInObsidian(path)}
        title={obsidianTitle}
        aria-describedby={obsidianTitle === undefined ? describedBy : undefined}
        onClick={() => onOpen('obsidian')}
      >
        {OPEN_IN_OBSIDIAN}
      </button>
      <button
        type="button"
        disabled={path === null}
        title={defaultTitle}
        aria-describedby={defaultTitle === undefined ? describedBy : undefined}
        onClick={() => onOpen('default')}
      >
        {openLabel}
      </button>
    </span>
  );
}

interface RowProps {
  path: string | null;
  /** `guidelines:status`, read as the dialog opens and whenever the window gets the focus back; null until then */
  status: GuidelinesStatus | null;
  onOpen: (via: OpenGuidelinesVia) => void;
}

/**
 * Review with AI's Guidelines row: the file, its two ways to open, and while
 * the style sheet is still empty, the note that says what the reviewer may
 * "fix" without it (`styleSheetNote`, setup.10b).
 */
export function GuidelinesRow({ path, status, onOpen }: RowProps): React.JSX.Element {
  const note = styleSheetNote(status);
  return (
    <>
      <div className="modal__row">
        <span>Guidelines</span>
        <span className="modal__path" title={path ?? undefined}>
          {path ?? 'choose a manuscript folder first'}
        </span>
        <GuidelinesButtons path={path} openLabel="Open" onOpen={onOpen} />
      </div>
      {note ? (
        <div className="modal__warn" role="note" data-testid="style-sheet-note">
          <span>{note}</span>
        </div>
      ) : null}
    </>
  );
}
