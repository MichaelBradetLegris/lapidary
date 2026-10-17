import type { ChapterFile, ReviewSummary } from '../../shared/ipc';
import type { Review } from '../../shared/types';
import { chapterListMarks } from '../../shared/ui/chapterList';
import { IconFolder, IconPlus } from './icons';

interface Props {
  files: ChapterFile[];
  index: Record<string, ReviewSummary>;
  /** the review on screen, which marks the open chapter's row live (apply.5) */
  review: Review | null;
  configured: boolean;
  onOpen: (file: ChapterFile) => void;
  onChooseFolder: () => void;
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
 */
export function FileList({
  files,
  index,
  review,
  configured,
  onOpen,
  onChooseFolder,
  onNewChapter
}: Props): React.JSX.Element {
  const byPath = new Map(Object.entries(index).map(([key, value]) => [indexKey(key), value]));
  const activePath = review?.sourcePath ?? null;

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
        <button
          type="button"
          className="files__act"
          aria-label="New chapter"
          title="New chapter"
          disabled={!configured}
          onClick={onNewChapter}
        >
          <IconPlus />
        </button>
      </div>
      {!configured ? (
        <>
          <p className="side__empty">No manuscript folder chosen yet.</p>
          <button type="button" onClick={onChooseFolder}>
            Choose folder
          </button>
        </>
      ) : files.length === 0 ? (
        <p className="side__empty">No .md or .txt files in that folder.</p>
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
