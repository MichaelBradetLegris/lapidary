import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Edit from '../../src/shared/edit';
import type { BlockEditResult, ChapterEditArgs } from '../../src/shared/edit';
import { createReview } from '../../src/shared/review';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';
import { FULL_EDIT_NOT_EXACT } from '../../src/shared/ui/modes';

/* rr.2: the store applies Full edit's plan only when it composes to exactly
   the chapter typed, with no hunks overlapping. The planner never makes one
   that does not (fullEdit.test.ts, 30,000 generated runs); this stands a
   faulty planner in for it to show the check keeps the box, and the page,
   as they were. */

type Fault = 'none' | 'wrong-words' | 'overlap' | 'throws';
const fault = vi.hoisted((): { kind: Fault } => ({ kind: 'none' }));

vi.mock('../../src/shared/edit', async (importOriginal) => {
  const real = await importOriginal<typeof Edit>();
  return {
    ...real,
    planChapterEdit: (args: ChapterEditArgs): BlockEditResult => {
      const plan = real.planChapterEdit(args);
      if (fault.kind === 'none' || plan.kind !== 'edit') return plan;
      if (fault.kind === 'throws') throw new Error('page offset 3 is not on an unchanged run');
      const first = plan.added[0];
      if (!first) return plan;
      if (fault.kind === 'wrong-words')
        return { ...plan, added: [{ ...first, replacement: `${first.replacement}!` }] };
      // Two hunks over the same words.
      return { ...plan, added: [first, { ...first, id: `${first.id}-again` }] };
    }
  };
});

const { useApp, fullEditDraft } = await import('../../src/renderer/state/store');
const { finishFullEdit } = await import('../../src/renderer/state/modes');

const TEXT = 'It was the third night of rain.\n\nShe should of known.';

beforeEach(() => {
  fault.kind = 'none';
  useApp.setState({
    drafts: {},
    viewMode: 'main',
    aiBusyPath: null,
    chapterSaving: false,
    notifications: []
  });
  useApp.getState().setReview(
    createReview({
      sourcePath: 'C:/vault/Chapter 01.md',
      base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [],
      generator: { kind: 'file' }
    }),
    null
  );
  expect(useApp.getState().openFullEdit()).toBeNull();
  useApp.getState().setDraftText(WHOLE_DRAFT_KEY, TEXT.replace('third', 'fourth'));
});

describe("Full edit's plan, checked before it is applied", () => {
  it('is applied when it composes to the chapter typed', () => {
    expect(finishFullEdit()).toBe(true);
    expect(useApp.getState().review?.hunks.map((h) => [h.original, h.replacement])).toEqual([
      ['third', 'fourth']
    ]);
  });

  for (const kind of ['wrong-words', 'overlap', 'throws'] as const) {
    it(`is refused, the box and the page kept, when it ${kind === 'throws' ? 'cannot be made' : `has ${kind}`}`, () => {
      fault.kind = kind;
      expect(finishFullEdit()).toBe(false);
      expect(useApp.getState().review?.hunks).toEqual([]);
      expect(fullEditDraft(useApp.getState().drafts)?.text).toContain('fourth');
      expect(useApp.getState().notifications.map((n) => n.text)).toEqual([FULL_EDIT_NOT_EXACT]);
    });
  }
});
