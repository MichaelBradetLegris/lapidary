import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { REVIEW_SIZE_INFO, REVIEW_SIZE_WARN } from '../../src/shared/text/stats';
import { DEFAULT_SETTINGS, type Provider, type Review } from '../../src/shared/types';

/* files.10: Review with AI says under the word count when a chapter is long
   (a grey note from 12,000 words) or very long (an orange box from 40,000),
   for either provider. Rendered with react-dom/server; effects do not run.
   Type-checked with the renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** A chapter of `words` words in paragraphs of 100, after a frontmatter the count leaves out. */
function chapterOf(words: number): string {
  const paragraphs: string[] = [];
  for (let start = 0; start < words; start += 100) {
    const length = Math.min(100, words - start);
    paragraphs.push(Array.from({ length }, (_, i) => `word${start + i}`).join(' '));
  }
  return `---\ntags: [draft, long, chapter]\n---\n\n${paragraphs.join('\n\n')}\n`;
}

function dialog(words: number, provider: Provider = 'openai'): string {
  const review: Review = {
    version: 1,
    id: 'chapter-09--2026-10-19T10-00-00-000Z',
    sourcePath: 'C:/Vault/Novel/Chapter 09.md',
    createdAt: '2026-10-19T10:00:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    base: { text: chapterOf(words), hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    generator: { kind: 'manual' },
    hunks: [],
    comments: []
  };
  return decode(
    renderToStaticMarkup(
      createElement(ReviewDialog, {
        review,
        settings: { ...DEFAULT_SETTINGS, provider },
        models: {},
        modelsLoading: {},
        runtimes: {},
        keyStatus: null,
        history: [],
        reviewPath: null,
        unsavedDecisions: 0,
        saving: false,
        onSaveThenStart: () => undefined,
        onStartWithout: () => undefined,
        onApplySettings: () => undefined,
        onNeedModels: () => undefined,
        onOpenSettings: () => undefined,
        onCheckClaude: () => undefined,
        checking: false,
        claudeLastFailure: null,
        onOpenSetup: () => undefined,
        onStart: () => undefined,
        onClose: () => undefined
      })
    )
  );
}

/** What follows the word count's line, up to the next element after the advice. */
function afterCount(html: string): string {
  const at = html.indexOf('you to accept or dismiss.</p>');
  expect(at).toBeGreaterThan(0);
  return html.slice(at + 'you to accept or dismiss.</p>'.length);
}

describe('Review with AI under a long chapter', () => {
  it('says nothing under 12,000 words', () => {
    const html = dialog(11_999);
    expect(html).toContain('11,999 words.');
    expect(html).not.toContain('review-size-advice');
  });

  it('adds a grey note right under the count from 12,000 words to 39,999', () => {
    for (const words of [12_000, 39_999]) {
      const html = dialog(words);
      expect(html).toContain(`${words.toLocaleString()} words.`);
      expect(
        afterCount(html).startsWith(
          `<p class="modal__note" data-testid="review-size-advice">${REVIEW_SIZE_INFO}</p>`
        )
      ).toBe(true);
      expect(html).not.toContain('class="modal__warn" role="note" data-testid="review-size-advice"');
    }
  });

  it('puts an orange box there instead from 40,000 words', () => {
    const html = dialog(40_000);
    expect(
      afterCount(html).startsWith(
        `<div class="modal__warn" role="note" data-testid="review-size-advice"><span>${REVIEW_SIZE_WARN}</span></div>`
      )
    ).toBe(true);
    expect(html).not.toContain(`<p class="modal__note" data-testid="review-size-advice">`);
  });

  it('says the same with Claude as the provider', () => {
    expect(afterCount(dialog(40_000, 'claude'))).toContain(REVIEW_SIZE_WARN);
    expect(afterCount(dialog(12_000, 'claude'))).toContain(REVIEW_SIZE_INFO);
  });
});
