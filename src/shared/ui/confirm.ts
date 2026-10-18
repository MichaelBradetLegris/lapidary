/**
 * The in-app confirm dialog's question and its buttons (apply.6), decided
 * without React so every rule has a test.
 *
 * A question has two or three answers. The two-way ones (Bulk, replacing the
 * open review, discarding or applying open paragraphs) give only a title, a
 * body and the confirm label, and read exactly as before. The three-way ones,
 * leaving a chapter and closing the window (PLAN 11.3 i, `leavePrompt` and
 * `closePrompt` in `save.ts`), add a middle choice and say which button has
 * the focus: confirm saves, alt leaves and keeps everything for later, cancel
 * stays.
 */

/** Which button answered, or which has the focus when the dialog opens. */
export type ConfirmChoice = 'confirm' | 'alt' | 'cancel';

export interface ConfirmSpec {
  title: string;
  /**
   * One point per line, separated by "\n"; the dialog shows each line as a
   * paragraph of its own.
   */
  body: string;
  /** The main choice, drawn as the blue button on the right. Empty hides the button. */
  confirmLabel: string;
  /** A third choice, between Cancel and the main one. Absent or empty shows none. */
  altLabel?: string;
  /** Absent or empty reads "Cancel". */
  cancelLabel?: string;
  /** The button focused when the dialog opens, so Enter picks it. Absent means confirm. */
  defaultButton?: ConfirmChoice;
}

export interface ConfirmButton {
  choice: ConfirmChoice;
  label: string;
  /** the blue button; only confirm is ever blue */
  primary: boolean;
}

/**
 * The buttons the dialog shows, left to right: Cancel, then alt, then
 * confirm. Cancel is always there, so Escape and a click both have somewhere
 * safe to go.
 */
export function confirmButtons(spec: ConfirmSpec): ConfirmButton[] {
  const buttons: ConfirmButton[] = [
    { choice: 'cancel', label: spec.cancelLabel || 'Cancel', primary: false }
  ];
  if (spec.altLabel) buttons.push({ choice: 'alt', label: spec.altLabel, primary: false });
  if (spec.confirmLabel) buttons.push({ choice: 'confirm', label: spec.confirmLabel, primary: true });
  return buttons;
}

/**
 * The answer as the question allows it: a choice whose button is not shown
 * (confirm with an empty label, alt with none) counts as cancel, so nothing
 * can save when saving was not offered.
 */
export function offeredChoice(spec: ConfirmSpec, choice: ConfirmChoice): ConfirmChoice {
  return confirmButtons(spec).some((b) => b.choice === choice) ? choice : 'cancel';
}

/**
 * The button that takes the focus when the dialog opens: `defaultButton`, or
 * confirm when none is named, as the two-way questions always had. A default
 * whose button is not shown falls back to Cancel, never to another way of
 * leaving, so Enter does not throw work away.
 */
export function focusedChoice(spec: ConfirmSpec): ConfirmChoice {
  return offeredChoice(spec, spec.defaultButton ?? 'confirm');
}

/** The body's points, one per line, without blank lines. */
export function bodyLines(body: string): string[] {
  return body.split('\n').filter((line) => line.trim() !== '');
}
