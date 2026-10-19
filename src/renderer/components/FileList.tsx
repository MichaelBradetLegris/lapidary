import type { ChapterFile, ReviewSummary } from '../../shared/ipc';
import type { Review } from '../../shared/types';
import { READ_LIST_AGAIN, chapterListMarks, chapterListNotice } from '../../shared/ui/chapterList';
import { IconFolder, IconPlus } from './icons';

interface Props {
  files: ChapterFile[];
  index: Record<string, ReviewSummary>;
  /** the review on screen, which marks the open chapter's row live (apply.5) */
  review: Review | null;
  configured: boolean;
  /** why the manuscript folder could not be read, in main's words; null when it was (apply.25) */
  problem: string | null;
  onOpen: (file: ChapterFile) => void;
  onChooseFolder: () => void;
  /** read the manuscript folder again */
  onReadAgain: () => void;
  onNewChapter: () => void;
}

/** Windows paths differ in case and separator between sources; compare loosely. */
function indexKey(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/**
 * The chapters in the manuscript folder. A chapter whose file does not have all
 * its changes yet gets the unsaved dot before its name, as the open chapter
 * does in the toolbar; the badge after it counts the suggestions still pending,
 * or ticks a chapter with none. Both come from `chapterListMarks` (apply.5).
 * With no rows, the list says why (`chapterListNotice`): no folder chosen, a
 * folder with no chapters, or a manuscript folder that could not be read,
 * with Try again (apply.25).
 */
export function FileList({
  files,
  index,
  review,
  configured,
  problem,
  onOpen,
  onChooseFolder,
  onReadAgain,
  onNewChapter
}: Props): React.JSX.Element {
  const byPath = new Map(Object.entries(index).map(([key, value]) => [indexKey(key), value]));
  const activePath = review?.sourcePath ?? null;
  const notice = chapterListNotice({ configured, count: files.length, problem });

  return (
    <nav className="files">
      {/* Choosing the folder and starting a chapter are the two things done
          from here, so they live in the heading rather than in Settings and a
          dialog nobody would look for (item 7a). */}
      <div className="files__head">
        <h3>Chapters</h3>
        <span className="spacer" />
        <button
          type="button"
          className="files__act"
          aria-label="Choose the manuscript folder"
          title="Choose the manuscript folder"
          onClick={onChooseFolder}
        >
          <IconFolder />
        </button>
        {/* Where the focus goes when New chapter closes (NEW_CHAPTER_BUTTON_SELECTOR, ui.4). */}
        <button
          type="button"
          className="files__act"
          data-opens="new-chapter"
          aria-label="New chapter"
          title="New chapter"
          disabled={!configured}
          onClick={onNewChapter}
        >
          <IconPlus />
        </button>
      </div>
      {notice ? (
        <>
          <p className={notice.action === 'read-again' ? 'files__problem' : 'side__empty'}>{notice.text}</p>
          {notice.action === 'choose-folder' ? (
            <button type="button" onClick={onChooseFolder}>
              Choose folder
            </button>
          ) : notice.action === 'read-again' ? (
            <button type="button" onClick={onReadAgain}>
              {READ_LIST_AGAIN}
            </button>
          ) : null}
        </>
      ) : (
        <ul className="filelist">
          {files.map((file) => {
            const open = file.path === activePath;
            const marks = chapterListMarks(byPath.get(indexKey(file.path)), open ? review : null);
            return (
              <li key={file.path}>
                <button
                  type="button"
                  className={`filelist__item ${open ? 'filelist__item--active' : ''}`}
                  onClick={() => onOpen(file)}
                  title={file.relativePath}
                >
                  {marks.unsaved > 0 ? (
                    <span
                      className="unsaved-dot"
                      role="img"
                      aria-label={marks.dotLabel}
                      title={marks.dotLabel}
                    />
                  ) : null}
                  <span className="filelist__name">{file.relativePath}</span>
                  {marks.pending === null ? null : marks.pending > 0 ? (
                    <span className="badge badge--pending" title="Pending suggestions">
                      {marks.pending}
                    </span>
                  ) : (
                    <span className="badge" title="Reviewed">
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
