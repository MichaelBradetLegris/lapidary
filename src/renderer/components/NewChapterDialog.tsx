import { useEffect, useRef, useState } from 'react';
import {
  CHAPTER_EXTENSIONS,
  type ChapterExtension,
  type ChapterFile,
  type NameCheck
} from '../../shared/ipc';
import { NEW_CHAPTER_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import { call, errorMessage } from '../state/client';
import { useDialogFocus } from '../state/dialog';
import { useApp } from '../state/store';

interface Props {
  onCreated: (file: ChapterFile) => void;
  onClose: () => void;
}

/**
 * New chapter (item 7a).
 *
 * The name is checked against the manuscript folder as it is typed, so "that
 * name is taken" is visible before Create is reachable. That is a courtesy, not
 * the guarantee: the file is written with the exclusive-create flag, so even a
 * race with Obsidian cannot overwrite an existing chapter (CLAUDE.md rule 1).
 *
 * The focus goes into the name field as it opens and back to the + that opened
 * it when it closes; the page behind it is inert meanwhile, so Tab stays among
 * its controls (`useDialogFocus`, ui.4).
 */
export function NewChapterDialog({ onCreated, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState('');
  const [extension, setExtension] = useState<ChapterExtension>('md');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState<{ name: string; extension: string; result: NameCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const setDialogText = useApp((s) => s.setDialogText);

  useDialogFocus(boxRef, NEW_CHAPTER_BUTTON_SELECTOR, nameRef);

  /* A name or text typed here would be lost if the window closed, so the
     close guard is told (apply.16, PLAN 11.3 i). */
  const typed = name !== '' || text !== '';
  useEffect(() => setDialogText('new-chapter', typed), [typed, setDialogText]);
  useEffect(() => () => setDialogText('new-chapter', false), [setDialogText]);

  useEffect(() => {
    if (trimmed.length === 0) return;
    let alive = true;
    // A short debounce: the author is typing, not asking a question per letter.
    const timer = window.setTimeout(() => {
      call('files:check-name', { name: trimmed, extension })
        .then((result) => {
          if (alive) setAnswer({ name: trimmed, extension, result });
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [trimmed, extension]);

  /* Only ever trust a verdict about the name that is actually in the field, so
     Create can never be enabled by an answer about something else. */
  const check = answer && answer.name === trimmed && answer.extension === extension ? answer.result : null;
  const problem = check && !check.valid ? (check.problem ?? '') : '';
  const taken = check?.exists === true;
  const canCreate = Boolean(check?.valid) && !taken && !busy;

  const create = (): void => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    call('files:create', { name: trimmed, extension, text })
      .then(onCreated)
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="New chapter">
      <div className="modal" ref={boxRef} tabIndex={-1}>
        <h2>New chapter</h2>
        <p className="modal__hint">
          The file is created in the manuscript folder. An existing file is never touched.
        </p>

        <div className="modal__row">
          <span>File name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            spellCheck={false}
            placeholder="Chapter 03 - The Bridge"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
          <span className="modal__ext">
            {CHAPTER_EXTENSIONS.map((ext) => (
              <label key={ext}>
                <input
                  type="radio"
                  name="extension"
                  value={ext}
                  checked={extension === ext}
                  onChange={() => setExtension(ext)}
                />
                .{ext}
              </label>
            ))}
          </span>
        </div>

        {taken ? (
          <p className="modal__problem">A file with this name already exists.</p>
        ) : problem ? (
          <p className="modal__problem">{problem}</p>
        ) : check?.path ? (
          <p className="modal__note modal__path">{check.path}</p>
        ) : null}

        <label className="paste-field paste-field--small">
          <span>Text (optional)</span>
          <textarea
            value={text}
            spellCheck={false}
            placeholder="Paste or type the chapter"
            onChange={(event) => setText(event.target.value)}
          />
        </label>

        {error ? <p className="modal__hint modal__hint--error">{error}</p> : null}

        <div className="modal__actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canCreate} onClick={create}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
