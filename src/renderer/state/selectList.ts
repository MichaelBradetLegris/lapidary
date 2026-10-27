/**
 * Whether a select's list is open (theme.13). The app draws its selects'
 * lists itself (`appearance: base-select`, app.css), so a key pressed while
 * one is open reaches the page, where the native list took it before the page
 * saw it. Escape then closes the list and nothing else: every Escape handler
 * asks here first (`useDialogEscape`, the keyboard bindings, and
 * `escapeTakers` for full screen and focus mode). While the list is open the
 * focus is on the chosen row, an option inside the select, and `:open`
 * matches a select whose list is. Where `:open` is unknown, as in a browser
 * without the customizable select, nothing is open.
 */
export function selectListOpen(active: Element | null = document.activeElement): boolean {
  const select = active?.closest?.('select');
  if (!select) return false;
  try {
    return select.matches(':open');
  } catch {
    return false;
  }
}
