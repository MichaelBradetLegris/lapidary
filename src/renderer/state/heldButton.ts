/**
 * The props of a button held while its work runs, such as Check again during
 * a check and Test the connection during a test (setup.8 review): marked
 * `aria-disabled` rather than `disabled`, and with no click handler.
 *
 * Chromium takes the focus from a focused button that becomes `disabled` and
 * leaves it on the page, so a keyboard or screen-reader user who pressed the
 * button had to Tab in again from the top of the window. A button that is only
 * `aria-disabled` keeps the focus and is still announced as unavailable;
 * without its handler, a click, Space or Enter on it does nothing until the
 * work ends. app.css draws it as it draws a disabled button.
 */
export interface HeldButtonProps {
  'aria-disabled'?: true;
  onClick?: () => void;
}

export function heldButton(held: boolean, onClick: (() => void) | undefined): HeldButtonProps {
  if (held) return { 'aria-disabled': true };
  return onClick ? { onClick } : {};
}
