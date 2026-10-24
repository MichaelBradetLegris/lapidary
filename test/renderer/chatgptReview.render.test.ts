import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptSetup } from '../../src/renderer/components/ChatGptSetup';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import type { ChatGptStatus, ModelInfo, RateLimitInfo } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import {
  CHATGPT_EMPTY_MODEL_LIST,
  CHATGPT_PLAN_NOTE,
  CHATGPT_REVIEW_FAILURES,
  DATA_SETTINGS_CHECKBOX,
  MANAGE_USAGE_BUTTON,
  PLAN_WELCOME_DONE,
  PLAN_WELCOME_TEXT,
  PLAN_WELCOME_TITLE,
  TRAINING_WARNING_TITLE,
  USING_CHATGPT_PLAN
} from '../../src/shared/ui/chatgpt';
import { LIST_MODELS_AGAIN, NO_MODEL_BLOCKER } from '../../src/shared/ui/models';

/* codex.3: ChatGPT in Review with AI, the welcome on the Setup screen's
   ChatGPT view after the first sign-in, and the ChatGPT plan's usage in the
   status bar, rendered with react-dom/server. Effects do not run here, so
   nothing is called, and the dialog's warning shows from its first draw.
   This file is type-checked with the renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

/** Each button's label, with [primary] or [disabled] after it. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs = '', inner = '']) => {
    const marks = [
      / class="[^"]*primary/.test(attrs) ? ' [primary]' : '',
      / disabled=""/.test(attrs) ? ' [disabled]' : ''
    ].join('');
    return `${text(inner)}${marks}`;
  });
}

const REVIEW: Review = {
  version: 1,
  id: 'chapter-01--2026-10-24T10-00-00-000Z',
  sourcePath: 'C:/Vault/Novel/Chapter 01.md',
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-24T10:00:00.000Z',
  base: { text: 'One paragraph.\n\nAnother one.\n', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [],
  comments: []
};

const SIGNED_IN: ChatGptStatus = {
  signedIn: true,
  plan: 'Plus',
  dataSettingsConfirmed: true,
  signingIn: false,
  registered: true,
  encryptionAvailable: true
};

const MODELS: ModelInfo[] = [
  { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
  { value: 'gpt-5.5', label: 'GPT-5.5 (default)', isDefault: true }
];

function dialog(
  chatgpt: ChatGptStatus | null,
  /** null for a list not fetched */
  models: ModelInfo[] | null = MODELS,
  options: { modelsError?: string; loading?: boolean; chatgptModel?: string } = {}
): string {
  return decode(
    renderToStaticMarkup(
      createElement(ReviewDialog, {
        review: REVIEW,
        settings: { ...DEFAULT_SETTINGS, provider: 'chatgpt', chatgptModel: options.chatgptModel ?? '' },
        models: models === null ? {} : { chatgpt: models },
        modelsLoading: options.loading ? { chatgpt: true } : {},
        ...(options.modelsError === undefined ? {} : { modelsError: { chatgpt: options.modelsError } }),
        onRetryModels: () => undefined,
        runtimes: { chatgpt: { provider: 'chatgpt', state: chatgpt?.signedIn ? 'ready' : 'not-signed-in' } },
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
        chatgpt,
        chatgptWaiting: false,
        onOpenChatGptSetup: () => undefined,
        onConfirmDataSettings: () => undefined,
        onOpenDataControls: () => undefined,
        onManageUsage: () => undefined,
        onStart: () => undefined,
        onClose: () => undefined
      })
    )
  );
}

describe('Review with AI with ChatGPT chosen (codex.3)', () => {
  it('lists ChatGPT between Claude and OpenAI (API key), and chooses it', () => {
    const html = dialog(SIGNED_IN);
    const options = [...html.matchAll(/<option value="(\w+)"[^>]*>([^<]*)<\/option>/g)]
      .map(([, value = '', label = '']) => `${value}=${label}`)
      .filter((o) => /^(claude|chatgpt|openai)=/.test(o));
    expect(options).toEqual(['claude=Claude', 'chatgpt=ChatGPT', 'openai=OpenAI (API key, experimental)']);
    expect(html).toMatch(/<option value="chatgpt" selected="">ChatGPT<\/option>/);
  });

  it('shows the account with Open Setup, "Using ChatGPT plan" with Manage usage, and the model list the sign-in allows', () => {
    const html = dialog(SIGNED_IN);
    expect(text(html)).toContain('Account signed in (Plus)');
    expect(text(html)).toContain(`${USING_CHATGPT_PLAN}. ${CHATGPT_PLAN_NOTE} ${MANAGE_USAGE_BUTTON}`);
    expect(buttons(html)).toEqual(expect.arrayContaining(['Open Setup', MANAGE_USAGE_BUTTON]));
    expect(html).toContain('<option value="gpt-5.5" selected="">GPT-5.5 (default)</option>');
    // Claude's notes and OpenAI's key are not about ChatGPT.
    expect(html).not.toContain('data-testid="openai-key-line"');
    expect(html).not.toContain('data-testid="claude-setup-warning"');
    expect(html).not.toContain('Billed per token');
    expect(html).not.toContain('data-testid="openai-maturity-note"');
  });

  it('starts once signed in with the box ticked, with no training warning to show', () => {
    const html = dialog(SIGNED_IN);
    expect(html).not.toContain('data-testid="chatgpt-training-warning"');
    expect(html).not.toContain('data-testid="chatgpt-start-blocker"');
    expect(buttons(html)).toContain('Start review [primary]');
  });

  it('before the first review shows the training warning with the box, and waits for the box', () => {
    const html = dialog({ ...SIGNED_IN, dataSettingsConfirmed: false });
    expect(html).toContain('data-testid="chatgpt-training-warning"');
    // A heading under the dialog's own.
    expect(html).toMatch(
      new RegExp(`<h3 id="[^"]+" class="data-warning__title">${TRAINING_WARNING_TITLE}</h3>`)
    );
    expect(text(html)).toContain(DATA_SETTINGS_CHECKBOX);
    expect(html).toMatch(/<input type="checkbox" aria-describedby="[^"]+"\/>/);
    expect(text(html)).toContain(`The review cannot start until you tick ${DATA_SETTINGS_CHECKBOX}.`);
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
  });

  it('while signed out says so, with Open Setup, and starts nothing', () => {
    const html = dialog({ ...SIGNED_IN, signedIn: false, plan: null, dataSettingsConfirmed: false }, []);
    expect(text(html)).toContain('Account not signed in');
    expect(html).toContain('modal__path--warn');
    expect(html).toMatch(/<option value=""( selected="")?>sign in first<\/option>/);
    expect(text(html)).toContain('The review cannot start until you sign in with ChatGPT.');
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
  });

  it('before the sign-in has been read says not read yet, and starts nothing', () => {
    const html = dialog(null, []);
    expect(text(html)).toContain('Account not read yet');
    expect(text(html)).toContain('The review cannot start until the ChatGPT sign-in has been read.');
  });
});

describe('a ChatGPT model list that failed, or came back empty (codex.3 review)', () => {
  /** The box under the Model row: its words and buttons, or null. */
  function listBox(html: string): { role: string; text: string; buttons: string[] } | null {
    const box =
      /<div class="modal__warn" role="(\w+)" data-testid="model-list-failed">([\s\S]*?)<\/div>/.exec(html);
    const words = /<span>([\s\S]*?)<\/span>/.exec(box?.[2] ?? '');
    return box ? { role: box[1] ?? '', text: text(words?.[1] ?? ''), buttons: buttons(box[2] ?? '') } : null;
  }

  it("says why under the Model row, in main's words, with Try again, and Start waits for a model", () => {
    const html = dialog(SIGNED_IN, null, { modelsError: CHATGPT_REVIEW_FAILURES.modelsNoAnswer });
    expect(listBox(html)).toEqual({
      role: 'alert',
      text: `The models on your ChatGPT plan could not be listed. ${CHATGPT_REVIEW_FAILURES.modelsNoAnswer}`,
      buttons: [LIST_MODELS_AGAIN]
    });
    // Under the Model row, before the effort.
    expect(html.indexOf('data-testid="model-list-failed"')).toBeGreaterThan(
      html.indexOf('aria-label="Model"')
    );
    expect(html.indexOf('data-testid="model-list-failed"')).toBeLessThan(html.indexOf('aria-label="Effort"'));
    expect(html).toContain(
      `<span class="modal__hint" style="margin:0" data-testid="model-start-blocker">${NO_MODEL_BLOCKER}</span>`
    );
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
  });

  it('keeps the box while the list is asked for again, Try again held, and says nothing beside Start meanwhile', () => {
    const html = dialog(SIGNED_IN, null, { modelsError: 'Offline.', loading: true });
    expect(html).toMatch(
      /data-testid="model-list-failed"><span>[^<]*<\/span><button type="button" aria-disabled="true">Try again<\/button>/
    );
    expect(html).not.toContain('data-testid="model-start-blocker"');
    expect(html).toMatch(/<option value=""( selected="")?>loading models…<\/option>/);
  });

  it('starts with the model the author chose even while the list cannot be read', () => {
    const html = dialog(SIGNED_IN, null, { modelsError: 'Offline.', chatgptModel: 'gpt-5-mini' });
    expect(listBox(html)?.text).toBe('The models on your ChatGPT plan could not be listed. Offline.');
    expect(html).not.toContain('data-testid="model-start-blocker"');
    expect(buttons(html)).toContain('Start review [primary]');
  });

  it('says an empty list, with Try again, and Start waits for a model', () => {
    const html = dialog(SIGNED_IN, []);
    expect(listBox(html)).toEqual({
      role: 'alert',
      text: CHATGPT_EMPTY_MODEL_LIST,
      buttons: [LIST_MODELS_AGAIN]
    });
    expect(text(html)).toContain(NO_MODEL_BLOCKER);
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
  });

  it('says nothing of the list while signed out: the sign-in comes first', () => {
    const html = dialog({ ...SIGNED_IN, signedIn: false, plan: null, dataSettingsConfirmed: false }, []);
    expect(listBox(html)).toBeNull();
    expect(html).not.toContain('data-testid="model-start-blocker"');
  });

  it('says nothing while the list loads the first time', () => {
    const html = dialog(SIGNED_IN, null, { loading: true });
    expect(listBox(html)).toBeNull();
    expect(html).not.toContain('data-testid="model-start-blocker"');
  });
});

describe("the ChatGPT view's welcome after the first sign-in (codex.3)", () => {
  function view(welcome: boolean): string {
    return decode(
      renderToStaticMarkup(
        createElement(ChatGptSetup, {
          status: SIGNED_IN,
          waiting: false,
          busy: false,
          outcome: null,
          onSignIn: () => undefined,
          onCancelSignIn: () => undefined,
          onSignOut: () => undefined,
          onConfirmDataSettings: () => undefined,
          onOpenDataControls: () => undefined,
          welcome,
          onManageUsage: () => undefined,
          onWelcomeDone: () => undefined,
          onClose: () => undefined
        })
      )
    );
  }

  it("says OpenAI's words, with Manage usage and Got it, under the status card and before the warning", () => {
    const html = view(true);
    const welcome = html.indexOf('data-testid="chatgpt-plan-welcome"');
    expect(welcome).toBeGreaterThan(html.indexOf('aria-label="ChatGPT status"'));
    expect(welcome).toBeLessThan(html.indexOf('data-testid="chatgpt-training-warning"'));
    expect(text(html)).toContain(
      `${PLAN_WELCOME_TITLE} ${PLAN_WELCOME_TEXT} ${MANAGE_USAGE_BUTTON} ${PLAN_WELCOME_DONE}`
    );
    expect(buttons(html)).toEqual(
      expect.arrayContaining([MANAGE_USAGE_BUTTON, `${PLAN_WELCOME_DONE} [primary]`])
    );
  });

  it('is gone once Got it has been pressed', () => {
    expect(view(false)).not.toContain('chatgpt-plan-welcome');
  });
});

describe("the ChatGPT plan's usage in the status bar (codex.3)", () => {
  const NOW = new Date(2026, 9, 24, 13, 35);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function bar(rateLimit: RateLimitInfo): string {
    return decode(
      renderToStaticMarkup(
        createElement(StatusBar, { review: null, runtimeLabel: 'ChatGPT ready (Plus)', rateLimit })
      )
    );
  }

  it("words the notice as Claude's, and its tooltip as the ChatGPT plan's", () => {
    const resetsAt = new Date(2026, 9, 24, 15, 45).toISOString();
    const html = bar({
      provider: 'chatgpt',
      status: 'allowed',
      kind: 'five_hour',
      utilization: 0.85,
      resetsAt
    });
    expect(html).toContain('>5-hour limit 85% used, resets 15:45</span>');
    expect(html).toContain(
      'title="85% of your ChatGPT plan\'s 5-hour limit is used. It resets at 15:45, in 2 hours and 10 minutes."'
    );
    expect(html).toContain('>ChatGPT ready (Plus)</span>');
  });
});
