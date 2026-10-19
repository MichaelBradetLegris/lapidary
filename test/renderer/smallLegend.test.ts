import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* small.10 (PLAN 11.7): the legend behind the status bar's "?" explains the
   capsule, the small text above the line, the margin bars and Shift+J, each
   with a swatch drawn as on the page, between Dismissed and Not saved to
   chapter, in the list apply.4 rewrote. Source checks: the tests run without
   a DOM. */

const SRC = path.join(__dirname, '../../src');
const STATUS_BAR = readFileSync(path.join(SRC, 'renderer/components/StatusBar.tsx'), 'utf8');
const CSS = readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (
      !(match[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(selector)
    )
      continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('the legend explains small changes (small.10)', () => {
  it('lists them after Dismissed and before Not saved to chapter', () => {
    const order = [
      'legend__swatch--pending',
      'legend__swatch--accepted',
      'legend__swatch--dismissed',
      'legend__swatch--capsule',
      'legend__swatch--key',
      'legend__swatch--bar',
      'legend__swatch--focus',
      'legend__swatch--unsaved'
    ].map((swatch) => STATUS_BAR.indexOf(swatch));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const words of ['Small changes.', 'Small text above.', 'Margin bars.', 'Shift+J and Shift+K']) {
      expect(STATUS_BAR).toContain(words);
    }
  });

  it('draws each swatch as the page draws the mark, with the same tokens, in 16 px', () => {
    expect(declsFor('.legend__swatch--capsule').get('background')).toBe(
      'color-mix(in srgb, var(--cat-punctuation) var(--tint-small), transparent)'
    );
    expect(declsFor('.legend__swatch--capsule').get('border-bottom')).toBe(
      '2px solid var(--cat-punctuation)'
    );
    expect(declsFor('.legend__swatch--key').get('border')).toBe(
      '1px solid color-mix(in srgb, var(--ink-faint) 60%, transparent)'
    );
    expect(declsFor('.legend__swatch--bar').get('border-left')).toBe('3px solid var(--cat-punctuation)');
    expect(declsFor('.legend__swatch--focus').get('border-left')).toBe('6px solid var(--ink)');
  });
});
