import { useEffect, useId, useRef, useState } from 'react';
import { FOCUS_OVERLAY_FOCUS_FALLBACK } from '../../shared/ui/dialog';
import {
  FOCUS_OVERLAY_TITLE,
  FOCUS_RING_LABEL,
  focusCount,
  focusCountSpoken,
  focusOverlayLines,
  holdProgress,
  type FocusHoldSeconds
} from '../../shared/ui/focusMode';
import { useDialogFocus } from '../state/dialog';
import { resumeFocus } from '../state/focusMode';
import { useFocusOverlay, useFullScreen } from '../state/fullScreen';

/** The ring's radius in its 120-unit box; the arc is drawn on a path length of 100. */
const RING_RADIUS = 52;

interface ViewProps {
  seconds: FocusHoldSeconds;
  /** how long F11 or Escape has been held, in ms; 0 while the overlay waits for one */
  elapsedMs: number;
  /** the heading's and the words' ids, which the overlay is named and described by */
  titleId: string;
  textId: string;
}

/**
 * What the overlay shows (focus.1): the count in the middle of a ring that
 * fills as the time runs, and under it the words. Pure, for the render tests.
 */
export function FocusOverlayView({ seconds, elapsedMs, titleId, textId }: ViewProps): React.JSX.Element {
  const progress = holdProgress(elapsedMs, seconds);
  return (
    <div className="focus-overlay__content">
      <div
        className="focus-overlay__ring"
        role="progressbar"
        aria-label={FOCUS_RING_LABEL}
        aria-valuemin={0}
        aria-valuemax={seconds}
        aria-valuenow={Math.min(seconds, Math.floor(elapsedMs / 1000))}
        aria-valuetext={focusCountSpoken(elapsedMs, seconds)}
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="focus-overlay__track" cx="60" cy="60" r={RING_RADIUS} fill="none" />
          {/* No arc at all before the count starts: an arc of no length still
              left a sliver at the top of the ring. */}
          {progress > 0 ? (
            <circle
              className="focus-overlay__arc"
              cx="60"
              cy="60"
              r={RING_RADIUS}
              fill="none"
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={100 - progress * 100}
              transform="rotate(-90 60 60)"
            />
          ) : null}
        </svg>
        <span className="focus-overlay__count">{focusCount(elapsedMs, seconds)}</span>
      </div>
      <h2 id={titleId}>{FOCUS_OVERLAY_TITLE}</h2>
      <p id={textId} className="focus-overlay__text">
        {focusOverlayLines(seconds).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </p>
    </div>
  );
}

/**
 * Focus mode's overlay (focus.1, PLAN section 7, Focus mode): over the whole
 * window, dialogs and a question included, while the author holds F11 or
 * Escape to leave focus mode, or while it waits for one, opened by the
 * toolbar's button, a close request or Restart now. App makes everything
 * under it inert, the page, the dialogs, the question and Restart now's
 * overlay (`shellInert`'s `focus`), and `state/focusMode.ts` keeps every key
 * from the page while it shows. A click
 * anywhere on it closes it (`resumeFocus`): the whole press lands on it, so
 * nothing under it is clicked. It takes the focus on its box as it shows, so
 * a screen reader reads it, and hands it back to where it was when it goes
 * (`useDialogFocus`).
 */
export function FocusOverlay(): React.JSX.Element | null {
  const overlay = useFocusOverlay();
  const focus = useFullScreen((s) => s.focus);
  if (!overlay.open || focus === null) return null;
  return <FocusOverlayBox seconds={focus.holdSeconds} since={overlay.since} leaving={overlay.leaving} />;
}

function FocusOverlayBox({
  seconds,
  since,
  leaving
}: {
  seconds: FocusHoldSeconds;
  since: number | null;
  leaving: boolean;
}): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef, FOCUS_OVERLAY_FOCUS_FALLBACK);
  const [now, setNow] = useState(() => performance.now());

  /* The ring and the count follow the clock while a key is held. */
  useEffect(() => {
    if (since === null || leaving) return;
    let frame = requestAnimationFrame(function step() {
      setNow(performance.now());
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [since, leaving]);

  const titleId = useId();
  const textId = useId();
  const elapsedMs = leaving ? seconds * 1000 : since === null ? 0 : Math.max(0, now - since);
  return (
    <div
      className="modal-backdrop modal-backdrop--focus"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onMouseDown={(event) => event.preventDefault()}
      onClick={resumeFocus}
      onAuxClick={resumeFocus}
      onContextMenu={(event) => {
        event.preventDefault();
        resumeFocus();
      }}
    >
      <div className="modal focus-overlay" ref={boxRef} tabIndex={-1}>
        <FocusOverlayView seconds={seconds} elapsedMs={elapsedMs} titleId={titleId} textId={textId} />
      </div>
    </div>
  );
}
