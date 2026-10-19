import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuidelinesButtons, GuidelinesRow } from '../../src/renderer/components/Guidelines';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { GuidelinesStatus, OpenGuidelinesVia } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import { STYLE_SHEET_EMPTY } from '../../src/shared/ui/guidelines';

/* setup.10b: the guidelines file in Review with AI and Settings, rendered
   with react-dom/server. Review with AI's Guidelines row has Open in Obsidian
   and Open, and says while the style sheet is still empty what the reviewer
   may "fix" without it; Settings gains Open in Obsidian. Effects do not run
   here, so nothing is called; which call each button makes is checked by
   calling the buttons' own click handlers, and the status reads in the
   dialogs' source in test/renderer/guidelines.test.ts. This file is
   type-checked with the renderer's project (tsconfig.web.json). */

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

function row(path: string | null, status: GuidelinesStatus | null): string {
  return renderToStaticMarkup(createElement(GuidelinesRow, { path, status, onOpen: () => undefined }));
}

const status = (styleSheet: GuidelinesStatus['styleSheet'], exists = true): GuidelinesStatus => ({
  path: FILE,
  exists,
  styleSheet
});

describe("Review with AI's Guidelines row", () => {
  it('shows the file with Open in Obsidian and Open, and the note while the style sheet is blank', () => {
    const html = row(FILE, status('blank'));
    expect(decode(html)).toContain(
      '<div class="modal__warn" role="note" data-testid="style-sheet-note"><span>Your style sheet is still empty: spelling variant, character names, invented words. Without it the reviewer may "fix" them.</span></div>'
    );
    expect(decode(html)).toContain(`<span class="modal__path" title="${FILE}">${FILE}</span>`);
    expect(buttons(html)).toEqual([
      'Open in Obsidian {Open GUIDELINES.md in Obsidian, in the vault that holds it.}',
      'Open {Open GUIDELINES.md in the app this computer uses for .md files.}'
    ]);
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

  it('disables both buttons with no manuscript folder, and Open in Obsidian for a .txt file', () => {
    const none = row(null, { path: null, exists: false, styleSheet: 'missing' });
    expect(decode(none)).toContain('>choose a manuscript folder first</span>');
    expect(none).not.toContain('style-sheet-note');
    expect(buttons(none)).toEqual(['Open in Obsidian [disabled]', 'Open [disabled]']);

    const txt = row('C:\\Vault\\Novel\\GUIDELINES.txt', null);
    expect(buttons(txt)).toEqual([
      'Open in Obsidian [disabled] {Obsidian opens .md files, and GUIDELINES.txt is not one.}',
      'Open {Open GUIDELINES.txt in the app this computer uses for .txt files.}'
    ]);
  });
});

describe('which way each button opens the file', () => {
  /** The buttons' elements, from the component's own output, without a DOM. */
  function clickAll(path: string | null): OpenGuidelinesVia[] {
    const calls: OpenGuidelinesVia[] = [];
    const element = GuidelinesButtons({ path, openLabel: 'Open', onOpen: (via) => calls.push(via) });
    const children = (element.props as { children: ReactNode }).children;
    for (const child of [children].flat()) {
      if (!isValidElement(child)) continue;
      const props = (child as ReactElement<{ onClick?: () => void; disabled?: boolean }>).props;
      if (!props.disabled) props.onClick?.();
    }
    return calls;
  }

  it('asks main for Obsidian, then for the system app, and for nothing a disabled button stands for', () => {
    expect(clickAll(FILE)).toEqual(['obsidian', 'default']);
    expect(clickAll('C:\\Vault\\GUIDELINES.txt')).toEqual(['default']);
    expect(clickAll(null)).toEqual([]);
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
    expect(buttons(html)).toEqual(expect.arrayContaining(['Open in Obsidian [disabled]', 'Open [disabled]']));
  });

  it('Settings has Open in Obsidian beside Open guidelines file, on a row under Change and Show in folder', () => {
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
        onShowWelcome: () => undefined
      })
    );
    const list = buttons(html).map((b) => b.replace(/ \{.*\}$/, ''));
    const at = list.indexOf('Open in Obsidian [disabled]');
    expect(at).toBeGreaterThan(1);
    expect(list.slice(at - 2, at + 2)).toEqual([
      'Change',
      'Show in folder [disabled]',
      'Open in Obsidian [disabled]',
      'Open guidelines file [disabled]'
    ]);
  });
});
