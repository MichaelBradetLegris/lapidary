import { describe, expect, it } from 'vitest';
import { selectListOpen } from '../../src/renderer/state/selectList';

/** The focus as it stands while a list is open: an option inside a select, which `:open` may match. */
const option = (open: boolean, unknownPseudo = false): Element =>
  ({
    closest: (selector: string) =>
      selector === 'select'
        ? {
            matches: (pseudo: string) => {
              if (unknownPseudo) throw new SyntaxError(`'${pseudo}' is not a valid selector`);
              return pseudo === ':open' && open;
            }
          }
        : null
  }) as unknown as Element;

/* theme.13: the app draws its selects' lists itself, so a key pressed while one is open reaches the
   page; Escape handlers ask this first, so the list closes on it and nothing else does. */
describe('selectListOpen (theme.13)', () => {
  it('is true only while the focus is in a select whose list is open', () => {
    expect(selectListOpen(option(true))).toBe(true);
    expect(selectListOpen(option(false))).toBe(false);
    expect(selectListOpen(null)).toBe(false);
    expect(selectListOpen({ closest: () => null } as unknown as Element)).toBe(false);
  });

  it('is false where :open is unknown, as in a browser without the customizable select', () => {
    expect(selectListOpen(option(true, true))).toBe(false);
  });
});
