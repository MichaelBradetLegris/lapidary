import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.11: finding backups. Show backups in the side panel's footer and on
   the save card, the Backups row in Settings, and main's `shell:reveal`
   for a chapter. These are source checks: the tests run without a DOM or
   Electron. What main finds is tested in test/main/backups.test.ts
   (`chapterBackups`), the card in test/renderer/saveChapter.test.ts, the words
   in test/shared/backups.test.ts, and the window steps are in PLAN (apply.11). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const APP = read('renderer/App.tsx');
const SIDE_PANEL = read('renderer/components/SidePanel.tsx');
const SETTINGS = read('renderer/components/SettingsDialog.tsx');
const CARDS = read('renderer/components/NotificationCards.tsx');
const MAIN_IPC = read('main/ipc.ts');
const CSS = readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration made for exactly this selector, across app.css, outside any media block too. */
function declsFor(selector: string, css = CSS): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('Show backups in the side panel (apply.11)', () => {
  it('puts the button in a footer after both regions, only when App hands it the action', () => {
    const body = SIDE_PANEL.indexOf('className="side__body"');
    const lower = SIDE_PANEL.indexOf('className="side__lower"');
    const foot = SIDE_PANEL.indexOf('className="side__foot"');
    expect(body).toBeGreaterThan(-1);
    expect(lower).toBeGreaterThan(body);
    expect(foot).toBeGreaterThan(lower);
    expect(SIDE_PANEL.lastIndexOf('</aside>')).toBeGreaterThan(foot);
    expect(SIDE_PANEL).toMatch(/\{onShowBackups \? \(\s*<div className="side__foot">/);
    expect(SIDE_PANEL).toMatch(
      /<button type="button" title=\{SHOW_BACKUPS_TITLE\} onClick=\{onShowBackups\}>\s*\{SHOW_BACKUPS\}\s*<\/button>/
    );
  });

  it('is wired in App to the chapter on screen', () => {
    // The side panel is drawn only while a chapter is open.
    expect(APP).toMatch(
      /\{review \? \(\s*<SidePanel[\s\S]*?onShowBackups=\{\(\) => revealBackups\(review\.sourcePath\)\}/
    );
    expect(APP).toContain(
      "call('shell:reveal', { target: 'backups', ...(sourcePath ? { sourcePath } : {}) })"
    );
    // A chapter with no folder at its path is told so, not shown an error, and
    // offered every chapter's backups, a renamed or moved chapter's among them.
    expect(APP).toMatch(
      /if \(err instanceof ApiError && err\.code === 'not-found'\) \{\s*notify\('info', errorMessage\(err\), SHOW_BACKUPS_CARD, 'reveal-all-backups'\);/
    );
  });

  it('closes an earlier no-backups card once a Show backups works, under the shared key', () => {
    const reveal = APP.slice(APP.indexOf('const revealBackups'), APP.indexOf('const chooseManuscriptFolder'));
    expect(reveal).toMatch(
      /call\('shell:reveal', [^\n]*\)\s*\.then\(\(\) => dismissNotificationsByKey\(SHOW_BACKUPS_CARD\)\)\s*\.catch\(/
    );
    expect(APP).not.toContain("'show-backups'");
    expect(APP).toContain("import { SHOW_BACKUPS_CARD } from '../shared/ui/backups';");
  });

  it('keeps the footer pinned: the panel is a column, the regions take the rest, and the footer never scrolls', () => {
    const side = declsFor('.side');
    expect(side.get('display')).toBe('flex');
    expect(side.get('flex-direction')).toBe('column');
    expect(side.get('overflow')).toBe('clip');
    const body = declsFor('.side__body');
    expect(body.get('flex')).toBe('1 1 0');
    expect(body.get('min-height')).toBe('0');
    // A full height would push the footer out of the clipped panel.
    expect(body.has('height')).toBe(false);
    const foot = declsFor('.side__foot');
    expect(foot.get('flex')).toBe('none');
    expect(foot.get('background')).toBe('var(--panel)');
    expect([...foot.keys()].some((p) => p.startsWith('overflow'))).toBe(false);
    // The short window's one scroller is the body, not the footer.
    const block = /@media \(height < \d+px\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/\.side__body \{[^}]*overflow-y: auto/);
    expect(block).not.toContain('.side__foot');
  });
});

describe('Show backups on the save card (apply.11)', () => {
  it('labels the button from the shared words and opens the folder of the chapter the card names', () => {
    expect(CARDS).toContain("'reveal-backups': SHOW_BACKUPS,");
    expect(CARDS).toContain('onAction(action, note.actionArg)');
    expect(APP).toMatch(/case 'reveal-backups':\s*revealBackups\(arg\);\s*break;/);
  });

  it("gives the no-backups card's Show all backups the backups root, with no chapter", () => {
    expect(CARDS).toContain("'reveal-all-backups': SHOW_ALL_BACKUPS,");
    expect(APP).toMatch(/case 'reveal-all-backups':\s*revealBackups\(\);\s*break;/);
  });
});

describe('the Backups row in Settings (apply.11)', () => {
  it('shows the backups folder, Show in folder and the note, after the reviews folder', () => {
    const reviews = SETTINGS.indexOf('<span>Reviews folder</span>');
    const backups = SETTINGS.indexOf('<span>Backups</span>');
    const guidelines = SETTINGS.indexOf('<span>Guidelines file</span>');
    expect(reviews).toBeGreaterThan(-1);
    expect(backups).toBeGreaterThan(reviews);
    expect(guidelines).toBeGreaterThan(backups);
    const row = SETTINGS.slice(backups, guidelines);
    expect(row).toContain("{paths?.backupsFolder ?? '…'}");
    expect(row).toMatch(/onClick=\{\(\) => reveal\('backups'\)\}>\s*Show in folder\s*</);
    expect(row).toContain('<p className="modal__note">{BACKUPS_NOTE}</p>');
  });
});

describe("main's shell:reveal for a chapter's backups (apply.11)", () => {
  it('works the folder out from the path, through chapterBackups, before any other target', () => {
    const handler = MAIN_IPC.slice(MAIN_IPC.indexOf("handle('shell:reveal'"));
    const chapter = handler.indexOf("if (target === 'backups' && sourcePath !== undefined)");
    expect(chapter).toBeGreaterThan(-1);
    expect(chapter).toBeLessThan(handler.indexOf("if (target === 'drafts' && name !== undefined)"));
    expect(handler).toMatch(
      /chapterBackups\(\s*backupsRootFor\(app\.getPath\('userData'\)\),\s*sourcePath,\s*caseInsensitiveFs\(\)\s*\)/
    );
    expect(handler).toContain("if (!shown) throw fail('not-found', noBackupsYet(chapterName(sourcePath)));");
    expect(handler).toContain('system.showItemInFolder(shown.newest);');
  });

  it('tells Settings where the backups root is', () => {
    expect(MAIN_IPC).toContain("backupsFolder: backupsRootFor(app.getPath('userData'))");
  });
});
