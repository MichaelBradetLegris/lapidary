import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* setup.10b and polish.3: when Review with AI reads whether the style sheet
   is still empty, and what each dialog asks main for when Open or Open
   folder is pressed. Effects and handlers need a DOM, which these tests run
   without, so they are checked in the source; what the dialogs show is
   rendered in test/renderer/guidelines.render.test.ts. */

describe("the dialogs' calls", () => {
  const RENDERER = path.join(__dirname, '../../src/renderer/components');
  const source = (file: string): string => readFileSync(path.join(RENDERER, file), 'utf8');

  it('Review with AI reads the status as it opens, after Open or Open folder and when the window gets the focus back', () => {
    const dialog = source('ReviewDialog.tsx');
    expect(dialog).toContain(
      "call('guidelines:status', undefined).then(setGuidelines, () => setGuidelines(null));"
    );
    expect(dialog).toContain("window.addEventListener('focus', readGuidelines);");
    expect(dialog).toContain("return () => window.removeEventListener('focus', readGuidelines);");
    expect(dialog).toMatch(/call\('guidelines:open', undefined\)\.then\(\s*\(\) => readGuidelines\(\),/);
    expect(dialog).toMatch(
      /call\('shell:reveal', \{ target: 'guidelines' \}\)\.then\(\s*\(\) => readGuidelines\(\),/
    );
    expect(dialog).toMatch(
      /<GuidelinesRow\s+path=\{paths\?\.guidelinesPath \?\? null\}\s+status=\{guidelines\}\s+onOpen=\{openGuidelines\}\s+onOpenFolder=\{openGuidelinesFolder\}\s+\/>/
    );
  });

  it('Settings sends nothing but which button, says what Open did, and shows the folder through shell:reveal', () => {
    const settings = source('SettingsDialog.tsx');
    expect(settings).toContain("call('guidelines:open', undefined)");
    expect(settings).toContain('setNote(openedGuidelinesNote(result));');
    expect(settings).toContain("onOpenFolder={() => reveal('guidelines')}");
    expect(settings).toMatch(/call\('shell:reveal', \{ target \}\)/);
  });

  it('no dialog names Obsidian as a way to open the file', () => {
    for (const file of ['ReviewDialog.tsx', 'SettingsDialog.tsx', 'WelcomeScreen.tsx', 'Guidelines.tsx']) {
      expect(source(file), file).not.toMatch(/'obsidian'|obsidian:\/\/|OPEN_IN_OBSIDIAN/);
    }
  });
});
