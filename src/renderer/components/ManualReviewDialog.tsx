import { useState } from 'react';
import { diffToHunks } from '../../shared/diff/wordDiff';
import { createReview } from '../../shared/review';
import { normalizeText } from '../../shared/text/eol';
import type { Review } from '../../shared/types';
import { useApp } from '../state/store';

interface Props {
  /** the chapter the corrected text will be diffed against */
  review: Review;
  onCreated: (next: Review) => void;
  onClose: () => void;
  onLoadCorrected: () => Promise<string | null>;
}

/**
 * Submit manual review (item 7b).
 *
 * This is half of what used to be paste mode. The other half became New
 * chapter. The difference that matters: the base is no longer something pasted
 * into a box, it is the chapter that is open, so the review it produces belongs
 * to a real file and is saved and re-anchored like any other.
 */
export function ManualReviewDialog({
  review,
  onCreated,
  onClose,
  onLoadCorrected
}: Props): React.JSX.Element {
  const notify = useApp((s) => s.notify);
  const askConfirm = useApp((s) => s.askConfirm);
  const [corrected, setCorrected] = useState('');
  const [busy, setBusy] = useState(false);

  const decided = review.hunks.filter((h) => h.status !== 'pending').length;

  const build = (): void => {
    if (corrected.trim().length === 0) {
      notify('warn', 'Paste the corrected chapter, or load it from a file.');
      return;
    }

    const make = (): void => {
      const next = createReview({
        sourcePath: review.sourcePath,
        base: review.base,
        hunks: diffToHunks(review.base.text, normalizeText(corrected).text),
        generator: { kind: 'manual' }
      });
      onCreated(next);
      onClose();
    };

    if (decided === 0) {
      make();
      return;
    }

    setBusy(true);
    void askConfirm({
      title: `Replace the open review?`,
      body: `You have decided ${decided} suggestion${
        decided === 1 ? '' : 's'
      } in the review that is open. Building a review from this text replaces the working set. The old review stays in History.`,
      confirmLabel: 'Replace'
    })
      .then((ok) => {
        if (ok) make();
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Submit manual review">
      <div className="modal modal--wide">
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
          <button type="button" className="primary" disabled={busy} onClick={build}>
            Build review
          </button>
        </div>
      </div>
    </div>
  );
}
