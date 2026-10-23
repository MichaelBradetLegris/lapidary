import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from 'react';
import {
  SPLIT_LABEL,
  SPLIT_ROW_PX,
  SPLIT_TITLE,
  SPLIT_TITLE_STILL,
  splitAria,
  splitKeyAction,
  splitMovable,
  splitMove,
  splitRoom,
  splitShare,
  type SplitMeasure,
  type SplitRoom
} from '../../shared/ui/split';
import { call } from './client';
import { saveSplit, type SplitIo } from './split';
import { useApp } from './store';

/*
 * The handle between the side panel's two regions (ui.6, PLAN 7 "The split").
 * The rules are in src/shared/ui/split.ts; this measures the regions, follows
 * the pointer and the keys, and hands the split to app.css as custom
 * properties on `.side__regions`. The split is drawn by CSS from the share,
 * so the line keeps its place as the window, the zoom or the status bar change
 * the panel's height, with no script. In the short window's one scroller the
 * handle is hidden and app.css ignores the split (C.49). In a panel too short
 * for it to move an arrow step, it is the plain line it replaced: disabled,
 * out of the Tab order, and still to the pointer (C.59).
 */

/** The id of the suggestions list's region, which the handle's `aria-controls` names. */
export const SPLIT_LIST_ID = 'side-suggestions';

const SPLIT_IO: SplitIo = {
  setSettings: (patch) => call('settings:set', patch)
};

const px = (value: string | undefined): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
};

/**
 * The two regions as drawn, or null when the panel is not laid out in two:
 * the short window's one scroller hides the handle.
 */
export function measureSplit(regions: HTMLElement): SplitMeasure | null {
  const list = regions.querySelector<HTMLElement>(':scope > .side__list');
  const lower = regions.querySelector<HTMLElement>(':scope > .side__lower');
  const handle = regions.querySelector<HTMLElement>(':scope > .side__split');
  if (!list || !lower || !handle) return null;
  const handleHeight = handle.getBoundingClientRect().height;
  if (handleHeight === 0) return null;
  const listStyle = getComputedStyle(list);
  const lowerStyle = getComputedStyle(lower);
  // The heading's line, with Show states beside it (polish.12).
  const heading = list.querySelector<HTMLElement>(':scope > .side__list-head');
  const headingStyle = heading ? getComputedStyle(heading) : null;
  const row = list.querySelector<HTMLElement>('.rows > li');
  return {
    total: regions.getBoundingClientRect().height,
    list: list.getBoundingClientRect().height,
    row: row ? row.getBoundingClientRect().height : SPLIT_ROW_PX,
    listChrome:
      px(listStyle.paddingTop) +
      px(listStyle.paddingBottom) +
      (heading && headingStyle
        ? heading.getBoundingClientRect().height + px(headingStyle.marginTop) + px(headingStyle.marginBottom)
        : 0),
    lowerChrome:
      px(lowerStyle.paddingTop) +
      px(lowerStyle.paddingBottom) +
      px(lowerStyle.borderTopWidth) +
      px(lowerStyle.borderBottomWidth),
    handle: handleHeight
  };
}

function sameMeasure(a: SplitMeasure | null, b: SplitMeasure | null): boolean {
  if (a === null || b === null) return a === b;
  return (Object.keys(a) as (keyof SplitMeasure)[]).every((key) => Math.abs(a[key] - b[key]) < 0.01);
}

interface Drag {
  pointerId: number;
  startY: number;
  room: SplitRoom;
}

export interface Split {
  regionsRef: RefObject<HTMLDivElement | null>;
  /** for `.side__regions`: the share and the limits app.css draws it with, when a split is set */
  regionsProps: { 'data-split'?: string; style?: CSSProperties };
  /** for the handle */
  handleProps: HTMLAttributes<HTMLDivElement> & { 'aria-orientation': 'horizontal' };
}

export function useSplit(): Split {
  const saved = useApp((s) => s.settings?.sideSplit ?? null);
  /** the share while a drag is under way; undefined when none is, or the drag has gone back past its start */
  const [live, setLive] = useState<number | undefined>(undefined);
  const liveRef = useRef<number | undefined>(undefined);
  const [measure, setMeasure] = useState<SplitMeasure | null>(null);
  const [dragging, setDragging] = useState(false);
  const regionsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const update = useCallback(() => {
    const regions = regionsRef.current;
    const next = regions ? measureSplit(regions) : null;
    setMeasure((prev) => (sameMeasure(prev, next) ? prev : next));
  }, []);

  /* After every render, before the frame is painted, so the limits app.css
     clamps with are there from the first frame; and whenever the panel or
     the list changes size, as the window, the zoom or the status bar change it. */
  useLayoutEffect(update);
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    const observer = new ResizeObserver(update);
    observer.observe(regions);
    const list = regions.querySelector(':scope > .side__list');
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [update]);

  /* While a drag is under way the pointer keeps the row-resize shape wherever
     it goes, and no text is selected (app.css `.splitting`). */
  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add('splitting');
    return () => document.documentElement.classList.remove('splitting');
  }, [dragging]);

  const showLive = (share: number | undefined): void => {
    liveRef.current = share;
    setLive(share);
  };

  const share = live === undefined ? saved : live;
  const room = measure ? splitRoom(measure) : null;
  const aria = room ? splitAria(room) : null;
  const still = room !== null && !splitMovable(room);

  const regionsProps: Split['regionsProps'] =
    share === null
      ? {}
      : {
          'data-split': '',
          style: {
            '--split': String(share),
            ...(room ? { '--split-min': `${room.min}px`, '--split-gap': `${room.gap}px` } : {})
          } as CSSProperties
        };

  const finish = (pointerId: number, keep: boolean): void => {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    drag.current = null;
    setDragging(false);
    const last = liveRef.current;
    showLive(undefined);
    // The store takes the split at once, so the line stays where it was let go.
    if (keep && last !== undefined) void saveSplit(last, SPLIT_IO);
  };

  /** The regions as they are now, when the handle can move; null when it cannot, or is hidden. */
  const movableRoom = (): SplitRoom | null => {
    const regions = regionsRef.current;
    const measured = regions ? measureSplit(regions) : null;
    const now = measured ? splitRoom(measured) : null;
    return now && splitMovable(now) ? now : null;
  };

  const handleProps: Split['handleProps'] = {
    className: dragging ? 'side__split side__split--dragging' : 'side__split',
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': SPLIT_LABEL,
    'aria-controls': SPLIT_LIST_ID,
    'aria-valuemin': aria?.valueMin,
    'aria-valuemax': aria?.valueMax,
    'aria-valuenow': aria?.valueNow,
    'aria-valuetext': aria?.valueText,
    'aria-disabled': still ? true : undefined,
    tabIndex: still ? -1 : 0,
    title: still ? SPLIT_TITLE_STILL : SPLIT_TITLE,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      /* No text selection, and the focus stays where it was, as a click in
         the focused suggestion's box leaves it (ui.5): the arrows go on
         stepping through the list after a drag. So too on a handle that
         cannot move, which a press then leaves alone. */
      event.preventDefault();
      const dragRoom = movableRoom();
      if (!dragRoom) return;
      drag.current = { pointerId: event.pointerId, startY: event.clientY, room: dragRoom };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId) return;
      const next = splitMove(d.room, d.room.current + event.clientY - d.startY);
      showLive(next === null ? undefined : splitShare(next, d.room));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onDoubleClick: () => {
      if (movableRoom()) void saveSplit(null, SPLIT_IO);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      /* A handle that cannot move takes no key, and the review keys have the
         arrows back (`splitTakesKey` reads `aria-disabled`). */
      const keyRoom = movableRoom();
      if (!keyRoom) return;
      const action = splitKeyAction(event, keyRoom.current);
      if (!action) return;
      // The review keys leave these to the handle (`splitTakesKey`, keyboard.ts).
      event.preventDefault();
      if (action.kind === 'reset') {
        void saveSplit(null, SPLIT_IO);
        return;
      }
      const next = splitMove(keyRoom, action.target);
      if (next !== null) void saveSplit(splitShare(next, keyRoom), SPLIT_IO);
    }
  };

  return { regionsRef, regionsProps, handleProps };
}
