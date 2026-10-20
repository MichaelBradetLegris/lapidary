import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* files.11: source checks for what syncHygiene.render.test.ts cannot reach
   without a DOM: where App notes merge markers (Save to chapter's own call is
   run in saveChapter.test.ts), and how the conflict copy badge is styled. Its
   colours and their contrast are in themeCss.test.ts and
   themeContrast.test.ts. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const APP = readFileSync(path.join(RENDERER, 'App.tsx'), 'utf8');
const CSS = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8');

const between = (text: string, from: string, to: string): string => {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = text.indexOf(to, start);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
};

describe("App's calls (files.11)", () => {
  it('notes merge markers once a chapter has opened, from the text just read', () => {
    const open = between(APP, 'const openChapter = useCallback(', 'const openHistoryEntry');
    expect(open.match(/noteMergeMarkers\(/g)).toHaveLength(1);
    expect(open).toContain('noteMergeMarkers(null, base.text, file.name);');
    // After the chapter is on screen, in every branch, and inside the try, so
    // an open that fails leaves the card as it was.
    const at = open.indexOf('noteMergeMarkers(');
    for (const shown of [
      'setReview(\n              createReview(',
      'setReview(loaded.review, loaded.path);',
      'setReview(rebased, loaded.path);'
    ]) {
      expect(open.indexOf(shown), shown).toBeGreaterThan(-1);
      expect(open.indexOf(shown), shown).toBeLessThan(at);
    }
    expect(at).toBeLessThan(open.indexOf('} catch (err) {', open.indexOf('await marked;')));
  });

  it('notes them on a reload from disk, against the text on screen before it', () => {
    const reload = between(APP, "window.api.on('file:changed'", "window.api.on('files:invalidated'");
    expect(reload.match(/noteMergeMarkers\(/g)).toHaveLength(1);
    expect(reload.indexOf('const before = latest.base.text;')).toBeGreaterThan(-1);
    expect(reload.indexOf('const before = latest.base.text;')).toBeLessThan(
      reload.indexOf('rebaseReview(latest')
    );
    expect(reload).toContain('noteMergeMarkers(before, content.text, event.path);');
  });

  it('notes them when a review from History reads the chapter again, against the text on screen', () => {
    const history = between(
      APP,
      'const openHistoryEntry = useCallback(',
      '/* ---------------- external changes'
    );
    expect(history.match(/noteMergeMarkers\(/g)).toHaveLength(1);
    const before = history.indexOf('const before = useApp.getState().review?.base.text ?? null;');
    expect(before).toBeGreaterThan(history.indexOf("await call('files:read'"));
    // Read before the review from History replaces the one on screen.
    expect(before).toBeLessThan(history.indexOf('setReview('));
    const at = history.indexOf('noteMergeMarkers(before, base.text, sourcePath);');
    expect(at).toBeGreaterThan(history.indexOf('setReview(rebased, loaded.path);'));
    expect(at).toBeLessThan(history.indexOf('} catch (err) {'));
  });

  it('notes them nowhere else in App', () => {
    expect(APP.match(/noteMergeMarkers\(/g)).toHaveLength(3);
  });
});

describe('the conflict copy badge style (files.11)', () => {
  it('has its own tokens, on one line, cut rather than run past the row', () => {
    const rule = /\n\.badge--conflict \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toContain('background: var(--badge-conflict-bg);');
    expect(rule).toContain('border-color: var(--badge-conflict-border);');
    expect(rule).toContain('color: var(--badge-conflict-ink);');
    expect(rule).toContain('white-space: nowrap;');
    expect(rule).toContain('align-self: flex-start;');
    expect(rule).toContain('max-width: 100%;');
    expect(rule).toContain('overflow: hidden;');
    expect(rule).toContain('text-overflow: ellipsis;');
  });

  /* The files.11 review: beside the name, the badge kept its width and left the
     name "Chapt..." in the drawer at 200%; under it, the name has the row. */
  it('sits under the name, in a column that takes the row as the name does elsewhere', () => {
    const rule = /\n\.filelist__copy \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toContain('flex: 1 1 auto;');
    expect(rule).toContain('min-width: 0;');
    expect(rule).toContain('display: flex;');
    expect(rule).toContain('flex-direction: column;');
    const name = /\n\.filelist__name \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(name).toContain('flex: 1 1 auto;');
  });
});
