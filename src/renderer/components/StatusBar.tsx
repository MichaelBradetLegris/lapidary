import { useEffect, useRef, useState } from 'react';
import { decisionCounts, unsavedDecisionCount } from '../../shared/diff/compose';
import type { RateLimitInfo } from '../../shared/ipc';
import { PROVIDER_NAMES, type Review } from '../../shared/types';
import { KEPT_TOOLTIP, keptPhrase, unsavedPhrase } from '../../shared/ui/save';
import { TAG_ABBREVIATIONS, TAG_KEYS, tagName } from '../../shared/ui/suggestions';
import { describeRateLimit, rateLimitTitle } from '../../shared/ui/usage';
import { canZoom, zoomLabel, type ZoomAction } from '../../shared/ui/zoom';
import { call } from '../state/client';
import { reviewKeptAt, useApp } from '../state/store';
import { IconCheck, IconMinus, IconPlus } from './icons';

interface Props {
  review: Review | null;
  runtimeLabel?: string;
  /** the label is a button: Setup for Claude, its ChatGPT view for ChatGPT (setup.7, codex.3) */
  onRuntime?: () => void;
  /** what the button opens, as its tooltip */
  runtimeTitle?: string;
  /** Claude Code's last usage notice, worded by `describeRateLimit` (setup.9) */
  rateLimit?: RateLimitInfo | null;
  /** Claude Code's `subscriptionType`, on which the weekly Sonnet limit's name depends (setup.9 review) */
  plan?: string | undefined;
}

/**
 * What the three states look like in the pane, since the swap can confuse
 * (item 6), how a small change is drawn and found (PLAN 11.7, `small.10`), and
 * what the unsaved dot means, in the window's title (polish.10; in the toolbar
 * from apply.4) and the chapter list (apply.5), what the chips count and do,
 * You and the eye included (polish.11) and the comments' (polish.13), and how
 * the suggestions list shows a decision, by the row's buttons, and the
 * heading's count (polish.12; Show states went in polish.17), and what each
 * row's three-letter tag stands for (polish.14). Exported for its render test.
 */
export function Legend({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The press is the legend's: it closes no drawer as well (keyboard.ts, ui.3).
      event.preventDefault();
      onClose();
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
          <span className="legend__swatch legend__swatch--capsule" /> <b>Small changes.</b> A change to a
          comma, a space or a one-letter word has a small box under it in the line, tinted while it is
          pending, so it is easy to see and to click. Once decided, only its grey or dotted line stays.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--key" /> <b>Small text above.</b> A comma or a letter
          above the line is drawn larger, and is not struck through when replaced: &quot;was&quot; says so. A
          space or a break is boxed and named, as in SPACE.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--bar" /> <b>Margin bars.</b> A bar beside a line
          marks a small change on it that is still pending. Click the bar to select the change, then press a,
          d, u or e.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--focus" /> <b>Shift+J and Shift+K</b> go to the next
          and previous pending suggestion, starting from what is on screen. The arrowhead in the margin marks
          the focused suggestion.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--unsaved" /> <b>Not saved to chapter.</b> The dot
          before a chapter&apos;s name, in the window&apos;s title or under Chapters, means the chapter has
          changes its file does not have yet. For the open chapter, Save to chapter and the status bar count
          them. Your decisions are kept automatically in the review, and the status bar says when they were
          last kept.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--chip" /> <b>Categories.</b> The chips at the top
          count the suggestions in each category, and You counts your own edits, in the colour of their YOU
          tag. Click a chip to hide or show it, to show only it, or to accept or dismiss all of it. The
          comments chip, before You, counts the open comments; hiding it hides the comments in the margin and
          in the side panel, whose heading still counts them. The eye before the chips shows or hides them
          all, the comments included.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--tick">
            <IconCheck />
          </span>{' '}
          <b>The suggestions list.</b> Each row starts with a tag in its chip&apos;s colour. Once you decide a
          suggestion, its tick turns a bold green if you accepted it, or its x red if you dismissed it, and
          the row&apos;s other buttons fade until the pointer is on them; click the tick or the x again to put
          it back. The Suggestions heading counts the suggestions you have decided.
        </li>
        <li>
          <span className="legend__swatch legend__swatch--tag" /> <b>Tags.</b> Three letters name the
          category, the same width on every row so the changes start in one column. The pointer on a tag shows
          its name.
          <span className="legend__tags">
            {TAG_KEYS.map((key) => (
              <span key={key} className="legend__tag">
                <span className={`row__cat cat-${key}`}>{TAG_ABBREVIATIONS[key]}</span>
                {tagName(key)}
              </span>
            ))}
          </span>
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

/** How often a usage notice is worded again while it shows. */
const USAGE_NOTICE_TICK_MS = 30_000;

/**
 * Claude's usage when there is something worth saying (setup.9,
 * `describeRateLimit`): from 80% of a limit, a limit reached, or extra usage
 * in use, with the whole sentence and the time left as its tooltip. While it
 * shows it is worded again every 30 s, so the time left keeps up and the
 * notice goes once its limit has reset.
 */
function UsageNotice({
  info,
  plan
}: {
  info: RateLimitInfo;
  plan?: string | undefined;
}): React.JSX.Element | null {
  const [, setTick] = useState(0);
  const now = new Date();
  const text = describeRateLimit(info, now, plan);
  const showing = text !== null;
  useEffect(() => {
    if (!showing) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), USAGE_NOTICE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [showing]);
  if (text === null) return null;
  return (
    <span
      className="statusbar__warn"
      data-testid="status-usage"
      title={rateLimitTitle(info, now, plan) ?? undefined}
    >
      {text}
    </span>
  );
}

/**
 * The counts, then where the decisions are: "3 not saved to chapter" while the
 * chapter file is behind the page, and "Decisions kept 14:02" for the last
 * write of the review on screen (`reviewKeptAt`; nothing for a chapter whose
 * review has not been written), which used to read "Review saved" and was
 * taken for the chapter (apply.4, PLAN 11.1 "Unsaved signal").
 */
export function StatusBar({
  review,
  runtimeLabel,
  onRuntime,
  runtimeTitle,
  rateLimit,
  plan
}: Props): React.JSX.Element {
  const counts = review ? decisionCounts(review.hunks) : { pending: 0, accepted: 0, dismissed: 0, stale: 0 };
  const unsaved = unsavedPhrase(review ? unsavedDecisionCount(review.hunks) : 0);
  const cost = review?.generator.costUsd;
  const provider = review?.generator.provider;
  const keptAt = useApp(reviewKeptAt);
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
      {keptAt ? <span title={KEPT_TOOLTIP}>{keptPhrase(keptAt)}</span> : null}
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
      {rateLimit ? <UsageNotice info={rateLimit} plan={plan} /> : null}
      {runtimeLabel ? (
        onRuntime ? (
          <button type="button" className="statusbar__runtime" title={runtimeTitle} onClick={onRuntime}>
            {runtimeLabel}
          </button>
        ) : (
          <span>{runtimeLabel}</span>
        )
      ) : null}
      <ZoomControl />
    </footer>
  );
}
