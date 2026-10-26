import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL_SCREEN_CLASS } from '../../src/shared/ui/fullScreen';

/* polish.23: F11 and Escape in the keyboard bindings, and the page's class
   for full screen, checked in their source since the tests run without a DOM.
   The button, the legend, what takes Escape first and the page's store are in
   fullScreen.render.test.ts; main's half is test/main/fullScreen.test.ts. */

describe('the keys, in the keyboard bindings (polish.23)', () => {
  const source = readFileSync(path.join(__dirname, '../../src/renderer/state/keyboard.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const at = (text: string): number => {
    const index = code.indexOf(text);
    expect(index, text).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('toggles on F11 before anything that leaves a key to a text box, a dialog or Main', () => {
    const f11 = at('const toggle = fullScreenToggle(event);');
    expect(code).toMatch(
      /if \(toggle !== 'pass'\) \{\s*event\.preventDefault\(\);\s*if \(toggle === 'toggle'\) toggleFullScreen\(\);\s*return;\s*\}/
    );
    expect(f11).toBeGreaterThan(at('const shortcut = saveShortcutAction('));
    expect(f11).toBeLessThan(at("event.key.toLowerCase() === 'f'"));
    expect(f11).toBeLessThan(at('if (isTypingTarget(event.target)) return;'));
    expect(f11).toBeLessThan(at('if (!reviewKeysActive(state)) return;'));
  });

  it('leaves on Escape last, after the drawer, the suggestion editor, the find bar and the hover card', () => {
    const leave = at('leaveFullScreen();');
    const rule = at('escapeLeavesFullScreen(event, inFullScreen, escapeTakers(state))');
    expect(rule).toBeLessThan(leave);
    for (const before of ['state.closeEditor();', 'state.closeFind();', 'hoverCancel();']) {
      expect(at(before), before).toBeLessThan(rule);
    }
    expect(code.lastIndexOf('closeDrawer();')).toBeLessThan(rule);
    expect(leave).toBeLessThan(at('if (event.ctrlKey || event.metaKey || event.altKey) return;'));
    expect(code.slice(leave, leave + 80)).toMatch(
      /^leaveFullScreen\(\);\s*event\.preventDefault\(\);\s*return;/
    );
  });

  it('closes a hover card on Escape when nothing above took the key', () => {
    const hover = at('const hoverEscape =');
    const rule = code.slice(hover, at('hoverCancel();'));
    expect(rule).toContain("event.key === 'Escape'");
    expect(rule).toContain('state.hoveredHunkId !== null');
    expect(rule).toContain('!isModalOpen(state)');
    expect(rule).toContain('!event.defaultPrevented');
    expect(rule).toContain('!popupTakesEscape()');
  });
});

describe("the page's class (polish.23)", () => {
  const app = readFileSync(path.join(__dirname, '../../src/renderer/App.tsx'), 'utf8');

  it('is on every layout of the shell while main says the window is in full screen', () => {
    expect(app).toContain('useEffect(() => installFullScreen(), []);');
    expect(app).toContain('const fullScreen = useFullScreen((s) => s.on);');
    expect(app).toContain("const shellClass = fullScreen ? `app-shell ${FULL_SCREEN_CLASS}` : 'app-shell';");
    expect(app.match(/<div className=\{shellClass\}>/g)).toHaveLength(3);
    expect(app).not.toContain('<div className="app-shell">');
    expect(FULL_SCREEN_CLASS).toBe('app-shell--full-screen');
  });

  it('changes nothing in the layout: no rule draws the page differently in full screen', () => {
    const css = readFileSync(path.join(__dirname, '../../src/renderer/styles/app.css'), 'utf8');
    expect(css).not.toContain(FULL_SCREEN_CLASS);
  });
});
