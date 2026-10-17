import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { styleSheetStatus } from '../../src/shared/prompt/guidelines';

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
