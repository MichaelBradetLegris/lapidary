import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import { openAiKeyRowLabel, openAiMaturityNote, openAiProviderLabel } from '../../src/shared/ai/openai';
import type { OpenAiKeyStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Provider, type Review } from '../../src/shared/types';

/* hardening.11: OpenAI is labelled experimental where it is chosen and where
   its key is kept. Review with AI names the option "OpenAI (API key,
   experimental)" and, while OpenAI is the provider, says under the select
   what that means; Settings names the key's row "OpenAI API key
   (experimental)". All of it reads OPENAI_MATURITY (test/openaiMaturity.test.ts
   pins that nothing else spells the word). Rendered with react-dom/server;
   effects do not run. Type-checked with the renderer's project
   (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const KEY: OpenAiKeyStatus = { configured: true, source: 'stored', last4: 'abcd', encryptionAvailable: true };

const REVIEW: Review = {
  version: 1,
  id: 'chapter-01--2026-10-20T10-00-00-000Z',
  sourcePath: 'C:/Vault/Novel/Chapter 01.md',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  base: { text: 'One paragraph.\n\nAnother one.\n', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [],
  comments: []
};

function reviewDialog(provider: Provider): string {
  return decode(
    renderToStaticMarkup(
      createElement(ReviewDialog, {
        review: REVIEW,
        settings: { ...DEFAULT_SETTINGS, provider },
        models: {},
        modelsLoading: {},
        runtimes: {},
        keyStatus: KEY,
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

function settingsDialog(keyStatus: OpenAiKeyStatus | null): string {
  return decode(
    renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        models: [],
        runtime: null,
        keyStatus,
        onApply: () => undefined,
        onKeyChanged: () => undefined,
        onClose: () => undefined,
        onOpenSetup: () => undefined,
        onShowWelcome: () => undefined
      })
    )
  );
}

/** The provider row, from its label to the end of its div. */
function providerRow(html: string): string {
  const row =
    /<div class="modal__row"><span>Provider<\/span><select[\s\S]*?<\/select><span><\/span><\/div>/.exec(
      html
    )?.[0];
  expect(row).toBeDefined();
  return row ?? '';
}

describe('Review with AI labels OpenAI experimental (hardening.11)', () => {
  it('names the option "OpenAI (API key, experimental)", for either provider', () => {
    expect(providerRow(reviewDialog('openai'))).toContain(
      '<option value="openai" selected="">OpenAI (API key, experimental)</option>'
    );
    expect(providerRow(reviewDialog('claude'))).toContain(
      '<option value="openai">OpenAI (API key, experimental)</option>'
    );
    expect(openAiProviderLabel()).toBe('OpenAI (API key, experimental)');
  });

  it('puts the note right under the select, before the API key row, with OpenAI chosen', () => {
    const html = reviewDialog('openai');
    const row = providerRow(html);
    const after = html.slice(html.indexOf(row) + row.length);
    const note = openAiMaturityNote();
    expect(note).toMatch(/is experimental\. It has been tested only with a stand-in/);
    expect(after.startsWith(`<p class="modal__note" data-testid="openai-maturity-note">${note}</p>`)).toBe(
      true
    );
    expect(after).toMatch(/^<p [^>]*>[^<]*<\/p><div class="modal__row"><span>API key<\/span>/);
  });

  it('has no note with Claude chosen', () => {
    const html = reviewDialog('claude');
    expect(html).not.toContain('openai-maturity-note');
    expect(html).not.toContain(openAiMaturityNote() ?? 'no note');
  });
});

describe("Settings' OpenAI key row (hardening.11)", () => {
  it('is named "OpenAI API key (experimental)", with the key or without one', () => {
    for (const key of [KEY, null]) {
      const html = settingsDialog(key);
      expect(html).toContain(
        '<div class="modal__row"><span>OpenAI API key (experimental)</span><span class="modal__path'
      );
      expect(openAiKeyRowLabel()).toBe('OpenAI API key (experimental)');
      // The field keeps its own name, which says what it holds.
      expect(html).toContain('aria-label="OpenAI API key"');
    }
  });
});
