import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* setup.10b: when Review with AI reads whether the style sheet is still
   empty, and which way each dialog asks main to open the guidelines file.
   Effects and handlers need a DOM, which these tests run without, so they are
   checked in the source; what the dialogs show is rendered in
   test/renderer/guidelines.render.test.ts. */

describe("the dialogs' calls", () => {
  const RENDERER = path.join(__dirname, '../../src/renderer/components');
  const source = (file: string): string => readFileSync(path.join(RENDERER, file), 'utf8');

  it('Review with AI reads the status as it opens, after an open and when the window gets the focus back', () => {
    const dialog = source('ReviewDialog.tsx');
    expect(dialog).toContain(
      "call('guidelines:status', undefined).then(setGuidelines, () => setGuidelines(null));"
    );
    expect(dialog).toContain("window.addEventListener('focus', readGuidelines);");
    expect(dialog).toContain("return () => window.removeEventListener('focus', readGuidelines);");
    expect(dialog).toMatch(/call\('guidelines:open', \{ via \}\)\.then\(\s*\(\) => readGuidelines\(\),/);
    expect(dialog).toContain(
      '<GuidelinesRow path={paths?.guidelinesPath ?? null} status={guidelines} onOpen={openGuidelines} />'
    );
  });

  it('Settings passes the way on and says what it did', () => {
    const settings = source('SettingsDialog.tsx');
    expect(settings).toContain("call('guidelines:open', { via })");
    expect(settings).toContain('setNote(openedGuidelinesNote(result, via));');
  });
});
