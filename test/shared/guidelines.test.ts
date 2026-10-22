import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GuidelinesStatus } from '../../src/shared/ipc';
import { styleSheetStatus } from '../../src/shared/prompt/guidelines';
import {
  OPEN_FOLDER,
  OPEN_GUIDELINES,
  STYLE_SHEET_EMPTY,
  openFolderTitle,
  openGuidelinesTitle,
  openedGuidelinesNote,
  styleSheetNote
} from '../../src/shared/ui/guidelines';

/* setup.10: is the style sheet in GUIDELINES.md filled in? */

const TEMPLATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'GUIDELINES.default.md'),
  'utf8'
);

const SHEET = `# Editing guidelines

Some rules.

## Style sheet

Fill this in before your first review and keep it current. The editor follows it over its own defaults.

- Spelling variant: (US or UK)
- Oxford comma: (yes or no)
- Character names and how they are spelled:
`;

describe('styleSheetStatus', () => {
  it('calls the shipped template blank', () => {
    expect(styleSheetStatus(TEMPLATE)).toBe('blank');
    expect(styleSheetStatus(SHEET)).toBe('blank');
    expect(styleSheetStatus(SHEET.replace(/\n/g, '\r\n'))).toBe('blank');
  });

  it('calls it filled once one entry has a value', () => {
    expect(styleSheetStatus(SHEET.replace('(US or UK)', 'UK'))).toBe('filled');
    expect(styleSheetStatus(SHEET.replace('spelled:', 'spelled: Mara, Tobias'))).toBe('filled');
  });

  it('counts what the author adds under an entry, or in their own words', () => {
    expect(styleSheetStatus(`${SHEET}  - Mara (never Marah)\n`)).toBe('filled');
    expect(styleSheetStatus(`${SHEET}\nKeep "grey", never "gray".\n`)).toBe('filled');
    expect(styleSheetStatus(`${SHEET}- \n- (anything else)\n`)).toBe('blank');
  });

  it('stops at the next section', () => {
    expect(styleSheetStatus(`${SHEET}\n## Notes\n\nUK spelling.\n`)).toBe('blank');
    expect(styleSheetStatus(`${SHEET}\n### Names\n`)).toBe('filled');
  });

  it('calls a file with no style sheet section missing', () => {
    expect(styleSheetStatus('# My rules\n\n- Be gentle.\n')).toBe('missing');
    expect(styleSheetStatus('')).toBe('missing');
    expect(styleSheetStatus('## Style Sheet\n- Spelling variant: UK\n')).toBe('filled');
  });
});

/* setup.10b: what Review with AI and Settings say about the guidelines file. */

describe('styleSheetNote', () => {
  const at = (patch: Partial<GuidelinesStatus>): GuidelinesStatus => ({
    path: 'C:/Vault/Novel/GUIDELINES.md',
    exists: true,
    styleSheet: 'blank',
    ...patch
  });

  it('says the style sheet is still empty while it is blank, in the words of the task', () => {
    expect(STYLE_SHEET_EMPTY).toBe(
      'Your style sheet is still empty: spelling variant, character names, invented words. Without it the reviewer may "fix" them.'
    );
    expect(styleSheetNote(at({}))).toBe(STYLE_SHEET_EMPTY);
  });

  it('says it of a file the review has still to create from the template, whose style sheet is blank', () => {
    expect(styleSheetStatus(TEMPLATE)).toBe('blank');
    expect(styleSheetNote(at({ exists: false, styleSheet: 'missing' }))).toBe(STYLE_SHEET_EMPTY);
  });

  it("says nothing once it is filled, for the author's own file with no style sheet, or with no folder or no status", () => {
    expect(styleSheetNote(at({ styleSheet: 'filled' }))).toBeNull();
    expect(styleSheetNote(at({ styleSheet: 'missing' }))).toBeNull();
    expect(styleSheetNote({ path: null, exists: false, styleSheet: 'missing' })).toBeNull();
    expect(styleSheetNote(null)).toBeNull();
  });
});

/* polish.3: Open and Open folder, in Review with AI, Settings and the welcome guide. */

describe('Open and Open folder', () => {
  it('are named as the author asked', () => {
    expect(OPEN_GUIDELINES).toBe('Open');
    expect(OPEN_FOLDER).toBe('Open folder');
  });

  it("says in Open's tooltip that the file opens in the system's app for its type, never naming Obsidian", () => {
    expect(openGuidelinesTitle('C:\\Vault\\GUIDELINES.md')).toBe(
      'Open GUIDELINES.md in the app this computer uses for .md files.'
    );
    expect(openGuidelinesTitle('/v/Rules.TXT')).toBe(
      'Open Rules.TXT in the app this computer uses for .txt files.'
    );
    expect(openGuidelinesTitle('/v/RULES')).toBe('Open RULES in the app this computer uses for it.');
    expect(openGuidelinesTitle('/v/House style.md', true)).toBe(
      'Create House style.md from the template, then open it in the app this computer uses for .md files.'
    );
    expect(openGuidelinesTitle(null)).toBeUndefined();
    expect(openGuidelinesTitle(null, true)).toBeUndefined();
    for (const file of ['C:\\Vault\\GUIDELINES.md', '/v/GUIDELINES.txt']) {
      expect(openGuidelinesTitle(file)).not.toMatch(/obsidian/i);
    }
  });

  it("says in Open folder's tooltip that the folder opens with the file selected", () => {
    expect(openFolderTitle('C:\\Vault\\GUIDELINES.md')).toBe(
      'Open the folder that holds GUIDELINES.md, with the file selected.'
    );
    expect(openFolderTitle('/v/GUIDELINES.md', true)).toBe(
      'Create GUIDELINES.md from the template, then open its folder with the file selected.'
    );
    expect(openFolderTitle(null)).toBeUndefined();
  });

  it('words the note after Open, and for a file just created from the template', () => {
    const file = 'C:\\Vault\\GUIDELINES.md';
    expect(openedGuidelinesNote({ path: file, created: false })).toBe('Opened C:\\Vault\\GUIDELINES.md.');
    expect(openedGuidelinesNote({ path: file, created: true })).toBe(
      'Created C:\\Vault\\GUIDELINES.md from the template and opened it.'
    );
  });
});
