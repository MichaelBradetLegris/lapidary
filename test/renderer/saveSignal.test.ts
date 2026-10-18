import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.4: the count on the Save button, the dot before the chapter name and
   the status bar, all from `unsavedDecisionCount` through `src/shared/ui/save.ts`
   (whose words are tested in test/shared/save.test.ts), with `store.dirty` gone.
   These are source checks: the tests run without a DOM, and the window checks
   (1100 px at 125%, a 40-character chapter name, 0, 1 and 12 changes, both
   themes) are in PLAN (apply.4). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const TOOLBAR = read('components/Toolbar.tsx');
const STATUS_BAR = read('components/StatusBar.tsx');
const FILE_LIST = read('components/FileList.tsx');
const SIDE_PANEL = read('components/SidePanel.tsx');
const REVIEW_DIALOG = read('components/ReviewDialog.tsx');
const APP = read('App.tsx');
const STORE = read('state/store.ts');
const PERSIST = read('state/reviewPersistence.ts');
const CSS = read('styles/app.css');

/** Every declaration made for exactly this selector, across app.css. */
function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('the Save button and the dot (apply.4)', () => {
  it('takes the label, tooltip and disabled state from saveButtonState', () => {
    // Every input, by name: saveButtonInput's own tests hold what it does with them.
    expect(TOOLBAR).toMatch(
      /const input = saveButtonInput\(\{\s*review,\s*changedParagraphs,\s*saving,\s*locked\s*\}\);/
    );
    expect(TOOLBAR).toContain('const save = saveButtonState(input);');
    expect(TOOLBAR).toContain('const locked = useApp(isLocked);');
    expect(TOOLBAR).toContain('changedParagraphCount(s.drafts)');
    expect(TOOLBAR).toMatch(/\{\s*review,\s*running,\s*progressLabel,\s*saving,/);
    expect(TOOLBAR).toContain('{save.label}');
    expect(TOOLBAR).toContain('title={save.title}');
    expect(TOOLBAR).toContain('disabled={save.disabled}');
    expect(TOOLBAR).not.toMatch(/accepted changes/i);
    expect(TOOLBAR).not.toContain("'Save to chapter'");
  });

  it('puts the dot before the chapter name, labelled, only when saveButtonState says so', () => {
    const dot = TOOLBAR.indexOf('className="unsaved-dot"');
    const name = TOOLBAR.indexOf('className="toolbar__name"');
    expect(dot).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(dot);
    expect(TOOLBAR).toMatch(/\{save\.dot \? <span className="unsaved-dot"/);
    expect(TOOLBAR).toContain('aria-label={dotLabel}');
    expect(TOOLBAR).toContain('unsavedDotLabel(input.unsavedDecisions)');
    expect(TOOLBAR).toMatch(/className="toolbar__name" title=\{title\}/);
  });

  it('cuts the chapter name short with an ellipsis, then wraps the row, never a button', () => {
    expect(Object.fromEntries(declsFor('.toolbar__title'))).toMatchObject({
      flex: '1 1 8em',
      'min-width': '0'
    });
    expect(Object.fromEntries(declsFor('.toolbar__name'))).toMatchObject({
      'min-width': '0',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap'
    });
    expect(declsFor('.toolbar button').get('white-space')).toBe('nowrap');
    // Zoomed in, or with a review's progress showing, the last buttons move to
    // a second row on the right instead of running out of the window; the
    // title grows into the room a spacer used to take.
    expect(Object.fromEntries(declsFor('.toolbar'))).toMatchObject({
      'flex-wrap': 'wrap',
      'justify-content': 'flex-end'
    });
    expect(TOOLBAR).not.toContain('className="spacer"');
  });

  it('keeps the progress label inside its own box', () => {
    // With nowrap and less room than its words, it spilled to the left over
    // the dot and the chapter name. It may wrap, or it must clip.
    const progress = new Map([...declsFor('.progress'), ...declsFor('.toolbar .progress')]);
    expect(progress.get('white-space') !== 'nowrap' || progress.get('overflow') === 'hidden').toBe(true);
    expect(TOOLBAR).toContain('<span className="progress" aria-live="polite">');
  });

  it('paints the dot in --unsaved, a token of its own', () => {
    expect(Object.fromEntries(declsFor('.unsaved-dot'))).toMatchObject({
      flex: 'none',
      'border-radius': '50%',
      background: 'var(--unsaved)'
    });
    expect(declsFor('.toolbar__dirty').size).toBe(0);
    expect(TOOLBAR).not.toContain('toolbar__dirty');
  });
});

describe('the status bar (apply.4)', () => {
  it('counts what is not saved to the chapter, in --unsaved, and only when there is something', () => {
    expect(STATUS_BAR).toContain('unsavedPhrase(review ? unsavedDecisionCount(review.hunks) : 0)');
    expect(STATUS_BAR).toMatch(
      /\{unsaved \? \(\s*<span className="statusbar__unsaved" title=\{KEPT_TOOLTIP\}>/
    );
    expect(declsFor('.statusbar__unsaved').get('color')).toBe('var(--unsaved)');
  });

  it('says "Decisions kept" with the tooltip, never "Review saved"', () => {
    expect(STATUS_BAR).toContain('<span title={KEPT_TOOLTIP}>{keptPhrase(keptAt)}</span>');
    expect(STATUS_BAR).not.toContain('Review saved');
    expect(STATUS_BAR).not.toContain('toLocaleTimeString');
  });

  it('has a legend that explains the dot and no longer offers the removed selection edit', () => {
    expect(STATUS_BAR).toContain('legend__swatch--unsaved');
    expect(STATUS_BAR).toContain('Not saved to chapter.');
    // Both places the dot is drawn (apply.5).
    expect(STATUS_BAR).toMatch(/at the top of the window or under\s+Chapters/);
    expect(STATUS_BAR).not.toMatch(/selecting words/i);
    expect(STATUS_BAR).not.toMatch(/pressing e\b/i);
    expect(STATUS_BAR).toContain('or the e key, lets you rewrite it');
    expect(declsFor('.legend__swatch--unsaved').get('background')).toBe('var(--unsaved)');
  });

  it('keeps the longer legend inside a short window, scrolling rather than running off the top', () => {
    expect(Object.fromEntries(declsFor('.legend'))).toMatchObject({
      'max-height': 'calc(100vh - 40px)',
      'overflow-y': 'auto',
      background: 'var(--panel)'
    });
    // The gap above the last paragraph, which `.legend p` used to take away.
    expect(declsFor('.legend .legend__foot').get('margin')).toBe('9px 0 0');
  });
});

/* apply.5: the same dot before each chapter in the chapter list that has changes
   its file does not have yet. `chapterListMarks` decides it (its tests are in
   test/shared/chapterList.test.ts, and test/main/reviews.test.ts checks that
   main's summary marks a chapter as it was marked while open); these check the
   wiring. */
describe('the chapter list (apply.5)', () => {
  it('marks each row with chapterListMarks, live for the open chapter only', () => {
    expect(FILE_LIST).toContain("import { chapterListMarks } from '../../shared/ui/chapterList';");
    expect(FILE_LIST).toContain('const activePath = review?.sourcePath ?? null;');
    expect(FILE_LIST).toContain('const open = file.path === activePath;');
    expect(FILE_LIST).toContain(
      'const marks = chapterListMarks(byPath.get(indexKey(file.path)), open ? review : null);'
    );
    expect(FILE_LIST).toContain("className={`filelist__item ${open ? 'filelist__item--active' : ''}`}");
    expect(APP).toMatch(/<FileList\s+files=\{files\}\s+index=\{index\}\s+review=\{review\}/);
  });

  it('puts the labelled dot before the name, and takes the badge from the same marks', () => {
    const dot = FILE_LIST.indexOf('className="unsaved-dot"');
    const name = FILE_LIST.indexOf('className="filelist__name"');
    expect(dot).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(dot);
    expect(FILE_LIST).toMatch(/\{marks\.unsaved > 0 \? \(\s*<span\s+className="unsaved-dot"\s+role="img"/);
    expect(FILE_LIST).toContain('aria-label={marks.dotLabel}');
    expect(FILE_LIST).toContain('title={marks.dotLabel}');
    expect(FILE_LIST).toContain('{marks.pending}');
    expect(FILE_LIST).not.toContain('summary.pendingCount');
    // The toolbar's dot, so the two look and read alike.
    expect(TOOLBAR).toContain('className="unsaved-dot"');
  });

  it('reads the marks again when a chapter opens, after the one left is written, and before it shows', () => {
    const open = APP.slice(
      APP.indexOf('const openChapter = useCallback('),
      APP.indexOf('const openHistoryEntry')
    );
    const flush = open.indexOf('await flushReviewWrites();');
    const read = open.indexOf('const marked = refreshIndex();');
    const wait = open.indexOf('await marked;');
    const shown = open.indexOf('setReview(');
    expect(flush).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(flush);
    expect(open.indexOf("call('files:read'")).toBeGreaterThan(read);
    expect(wait).toBeGreaterThan(read);
    expect(shown).toBeGreaterThan(wait);
    // Only the newest answer counts, and a failure leaves no stale marks.
    expect(APP).toContain('if (ticket === indexSeq.current) setIndex(next);');
  });
});

/* apply.5, after review: History and the Review with AI dialog's "Last
   reviewed" line count the review on screen from the page, as the chapter list
   does, through `historyCounts` (its tests are in test/shared/history.test.ts,
   and test/main/reviews.test.ts checks that main counts a written review the
   same way); these check the wiring. */
describe('History (apply.5)', () => {
  it('takes the highlight and the pending badge of each row from historyCounts', () => {
    expect(SIDE_PANEL).toMatch(
      /import \{\s*historyCounts,\s*historyWhen,[^}]*\} from '\.\.\/\.\.\/shared\/ui\/history';/
    );
    expect(SIDE_PANEL).toContain('const counts = historyCounts(entry, activeReviewPath, review);');
    expect(SIDE_PANEL).toContain(
      "className={`history__item ${counts.onScreen ? 'history__item--active' : ''}`}"
    );
    expect(SIDE_PANEL).toMatch(
      /\{counts\.pendingCount > 0 \? \(\s*<span className="badge badge--pending">\{counts\.pendingCount\}<\/span>/
    );
    expect(SIDE_PANEL).not.toContain('entry.pendingCount');
    expect(APP).toMatch(
      /<SidePanel\s+review=\{review\}\s+history=\{history\}\s+activeReviewPath=\{reviewPath\}/
    );
  });

  it('counts the last review in the Review with AI dialog the same way', () => {
    expect(REVIEW_DIALOG).toContain("import { historyCounts, historyWhen } from '../../shared/ui/history';");
    expect(REVIEW_DIALOG).toContain(
      'const previousCounts = previous ? historyCounts(previous, reviewPath, review) : null;'
    );
    expect(REVIEW_DIALOG).toContain('${previousCounts.hunkCount} suggestion');
    expect(REVIEW_DIALOG).toContain('${previousCounts.pendingCount} still pending');
    // History's date, then a space after the colon (apply.7 review: it had gone missing).
    expect(REVIEW_DIALOG).toContain(
      '`Last reviewed ${historyWhen(previous.createdAt)}: ${previousCounts.hunkCount} suggestion${'
    );
    expect(REVIEW_DIALOG).not.toMatch(/previous\.(hunkCount|pendingCount)/);
    expect(APP).toMatch(/history=\{history\}\s+reviewPath=\{reviewPath\}\s+unsavedDecisions=/);
  });

  it('reads History again when a History entry opens, after the review left is written', () => {
    const start = APP.indexOf('const openHistoryEntry = useCallback(');
    const open = APP.slice(start, APP.indexOf('useEffect(', start));
    const flush = open.indexOf('await flushReviewWrites();');
    const shown = open.lastIndexOf('setReview(');
    const read = open.indexOf('refreshHistory(sourcePath);');
    expect(flush).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(flush);
    expect(read).toBeGreaterThan(shown);
    expect(open).toMatch(/\[[^\]]*\brefreshHistory\b[^\]]*\]\s*\);\s*$/);
  });
});

describe('the store (apply.4)', () => {
  it('shows the kept time of the review on screen only, recorded with the file it went to', () => {
    // reviewKeptAt's own tests are in test/renderer/store.test.ts.
    expect(STATUS_BAR).toContain('const keptAt = useApp(reviewKeptAt);');
    expect(STATUS_BAR).not.toContain('s.reviewSavedAt');
    expect(PERSIST).toContain('state.markReviewPersisted(stored.path);');
  });

  it('has no dirty flag: the unsaved count is the one measure', () => {
    expect(STORE).not.toMatch(/\bdirty\b/);
  });
});
