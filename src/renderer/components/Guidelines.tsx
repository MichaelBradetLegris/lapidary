import type { ReactNode } from 'react';
import type { GuidelinesStatus } from '../../shared/ipc';
import {
  OPEN_FOLDER,
  OPEN_GUIDELINES,
  openFolderTitle,
  openGuidelinesTitle,
  styleSheetNote
} from '../../shared/ui/guidelines';

interface ButtonsProps {
  /** the guidelines file, or null until a manuscript folder is chosen */
  path: string | null;
  /** `guidelines:open`, which creates the file from the template first when it is missing */
  onOpen: () => void;
  /** `shell:reveal` with `guidelines`, which also creates the file first when it is missing */
  onOpenFolder: () => void;
  /**
   * What describes a button that has no tooltip, which is while there is no
   * file to open: Settings gives its path line, which says to choose a
   * manuscript folder first (polish.4).
   */
  describedBy?: string;
  /** buttons of the row's own before these two, as Settings' Change */
  children?: ReactNode;
}

/**
 * Open and Open folder, for the guidelines file (polish.3), in Review with AI
 * and Settings. Open hands the file to the app the system uses for its type,
 * which is Obsidian when the author has made it the app for .md files; Open
 * folder shows it in its folder. Main works the file out from the settings;
 * the page only says which button was pressed. Each button's tooltip says
 * what it opens.
 */
export function GuidelinesButtons({
  path,
  onOpen,
  onOpenFolder,
  describedBy,
  children
}: ButtonsProps): React.JSX.Element {
  const openTitle = openGuidelinesTitle(path);
  const folderTitle = openFolderTitle(path);
  return (
    <span className="modal__buttons">
      {children}
      <button
        type="button"
        disabled={path === null}
        title={openTitle}
        aria-describedby={openTitle === undefined ? describedBy : undefined}
        onClick={onOpen}
      >
        {OPEN_GUIDELINES}
      </button>
      <button
        type="button"
        disabled={path === null}
        title={folderTitle}
        aria-describedby={folderTitle === undefined ? describedBy : undefined}
        onClick={onOpenFolder}
      >
        {OPEN_FOLDER}
      </button>
    </span>
  );
}

interface RowProps {
  path: string | null;
  /** `guidelines:status`, read as the dialog opens and whenever the window gets the focus back; null until then */
  status: GuidelinesStatus | null;
  onOpen: () => void;
  onOpenFolder: () => void;
}

/**
 * Review with AI's Guidelines row: the file, Open and Open folder, and while
 * the style sheet is still empty, the note that says what the reviewer may
 * "fix" without it (`styleSheetNote`, setup.10b).
 */
export function GuidelinesRow({ path, status, onOpen, onOpenFolder }: RowProps): React.JSX.Element {
  const note = styleSheetNote(status);
  return (
    <>
      <div className="modal__row">
        <span>Guidelines</span>
        <span className="modal__path" title={path ?? undefined}>
          {path ?? 'choose a manuscript folder first'}
        </span>
        <GuidelinesButtons path={path} onOpen={onOpen} onOpenFolder={onOpenFolder} />
      </div>
      {note ? (
        <div className="modal__warn" role="note" data-testid="style-sheet-note">
          <span>{note}</span>
        </div>
      ) : null}
    </>
  );
}
