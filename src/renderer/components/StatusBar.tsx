import { useEffect, useRef, useState } from 'react';
import { decisionCounts, unsavedDecisionCount } from '../../shared/diff/compose';
import { PROVIDER_NAMES, type Review } from '../../shared/types';
import { KEPT_TOOLTIP, keptPhrase, unsavedPhrase } from '../../shared/ui/save';
import { canZoom, zoomLabel, type ZoomAction } from '../../shared/ui/zoom';
import { call } from '../state/client';
import { useApp } from '../state/store';
import { IconMinus, IconPlus } from './icons';

interface Props {
  review: Review | null;
  runtimeLabel?: string;
  rateLimit?: string | undefined;
}

/**
 * What the three states look like in the pane, since the swap can confuse
 * (item 6), and what the unsaved dot means (apply.4). The small-change marks
 * of PLAN 11.7 join the list when they land (`small.10`).
 */
function Legend({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [onClose]);

  return (
    <div className="legend" ref={ref} role="dialog" aria-label="What the states mean">
      <h4>Reading a suggestion</h4>
      <p>
        The line of prose always reads as the text the chapter would have if you saved now. The small text
        above it is the other version.
      </p>
      <ul>
        <li>
          <span className="legend__swatch legend__swatch--pending" /> <b>Pending.</b> The line is your
          original, underlined and tinted in the category colour. The suggestion floats above it after an
          arrow. Only pending suggestions are coloured, so colour on the page means work left to do.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--accepted" /> <b>Accepted.</b> The line is the
          suggestion, with a plain grey underline and no tint: decided, and out of your way. Your original
          floats above it, struck through, after the word &quot;was&quot;.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--dismissed" /> <b>Dismissed.</b> The line is your
          original under a thin dotted grey line. The suggestion stays above it, faded.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--unsaved" /> <b>Not saved to chapter.</b> The dot
          before the chapter name means the page has changes the chapter file does not have yet. Save to
          chapter and the status bar count them. Your decisions are kept automatically in the review, and the
          status bar says when they were last kept.
        </li>
      </ul>
      <p className="legend__foot">
        Click a suggestion to accept or undo it. The x beside the floating text, or the d key, dismisses. The
        pencil on a suggestion, or the e key, lets you rewrite it, and the pen beside a paragraph lets you
        edit the paragraph itself. Nothing reaches the chapter until you press Save to chapter or Ctrl+S.
      </p>
    </div>
  );
}

/**
 * Window zoom, for reading from further back (round 5). The main process owns
 * the level and saves it; the buttons ask it to step, and the keyboard and
 * Ctrl+wheel reach it directly, so the label follows the settings in the store.
 */
function ZoomControl(): React.JSX.Element {
  const zoom = useApp((s) => s.settings?.zoom ?? 1);
  const notify = useApp((s) => s.notify);

  const step = (action: ZoomAction): void => {
    void call('view:zoom', { action })
      .then(({ zoom: next }) => {
        const settings = useApp.getState().settings;
        if (settings) useApp.getState().setSettings({ ...settings, zoom: next });
      })
      .catch((err: unknown) => notify('error', `Could not change the zoom: ${String(err)}`));
  };

  return (
    <span className="zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        className="zoom__btn"
        aria-label="Zoom out"
        title="Zoom out (Ctrl+minus)"
        disabled={!canZoom(zoom, 'out')}
        onClick={() => step('out')}
      >
        <IconMinus size={11} />
      </button>
      <button
        type="button"
        className="zoom__level"
        title="Reset to 100% (Ctrl+0). Ctrl+wheel also zooms."
        onClick={() => step('reset')}
      >
        {zoomLabel(zoom)}
      </button>
      <button
        type="button"
        className="zoom__btn"
        aria-label="Zoom in"
        title="Zoom in (Ctrl+plus)"
        disabled={!canZoom(zoom, 'in')}
        onClick={() => step('in')}
      >
        <IconPlus size={11} />
      </button>
    </span>
  );
}

/**
 * The counts, then where the decisions are: "3 not saved to chapter" while the
 * chapter file is behind the page, and "Decisions kept 14:02" for the last
 * write of the review, which used to read "Review saved" and was taken for the
 * chapter (apply.4, PLAN 11.1 "Unsaved signal").
 */
export function StatusBar({ review, runtimeLabel, rateLimit }: Props): React.JSX.Element {
  const counts = review ? decisionCounts(review.hunks) : { pending: 0, accepted: 0, dismissed: 0, stale: 0 };
  const unsaved = unsavedPhrase(review ? unsavedDecisionCount(review.hunks) : 0);
  const cost = review?.generator.costUsd;
  const provider = review?.generator.provider;
  const reviewSavedAt = useApp((s) => s.reviewSavedAt);
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <footer className="statusbar">
      <span className="statusbar__legend">
        <button
          type="button"
          className="statusbar__help"
          aria-label="What the states and the dot mean"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen((open) => !open)}
        >
          ?
        </button>
        {legendOpen ? <Legend onClose={() => setLegendOpen(false)} /> : null}
      </span>
      <span>{counts.pending} pending</span>
      <span className="statusbar__accept">{counts.accepted} accepted</span>
      <span className="statusbar__dismiss">{counts.dismissed} dismissed</span>
      {counts.stale > 0 ? <span className="statusbar__stale">{counts.stale} unanchored</span> : null}
      {unsaved ? (
        <span className="statusbar__unsaved" title={KEPT_TOOLTIP}>
          {unsaved}
        </span>
      ) : null}
      <span className="spacer" />
      {reviewSavedAt ? <span title={KEPT_TOOLTIP}>{keptPhrase(reviewSavedAt)}</span> : null}
      {provider || review?.generator.model ? (
        <span data-testid="status-model">
          {provider ? PROVIDER_NAMES[provider] : ''}
          {provider && review?.generator.model ? ' · ' : ''}
          {review?.generator.model ?? ''}
        </span>
      ) : null}
      {review?.generator.effort ? <span>effort {review.generator.effort}</span> : null}
      {typeof cost === 'number' ? (
        <span
          title={
            review?.generator.costEstimated
              ? "This app's estimate from a price table dated 2026-09-11, not a bill"
              : "The provider's own estimate"
          }
        >
          ${cost.toFixed(4)}
          {review?.generator.costEstimated ? ' estimate' : ''}
        </span>
      ) : null}
      {rateLimit ? <span className="statusbar__warn">{rateLimit}</span> : null}
      {runtimeLabel ? <span>{runtimeLabel}</span> : null}
      <ZoomControl />
    </footer>
  );
}
