import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.11: finding backups. Show backups in the toolbar's Actions menu (in
   the side panel's footer until polish.7) and on the save card, the Backups
   row in Settings, and main's `shell:reveal` for a chapter. These are source
   checks: the tests run without a DOM or
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
const TOOLBAR = read('renderer/components/Toolbar.tsx');
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

/* polish.7: Show backups left the side panel's footer for the toolbar's
   Actions menu, where it is the last item, after Copy result, and since rr.1
   after Export HTML. */
describe('Show backups in the Actions menu (apply.11, polish.7)', () => {
  it('is the last item of Actions, with its tooltip, after the bulk items, Copy result and Export HTML', () => {
    const actions = TOOLBAR.slice(TOOLBAR.indexOf('label={ACTIONS_MENU}'), TOOLBAR.indexOf('ref={saveRef}'));
    const order = [
      "label: 'Accept all'",
      "label: 'Dismiss all'",
      "label: 'Reset'",
      "label: 'Copy result', onSelect: onCopyResult, separated: true",
      'label: EXPORT_HTML, onSelect: onExportHtml, title: EXPORT_HTML_TITLE',
      'label: SHOW_BACKUPS, onSelect: onShowBackups, title: SHOW_BACKUPS_TITLE'
    ].map((needle) => {
      const i = actions.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The Actions menu is there while a review is on screen, as the side panel was.
    expect(TOOLBAR).toMatch(/<ToolbarMenu\s+label=\{ACTIONS_MENU\}\s+disabled=\{!review\}/);
  });

  it('leaves the side panel with no footer', () => {
    expect(SIDE_PANEL).not.toContain('side__foot');
    expect(SIDE_PANEL).not.toContain('onShowBackups');
    expect(SIDE_PANEL).not.toContain('SHOW_BACKUPS');
  });

  it('is wired in App to the chapter on screen', () => {
    const toolbar = APP.slice(APP.indexOf('<Toolbar'), APP.indexOf('/>', APP.indexOf('<Toolbar')));
    expect(toolbar).toContain('onShowBackups={() => revealBackups(review?.sourcePath)}');
    expect(APP).not.toMatch(/<SidePanel[^>]*onShowBackups/);
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

  it('gives the footer its height back: the panel is a column and the regions take the rest', () => {
    const side = declsFor('.side');
    expect(side.get('display')).toBe('flex');
    expect(side.get('flex-direction')).toBe('column');
    expect(side.get('overflow')).toBe('clip');
    const body = declsFor('.side__body');
    expect(body.get('flex')).toBe('1 1 0');
    expect(body.get('min-height')).toBe('0');
    expect(body.has('height')).toBe(false);
    expect(CSS).not.toContain('.side__foot');
    // The short window's one scroller is the body.
    const block = /@media \(height < \d+px\) \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/\.side__body \{[^}]*overflow-y: auto/);
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
  /* polish.4: the note is one short line, and apply.11's note, with the
     20-and-30-days rule, is the tooltip of the (?) at the row's right end
     (polish.15; test/renderer/settingsDialog.render.test.ts renders it). */
  it('shows the backups folder, Change, Show in folder, the (?) and the short note, after the reviews folder', () => {
    const reviews = SETTINGS.indexOf('<span>Reviews folder</span>');
    const backups = SETTINGS.indexOf('<span>Backups</span>');
    const guidelines = SETTINGS.indexOf('<span>Guidelines file</span>');
    expect(reviews).toBeGreaterThan(-1);
    expect(backups).toBeGreaterThan(reviews);
    expect(guidelines).toBeGreaterThan(backups);
    const row = SETTINGS.slice(backups, guidelines);
    expect(row).toContain(`<HelpTip id={id('backups-tip')} topic="backups" text={BACKUPS_TIP} />`);
    expect(row).toContain("{paths?.backupsFolder ?? settings.backupsFolder ?? '…'}");
    // Change, since the folder is a setting (setup.18), then Show in folder.
    expect(row).toMatch(
      /onClick=\{\(\) => pickFolder\('backupsFolder', 'Choose the backups folder'\)\}\s*>\s*Change\s*<\/button>\s*<button[\s\S]*?onClick=\{\(\) => reveal\('backups'\)\}\s*>\s*Show in folder\s*</
    );
    expect(row).toMatch(
      /<p className="modal__note" id=\{id\('backups-note'\)\}>\s*\{backupsFolderNote\(paths\?\.backupsFolderIsDefault \?\? false\)\}\s*<\/p>/
    );
  });
});

describe("main's shell:reveal for a chapter's backups (apply.11)", () => {
  it('works the folder out from the path, through chapterBackups, in the backups folder in use, before any other target', () => {
    const handler = MAIN_IPC.slice(MAIN_IPC.indexOf("handle('shell:reveal'"));
    const chapter = handler.indexOf("if (target === 'backups' && sourcePath !== undefined)");
    expect(chapter).toBeGreaterThan(-1);
    expect(chapter).toBeLessThan(handler.indexOf("if (target === 'drafts' && name !== undefined)"));
    // The folder chosen in Settings, or the data folder's (setup.18).
    expect(handler).toMatch(
      /const settings = await loadSettings\(\);\s*const shown = await chapterBackups\(backupsFolder\(settings\), sourcePath, caseInsensitiveFs\(\), \{\s*chosen: !isDefaultBackupsFolder\(settings\.backupsFolder\)\s*\}\);/
    );
    expect(handler).toContain("if (!shown) throw fail('not-found', noBackupsYet(chapterName(sourcePath)));");
    expect(handler).toContain('system.showItemInFolder(shown.newest);');
    // Settings' Show in folder and the card's Show all backups show the folder in use too.
    expect(handler).toMatch(/\} else if \(target === 'backups'\) \{\s*file = await backupsTarget\(\);/);
  });

  it('tells Settings and the welcome guide where the backups folder is, and whether it is the default', () => {
    expect(MAIN_IPC).toContain('backupsFolder: backupsFolder(settings),');
    expect(MAIN_IPC).toContain('backupsFolderIsDefault: isDefaultBackupsFolder(settings.backupsFolder)');
    expect(MAIN_IPC).toMatch(
      /function backupsFolder\(settings: Settings\): string \{\s*return resolveBackupsFolder\(settings\.backupsFolder, app\.getPath\('userData'\)\);\s*\}/
    );
  });

  it('backs up into the backups folder in use at Save to chapter, saying when it is a chosen one (setup.18)', () => {
    const save = MAIN_IPC.slice(MAIN_IPC.indexOf("handleWrite('files:save'"));
    expect(save).toMatch(
      /chapterBackupHooks\(\{\s*backupsRoot: backupsFolder\(settings\),\s*chosen: !isDefaultBackupsFolder\(settings\.backupsFolder\),\s*manuscriptFolder: settings\.manuscriptFolder,/
    );
    expect(MAIN_IPC).not.toContain('backupsRootFor');
  });

  it('makes the folder Settings shows, in words that offer another when it cannot be made (setup.18)', () => {
    expect(MAIN_IPC).toMatch(
      /async function backupsTarget\(\): Promise<string> \{\s*const folder = backupsFolder\(await loadSettings\(\)\);\s*try \{\s*await fs\.mkdir\(folder, \{ recursive: true \}\);\s*\} catch \(err\) \{\s*throw writeFailure\(err, 'folder', backupsFolderName\(folder\), \{ setting: 'backups folder' \}\);\s*\}\s*return folder;\s*\}/
    );
  });
});
