import { isLocked, useApp } from '../state/store';

interface Props {
  /** what the running review is doing, e.g. "Thinking.. (12s)" */
  label: string;
  onCancel: () => void;
}

/**
 * Says why the chapter is read-only while its review runs, and offers the way
 * out (round 3, item 3). It floats at the bottom of the manuscript pane, outside
 * the scroller, so it stays in view however far the author scrolls and never
 * lands on the notification cards in the top-right corner.
 */
export function LockCard({ label, onCancel }: Props): React.JSX.Element | null {
  const locked = useApp(isLocked);
  if (!locked) return null;
  return (
    <div className="lock-card" role="status">
      <span className="lock-card__spinner" aria-hidden="true" />
      <div className="lock-card__text">
        <strong>{label}</strong>
        <span>This chapter is read-only until the review comes back.</span>
      </div>
      <button type="button" onClick={onCancel}>
        Cancel review
      </button>
    </div>
  );
}
