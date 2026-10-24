import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* polish.7: the toolbar's Review and Actions menus, checked in their source,
   since the tests run without a DOM: the items each menu holds, and how
   ToolbarMenu applies the keys test/shared/menu.test.ts works out. The
   toolbar as drawn is in toolbarMenu.render.test.ts, and the keyboard walk in
   the window is in PLAN (polish.7). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));
const TOOLBAR = read('components/Toolbar.tsx');
// How a menu behaves is useMenu's since polish.10, which the toolbar's menus and a chip's share.
const MENU =
  read('components/ToolbarMenu.tsx') + read('components/useMenu.ts') + read('components/MenuList.tsx');

describe("the menus' items (polish.7)", () => {
  it('gives Review an item for each provider, off while a review runs, and Manual, with the tooltip Submit manual review had', () => {
    const review = TOOLBAR.slice(
      TOOLBAR.indexOf('label={REVIEW_MENU.label}'),
      TOOLBAR.indexOf('label={ACTIONS_MENU}')
    );
    // codex.3: With AI gave way to Claude, ChatGPT and OpenAI (API key), each opening
    // Review with AI with that provider chosen, in PROVIDERS' order.
    expect(review).toMatch(
      /\.\.\.PROVIDERS\.map\(\(provider\): MenuItem => \(\{\s*label: reviewMenuLabel\(provider\),\s*onSelect: \(\) => onReviewWith\(provider\),\s*disabled: running,\s*title: running\s*\?\s*'Wait until the review that is running ends, or cancel it'\s*:\s*REVIEW_WITH_TITLES\[provider\]\s*\}\)\)/
    );
    expect(review).toMatch(
      /label: REVIEW_MENU\.manual,\s*onSelect: onManualReview,\s*title: 'Paste a corrected version of this chapter and turn the differences into suggestions',\s*separated: true/
    );
    expect(review).toContain('disabled={!review?.sourcePath || locked}');
    expect(review).not.toContain('withAi');
  });

  it('gives Actions the three bulk items, off while the chapter is read-only or a paragraph is open, then Copy result, Copy HTML and Show backups', () => {
    expect(TOOLBAR).toContain('const bulkOff = locked || editing > 0;');
    // Full edit's box is one of the drafts, and the tooltip names it (rr.2).
    expect(TOOLBAR).toMatch(
      /const bulkTitle =\s*editing > 0\s*\?\s*fullEdit\s*\?\s*FINISH_FULL_EDIT_TITLE\s*:\s*'Finish or cancel the paragraphs you are editing first'\s*:\s*undefined;/
    );
    for (const [label, action] of [
      ['Accept all', 'accept'],
      ['Dismiss all', 'dismiss'],
      ['Reset', 'reset']
    ]) {
      expect(TOOLBAR).toContain(
        `{ label: '${label}', onSelect: () => runBulk('${action}'), disabled: bulkOff, title: bulkTitle }`
      );
    }
    expect(TOOLBAR).toContain("{ label: 'Copy result', onSelect: onCopyResult, separated: true }");
    // rr.1: never disabled, as Copy result is not.
    expect(TOOLBAR).toContain('{ label: COPY_HTML, onSelect: onCopyHtml, title: COPY_HTML_TITLE }');
    expect(TOOLBAR).toContain('{ label: SHOW_BACKUPS, onSelect: onShowBackups, title: SHOW_BACKUPS_TITLE }');
  });
});

describe('ToolbarMenu behaves as a menu (polish.7)', () => {
  it('draws a menu of menu items that only the arrows reach, with a separator where an item asks for one', () => {
    expect(MENU).toMatch(
      /<div\s+ref=\{listRef\}\s+className=\{className \? `menu__list \$\{className\}` : 'menu__list'\}\s+role="menu"\s+id=\{id\}\s+aria-label=\{label\}\s+style=\{style\}\s+onKeyDown=\{onListKey\}\s+onPointerDown=\{onListPress\}\s+onContextMenu=\{\(event\) => event\.preventDefault\(\)\}\s*>/
    );
    expect(MENU).toMatch(
      /\{shown \? <MenuList id=\{listId\} label=\{label\} items=\{items\} \{\.\.\.list\} \/> : null\}/
    );
    expect(MENU).toMatch(
      /type="button"\s+role="menuitem"\s+tabIndex=\{-1\}\s+disabled=\{item\.disabled === true\}/
    );
    expect(MENU).toContain('<div className="menu__sep" role="separator" />');
    expect(MENU).toMatch(
      /aria-haspopup="menu"\s+aria-expanded=\{shown\}\s+aria-controls=\{shown \? listId : undefined\}/
    );
  });

  it('opens on the first item by a click, Enter or Space, and on the first or last by the arrows, drawn before the focus moves', () => {
    expect(MENU).toContain("onClick={() => (shown ? close(false) : openOn('first'))}");
    expect(MENU).toMatch(
      /const openOn = \(where: 'first' \| 'last'\): void => \{\s*flushSync\(\(\) => setOpen\(true\)\);\s*focusItem\(where === 'first' \? firstEnabled\(enabled\) : lastEnabled\(enabled\)\);/
    );
    expect(MENU).toMatch(
      /const where = menuButtonKey\(event\);\s*if \(where === null\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/
    );
  });

  it("keeps the keys it takes from the page's own, and lets Tab go on from the button", () => {
    const list = MENU.slice(MENU.indexOf('const onListKey'), MENU.indexOf('const onListPress'));
    const pass = list.indexOf("if (action.kind === 'pass') return;");
    const stop = list.indexOf('event.stopPropagation();');
    const leave = list.indexOf("if (action.kind === 'leave') {");
    const prevent = list.indexOf('event.preventDefault();');
    expect(pass).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(pass);
    expect(leave).toBeGreaterThan(stop);
    // Tab is not prevented: the browser moves on from the button the focus went back to.
    expect(prevent).toBeGreaterThan(leave);
    expect(list.slice(leave, prevent)).toMatch(/close\(true\);\s*return;/);
    expect(list).toMatch(
      /if \(action\.kind === 'close'\) close\(true\);\s*else if \(action\.kind === 'focus'\) focusItem\(action\.index\);/
    );
  });

  it('reads which items can be used from each item, wherever it opens or moves (polish.7 review)', () => {
    // Every item counts as usable once this reads anything else, and the menu
    // then opens on a greyed-out item and the arrows stop on one.
    expect(MENU).toContain('const enabled = enabledItems(items);');
    expect(MENU).not.toMatch(/\bconst enabled = (?!enabledItems\(items\);)/);
    expect(MENU).toMatch(
      /if \(shown\) focusItem\(where === 'first' \? firstEnabled\(enabled\) : lastEnabled\(enabled\)\);\s*else openOn\(where\);/
    );
    expect(MENU).toMatch(
      /const action = menuItemKey\(\s*event,\s*current,\s*enabled,\s*items\.map\(\(item\) => item\.label\)\s*\);/
    );
  });

  it('keeps the focus in the list on a press there, a greyed-out item, the separator or the padding included (polish.7 review)', () => {
    // Prevented on the pointerdown: Chromium sends a disabled button no mousedown.
    expect(MENU).toMatch(
      /const onListPress = \(event: React\.PointerEvent<HTMLDivElement>\): void => \{\s*event\.preventDefault\(\);\s*\};/
    );
    expect(MENU).not.toContain('onMouseDown');
    // An item still runs from its click, which puts the focus on the button.
    expect(MENU).toContain('onClick={() => run(item)}');
    expect(MENU).toMatch(/const run = \(item: MenuItem\): void => \{\s*close\(true\);\s*item\.onSelect\(\);/);
  });

  it('closes on a click outside it and when the focus goes elsewhere in the page, and with its button turned off', () => {
    expect(MENU).toMatch(
      /const onPointerDown = \(event: MouseEvent\): void => \{\s*if \(!ref\.current\?\.contains\(event\.target as Node\)\) setOpen\(false\);/
    );
    expect(MENU).toMatch(
      /const next = event\.relatedTarget;\s*if \(shown && next instanceof Node && !ref\.current\?\.contains\(next\)\) setOpen\(false\);/
    );
    expect(MENU).toContain('const shown = open && !disabled;');
  });
});
