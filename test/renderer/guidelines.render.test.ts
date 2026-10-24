import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuidelinesButtons, GuidelinesRow } from '../../src/renderer/components/Guidelines';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { GuidelinesStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import { STYLE_SHEET_EMPTY } from '../../src/shared/ui/guidelines';

/* setup.10b and polish.3: the guidelines file in Review with AI and
   Settings, rendered with react-dom/server. Each has Open and Open folder
   for it (polish.3, which took the place of Open in Obsidian), and Review
   with AI says while the style sheet is still empty what the reviewer may
   "fix" without it. Effects do not run here, so nothing is called; which
   call each button makes is checked by calling the buttons' own click
   handlers, and the calls themselves in the dialogs' source in
   test/renderer/guidelines.test.ts. This file is type-checked with the
   renderer's project (tsconfig.web.json). */

const FILE = 'C:\\Vault\\Novel\\GUIDELINES.md';

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Each button as `label [disabled] {title}`, in order. */
function buttons(html: string): string[] {
  return [...decode(html).matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attrs = '', label]) => {
    const title = /title="([^"]*)"/.exec(attrs)?.[1];
    return `${label}${/ disabled=""/.test(attrs) ? ' [disabled]' : ''}${title ? ` {${title}}` : ''}`;
  });
}

const untitled = (list: string[]): string[] => list.map((b) => b.replace(/ \{.*\}$/, ''));

function row(path: string | null, status: GuidelinesStatus | null): string {
  return renderToStaticMarkup(
    createElement(GuidelinesRow, { path, status, onOpen: () => undefined, onOpenFolder: () => undefined })
  );
}

const status = (styleSheet: GuidelinesStatus['styleSheet'], exists = true): GuidelinesStatus => ({
  path: FILE,
  exists,
  styleSheet
});

describe("Review with AI's Guidelines row", () => {
  it('shows the file with Open and Open folder, and the note while the style sheet is blank', () => {
    const html = row(FILE, status('blank'));
    expect(decode(html)).toContain(
      '<div class="modal__warn" role="note" data-testid="style-sheet-note"><span>Your style sheet is still empty: spelling variant, character names, invented words. Without it the reviewer may "fix" them.</span></div>'
    );
    expect(decode(html)).toContain(`<span class="modal__path" title="${FILE}">${FILE}</span>`);
    expect(buttons(html)).toEqual([
      'Open {Open GUIDELINES.md in the app this computer uses for .md files.}',
      'Open folder {Open the folder that holds GUIDELINES.md, with the file selected.}'
    ]);
    expect(html).not.toMatch(/obsidian/i);
  });

  it('shows the note for a file the review has still to make from the template', () => {
    expect(decode(row(FILE, status('missing', false)))).toContain(STYLE_SHEET_EMPTY);
  });

  it('shows no note once the style sheet is filled, for a file with none of its own, or before the status is read', () => {
    for (const html of [row(FILE, status('filled')), row(FILE, status('missing')), row(FILE, null)]) {
      expect(html).not.toContain('style-sheet-note');
      expect(buttons(html)).toHaveLength(2);
    }
  });

  it('disables both buttons with no manuscript folder, and offers both for a .txt file', () => {
    const none = row(null, { path: null, exists: false, styleSheet: 'missing' });
    expect(decode(none)).toContain('>choose a manuscript folder first</span>');
    expect(none).not.toContain('style-sheet-note');
    expect(buttons(none)).toEqual(['Open [disabled]', 'Open folder [disabled]']);

    const txt = row('C:\\Vault\\Novel\\GUIDELINES.txt', null);
    expect(buttons(txt)).toEqual([
      'Open {Open GUIDELINES.txt in the app this computer uses for .txt files.}',
      'Open folder {Open the folder that holds GUIDELINES.txt, with the file selected.}'
    ]);
  });
});

describe('what each button asks for', () => {
  /** The buttons' elements, from the component's own output, without a DOM. */
  function clickAll(path: string | null): string[] {
    const calls: string[] = [];
    const element = GuidelinesButtons({
      path,
      onOpen: () => calls.push('open'),
      onOpenFolder: () => calls.push('open folder')
    });
    const children = (element.props as { children: ReactNode }).children;
    for (const child of [children].flat()) {
      if (!isValidElement(child)) continue;
      const props = (child as ReactElement<{ onClick?: () => void; disabled?: boolean }>).props;
      if (!props.disabled) props.onClick?.();
    }
    return calls;
  }

  it('Open asks for the file, Open folder for its folder, and a disabled button for nothing', () => {
    expect(clickAll(FILE)).toEqual(['open', 'open folder']);
    expect(clickAll('C:\\Vault\\GUIDELINES.txt')).toEqual(['open', 'open folder']);
    expect(clickAll(null)).toEqual([]);
  });

  it("puts a row's own buttons, as Settings' Change, before the two", () => {
    const html = renderToStaticMarkup(
      createElement(
        GuidelinesButtons,
        { path: FILE, onOpen: () => undefined, onOpenFolder: () => undefined },
        createElement('button', { type: 'button' }, 'Change')
      )
    );
    expect(untitled(buttons(html))).toEqual(['Change', 'Open', 'Open folder']);
  });
});

describe('the dialogs', () => {
  const review: Review = {
    version: 1,
    id: 'chapter-01--2026-10-18T10-00-00-000Z',
    sourcePath: 'C:/Vault/Novel/Chapter 01.md',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    base: { text: 'One paragraph.', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    generator: { kind: 'manual' },
    hunks: [],
    comments: []
  };

  it('Review with AI has the row, with both buttons disabled until the path is read', () => {
    const html = renderToStaticMarkup(
      createElement(ReviewDialog, {
        review,
        settings: { ...DEFAULT_SETTINGS, provider: 'openai' },
        models: {},
        modelsLoading: {},
        runtimes: {},
        keyStatus: null,
        history: [],
        reviewPath: null,
        unsavedDecisions: 0,
        saving: false,
        onSaveThenStart: () => undefined,
        onStartWithout: () => undefined,
        onApplySettings: () => undefined,
        onNeedModels: () => undefined,
        onOpenSettings: () => undefined,
        onCheckClaude: () => undefined,
        checking: false,
        claudeLastFailure: null,
        onOpenSetup: () => undefined,
        onStart: () => undefined,
        onClose: () => undefined
      })
    );
    expect(decode(html)).toContain('<span>Guidelines</span>');
    expect(buttons(html)).toEqual(expect.arrayContaining(['Open [disabled]', 'Open folder [disabled]']));
    expect(html).not.toContain('Open in Obsidian');
  });

  it('Settings has Change, Open and Open folder on the guidelines file row, and no row under it', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        models: [],
        runtime: null,
        keyStatus: null,
        onApply: () => undefined,
        onKeyChanged: () => undefined,
        onClose: () => undefined,
        onOpenSetup: () => undefined,
        chatgpt: null,
        chatgptWaiting: false,
        onOpenChatGptSetup: () => undefined,
        onShowWelcome: () => undefined,
        onAbout: () => undefined
      })
    );
    expect(html).not.toContain('Open in Obsidian');
    expect(html).not.toContain('Open guidelines file');
    // The row's buttons, after its name and its path, up to its (?) at the end of the row (polish.15).
    const rowButtons =
      /<span>Guidelines file<\/span>[\s\S]*?<span class="modal__buttons">([\s\S]*?)<\/span><span class="modal__help">/.exec(
        decode(html)
      )?.[1];
    expect(rowButtons).toBeDefined();
    expect(untitled(buttons(rowButtons ?? ''))).toEqual([
      'Change',
      'Open [disabled]',
      'Open folder [disabled]'
    ]);
    // The row of its own that held Open in Obsidian under the path (setup.10b) is gone.
    expect(html).not.toContain('<div class="modal__row"><span></span><span></span>');
  });
});
