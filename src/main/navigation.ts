/**
 * What the window does when its page tries to go somewhere (PLAN 11.3,
 * `opensource.12`).
 *
 * The page is the whole app, and anything that replaced it would run with the
 * preload bridge: a stray `location.href`, a link without a target, a file dropped
 * onto the window that Chromium opens in its place. So the window stays where it
 * is. An http or https address goes to the system browser instead, and anything
 * else (file:, data:, javascript:, custom schemes) is refused.
 *
 * No electron import, so the rules are unit-tested directly.
 */

export type NavigationAction = 'allow' | 'external' | 'block';

function withoutHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/** `target` is where the page wants to go, `current` where it is now. */
export function navigationAction(target: string, current: string): NavigationAction {
  let to: URL;
  try {
    to = new URL(target);
  } catch {
    return 'block';
  }
  let from: URL | null;
  try {
    from = new URL(current);
  } catch {
    from = null;
  }
  // Reloading the app's own page, as the dev server does after an edit.
  if (from && withoutHash(to) === withoutHash(from)) return 'allow';
  if (to.protocol === 'http:' || to.protocol === 'https:') return 'external';
  return 'block';
}
