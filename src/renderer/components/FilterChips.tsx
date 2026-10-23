import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ChangeCategory, Review } from '../../shared/types';
import type { BulkAction } from '../../shared/ui/bulk';
import {
  CHIPS_FIT,
  chipBulkLabel,
  chipCategories,
  chipMenuLabel,
  chipMenuPlacement,
  chipsPageLeft,
  chipsRevealLeft,
  chipsView,
  chipsWheelLeft,
  chipTitle,
  sameChipsView,
  type ChipsView
} from '../../shared/ui/chips';
import { contextMenuKey, firstEnabled } from '../../shared/ui/menu';
import { useBulkAction } from '../state/bulk';
import { chipFocused } from '../state/chipFocus';
import { scrollContainerTo } from '../state/scroll';
import { isLocked, useApp } from '../state/store';
import { IconChevronDown, IconChevronLeft, IconChevronRight } from './icons';
import { MenuList } from './MenuList';
import { useMenu, type MenuItem } from './useMenu';

interface Props {
  review: Review;
  /** the bulk actions wait: the chapter is read-only, or a paragraph is open (the toolbar's own rule) */
  bulkOff: boolean;
  /** why, when a paragraph is open */
  bulkTitle: string | undefined;
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
 * Chromium scrolls only one that does not show at all. Only for a chip's
 * toggle, and only for a focus the keyboard gave (`:focus-visible`): a press
 * on a chip half cut off at the edge would otherwise slide the row under the
 * pointer between the press and the release, and the click would land on
 * nothing, as a row that moved under a click once accepted its neighbour
 * (C.49). A chip's open menu, inside it, is not a chip.
 */
function revealChip(event: React.FocusEvent<HTMLDivElement>): void {
  const row = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains('chip__toggle')) return;
  if (!target.matches(':focus-visible')) return;
  const chip = target.closest('.chip');
  if (!chip) return;
  const box = row.getBoundingClientRect();
  const edges = chip.getBoundingClientRect();
  const offset = row.scrollLeft - box.left - row.clientLeft;
  const left = chipsRevealLeft(row, { left: edges.left + offset, right: edges.right + offset });
  if (left !== null) row.scrollLeft = left;
}

interface ChipProps {
  category: ChangeCategory;
  count: number;
  off: boolean;
  locked: boolean;
  bulkOff: boolean;
  bulkTitle: string | undefined;
  onToggle: () => void;
  onBulk: (action: Exclude<BulkAction, 'reset'>) => void;
  row: RefObject<HTMLDivElement | null>;
}

/**
 * One category's chip (polish.10): its name and count, the whole chip one
 * toggle of the category's filter, and a menu holding Accept all and Dismiss
 * all of it, opened by a right-click, the keyboard's menu key or Shift+F10 on
 * the chip, or the ▾ shown at its end while the pointer is over it or the
 * keyboard's focus is on it. The ▾ is no Tab stop. The menu behaves as the
 * toolbar's do (`useMenu`); it closes with the focus back on the chip, and the
 * question an item asks hands the focus back there too. The row scrolls and
 * clips what overflows it, so the list is placed in the window
 * (`position: fixed`, `chipMenuPlacement`), and goes when the row scrolls.
 */
function Chip({
  category,
  count,
  off,
  locked,
  bulkOff,
  bulkTitle,
  onToggle,
  onBulk,
  row
}: ChipProps): React.JSX.Element {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const items: MenuItem[] = [
    {
      label: chipBulkLabel('accept', category),
      onSelect: () => onBulk('accept'),
      disabled: bulkOff,
      title: bulkTitle
    },
    {
      label: chipBulkLabel('dismiss', category),
      onSelect: () => onBulk('dismiss'),
      disabled: bulkOff,
      title: bulkTitle
    }
  ];
  // While a review of the chapter runs the chips are inert, and an open menu goes.
  const { shown, listId, enabled, ref, openOn, close, focusItem, onBlur, list } = useMenu(
    items,
    toggleRef,
    locked
  );
  const label = chipMenuLabel(category);

  const openMenu = (): void => {
    if (shown) focusItem(firstEnabled(enabled));
    else openOn('first');
  };

  /* Under the chip, in the window, and only then shown: the list is hidden
     until it is placed (app.css), and a hidden item cannot take the focus. A
     layout effect, so it runs inside `openOn`'s flushSync, before the first
     item is focused and before the list is painted. */
  useLayoutEffect(() => {
    if (!shown) return;
    const place = (): void => {
      const chip = ref.current?.getBoundingClientRect();
      const menu = listRef.current;
      if (!chip || !menu) return;
      const at = chipMenuPlacement(chip, menu.offsetWidth, document.documentElement.clientWidth);
      menu.style.left = `${at.left}px`;
      menu.style.top = `${at.top}px`;
      menu.style.visibility = 'visible';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [shown, ref]);

  /* A row that scrolls leaves the list under nothing, so it goes, with the
     focus back on the chip. */
  useEffect(() => {
    const scroller = row.current;
    if (!shown || !scroller) return;
    const onScroll = (): void => close(true);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
    // `close` reads only refs and the state setter, so the first one serves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, row]);

  /* A right-click, or the menu key's or Shift+F10's own context menu event.
     One the open list has already taken, as the menu key's release sends once
     its press has opened the list, does nothing more. */
  const onContextMenu = (event: React.MouseEvent): void => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    openMenu();
  };

  const onToggleKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!contextMenuKey(event)) return;
    // The menu's, not the page's (keyboard.ts).
    event.preventDefault();
    event.stopPropagation();
    openMenu();
  };

  return (
    <span
      ref={ref}
      className={`chip cat-${category}${off ? ' chip--off' : ''}${shown ? ' chip--menu' : ''}`}
      onBlur={onBlur}
      onContextMenu={onContextMenu}
    >
      <button
        ref={toggleRef}
        type="button"
        className="chip__toggle"
        aria-pressed={!off}
        title={chipTitle(off)}
        onClick={onToggle}
        onFocus={() => chipFocused(category)}
        onKeyDown={onToggleKey}
      >
        {category} <span className="chip__count">{count}</span>
      </button>
      {/* No Tab stop, and a press on it leaves the focus where it is: the
          keyboard opens the menu from the chip. Its tooltip is its name. */}
      <button
        type="button"
        className="chip__more"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (shown ? close(true) : openOn('first'))}
      >
        <IconChevronDown size={8} />
      </button>
      {shown ? (
        <MenuList
          id={listId}
          label={label}
          items={items}
          className="chip__menu"
          listRef={listRef}
          {...list}
        />
      ) : null}
    </span>
  );
}

/**
 * The category chips, one per category actually present, in the toolbar's row
 * where the chapter's name was (polish.10, PLAN 7). They fit the default
 * window beside the toolbar's buttons; when they do not, the row scrolls
 * sideways and never wraps: with the wheel, the translucent ‹ and › laid over
 * its ends, which show only while there are chips out of sight that way, and
 * Tab, which brings a chip it reaches wholly into view. The row draws no
 * scrollbar; a 2 px line under it shows where it is while the chips overflow.
 */
export function FilterChips({ review, bulkOff, bulkTitle }: Props): React.JSX.Element | null {
  const hidden = useApp((s) => s.hiddenCategories);
  const toggleCategory = useApp((s) => s.toggleCategory);
  const locked = useApp(isLocked);
  const runBulk = useBulkAction();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ChipsView>(CHIPS_FIT);

  const categories = useMemo(() => chipCategories(review.hunks), [review.hunks]);

  const measure = useCallback((): void => {
    const row = rowRef.current;
    if (!row) return;
    const next = chipsView(row);
    setView((prev) => (sameChipsView(prev, next) ? prev : next));
  }, []);

  /* The row as drawn, after every render (a chip's count can change its
     width), on every scroll and whenever it changes size, as the window and
     the zoom make it. */
  useLayoutEffect(measure);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    row.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      row.removeEventListener('scroll', onScroll);
    };
  }, [measure, categories.length]);

  const attachRow = useCallback((row: HTMLDivElement | null) => {
    rowRef.current = row;
    const off = sidewaysWheel(row);
    return () => {
      off?.();
      rowRef.current = null;
    };
  }, []);

  const page = (direction: 1 | -1): void => {
    const row = rowRef.current;
    if (!row) return;
    const left = chipsPageLeft(row, direction);
    if (left !== null) scrollContainerTo(row, left, 'left');
  };

  if (categories.length === 0) return null;

  return (
    <div className={`chips-bar${locked ? ' chips--locked' : ''}`} inert={locked}>
      <div
        ref={attachRow}
        onFocus={revealChip}
        className="chips"
        role="group"
        aria-label="Filter suggestions by category"
      >
        {categories.map(([category, count]) => (
          <Chip
            key={category}
            category={category}
            count={count}
            off={hidden.includes(category)}
            locked={locked}
            bulkOff={bulkOff}
            bulkTitle={bulkTitle}
            onToggle={() => toggleCategory(category)}
            onBulk={(action) => runBulk(action, category)}
            row={rowRef}
          />
        ))}
      </div>
      {/* Pointer conveniences, laid over the row's ends: a press on one leaves
          the focus where it is, and the keyboard has Tab. */}
      {view.start ? (
        <button
          type="button"
          className="chips__arrow chips__arrow--start"
          tabIndex={-1}
          aria-label="Scroll the categories left"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => page(-1)}
        >
          <IconChevronLeft size={12} />
        </button>
      ) : null}
      {view.end ? (
        <button
          type="button"
          className="chips__arrow chips__arrow--end"
          tabIndex={-1}
          aria-label="Scroll the categories right"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => page(1)}
        >
          <IconChevronRight size={12} />
        </button>
      ) : null}
      {view.thumb ? (
        <div className="chips__line" aria-hidden="true">
          <div className="chips__thumb" style={{ left: view.thumb.left, width: view.thumb.width }} />
        </div>
      ) : null}
    </div>
  );
}
