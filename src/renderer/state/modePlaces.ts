import { useCallback, useLayoutEffect, useMemo, useRef, type UIEvent } from 'react';
import { modePlace, type Mode, type ModePlaces } from '../../shared/ui/modes';

/** What the scroller takes, spread onto it: its ref, and its `onScroll`, which notes where the mode on screen is. */
export interface ModePlaceProps {
  ref: (element: HTMLElement | null) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}

/**
 * Each mode keeps its own place in the open chapter (rr.2, PLAN section 7,
 * The Mode select). Main, Full edit and Preview draw in the one scroller, the
 * centre column's `.center`, so without this a switch would leave the new view
 * wherever the old one was scrolled to: Main came back at whatever place
 * Preview was left at. Back in a mode, the page is where the author left it;
 * a mode not shown yet in this chapter starts at its top; another chapter
 * forgets them all (`modePlace`). The place is put back at once, before the
 * frame is painted, not animated (`state/scroll.ts`): it is a view coming
 * back, not a move the author asked for.
 */
export function useModePlaces(mode: Mode, chapter: string | null): ModePlaceProps {
  const scroller = useRef<HTMLElement | null>(null);
  const places = useRef<ModePlaces>({ chapter, mode, tops: {} });

  useLayoutEffect(() => {
    const next = modePlace(places.current, chapter, mode);
    places.current = next.places;
    if (next.top !== null && scroller.current) scroller.current.scrollTop = next.top;
  }, [mode, chapter]);

  const ref = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    places.current.tops[places.current.mode] = event.currentTarget.scrollTop;
  }, []);
  return useMemo(() => ({ ref, onScroll }), [ref, onScroll]);
}
