import { BARE_CRASH_TEXT, CRASH_TITLE, RELOAD_WINDOW } from '../shared/ui/crash';

const BARE_ID = 'bare-crash';

/**
 * The last resort (hardening.4): when even the page the error boundary shows
 * could not be drawn, React has taken everything off the window (its
 * `onUncaughtError`). This puts a heading, a line and Reload window over the
 * empty window with plain DOM, outside React's root, once.
 */
export function showBareFallback(doc: Document, onReload: () => void): void {
  if (doc.getElementById(BARE_ID)) return;
  const box = doc.createElement('div');
  box.id = BARE_ID;
  box.className = 'bare-crash';
  box.setAttribute('role', 'alert');
  const title = doc.createElement('h1');
  title.textContent = CRASH_TITLE;
  const line = doc.createElement('p');
  line.textContent = BARE_CRASH_TEXT;
  const reload = doc.createElement('button');
  reload.type = 'button';
  reload.className = 'primary';
  reload.textContent = RELOAD_WINDOW;
  reload.addEventListener('click', onReload);
  box.append(title, line, reload);
  doc.body.append(box);
  reload.focus();
}
