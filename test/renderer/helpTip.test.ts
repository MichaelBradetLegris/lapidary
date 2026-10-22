import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* polish.4: the (?) beside a row in Settings (HelpTip) and the box's head and
   foot. Its handlers and effects need a DOM, which these tests run without,
   so they are checked in the source; what it renders is in
   settingsDialog.render.test.ts, and the window check in PLAN (polish.4)
   showed the card on hover and on keyboard focus, the pointer crossing onto
   it, and Escape closing Settings from it. */

const SRC = path.join(__dirname, '../../src/renderer');
const HELP = readFileSync(path.join(SRC, 'components/HelpTip.tsx'), 'utf8');
const SETTINGS = readFileSync(path.join(SRC, 'components/SettingsDialog.tsx'), 'utf8');
const CSS = readFileSync(path.join(SRC, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration made for exactly this selector, across app.css. */
function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('the (?) (polish.4)', () => {
  it('shows its card while hovered or while the keyboard has put the focus on it, not after a click', () => {
    expect(HELP).toContain('const open = hovered || keyFocus;');
    expect(HELP).toContain("onFocus={(event) => setKeyFocus(event.currentTarget.matches(':focus-visible'))}");
    expect(HELP).toContain('onBlur={() => setKeyFocus(false)}');
    expect(HELP).not.toMatch(/onClick=/);
  });

  it('lets the pointer cross onto the card: leaving waits, and entering either cancels the wait', () => {
    expect(HELP).toContain('const LEAVE_DELAY_MS = 150;');
    const button = HELP.slice(HELP.indexOf('<button'), HELP.indexOf('</button>'));
    const card = HELP.slice(HELP.indexOf('<span\n        role="tooltip"'), HELP.indexOf('</span>'));
    for (const part of [button, card]) {
      expect(part).toContain('onMouseEnter={enter}');
      expect(part).toContain('onMouseLeave={leave}');
    }
    expect(HELP).toMatch(/const enter = \(\): void => \{\s*cancelLeave\(\);\s*setHovered\(true\);/);
  });

  it('keeps the card in the page, hidden until shown, as the description of the (?)', () => {
    expect(HELP).toContain('aria-describedby={id}');
    expect(HELP).toContain('hidden={!open}');
    expect(HELP).toMatch(/role="tooltip"\s+id=\{id\}/);
  });

  it("places the card under the (?), its left edge under the (?)'s, and again on any scroll or resize", () => {
    expect(HELP).toMatch(/placeTooltip\([\s\S]*?6,\s*8,\s*'start'\s*\)/);
    expect(HELP).toContain("window.addEventListener('scroll', place, true);");
    expect(HELP).toContain("window.addEventListener('resize', place);");
    expect(HELP).toContain("window.removeEventListener('scroll', place, true);");
    const tip = declsFor('.help__tip');
    expect(tip.get('position')).toBe('fixed');
    expect(Number(tip.get('z-index'))).toBeGreaterThan(Number(declsFor('.settings__foot').get('z-index')));
  });

  /* polish.4 review: with the keyboard's focus on a (?), Page Down or the
     wheel scrolled it under the head, and its card followed it over the
     title. insideBand itself is tested in test/shared/ui.test.ts. */
  it('hides its card, still open, while the box has scrolled the (?) out of the band between the head and the foot', () => {
    // The band: from the bottom of the box's head to the top of its foot, or the box's own edges.
    const band = HELP.slice(HELP.indexOf('function visibleBand('), HELP.indexOf('interface Props'));
    expect(band).toContain("const box = button.closest('.modal');");
    expect(band).toContain("box.querySelector('.settings__head')?.getBoundingClientRect()");
    expect(band).toContain("box.querySelector('.settings__foot')?.getBoundingClientRect()");
    expect(band).toContain('top: head ? head.bottom : edges.top, bottom: foot ? foot.top : edges.bottom');
    // Every placing, the first and each one a scroll or a resize asks for, checks it first.
    const place = HELP.slice(HELP.indexOf('const place = (): void => {'), HELP.indexOf('place();'));
    const hide = place.indexOf("tip.style.visibility = 'hidden';");
    const show = place.indexOf("tip.style.visibility = '';");
    expect(place).toMatch(
      /const band = visibleBand\(button\);\s*if \(band && !insideBand\(at, band\)\) \{\s*tip\.style\.visibility = 'hidden';\s*return;\s*\}/
    );
    expect(hide).toBeGreaterThan(0);
    expect(show).toBeGreaterThan(hide);
    expect(show).toBeLessThan(place.indexOf('placeTooltip('));
    // Hidden by its style alone, so it stays open and the next scroll can show it again.
    expect(place).not.toMatch(/set(Hovered|KeyFocus)\(/);
  });
});

describe("Settings' head and foot (polish.4)", () => {
  it('stay in view while the box scrolls, on the panel colour, and the box is still the scroller', () => {
    const head = declsFor('.settings__head');
    const foot = declsFor('.settings__foot');
    expect(head.get('position')).toBe('sticky');
    expect(head.get('top')).toBe('0');
    expect(foot.get('position')).toBe('sticky');
    expect(foot.get('bottom')).toBe('0');
    for (const part of [head, foot]) expect(part.get('background')).toBe('var(--panel)');
    // The box, which takes the focus as it opens, scrolls, so the arrow keys and Page Down scroll it (ui.1).
    expect(declsFor('.modal').get('overflow')).toBe('auto');
    const box = declsFor('.modal--settings');
    expect(box.get('padding')).toBe('0 18px');
    expect(box.has('overflow')).toBe(false);
  });

  it('keeps a control the keyboard moves to clear of them, by their measured height', () => {
    // The starting values, for the head with no message and the foot.
    const box = declsFor('.modal--settings');
    expect(parseInt(box.get('scroll-padding-top') ?? '0', 10)).toBeGreaterThanOrEqual(48);
    expect(parseInt(box.get('scroll-padding-bottom') ?? '0', 10)).toBeGreaterThanOrEqual(60);
    /* polish.4 review: the head grows with a message, so the padding is set
       from the head's and the foot's measured height, again whenever either
       changes size. */
    expect(SETTINGS).toContain('<div className="settings__head" ref={headRef}>');
    expect(SETTINGS).toContain('<div className="modal__actions settings__foot" ref={footRef}>');
    expect(SETTINGS).toContain('const STICKY_CLEARANCE_PX = 8;');
    const effect = SETTINGS.slice(SETTINGS.indexOf('useLayoutEffect(() => {'));
    const fit = effect.slice(0, effect.indexOf('}, []);'));
    expect(fit).toContain('box.style.scrollPaddingTop = `${head.offsetHeight + STICKY_CLEARANCE_PX}px`;');
    expect(fit).toContain('box.style.scrollPaddingBottom = `${foot.offsetHeight + STICKY_CLEARANCE_PX}px`;');
    expect(fit).toMatch(/\};\s*fit\(\);\s*const observer = new ResizeObserver\(fit\);/);
    expect(fit).toContain('observer.observe(head);');
    expect(fit).toContain('observer.observe(foot);');
    expect(fit).toContain('return () => observer.disconnect();');
  });
});
