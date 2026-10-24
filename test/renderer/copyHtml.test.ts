import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY_HTML, COPY_HTML_TITLE, copiedHtmlNote } from '../../src/shared/ui/copy';

/* rr.1: Copy HTML, under Copy result in the toolbar's Actions menu, copies the
   text as it reads now as Royal Road HTML. Source checks, as the tests run
   without a DOM: the converter is tested in test/shared/royalroad.test.ts, the
   menu as drawn in toolbarMenu.render.test.ts, and the item in the window,
   against a stubbed clipboard, is in PLAN (rr.1). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const APP = read('renderer/App.tsx');
const TOOLBAR = read('renderer/components/Toolbar.tsx');

describe('Copy HTML (rr.1)', () => {
  it('has the words rr.1 gives it', () => {
    expect(COPY_HTML).toBe('Copy HTML');
    expect(copiedHtmlNote(1414)).toBe('Copied 1414 characters of HTML.');
    expect(COPY_HTML_TITLE).toBe("Copy the text as it reads now, as HTML for Royal Road's chapter editor.");
  });

  it('is the item straight under Copy result in Actions, with its tooltip, and never disabled', () => {
    const actions = TOOLBAR.slice(TOOLBAR.indexOf('label={ACTIONS_MENU}'), TOOLBAR.indexOf('ref={saveRef}'));
    const copy = actions.indexOf("{ label: 'Copy result', onSelect: onCopyResult, separated: true },");
    const html = actions.indexOf('{ label: COPY_HTML, onSelect: onCopyHtml, title: COPY_HTML_TITLE },');
    expect(copy).toBeGreaterThan(-1);
    expect(html).toBeGreaterThan(copy);
    expect(actions.slice(copy, html).match(/\{ label/g)).toHaveLength(1);
  });

  it('copies the composed text as Royal Road HTML and says how many characters, writing nothing else', () => {
    expect(APP).toMatch(
      /const copyHtml = useCallback\(\(\) => \{\s*if \(!review\) return;\s*const html = toRoyalRoadHtml\(composeReview\(review\)\);\s*navigator\.clipboard\s*\.writeText\(html\)\s*\.then\(\(\) => notify\('info', copiedHtmlNote\(html\.length\)\)\)\s*\.catch\(\(err: unknown\) => notify\('error', errorMessage\(err\)\)\);\s*\}, \[review, notify\]\);/
    );
    const toolbar = APP.slice(APP.indexOf('<Toolbar'), APP.indexOf('/>', APP.indexOf('<Toolbar')));
    expect(toolbar).toContain('onCopyHtml={copyHtml}');
  });
});
