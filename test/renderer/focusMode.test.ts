import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* focus.1: focus mode's page half, checked in its source since the tests run
   without a DOM: the overlay's click, App's wiring, the keys caught first on
   the window, and the overlay's layer and colours in app.css. What the keys
   and the clock do is test/renderer/focusMode.render.test.ts, the overlay as
   drawn focusOverlay.render.test.ts, main's half test/main/fullScreen.test.ts. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

describe('the overlay closes on a click anywhere (focus.1)', () => {
  const overlay = read('components/FocusOverlay.tsx');

  it('takes the whole press, so nothing under it is clicked, and moves no focus as it is pressed', () => {
    expect(overlay).toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(overlay).toContain('onClick={resumeFocus}');
    expect(overlay).toContain('onAuxClick={resumeFocus}');
    expect(overlay).toMatch(
      /onContextMenu=\{\(event\) => \{\s*event\.preventDefault\(\);\s*resumeFocus\(\);\s*\}\}/
    );
    // Closing on the press would let the release and the click land on what is under it.
    expect(overlay).not.toMatch(/onPointerDown|onMouseUp|onPointerUp/);
  });

  it('takes the focus as it shows and hands it back as it goes', () => {
    expect(overlay).toContain('useDialogFocus(boxRef, FOCUS_OVERLAY_FOCUS_FALLBACK);');
    expect(overlay).toMatch(/<div className="modal focus-overlay" ref=\{boxRef\} tabIndex=\{-1\}>/);
  });
});

describe('App and focus mode (focus.1)', () => {
  const app = read('App.tsx');

  it('installs focus mode once', () => {
    expect(app.match(/installFocusMode\(\)/g)).toHaveLength(1);
    expect(app).toContain('useEffect(() => installFocusMode(), []);');
  });

  it('draws the overlay last in each of the three layouts, over the question', () => {
    expect(app.match(/<FocusOverlay \/>/g)).toHaveLength(3);
    // The comments are taken out first, so a JSX comment between them is left as {}.
    expect(
      app.match(
        /<ConfirmDialog inert=\{(inert|cardInert)\.over\} \/>\s*(\{\}\s*)?<FocusOverlay \/>\s*<\/div>/g
      )
    ).toHaveLength(3);
  });

  it('makes the page and the dialogs inert under it, in every layout', () => {
    expect(app).toContain('const focusOverlayOpen = useFocusOverlay((s) => s.open);');
    expect(app.match(/overlay: updateOverlayShown,\s*focus: focusOverlayOpen\s*\}\)/g)).toHaveLength(2);
  });

  /* focus.1 review: with a question open, the overlay showed over it, but
     nothing made the question inert, so a screen reader's cursor could reach
     and press "Keep for later" under the hold. */
  it("makes the question and Restart now's overlay inert under it too, in every layout", () => {
    expect(app.match(/<ConfirmDialog inert=\{inert\.over\} \/>/g)).toHaveLength(2);
    expect(app.match(/<ConfirmDialog inert=\{cardInert\.over\} \/>/g)).toHaveLength(1);
    expect(app.match(/<ConfirmDialog\b/g)).toHaveLength(3);
    expect(app).toMatch(
      /const updateOverlay = updateOverlayShown \? \(?\s*<UpdateOverlay update=\{updateStatus\} inert=\{inert\.over\} \/>\s*\)? : null;/
    );
    expect(app.match(/<UpdateOverlay\b/g)).toHaveLength(1);
    expect(app.match(/\{updateOverlay\}/g)).toHaveLength(3);
  });

  it('has a close and Restart now wait on the hold, through the close guard', () => {
    expect(app).toMatch(/cancelReview,\s*focusHold: holdToLeave\s*\}\)/);
  });
});

describe('the keys are caught first, on the window (focus.1)', () => {
  const focus = read('state/focusMode.ts');

  it('listens for key presses and releases in the capture phase, and for the window losing the focus', () => {
    expect(focus).toContain("target.addEventListener('keydown', onKeyDown, CAPTURE);");
    expect(focus).toContain("target.addEventListener('keyup', onKeyUp, CAPTURE);");
    expect(focus).toContain("target.addEventListener('blur', onBlur);");
    expect(focus).toContain('const CAPTURE = { capture: true };');
    expect(focus).toContain('export function installFocusMode(target: FocusTarget = window,');
  });

  it('keeps a key from the page by stopping it there, every other listener included', () => {
    expect(focus).toMatch(
      /function keep\(event: FocusKeyEvent\): void \{\s*event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\);\s*\}/
    );
  });

  it('sends release, the one word main takes to leave, and nothing else', () => {
    expect(focus.match(/'window:full-screen'/g)).toHaveLength(1);
    expect(focus).toContain("release: () => call('window:full-screen', { action: 'release' }),");
  });
});

describe("the overlay's layer and colours (focus.1)", () => {
  const css = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8');
  const zIndex = (selector: string): number => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return Number(/z-index: (\d+);/.exec(css.slice(at, css.indexOf('}', at)))?.[1]);
  };

  it('stands over the question and over Restart now overlay', () => {
    expect(zIndex('.modal-backdrop--focus')).toBe(50);
    expect(zIndex('.modal-backdrop--focus')).toBeGreaterThan(zIndex('.modal-backdrop--confirm'));
    expect(zIndex('.modal-backdrop--focus')).toBeGreaterThan(zIndex('.modal-backdrop--overlay'));
  });

  it('draws the ring in the lock card spinner colours, --accent on --border, which hold 3:1 and more on the box', () => {
    expect(css).toMatch(/\.focus-overlay__track \{\s*stroke: var\(--border\);\s*\}/);
    expect(css).toMatch(/\.focus-overlay__arc \{\s*stroke: var\(--accent\);\s*\}/);
    expect(css).toMatch(
      /\.lock-card__spinner \{[^}]*border: 2px solid var\(--border\);\s*border-top-color: var\(--accent\);/
    );
  });
});
