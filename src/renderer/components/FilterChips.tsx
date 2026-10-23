import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Review } from '../../shared/types';
import { bulkPlan, type BulkAction } from '../../shared/ui/bulk';
import {
  allChipsShown,
  CHIP_STEPS,
  CHIPS_FIT,
  CHIPS_ROW_PADDING,
  chipCounts,
  chipMenuLabel,
  chipMenuLabels,
  chipMenuPlacement,
  chipName,
  chipsPageLeft,
  chipsRevealLeft,
  chipsStep,
  chipsView,
  chipsWheelLeft,
  chipTitle,
  eyeLabel,
  sameChipsView,
  showOnlyHidden,
  type ChipKey,
  type ChipsView
} from '../../shared/ui/chips';
import { contextMenuKey, firstEnabled, lastEnabled, menuButtonKey } from '../../shared/ui/menu';
import { useBulkAction } from '../state/bulk';
import { chipFocused } from '../state/chipFocus';
import { scrollContainerTo } from '../state/scroll';
import { isLocked, useApp } from '../state/store';
import { IconChevronLeft, IconChevronRight, IconEye, IconEyeClosed } from './icons';
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
 * button, and only for a focus the keyboard gave (`:focus-visible`): a press
 * on a chip half cut off at the edge would otherwise slide the row under the
 * pointer between the press and the release, and the click would land on
 * nothing, as a row that moved under a click once accepted its neighbour
 * (C.49). A chip's open menu, inside it, is not a chip.
 */
function revealChip(event: React.FocusEvent<HTMLDivElement>): void {
  const row = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains('chip__button')) return;
  if (!target.matches(':focus-visible')) return;
  const chip = target.closest('.chip');
  if (!chip) return;
  const box = row.getBoundingClientRect();
  const edges = chip.getBoundingClientRect();
  const offset = row.scrollLeft - box.left - row.clientLeft;
  const left = chipsRevealLeft(row, { left: edges.left + offset, right: edges.right + offset });
  if (left !== null) row.scrollLeft = left;
}

/**
 * Each chip's width at every step (`CHIP_STEPS`), from the copy of the chips
 * out of sight: one row of it for each step, its chips in the row's order.
 */
function naturalWidths(copy: HTMLDivElement | null): number[][] {
  if (!copy) return [];
  return [...copy.children].map((row) => [...row.children].map((chip) => chip.getBoundingClientRect().width));
}

interface ChipProps {
  chip: ChipKey;
  count: number;
  off: boolean;
  /** its suggestions still pending, which Accept all and Dismiss all would move */
  pending: number;
  /** what Accept all and Dismiss all say on their tooltips when there is nothing to move */
  emptyNotes: Record<Exclude<BulkAction, 'reset'>, string>;
  locked: boolean;
  bulkOff: boolean;
  bulkTitle: string | undefined;
  onToggle: () => void;
  onShowOnly: () => void;
  onBulk: (action: Exclude<BulkAction, 'reset'>) => void;
  row: RefObject<HTMLDivElement | null>;
}

/**
 * One chip (polish.11): a menu button named by its category, or You, and its
 * count, whose tooltip, which is also its description, says whether its
 * suggestions are shown. A click anywhere on it, Enter, Space, the down or up
 * arrow, the keyboard's menu key or Shift+F10, or a right-click opens its
 * menu: Hide or Show, Show only, and under a line Accept all N and Dismiss
 * all N, N its suggestions still pending (`chipMenuLabels`). The menu behaves
 * as the toolbar's do (`useMenu`); it closes with the focus back on the chip,
 * and the question an item asks hands the focus back there too. The row
 * scrolls and clips what overflows it, so the list is placed in the window
 * (`position: fixed`, `chipMenuPlacement`), and goes when the row scrolls.
 */
function Chip({
  chip,
  count,
  off,
  pending,
  emptyNotes,
  locked,
  bulkOff,
  bulkTitle,
  onToggle,
  onShowOnly,
  onBulk,
  row
}: ChipProps): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const labels = chipMenuLabels(off, pending);
  /* Off while the toolbar's bulk items are, and with nothing pending, when
     the tooltip says so. */
  const bulkItem = (action: Exclude<BulkAction, 'reset'>): MenuItem => ({
    label: labels[action],
    onSelect: () => onBulk(action),
    disabled: bulkOff || pending === 0,
    title: bulkOff ? bulkTitle : pending === 0 ? emptyNotes[action] : undefined
  });
  const items: MenuItem[] = [
    { label: labels.toggle, onSelect: onToggle },
    { label: labels.only, onSelect: onShowOnly },
    { ...bulkItem('accept'), separated: true },
    bulkItem('dismiss')
  ];
  // While a review of the chapter runs the chips are inert, and an open menu goes.
  const { shown, listId, enabled, ref, openOn, close, focusItem, onBlur, list } = useMenu(
    items,
    buttonRef,
    locked
  );

  const openMenu = (where: 'first' | 'last' = 'first'): void => {
    if (shown) focusItem(where === 'first' ? firstEnabled(enabled) : lastEnabled(enabled));
    else openOn(where);
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

  /* The menu key and Shift+F10, and the arrows as on the toolbar's menu
     buttons: the menu's keys, not the page's (keyboard.ts). Enter and Space
     press the button, which opens it. */
  const onChipKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const where = contextMenuKey(event) ? 'first' : menuButtonKey(event);
    if (where === null) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(where);
  };

  return (
    <span
      ref={ref}
      className={`chip cat-${chip}${off ? ' chip--off' : ''}${shown ? ' chip--menu' : ''}`}
      onBlur={onBlur}
      onContextMenu={onContextMenu}
    >
      <button
        ref={buttonRef}
        type="button"
        className="chip__button"
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        title={chipTitle(chip, off)}
        onClick={() => (shown ? close(false) : openOn('first'))}
        onFocus={() => chipFocused(chip)}
        onKeyDown={onChipKey}
      >
        {chipName(chip)} <span className="chip__count">{count}</span>
      </button>
      {shown ? (
        <MenuList
          id={listId}
          label={chipMenuLabel(chip)}
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
 * The category chips, one per category actually present and You for the
 * author's own edits, last (`chipCounts`), at the left of the toolbar where
 * the chapter's name was (polish.10, polish.11, PLAN 7), after the eye that
 * shows or hides them all. They are drawn at the size they had before
 * `polish.10` and shrink in steps, only as far as they must to fit beside the
 * buttons (`chipsStep`, from the copy of them out of sight at every step,
 * `.chips__measure`); only at the smallest step do they overflow, and the row
 * then scrolls sideways and never wraps: with the wheel, the translucent ‹
 * and › laid over its ends, which show only while there are chips out of
 * sight that way, and Tab, which brings a chip it reaches wholly into view.
 * The row draws no scrollbar; a 2 px line under it shows where it is while
 * the chips overflow.
 */
export function FilterChips({ review, bulkOff, bulkTitle }: Props): React.JSX.Element | null {
  const hidden = useApp((s) => s.hiddenCategories);
  const toggleCategory = useApp((s) => s.toggleCategory);
  const setHiddenCategories = useApp((s) => s.setHiddenCategories);
  const clearCategoryFilter = useApp((s) => s.clearCategoryFilter);
  const locked = useApp(isLocked);
  const runBulk = useBulkAction();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ChipsView>(CHIPS_FIT);
  const [step, setStep] = useState(0);

  const chips = useMemo(() => chipCounts(review.hunks), [review.hunks]);
  const keys = useMemo(() => chips.map(([key]) => key), [chips]);
  /* What Accept all and Dismiss all would move for each chip, by the rule the
     question itself counts with (`bulkPlan`). */
  const plans = useMemo(
    () =>
      new Map(
        keys.map((key) => [
          key,
          { accept: bulkPlan(review.hunks, 'accept', key), dismiss: bulkPlan(review.hunks, 'dismiss', key) }
        ])
      ),
    [keys, review.hunks]
  );
  const allShown = allChipsShown(keys, hidden);
  const eye = eyeLabel(allShown);

  const measure = useCallback((): void => {
    const row = rowRef.current;
    if (!row) return;
    const next = chipsView(row);
    setView((prev) => (sameChipsView(prev, next) ? prev : next));
    // The room the row has for its chips, which no step changes (app.css).
    const room = row.getBoundingClientRect().width - CHIPS_ROW_PADDING;
    setStep(chipsStep(room, naturalWidths(copyRef.current)));
  }, []);

  /* The row as drawn, after every render (a chip's count can change its
     width, and a new step its view), on every scroll and whenever it or the
     copy changes size, as the window, the zoom and the fonts make them. */
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
    for (const copy of copyRef.current?.children ?? []) observer.observe(copy);
    row.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      row.removeEventListener('scroll', onScroll);
    };
  }, [measure, chips.length]);

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

  if (chips.length === 0) return null;

  return (
    <div className={`chips-bar${locked ? ' chips--locked' : ''}`} inert={locked}>
      {/* Open while every chip is shown, when it hides them all; closed
          otherwise, when it shows them all. Its name says what it does. */}
      <button
        type="button"
        className="chips__eye"
        aria-label={eye}
        title={eye}
        onClick={() => (allShown ? setHiddenCategories(keys) : clearCategoryFilter())}
      >
        {allShown ? <IconEye /> : <IconEyeClosed />}
      </button>
      <div className="chips-view">
        <div
          ref={attachRow}
          onFocus={revealChip}
          className="chips"
          data-chip-step={step}
          role="group"
          aria-label="Filter suggestions by category"
        >
          {chips.map(([key, count]) => {
            const plan = plans.get(key);
            return (
              <Chip
                key={key}
                chip={key}
                count={count}
                off={hidden.includes(key)}
                pending={plan?.accept.count ?? 0}
                emptyNotes={{
                  accept: plan?.accept.emptyNote ?? '',
                  dismiss: plan?.dismiss.emptyNote ?? ''
                }}
                locked={locked}
                bulkOff={bulkOff}
                bulkTitle={bulkTitle}
                onToggle={() => toggleCategory(key)}
                onShowOnly={() => setHiddenCategories(showOnlyHidden(keys, key))}
                onBulk={(action) => runBulk(action, key)}
                row={rowRef}
              />
            );
          })}
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
        {/* The chips again at every step, out of sight, for their widths there. */}
        <div ref={copyRef} className="chips__measure" aria-hidden="true">
          {CHIP_STEPS.map((_, at) => (
            <div key={at} className="chips__measure-row" data-chip-step={at}>
              {chips.map(([key, count]) => (
                <span key={key} className={`chip cat-${key}`}>
                  <span className="chip__button">
                    {chipName(key)} <span className="chip__count">{count}</span>
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
