import { useMemo } from 'react';
import type { ChangeCategory, Review } from '../../shared/types';
import { chipsRevealLeft, chipsWheelLeft } from '../../shared/ui/chips';
import { useBulkAction } from '../state/bulk';
import { isLocked, useApp } from '../state/store';
import { IconCheck, IconX } from './icons';

interface Props {
  review: Review;
}

/**
 * An up-and-down wheel turned over the row scrolls it sideways (polish.6,
 * `chipsWheelLeft`). A listener of its own, not React's `onWheel`, which is
 * passive and so cannot keep the turn from going on to scroll something else.
 */
function sidewaysWheel(row: HTMLDivElement | null): (() => void) | undefined {
  if (!row) return undefined;
  const onWheel = (event: WheelEvent): void => {
    const left = chipsWheelLeft(event, row);
    if (left === null) return;
    event.preventDefault();
    row.scrollLeft = left;
  };
  row.addEventListener('wheel', onWheel, { passive: false });
  return () => row.removeEventListener('wheel', onWheel);
}

/**
 * A chip the keyboard reaches comes wholly into view (`chipsRevealLeft`):
 * Chromium scrolls only one that does not show at all. Only for a focus the
 * keyboard gave (`:focus-visible`): a press on a chip half cut off at the
 * edge would otherwise slide the row under the pointer between the press and
 * the release, and the click would land on nothing, as a row that moved under
 * a click once accepted its neighbour (C.49).
 */
function revealChip(event: React.FocusEvent<HTMLDivElement>): void {
  const row = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
  const chip = target.closest('.chip');
  if (!chip) return;
  const box = row.getBoundingClientRect();
  const edges = chip.getBoundingClientRect();
  const offset = row.scrollLeft - box.left - row.clientLeft;
  const left = chipsRevealLeft(row, { left: edges.left + offset, right: edges.right + offset });
  if (left !== null) row.scrollLeft = left;
}

/**
 * One chip per category actually present, with bulk accept and dismiss on it,
 * on one row at the top of the centre column that scrolls sideways when the
 * chips do not fit (polish.6, PLAN 7).
 */
export function FilterChips({ review }: Props): React.JSX.Element | null {
  const hidden = useApp((s) => s.hiddenCategories);
  const toggleCategory = useApp((s) => s.toggleCategory);
  const locked = useApp(isLocked);
  const runBulk = useBulkAction();

  const categories = useMemo(() => {
    const counts = new Map<ChangeCategory, number>();
    for (const hunk of review.hunks) {
      if (hunk.anchor === 'stale') continue;
      const key: ChangeCategory = hunk.category ?? 'other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [review.hunks]);

  if (categories.length === 0) return null;

  return (
    <div
      ref={sidewaysWheel}
      onFocus={revealChip}
      className={`chips ${locked ? 'chips--locked' : ''}`}
      role="group"
      aria-label="Filter suggestions by category"
      inert={locked}
    >
      {categories.map(([category, count]) => (
        <span
          key={category}
          className={`chip cat-${category} ${hidden.includes(category) ? 'chip--off' : ''}`}
        >
          <button
            type="button"
            className="chip__label"
            aria-pressed={!hidden.includes(category)}
            onClick={() => toggleCategory(category)}
            title={hidden.includes(category) ? 'Show these' : 'Hide these'}
          >
            {category} {count}
          </button>
          <button
            type="button"
            className="chip__bulk"
            aria-label={`Accept all ${category}`}
            title={`Accept all ${category}`}
            onClick={() => runBulk('accept', category)}
          >
            <IconCheck size={11} />
          </button>
          <button
            type="button"
            className="chip__bulk"
            aria-label={`Dismiss all ${category}`}
            title={`Dismiss all ${category}`}
            onClick={() => runBulk('dismiss', category)}
          >
            <IconX size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
