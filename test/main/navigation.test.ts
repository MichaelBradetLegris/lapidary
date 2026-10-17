import { describe, expect, it } from 'vitest';
import { navigationAction } from '../../src/main/navigation';

/* opensource.12: the window's page is never replaced. */

const PACKAGED = 'file:///C:/Program%20Files/Lapidary/resources/app.asar/out/renderer/index.html';
const DEV = 'http://localhost:5173/';

describe('navigationAction', () => {
  it('allows reloading the app itself, with or without a fragment', () => {
    expect(navigationAction(PACKAGED, PACKAGED)).toBe('allow');
    expect(navigationAction(`${PACKAGED}#top`, PACKAGED)).toBe('allow');
    expect(navigationAction(DEV, DEV)).toBe('allow');
  });

  it('sends web addresses to the browser', () => {
    expect(navigationAction('https://example.com/', PACKAGED)).toBe('external');
    expect(navigationAction('http://example.com/page', DEV)).toBe('external');
    expect(navigationAction('http://localhost:5173/elsewhere', DEV)).toBe('external');
  });

  it('refuses every other scheme, including a dropped file', () => {
    expect(navigationAction('file:///C:/Users/me/Vault/Chapter%2012.md', PACKAGED)).toBe('block'); // check-public: allow
    expect(navigationAction('file:///C:/Program%20Files/Lapidary/other.html', PACKAGED)).toBe('block');
    expect(navigationAction('javascript:alert(1)', PACKAGED)).toBe('block');
    expect(navigationAction('data:text/html,<p>x</p>', PACKAGED)).toBe('block');
    expect(navigationAction('obsidian://open?vault=x', PACKAGED)).toBe('block');
  });

  it('refuses what it cannot parse', () => {
    expect(navigationAction('not a url', PACKAGED)).toBe('block');
    expect(navigationAction('', PACKAGED)).toBe('block');
    expect(navigationAction('https://example.com/', 'not a url')).toBe('external');
  });
});
