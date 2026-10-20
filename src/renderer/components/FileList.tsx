import type { ChapterFile, ReviewSummary } from '../../shared/ipc';
import type { Review } from '../../shared/types';
import { CONFLICT_COPY_BADGE, conflictCopyLabel } from '../../shared/text/sync';
import {
  READ_LIST_AGAIN,
  chapterListMarks,
  chapterListNotice,
  watchNotice
} from '../../shared/ui/chapterList';
import { IconFolder, IconPlus } from './icons';

interface Props {
  files: ChapterFile[];
  index: Record<string, ReviewSummary>;
  /** the review on screen, which marks the open chapter's row live (apply.5) */
  review: Review | null;
  configured: boolean;
  /** why the manuscript folder could not be read, in main's words; null when it was (apply.25) */
  problem: string | null;
  /** false while main is not watching the manuscript folder, as when its start was refused (files.21) */
  watching: boolean;
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
 * A conflict copy that Obsidian Sync, Dropbox or Syncthing made gets a
 * "conflict copy" badge under its name, its tooltip naming the tool and the
 * chapter it copies (`conflictCopyLabel`, files.11); it is listed and opens as
 * any chapter does. With no rows, the list says why (`chapterListNotice`): no folder chosen, a
 * folder with no chapters, or a manuscript folder that could not be read,
 * with Try again (apply.25). While main is not watching the folder, a line
 * says that changes made outside the app will not show, above the rows or
 * under that line, with Try again, whose list read starts the watcher once
 * the folder can be read (`watchNotice`, files.21).
 */
export function FileList({
  files,
  index,
  review,
  configured,
  problem,
  watching,
  onOpen,
  onChooseFolder,
  onReadAgain,
  onNewChapter
}: Props): React.JSX.Element {
  const byPath = new Map(Object.entries(index).map(([key, value]) => [indexKey(key), value]));
  const activePath = review?.sourcePath ?? null;
  const notice = chapterListNotice({ configured, count: files.length, problem });
  const unwatched = watchNotice({ configured, watching });

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
        <p className={notice.action === 'read-again' ? 'files__problem' : 'side__empty'}>{notice.text}</p>
      ) : null}
      {unwatched ? <p className="files__problem">{unwatched}</p> : null}
      {notice?.action === 'choose-folder' ? (
        <button type="button" onClick={onChooseFolder}>
          Choose folder
        </button>
      ) : notice?.action === 'read-again' || unwatched ? (
        <button type="button" onClick={onReadAgain}>
          {READ_LIST_AGAIN}
        </button>
      ) : null}
      {notice ? null : (
        <ul className="filelist">
          {files.map((file) => {
            const open = file.path === activePath;
            const marks = chapterListMarks(byPath.get(indexKey(file.path)), open ? review : null);
            // A sync tool's conflict copy is listed like any chapter, and
            // marked, so the author can compare it with the chapter (files.11).
            const conflict = conflictCopyLabel(file.name);
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
                  {conflict ? (
                    // The badge goes on a line of its own under the name, so
                    // the name keeps the width any chapter's has (C.78).
                    <span className="filelist__copy">
                      <span className="filelist__name">{file.relativePath}</span>
                      <span className="badge badge--conflict" title={conflict}>
                        {CONFLICT_COPY_BADGE}
                      </span>
                    </span>
                  ) : (
                    <span className="filelist__name">{file.relativePath}</span>
                  )}
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
