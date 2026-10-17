/**
 * Zoom for the whole window (round 5), for reading from further back than
 * arm's length. Everything scales together, prose and controls alike, the way a
 * browser's zoom does. The main process applies it and keeps it in settings;
 * this module only knows the steps.
 */

/** The levels Ctrl+plus and Ctrl+minus walk through, as factors of normal size. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const DEFAULT_ZOOM = 1;

export type ZoomAction = 'in' | 'out' | 'reset';

/** The step closest to any number, so a hand-edited settings file cannot set 7x. */
export function normalizeZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_ZOOM;
  let best: number = DEFAULT_ZOOM;
  for (const step of ZOOM_STEPS) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  }
  return best;
}

/** The next level in a direction; stays put at either end. */
export function nextZoom(current: number, action: ZoomAction): number {
  if (action === 'reset') return DEFAULT_ZOOM;
  const at = ZOOM_STEPS.indexOf(normalizeZoom(current) as (typeof ZOOM_STEPS)[number]);
  const next = action === 'in' ? Math.min(ZOOM_STEPS.length - 1, at + 1) : Math.max(0, at - 1);
  return ZOOM_STEPS[next] ?? DEFAULT_ZOOM;
}

/** "125%". */
export function zoomLabel(zoom: number): string {
  return `${Math.round(normalizeZoom(zoom) * 100)}%`;
}

export function canZoom(current: number, action: Exclude<ZoomAction, 'reset'>): boolean {
  return nextZoom(current, action) !== normalizeZoom(current);
}
