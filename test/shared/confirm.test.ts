import { describe, expect, it } from 'vitest';
import type { CloseGuardState } from '../../src/shared/ipc';
import {
  bodyLines,
  confirmButtons,
  focusedChoice,
  offeredChoice,
  type ConfirmChoice,
  type ConfirmSpec
} from '../../src/shared/ui/confirm';
import { closePrompt, leavePrompt, type SavePrompt } from '../../src/shared/ui/save';

/* apply.6: the confirm dialog's buttons, their order and the focused one. */

const CHAPTER = 'D:\\Writing\\Novel\\Chapter 3.md';

const TWO_WAY: ConfirmSpec = {
  title: 'Accept 6 pending suggestions?',
  body: 'Suggestions you already dismissed are not changed.',
  confirmLabel: 'Accept'
};

const THREE_WAY: ConfirmSpec = {
  title: 'Leave Chapter 3?',
  body: 'One.\nTwo.',
  confirmLabel: 'Save 2 changes first',
  altLabel: 'Keep for later',
  cancelLabel: 'Cancel',
  defaultButton: 'alt'
};

const labels = (spec: ConfirmSpec): string[] => confirmButtons(spec).map((b) => b.label);

describe('confirm dialog buttons', () => {
  it('shows a two-way question as it always did: Cancel, then the blue confirm', () => {
    expect(confirmButtons(TWO_WAY)).toEqual([
      { choice: 'cancel', label: 'Cancel', primary: false },
      { choice: 'confirm', label: 'Accept', primary: true }
    ]);
    expect(focusedChoice(TWO_WAY)).toBe('confirm');
  });

  it('orders a three-way question Cancel, alt, confirm, with only confirm blue', () => {
    expect(confirmButtons(THREE_WAY)).toEqual([
      { choice: 'cancel', label: 'Cancel', primary: false },
      { choice: 'alt', label: 'Keep for later', primary: false },
      { choice: 'confirm', label: 'Save 2 changes first', primary: true }
    ]);
  });

  it('hides confirm when its label is empty, and alt when it has none', () => {
    expect(labels({ ...THREE_WAY, confirmLabel: '' })).toEqual(['Cancel', 'Keep for later']);
    expect(labels({ ...THREE_WAY, altLabel: '' })).toEqual(['Cancel', 'Save 2 changes first']);
    expect(labels({ ...THREE_WAY, altLabel: undefined })).toEqual(['Cancel', 'Save 2 changes first']);
    expect(labels({ ...THREE_WAY, confirmLabel: '', altLabel: '' })).toEqual(['Cancel']);
  });

  it('labels Cancel from the question, or "Cancel" when it gives none', () => {
    expect(labels({ ...TWO_WAY, cancelLabel: 'Stay' })[0]).toBe('Stay');
    expect(labels({ ...TWO_WAY, cancelLabel: '' })[0]).toBe('Cancel');
    expect(labels(TWO_WAY)[0]).toBe('Cancel');
  });
});

describe('the focused button', () => {
  it('is the default the question names', () => {
    const named: ConfirmChoice[] = ['confirm', 'alt', 'cancel'];
    for (const choice of named) expect(focusedChoice({ ...THREE_WAY, defaultButton: choice })).toBe(choice);
  });

  it('is confirm when none is named', () => {
    expect(focusedChoice({ ...THREE_WAY, defaultButton: undefined })).toBe('confirm');
  });

  it('falls back to Cancel when the default is not shown, never to the other way out', () => {
    expect(focusedChoice({ ...THREE_WAY, confirmLabel: '', defaultButton: undefined })).toBe('cancel');
    expect(focusedChoice({ ...THREE_WAY, confirmLabel: '', defaultButton: 'confirm' })).toBe('cancel');
    expect(focusedChoice({ ...THREE_WAY, altLabel: undefined, defaultButton: 'alt' })).toBe('cancel');
  });
});

describe('an answer the question does not offer', () => {
  it('counts as cancel', () => {
    expect(offeredChoice({ ...THREE_WAY, confirmLabel: '' }, 'confirm')).toBe('cancel');
    expect(offeredChoice(TWO_WAY, 'alt')).toBe('cancel');
  });

  it('passes every shown choice through unchanged', () => {
    for (const button of confirmButtons(THREE_WAY)) {
      expect(offeredChoice(THREE_WAY, button.choice)).toBe(button.choice);
    }
    expect(offeredChoice(TWO_WAY, 'confirm')).toBe('confirm');
    expect(offeredChoice(TWO_WAY, 'cancel')).toBe('cancel');
  });
});

describe('the body', () => {
  it('keeps a one-line body as one paragraph, as before', () => {
    expect(bodyLines(TWO_WAY.body)).toEqual([TWO_WAY.body]);
  });

  it('gives each line of a three-way body a paragraph, skipping blank lines', () => {
    expect(bodyLines('One.\nTwo.')).toEqual(['One.', 'Two.']);
    expect(bodyLines('One.\n\n  \nTwo.\n')).toEqual(['One.', 'Two.']);
    expect(bodyLines('')).toEqual([]);
  });
});

describe('the leave and close prompts in the dialog (apply.2 shapes)', () => {
  const guard = (over: Partial<CloseGuardState>): CloseGuardState => ({
    chapter: CHAPTER,
    unsavedDecisions: 0,
    changedParagraphs: 0,
    locked: false,
    reviewRunning: false,
    writesPending: false,
    dialogText: false,
    ...over
  });

  it('leave: Cancel, Keep for later, Save; Keep for later focused', () => {
    const prompt: ConfirmSpec = leavePrompt(
      { chapter: CHAPTER, unsavedDecisions: 3, changedParagraphs: 0, locked: false, reviewId: 'r1' },
      { kind: 'chapter', path: 'D:\\Writing\\Novel\\Chapter 4.md' }
    )!;
    expect(labels(prompt)).toEqual(['Cancel', 'Keep for later', 'Save 3 changes first']);
    expect(focusedChoice(prompt)).toBe('alt');
  });

  it('close with only typed dialog text: no Save, Cancel focused so Enter loses nothing', () => {
    const prompt = closePrompt(guard({ dialogText: true }))!;
    expect(labels(prompt)).toEqual(['Cancel', 'Close anyway']);
    expect(focusedChoice(prompt)).toBe('cancel');
    expect(offeredChoice(prompt, 'confirm')).toBe('cancel');
  });

  it('close while the chapter s review runs: no Save, Keep for later focused', () => {
    const prompt = closePrompt(guard({ unsavedDecisions: 2, locked: true, reviewRunning: true }))!;
    expect(labels(prompt)).toEqual(['Cancel', 'Close, keep for later']);
    expect(focusedChoice(prompt)).toBe('alt');
  });

  it('every prompt focuses the default it names, which is always shown', () => {
    const prompts: SavePrompt[] = [];
    for (const n of [0, 1, 12]) {
      for (const p of [0, 2]) {
        for (const locked of [false, true]) {
          for (const dialogText of [false, true]) {
            for (const chapter of [CHAPTER, null]) {
              const state = guard({ chapter, unsavedDecisions: n, changedParagraphs: p, locked, dialogText });
              const close = closePrompt(state);
              if (close) prompts.push(close);
              const leave = leavePrompt(
                { chapter, unsavedDecisions: n, changedParagraphs: p, locked, reviewId: 'r1' },
                { kind: 'review', id: 'r2', when: '14 Oct 2026, 16:04' }
              );
              if (leave) prompts.push(leave);
            }
          }
        }
      }
    }
    expect(prompts.length).toBeGreaterThan(20);
    for (const prompt of prompts) {
      expect(focusedChoice(prompt)).toBe(prompt.defaultButton);
      expect(confirmButtons(prompt)[0]).toEqual({ choice: 'cancel', label: 'Cancel', primary: false });
    }
  });
});
