import { useMemo } from 'react';
import type { ChangeCategory, Review } from '../../shared/types';
import { useBulkAction } from '../state/bulk';
import { isLocked, useApp } from '../state/store';
import { IconCheck, IconX } from './icons';

interface Props {
  review: Review;
}

/** One chip per category actually present, with bulk accept and dismiss on it. */
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
