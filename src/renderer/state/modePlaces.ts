import { useCallback, useLayoutEffect, useMemo, useRef, type UIEvent } from 'react';
import { modePlace, type Mode, type ModePlaces } from '../../shared/ui/modes';

/** What the scroller takes, spread onto it: its ref, and its `onScroll`, which notes where the mode on screen is. */
export interface ModePlaceProps {
  ref: (element: HTMLElement | null) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}

/**
 * How long a place is held while the page grows back to its height (rr.2
 * review): Main lays out its margin notes, ghosts and position strip in passes
 * of its own after its first render, which take a frame or two; a page that
 * never gets tall enough, such as a chapter made shorter meanwhile, is left
 * where it got to.
 */
export const PLACE_HOLD_MS = 1500;

/** What `holdPlace` watches, the browser's in the window and stand-ins in the tests. */
export interface PlaceWatch {
  /** calls `grew` after a layout in which the scroller's content changed size; gives back how to stop */
  resized: (grew: () => void) => () => void;
  /** calls `moved` when the author scrolls or moves on: a wheel, a key, a press or a touch; gives back how to stop */
  authorMoves: (moved: () => void) => () => void;
  /** calls `done` once after `ms`; gives back how to cancel */
  later: (ms: number, done: () => void) => () => void;
}

/**
 * Put the scroller back at `top`, and keep putting it back as the page grows
 * until it gets there (rr.2 review). Back in Main, the page's first render is
 * shorter than it will be once ReviewPane has measured itself and laid out its
 * margin column, so the browser cut the place down to the first height and
 * nothing put it back: left 500 px down, Main came back 254 px down. The place
 * is held until it is reached, the author scrolls or moves on (a wheel, a key,
 * a press or a touch, anywhere), `PLACE_HOLD_MS` pass, or the stop given back
 * is called, and `ended` is called then, once; null, with `ended` not called,
 * when it was reached at once and nothing is held.
 */
export function holdPlace(
  scroller: { scrollTop: number },
  top: number,
  watch: PlaceWatch,
  ended: () => void = () => undefined
): (() => void) | null {
  const reached = (): boolean => scroller.scrollTop >= top - 1;
  scroller.scrollTop = top;
  if (reached()) return null;
  let stopped = false;
  const stops: (() => void)[] = [];
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const s of stops.splice(0)) s();
    ended();
  };
  const watching = [
    watch.resized(() => {
      if (stopped) return;
      scroller.scrollTop = top;
      if (reached()) stop();
    }),
    watch.authorMoves(stop),
    watch.later(PLACE_HOLD_MS, stop)
  ];
  if (stopped) for (const s of watching) s();
  else stops.push(...watching);
  return stop;
}

/** The window's own watch over `scroller`: its content's size, the author's input, and a timer. */
function browserWatch(scroller: HTMLElement): PlaceWatch {
  const kinds = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;
  return {
    resized: (grew) => {
      const observer = new ResizeObserver(grew);
      for (const child of Array.from(scroller.children)) observer.observe(child);
      return () => observer.disconnect();
    },
    authorMoves: (moved) => {
      for (const kind of kinds) window.addEventListener(kind, moved, { capture: true, passive: true });
      return () => {
        for (const kind of kinds) window.removeEventListener(kind, moved, { capture: true });
      };
    },
    later: (ms, done) => {
      const timer = window.setTimeout(done, ms);
      return () => window.clearTimeout(timer);
    }
  };
}

/**
 * Main and Preview each keep their own place in the open chapter (rr.2, PLAN
 * section 7, The Mode select). The three modes draw in the one scroller, the
 * centre column's `.center`, so without this a switch would leave the new
 * view wherever the old one was scrolled to: Main came back at whatever place
 * Preview was left at. Back in Main or Preview, the page is where the author
 * left it, held there while the page grows back to its height (`holdPlace`);
 * a mode not shown yet in this chapter starts at its top, and so does Full
 * edit every time, as its box opens afresh; another chapter forgets them all
 * (`modePlace`). The place is put back at once, before the frame is painted,
 * not animated (`state/scroll.ts`): it is a view coming back, not a move the
 * author asked for.
 */
export function useModePlaces(mode: Mode, chapter: string | null): ModePlaceProps {
  const scroller = useRef<HTMLElement | null>(null);
  const places = useRef<ModePlaces>({ chapter, mode, tops: {} });
  /** True while a place is held: the scroller's own moves then say nothing of where the author is. */
  const holding = useRef(false);

  useLayoutEffect(() => {
    const next = modePlace(places.current, chapter, mode);
    places.current = next.places;
    const element = scroller.current;
    if (next.top === null || !element) return;
    holding.current = true;
    const stop = holdPlace(element, next.top, browserWatch(element), () => {
      holding.current = false;
    });
    if (!stop) holding.current = false;
    return stop ?? undefined;
  }, [mode, chapter]);

  const ref = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    if (holding.current) return;
    places.current.tops[places.current.mode] = event.currentTarget.scrollTop;
  }, []);
  return useMemo(() => ({ ref, onScroll }), [ref, onScroll]);
}
