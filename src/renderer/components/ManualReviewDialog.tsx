import { useEffect, useRef, useState } from 'react';
import { unsavedDecisionCount } from '../../shared/diff/compose';
import { diffToHunks } from '../../shared/diff/wordDiff';
import { createReview } from '../../shared/review';
import { normalizeText } from '../../shared/text/eol';
import type { Review } from '../../shared/types';
import { MANUAL_REVIEW_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import { useDialogFocus } from '../state/dialog';
import { buildManualReview } from '../state/reviewStart';
import type { SaveOptions, SaveOutcome } from '../state/saveChapter';
import { useApp } from '../state/store';

interface Props {
  /** the chapter the corrected text will be diffed against */
  review: Review;
  onCreated: (next: Review) => void;
  onClose: () => void;
  onLoadCorrected: () => Promise<string | null>;
  /** Save to chapter, waited for, for Save then build (apply.20) */
  onSave: (options: SaveOptions) => Promise<SaveOutcome>;
}

/**
 * Submit manual review (item 7b).
 *
 * This is half of what used to be paste mode. The other half became New
 * chapter. The difference that matters: the base is no longer something pasted
 * into a box, it is the chapter that is open, so the review it produces belongs
 * to a real file and is saved and re-anchored like any other.
 *
 * The pasted text is compared with the chapter file, so changes on the page
 * that the file does not have yet are asked about before building: Save then
 * build, Build without them, or Cancel (apply.20, `buildManualReview`).
 *
 * The focus goes into its box as it opens and back to the toolbar button that
 * opened it when it closes; the page behind it is inert meanwhile, so Tab
 * stays among its controls (`useDialogFocus`, ui.4).
 */
export function ManualReviewDialog({
  review,
  onCreated,
  onClose,
  onLoadCorrected,
  onSave
}: Props): React.JSX.Element {
  const notify = useApp((s) => s.notify);
  const saving = useApp((s) => s.chapterSaving);
  const [corrected, setCorrected] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef, MANUAL_REVIEW_BUTTON_SELECTOR);
  /* What a save before building said when it did not reach the chapter file.
     Its cards sit under this dialog's backdrop, so the dialog says it instead
     (apply.20 review). */
  const [notSaved, setNotSaved] = useState<string[]>([]);
  const showNotSaved = notSaved.length > 0 && unsavedDecisionCount(review.hunks) > 0;
  const setDialogText = useApp((s) => s.setDialogText);

  /* Pasted text would be lost if the window closed, so the close guard is
     told (apply.16, PLAN 11.3 i). */
  const typed = corrected !== '';
  useEffect(() => setDialogText('manual-review', typed), [typed, setDialogText]);
  useEffect(() => () => setDialogText('manual-review', false), [setDialogText]);

  const build = (): void => {
    if (corrected.trim().length === 0) {
      notify('warn', 'Paste the corrected chapter, or load it from a file.');
      return;
    }

    /* Against the review on screen when it is built, not when Build was
       pressed: after Save then build, that is the chapter just saved. */
    const make = (): void => {
      const current = useApp.getState().review ?? review;
      const next = createReview({
        sourcePath: current.sourcePath,
        base: current.base,
        hunks: diffToHunks(current.base.text, normalizeText(corrected).text),
        generator: { kind: 'manual' }
      });
      onCreated(next);
      onClose();
    };

    /* Changes not saved to the chapter are asked about first: Save then
       build, Build without them, or Cancel (apply.20). Build review is not
       disabled while the question is open: the dialog is inert under it, and
       a button disabled then could not take back the focus when Cancel
       answers it (ui.4); during the save that follows, `saving` disables it. */
    setNotSaved([]);
    void buildManualReview({
      save: onSave,
      build: make,
      stillWanted: () => useApp.getState().manualReviewOpen,
      onNotSaved: setNotSaved
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Submit manual review">
      <div className="modal modal--wide" ref={boxRef} tabIndex={-1}>
        <h2>Submit manual review</h2>
        <p className="modal__hint">
          Paste a corrected version of this chapter. Every difference from what is on disk becomes a
          suggestion you can accept or dismiss, exactly like one the model wrote.
        </p>
        <label className="paste-field">
          <span>Corrected text</span>
          <textarea
            value={corrected}
            onChange={(event) => setCorrected(event.target.value)}
            spellCheck={false}
            placeholder="Paste the corrected chapter"
          />
        </label>
        {showNotSaved ? (
          <div className="modal__warn modal__warn--stack modal__warn--error" role="alert">
            {notSaved.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        ) : null}
        <div className="modal__actions">
          <button
            type="button"
            onClick={() => {
              void onLoadCorrected().then((text) => {
                if (text !== null) setCorrected(text);
              });
            }}
          >
            Load corrected from file
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={saving} onClick={build}>
            {saving ? 'Saving…' : 'Build review'}
          </button>
        </div>
      </div>
    </div>
  );
}
