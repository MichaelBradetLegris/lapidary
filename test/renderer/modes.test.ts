import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeReview } from '../../src/shared/diff/compose';
import { fullEditText } from '../../src/shared/edit';
import { createReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';
import {
  FINISH_FULL_EDIT_FIRST,
  FULL_EDIT_CHANGED,
  FULL_EDIT_HOLDS_PARAGRAPHS,
  FULL_EDIT_WAIT_FOR_REVIEW,
  FULL_EDIT_WAIT_FOR_SAVE,
  boxesBeforeFullEditPrompt,
  boxesBeforePreviewPrompt,
  discardFullEditPrompt,
  leaveFullEditPrompt,
  type Mode
} from '../../src/shared/ui/modes';
import { closeGuardStateOf } from '../../src/renderer/state/closeGuard';
import { beforeLeaving, leaveStateOf } from '../../src/renderer/state/leave';
import { cancelFullEdit, chooseMode, finishFullEdit } from '../../src/renderer/state/modes';
import {
  changedParagraphCount,
  currentMode,
  fullEditChanged,
  fullEditDraft,
  inDraft,
  reviewKeysActive,
  saveShortcutContext,
  useApp,
  type ConfirmChoice
} from '../../src/renderer/state/store';

/* rr.2: the Mode select. Main, Full edit and Preview are the window's own;
   Full edit is open while its box is, under WHOLE_DRAFT_KEY; a switch with
   something typed and not applied asks as leaving the chapter does. The
   words are tested in test/shared/modes.test.ts; these check what each
   answer does to the store. */

const FRONT = '---\ntitle: T\n---';
const TEXT = `${FRONT}\nIt was the third night of rain.\n\nShe should of known.\n\nThe lamp guttered.`;
const SOURCE = 'C:/vault/Chapter 01.md';

function hunk(original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = TEXT.indexOf(original);
  return {
    id: `h-${original}`,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 1,
    category: 'grammar',
    reason: 'Reason.',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

function chapter(id = 'review-1', sourcePath = SOURCE): Review {
  return {
    ...createReview({
      sourcePath,
      base: { text: TEXT, hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [hunk('of', 'have')],
      generator: { kind: 'manual' }
    }),
    id
  };
}

const state = () => useApp.getState();
const mode = (): Mode => currentMode(state());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run a switch, answer the question it asks with `choice`, and give back the question and the result. */
async function switchAnswering(target: Mode, choice: ConfirmChoice | null) {
  const run = chooseMode(target);
  await tick();
  const asked = state().confirmSpec;
  if (choice) state().answerChoice(choice);
  return { asked, done: await run };
}

/** Type into Full edit's box, as its onChange does. */
function typeInFullEdit(transform: (text: string) => string): void {
  const draft = fullEditDraft(state().drafts);
  if (!draft) throw new Error('Full edit is not open');
  state().setDraftText(WHOLE_DRAFT_KEY, transform(draft.text));
}

beforeEach(() => {
  useApp.setState({
    drafts: {},
    viewMode: 'main',
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    confirmSpec: null,
    notifications: []
  });
  state().setReview(chapter(), 'C:/reviews/r1.json');
});

describe('the mode of the window', () => {
  it('opens a chapter in Main, and Main and Preview switch with no question when nothing is typed', async () => {
    expect(mode()).toBe('main');
    expect(await chooseMode('preview')).toBe(true);
    expect(mode()).toBe('preview');
    expect(state().confirmSpec).toBeNull();
    expect(await chooseMode('main')).toBe(true);
    expect(mode()).toBe('main');
  });

  it('keeps Preview for another review of the chapter, and opens another chapter in Main', async () => {
    await chooseMode('preview');
    state().setReview(chapter('review-2'), null);
    expect(mode()).toBe('preview');
    state().setReview(chapter('review-3', 'C:/vault/Chapter 02.md'), null);
    expect(mode()).toBe('main');
  });

  it("closes the find bar and the hover card, which are Main's, on the way out of Main", async () => {
    useApp.setState({
      find: { open: true, query: 'rain', index: 0, count: 1, seek: 4 },
      hoveredHunkId: 'h-of'
    });
    await chooseMode('preview');
    expect(state().find).toEqual({ open: false, query: '', index: -1, count: 0, seek: 4 });
    expect(state().hoveredHunkId).toBeNull();
  });
});

describe('Full edit', () => {
  it('opens on the body as the page reads it, freezes every suggestion and closes into Main', async () => {
    await chooseMode('preview');
    expect(await chooseMode('edit')).toBe(true);
    expect(mode()).toBe('edit');
    const draft = fullEditDraft(state().drafts);
    expect(draft).toEqual({
      key: WHOLE_DRAFT_KEY,
      paragraphs: [],
      initial: fullEditText(TEXT, state().review!.hunks),
      text: fullEditText(TEXT, state().review!.hunks),
      whole: true
    });
    expect(inDraft(state().drafts, 0)).toBe(true);
    expect(inDraft(state().drafts, 99)).toBe(true);
    // Frozen: no decision reaches the suggestion while Full edit is open.
    state().setHunkStatus('h-of', 'accepted');
    expect(state().review!.hunks[0]!.status).toBe('pending');
    // Nothing typed: Cancel closes it with no question, into Main.
    expect(await cancelFullEdit()).toBe(true);
    expect(mode()).toBe('main');
  });

  it('Done applies what was typed as the author s own hunks and says so', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth').replace('known.', 'known.\n\nShe had.'));
    expect(fullEditChanged(state().drafts)).toBe(true);
    expect(finishFullEdit()).toBe(true);
    expect(mode()).toBe('main');
    expect(composeReview(state().review!)).toBe(
      `${FRONT}\nIt was the fourth night of rain.\n\nShe should of known.\n\nShe had.\n\nThe lamp guttered.`
    );
    expect(state().notifications.map((n) => n.text)).toEqual([
      'Full edit: 2 changes added, already accepted.'
    ]);
    expect(
      state()
        .review!.hunks.filter((h) => h.source === 'manual')
        .map((h) => h.status)
    ).toEqual(['accepted', 'accepted']);
  });

  it('Done refuses, keeping the text, when the chapter changed on disk meanwhile', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    // The watcher reloads the same review onto a changed file: the box stays.
    const changed = {
      ...state().review!,
      base: { ...state().review!.base, text: TEXT.replace('lamp', 'candle') }
    };
    state().setReview(changed, null);
    expect(mode()).toBe('edit');
    expect(finishFullEdit()).toBe(false);
    expect(mode()).toBe('edit');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_CHANGED]);
    expect(fullEditDraft(state().drafts)?.text).toContain('fourth');
  });

  it('Cancel with typed text asks, Keep editing focused: Keep editing stays, Discard closes', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    let run = cancelFullEdit();
    await tick();
    expect(state().confirmSpec).toEqual(discardFullEditPrompt());
    state().answerChoice('cancel');
    expect(await run).toBe(false);
    expect(mode()).toBe('edit');
    run = cancelFullEdit();
    await tick();
    state().answerChoice('confirm');
    expect(await run).toBe(true);
    expect(mode()).toBe('main');
    expect(state().review!.hunks).toEqual(chapter().hunks);
  });

  it('does not open while a review of the chapter runs or a save is under way, and says why', async () => {
    useApp.setState({ aiBusyPath: SOURCE });
    expect(await chooseMode('edit')).toBe(false);
    expect(mode()).toBe('main');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_REVIEW]);
    useApp.setState({ aiBusyPath: null, chapterSaving: true });
    expect(await chooseMode('edit')).toBe(false);
    // One card under one key: the newer reason replaces the older.
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_SAVE]);
    useApp.setState({ chapterSaving: false });
    expect(state().openFullEdit()).toBeNull();
  });

  it('opens no paragraph box beside it, and says so', async () => {
    await chooseMode('edit');
    expect(state().openDraft(1)).toBe(false);
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_HOLDS_PARAGRAPHS]);
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });

  /* rr.2 review: the store's parts of opening and reopening Full edit, which
     no test held: each could be undone and the suite still passed. */
  it('closes an open suggestion editor as it opens, as its box takes the keys', () => {
    state().openEditor({ kind: 'suggestion', hunkId: 'h-of', initial: 'have', anchor: null });
    expect(state().editor).not.toBeNull();
    expect(state().openFullEdit()).toBeNull();
    expect(state().editor).toBeNull();
    expect(mode()).toBe('edit');
  });

  it('comes back from the drafts file into Full edit from Preview too, and closes into Main', async () => {
    await chooseMode('preview');
    const initial = fullEditText(TEXT, state().review!.hunks);
    expect(
      state().reopenDrafts([
        { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: `${initial} More.`, whole: true }
      ])
    ).toBe(1);
    expect(mode()).toBe('edit');
    expect(state().viewMode).toBe('main');
    const run = cancelFullEdit();
    await tick();
    state().answerChoice('confirm');
    expect(await run).toBe(true);
    expect(mode()).toBe('main');
  });
});

/* rr.2 review: in Preview the review keys acted on suggestions the page did
   not show, a accepting one and e opening the suggestion editor over the
   page, and the arrows, taken to step through them, could not scroll it.
   The key handler asks `reviewKeysActive` before any of them, and returns
   before preventDefault when it says no (keyboard.test.ts), so the browser
   scrolls the page. */
describe('the review keys are Main s', () => {
  it('act in Main, and not in Preview or Full edit', async () => {
    expect(reviewKeysActive(state())).toBe(true);
    await chooseMode('preview');
    expect(reviewKeysActive(state())).toBe(false);
    await chooseMode('edit');
    expect(reviewKeysActive(state())).toBe(false);
    await cancelFullEdit();
    expect(mode()).toBe('main');
    expect(reviewKeysActive(state())).toBe(true);
  });
});

/* rr.2 review: another review of the chapter from the review selector or
   History, with Full edit open, closed Full edit with no question; its box,
   opened on this review's text, could not go back over another review that
   composes differently, so what was typed was set aside with a card saying
   the chapter no longer read as it did, which was untrue. It is refused now,
   as Review with AI and Submit manual review are. */
describe('another review of the chapter while Full edit is open', () => {
  const deps = { save: () => Promise.resolve('saved' as const) };

  it('is refused, with Full edit and what was typed kept, and asks nothing', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const typed = fullEditDraft(state().drafts)?.text;
    expect(await beforeLeaving({ kind: 'review', id: 'review-2' }, deps)).toBe('stay');
    expect(state().confirmSpec).toBeNull();
    expect(state().notifications.map((n) => n.text)).toEqual([FINISH_FULL_EDIT_FIRST]);
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toBe(typed);
    expect(state().review!.id).toBe('review-1');
  });

  it('is refused with nothing typed too, and the review on screen still only flushes', async () => {
    await chooseMode('edit');
    expect(await beforeLeaving({ kind: 'review', id: 'review-2' }, deps)).toBe('stay');
    expect(await beforeLeaving({ kind: 'review', id: 'review-1' }, deps)).toBe('here');
  });

  it('opens as before, with no question, once Full edit is closed', async () => {
    expect(await beforeLeaving({ kind: 'review', id: 'review-2' }, deps)).toBe('go');
    expect(state().confirmSpec).toBeNull();
    expect(state().notifications).toEqual([]);
  });
});

describe('switching with something typed (as leaving the chapter asks)', () => {
  it('from a changed Full edit: Cancel stays, Discard throws it away, Apply first applies it', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    let answer = await switchAnswering('preview', 'cancel');
    expect(answer.asked).toEqual(leaveFullEditPrompt('preview'));
    expect(answer.done).toBe(false);
    expect(mode()).toBe('edit');

    answer = await switchAnswering('preview', 'alt');
    expect(answer.done).toBe(true);
    expect(mode()).toBe('preview');
    expect(state().review!.hunks).toEqual(chapter().hunks);

    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    answer = await switchAnswering('main', 'confirm');
    expect(answer.asked).toEqual(leaveFullEditPrompt('main'));
    expect(mode()).toBe('main');
    expect(composeReview(state().review!)).toContain('fourth night');
  });

  it('from Full edit with nothing typed: no question', async () => {
    await chooseMode('edit');
    const answer = await switchAnswering('preview', null);
    expect(answer.asked).toBeNull();
    expect(mode()).toBe('preview');
  });

  it('into Full edit over changed paragraph boxes: Cancel stays, Apply first applies them, then opens', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She should have known.');
    let answer = await switchAnswering('edit', 'cancel');
    expect(answer.asked).toEqual(boxesBeforeFullEditPrompt(1));
    expect(answer.done).toBe(false);
    expect(Object.keys(state().drafts)).toEqual(['1']);
    answer = await switchAnswering('edit', 'confirm');
    expect(answer.done).toBe(true);
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.initial).toContain('She should have known.');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });

  it('into Full edit over boxes left as they opened: no question, and they close', async () => {
    state().openDraft(1);
    const answer = await switchAnswering('edit', null);
    expect(answer.asked).toBeNull();
    expect(mode()).toBe('edit');
    expect(changedParagraphCount(state().drafts)).toBe(0);
  });

  it('from Main to Preview over changed boxes: Keep for later leaves them in Main, Apply first applies them', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She should have known.');
    const answer = await switchAnswering('preview', 'alt');
    expect(answer.asked).toEqual(boxesBeforePreviewPrompt(1));
    expect(mode()).toBe('preview');
    expect(state().drafts[1]?.text).toBe('She should have known.');
    await chooseMode('main');
    expect(state().drafts[1]?.text).toBe('She should have known.');
    await switchAnswering('preview', 'cancel');
    expect(mode()).toBe('main');
    await switchAnswering('preview', 'confirm');
    expect(mode()).toBe('preview');
    expect(state().drafts).toEqual({});
    expect(composeReview(state().review!)).toContain('She should have known.');
  });
});

describe("Full edit's box counted where paragraph boxes are", () => {
  it('in the close and leave states, which name it once something is typed', async () => {
    await chooseMode('edit');
    expect(closeGuardStateOf(state()).changedParagraphs).toBe(0);
    expect('fullEdit' in closeGuardStateOf(state())).toBe(false);
    typeInFullEdit((t) => `${t} More.`);
    expect(closeGuardStateOf(state())).toMatchObject({ changedParagraphs: 1, fullEdit: true });
    expect(leaveStateOf(state())).toMatchObject({ changedParagraphs: 1, fullEdit: true });
  });

  it('for Ctrl+S, from inside its box', () => {
    expect(saveShortcutContext(state(), false, true).inFullEdit).toBe(true);
    expect('inFullEdit' in saveShortcutContext(state(), false)).toBe(false);
  });

  it('comes back from the drafts file into Full edit, and no box beside it', () => {
    const initial = fullEditText(TEXT, state().review!.hunks);
    const opened = state().reopenDrafts([
      { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: `${initial} More.`, whole: true },
      { key: 1, paragraphs: [1], initial: 'She should of known.', text: 'x' }
    ]);
    expect(opened).toBe(1);
    expect(mode()).toBe('edit');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });
});

describe('the pieces in the page (source checks)', () => {
  const SRC = path.join(__dirname, '../../src');
  const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');

  it('draws Full edit, Preview or Main in the one scroller, the find bar in Main only', () => {
    const app = read('renderer/App.tsx');
    expect(app).toMatch(
      /mode === 'edit' \? \(\s*<FullEdit review=\{review\} \/>\s*\) : mode === 'preview' \? \(\s*<PreviewPane review=\{review\} \/>\s*\) : \(\s*<ReviewPane/
    );
    expect(app).toContain("{review && mode === 'main' ? <FindBar /> : null}");
    expect(app).toContain('const mode = useApp(currentMode);');
  });

  it('goes through chooseMode from the select, holding back the keys that would switch at every press', () => {
    const bar = read('renderer/components/ModeBar.tsx');
    expect(bar).toContain('if (pickerHoldsKey(event)) event.preventDefault();');
    expect(bar).toContain('void chooseMode(target).then((switched) => {');
    expect(bar).toContain('value={mode}');
  });

  it("keeps each mode's place in the one scroller, put back before the frame is painted and held as it grows", () => {
    const hook = read('renderer/state/modePlaces.ts');
    expect(hook).toMatch(
      /useLayoutEffect\(\(\) => \{\s*const next = modePlace\(places\.current, chapter, mode\);/
    );
    expect(hook).toContain('if (next.top === null || !element) return;');
    expect(hook).toContain('const stop = holdPlace(element, next.top, browserWatch(element), () => {');
    expect(hook).toContain('return stop ?? undefined;');
    // The scroller's own moves while a place is held are not the author's.
    expect(hook).toMatch(
      /if \(holding\.current\) return;\s*places\.current\.tops\[places\.current\.mode\] = event\.currentTarget\.scrollTop;/
    );
    // The content's size, and the author's wheel, keys, presses and touches.
    expect(hook).toContain('for (const child of Array.from(scroller.children)) observer.observe(child);');
    expect(hook).toContain("const kinds = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;");
  });

  it('hands the focus back to the page after a choice that lands in Main or Preview, as the review selector does', () => {
    const bar = read('renderer/components/ModeBar.tsx');
    expect(bar).toContain(
      "if (switched && target !== 'edit' && document.activeElement === select) select.blur();"
    );
  });

  it("gives Full edit's box Escape for Cancel and Ctrl+Enter for Done", () => {
    const box = read('renderer/components/FullEdit.tsx');
    expect(box).toMatch(/event\.key === 'Escape'[\s\S]*void cancelFullEdit\(\)/);
    expect(box).toMatch(
      /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*finishFullEdit\(\)/
    );
  });
});

describe('the CSS of the three modes', () => {
  const CSS = readFileSync(path.join(__dirname, '../../src/renderer/styles/app.css'), 'utf8');
  const rule = (selector: string): string => {
    const at = CSS.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return CSS.slice(at, CSS.indexOf('}', at));
  };

  it('puts the select at the right of its strip, on the page s own colour', () => {
    expect(rule('.modebar')).toContain('justify-content: flex-end;');
    expect(rule('.modebar')).toContain('background: var(--bg);');
  });

  it("gives Full edit's box the column's height, the prose's typeface and an opaque background", () => {
    expect(rule('.fulledit')).toContain('flex: 1 1 auto;');
    expect(rule('.fulledit')).toContain('font-family: var(--font-prose);');
    expect(rule('.fulledit__area')).toContain('flex: 1 1 auto;');
    expect(rule('.fulledit__area')).toContain('background: var(--editor-bg);');
    expect(rule('.fulledit__area')).toContain('resize: none;');
    // The browser's own focus ring: no outline rule of its own.
    expect(CSS).not.toMatch(/\.fulledit__area:focus/);
  });

  /* rr.2 review: the notification cards, pinned to the column's top right,
     covered the first lines of Full edit's box and of Preview's page, which
     ran under them where Main's prose stops short of its margin notes. From
     Main's 820 px (GUTTER_MIN_WIDTH) both keep Main's 344 px free on the right. */
  it('keeps the right of a wide column free for the cards in Full edit and Preview, as Main s margin is', () => {
    const reserve = 'clamp(40px, (100% - 819px) * 1000, 344px)';
    expect(rule('.fulledit')).toContain(`padding: 12px ${reserve} 16px 40px;`);
    expect(rule('.fulledit')).toContain(`max-width: calc(66ch + 66px + ${reserve});`);
    expect(rule('.preview')).toContain(`padding: 16px ${reserve} 120px 40px;`);
    // Main's margin: 22 px of padding, a 22 px gap and a column of at most 300 px, from 820 px.
    expect(rule('.pane--gutter')).toContain('padding-right: 22px;');
    expect(CSS).toContain('grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);');
    expect(CSS).toMatch(/\.pane--gutter \.pane__body \{[^}]*gap: 22px;/);
    const pane = readFileSync(path.join(__dirname, '../../src/renderer/components/ReviewPane.tsx'), 'utf8');
    expect(pane).toContain('const GUTTER_MIN_WIDTH = 820;');
  });

  it("draws Preview's paragraphs apart, a tight block's lines together, in the prose's serif", () => {
    expect(rule('.preview__page')).toContain('font-family: var(--font-prose);');
    expect(rule('.preview__page p')).toContain('margin: 0 0 1.2em;');
    expect(rule('.preview__page p.rr-tight')).toContain('margin-bottom: 0;');
  });
});
