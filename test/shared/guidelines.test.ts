import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GuidelinesStatus } from '../../src/shared/ipc';
import { styleSheetStatus } from '../../src/shared/prompt/guidelines';
import {
  OPEN_IN_OBSIDIAN,
  STYLE_SHEET_EMPTY,
  canOpenInObsidian,
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

describe('the two ways to open the guidelines file', () => {
  it('offers Open in Obsidian for a .md file only', () => {
    expect(OPEN_IN_OBSIDIAN).toBe('Open in Obsidian');
    expect(canOpenInObsidian('C:\\Vault\\GUIDELINES.md')).toBe(true);
    expect(canOpenInObsidian('C:\\Vault\\GUIDELINES.txt')).toBe(false);
    expect(canOpenInObsidian(null)).toBe(false);
  });

  it('says in each tooltip where the file opens', () => {
    expect(openGuidelinesTitle('C:\\Vault\\GUIDELINES.md', 'obsidian')).toBe(
      'Open GUIDELINES.md in Obsidian, in the vault that holds it.'
    );
    expect(openGuidelinesTitle('/v/House style.txt', 'obsidian')).toBe(
      'Obsidian opens .md files, and House style.txt is not one.'
    );
    expect(openGuidelinesTitle('C:\\Vault\\GUIDELINES.md', 'default')).toBe(
      'Open GUIDELINES.md in the app this computer uses for .md files.'
    );
    expect(openGuidelinesTitle('/v/Rules.TXT', 'default')).toBe(
      'Open Rules.TXT in the app this computer uses for .txt files.'
    );
    expect(openGuidelinesTitle(null, 'obsidian')).toBeUndefined();
    expect(openGuidelinesTitle(null, 'default')).toBeUndefined();
  });

  it("words Settings' note for each way, and for a file just created from the template", () => {
    const file = 'C:\\Vault\\GUIDELINES.md';
    expect(openedGuidelinesNote({ path: file, created: false }, 'obsidian')).toBe(
      'Asked Obsidian to open C:\\Vault\\GUIDELINES.md.'
    );
    expect(openedGuidelinesNote({ path: file, created: true }, 'obsidian')).toBe(
      'Created C:\\Vault\\GUIDELINES.md from the template and asked Obsidian to open it.'
    );
    expect(openedGuidelinesNote({ path: file, created: false }, 'default')).toBe(
      'Opened C:\\Vault\\GUIDELINES.md.'
    );
    expect(openedGuidelinesNote({ path: file, created: true }, 'default')).toBe(
      'Created C:\\Vault\\GUIDELINES.md from the template.'
    );
  });
});
