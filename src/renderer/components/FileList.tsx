import type { ChapterFile, ReviewSummary } from '../../shared/ipc';
import { IconFolder, IconPlus } from './icons';

interface Props {
  files: ChapterFile[];
  index: Record<string, ReviewSummary>;
  activePath: string | null;
  configured: boolean;
  onOpen: (file: ChapterFile) => void;
  onChooseFolder: () => void;
  onNewChapter: () => void;
}

/** Windows paths differ in case and separator between sources; compare loosely. */
function indexKey(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

export function FileList({
  files,
  index,
  activePath,
  configured,
  onOpen,
  onChooseFolder,
  onNewChapter
}: Props): React.JSX.Element {
  const byPath = new Map(Object.entries(index).map(([key, value]) => [indexKey(key), value]));

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
            const summary = byPath.get(indexKey(file.path));
            return (
              <li key={file.path}>
                <button
                  type="button"
                  className={`filelist__item ${file.path === activePath ? 'filelist__item--active' : ''}`}
                  onClick={() => onOpen(file)}
                  title={file.relativePath}
                >
                  <span className="filelist__name">{file.relativePath}</span>
                  {summary ? (
                    summary.pendingCount > 0 ? (
                      <span className="badge badge--pending" title="Pending suggestions">
                        {summary.pendingCount}
                      </span>
                    ) : (
                      <span className="badge" title="Reviewed">
                        ✓
                      </span>
                    )
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
