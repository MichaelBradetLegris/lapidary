import { MERGE_MARKERS_CARD, mergeMarkersCard, mergeMarkersText } from '../../shared/text/sync';
import { useApp } from './store';

/**
 * The merge markers card for a chapter's text just read (files.11): shown,
 * as a warning, when the chapter opens with markers or a reload brings them,
 * and closed once the text read has none (`mergeMarkersCard`). `before` is
 * the text on screen until now, null when the chapter has just opened;
 * `chapter` is its path or file name. The chapter is shown as it is either
 * way: nothing in it is hidden or changed.
 */
export function noteMergeMarkers(before: string | null, after: string, chapter: string): void {
  const state = useApp.getState();
  const change = mergeMarkersCard(before, after);
  if (change === 'show') state.notify('warn', mergeMarkersText(chapter), MERGE_MARKERS_CARD);
  else if (change === 'close') state.dismissNotificationsByKey(MERGE_MARKERS_CARD);
}
