import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatGptSetup } from '../../src/renderer/components/ChatGptSetup';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import type { ChatGptStatus, ModelInfo, RateLimitInfo } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Provider, type Review } from '../../src/shared/types';
import {
  CHATGPT_EMPTY_MODEL_LIST,
  CHATGPT_REVIEW_FAILURES,
  DATA_SETTINGS_CHECKBOX,
  MANAGE_USAGE_BUTTON,
  PLAN_WELCOME_DONE,
  PLAN_WELCOME_TEXT,
  PLAN_WELCOME_TITLE,
  TRAINING_WARNING_TITLE
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

const CLAUDE_MODELS: ModelInfo[] = [
  { value: 'default', label: 'Default (recommended)', isDefault: true },
  { value: 'sonnet', label: 'Sonnet' }
];

/** What ChatGPT's runtime check says in a development run on the mock, which the dialog left out from codex.5. */
const DEV_ENDPOINT = 'Using a development endpoint: http://127.0.0.1:4599/v1';

function dialog(
  chatgpt: ChatGptStatus | null,
  /** null for a list not fetched */
  models: ModelInfo[] | null = MODELS,
  options: {
    modelsError?: string;
    loading?: boolean;
    chatgptModel?: string;
    /** the provider chosen, ChatGPT unless said */
    provider?: Provider;
    /** a sign-in waits for the browser */
    waiting?: boolean;
    /** the ChatGPT runtime's message, as a development run gives it */
    runtimeMessage?: string;
  } = {}
): string {
  const provider = options.provider ?? 'chatgpt';
  return decode(
    renderToStaticMarkup(
      createElement(ReviewDialog, {
        review: REVIEW,
        settings: { ...DEFAULT_SETTINGS, provider, chatgptModel: options.chatgptModel ?? '' },
        models: { claude: CLAUDE_MODELS, ...(models === null ? {} : { chatgpt: models }) },
        modelsLoading: options.loading ? { chatgpt: true } : {},
        ...(options.modelsError === undefined ? {} : { modelsError: { chatgpt: options.modelsError } }),
        onRetryModels: () => undefined,
        runtimes: {
          claude: { provider: 'claude', state: 'ready', credential: 'subscription' },
          chatgpt: {
            provider: 'chatgpt',
            state: chatgpt?.signedIn ? 'ready' : 'not-signed-in',
            ...(options.runtimeMessage === undefined ? {} : { message: options.runtimeMessage })
          }
        },
        history: [],
        reviewPath: null,
        unsavedDecisions: 0,
        saving: false,
        onSaveThenStart: () => undefined,
        onStartWithout: () => undefined,
        onApplySettings: () => undefined,
        onNeedModels: () => undefined,
        onCheckClaude: () => undefined,
        checking: false,
        claudeLastFailure: null,
        onOpenSetup: () => undefined,
        chatgpt,
        chatgptWaiting: options.waiting ?? false,
        onOpenChatGptSetup: () => undefined,
        onConfirmDataSettings: () => undefined,
        onOpenDataControls: () => undefined,
        onStart: () => undefined,
        onClose: () => undefined
      })
    )
  );
}

/** The dialog's rows, by the name in their first column. */
const rows = (html: string): string[] =>
  [...html.matchAll(/<div class="modal__row[^"]*"><span>([^<]*)<\/span>/g)].map(([, name = '']) => name);

/**
 * The dialog's markup without what the two providers' dialogs may differ in
 * (codex.5): ChatGPT's Account row, and the options of the Provider and Model
 * lists, which name the provider chosen and its models.
 */
const withoutOwnRows = (html: string): string =>
  html
    .replace(/<div class="modal__row modal__row--account"><span>Account<\/span>[\s\S]*?<\/div>/, '')
    .replace(/<option[^>]*>[^<]*<\/option>/g, '');

describe('Review with AI with ChatGPT chosen (codex.3)', () => {
  it('lists Claude and ChatGPT, OpenAI (API key) gone since codex.6, and chooses ChatGPT', () => {
    const html = dialog(SIGNED_IN);
    const options = [...html.matchAll(/<option value="(\w+)"[^>]*>([^<]*)<\/option>/g)]
      .map(([, value = '', label = '']) => `${value}=${label}`)
      .filter((o) => /^(claude|chatgpt|openai)=/.test(o));
    expect(options).toEqual(['claude=Claude', 'chatgpt=ChatGPT']);
    expect(html).toMatch(/<option value="chatgpt" selected="">ChatGPT<\/option>/);
    expect(html).not.toContain('OpenAI (API key');
  });

  it('shows the account and the model list the sign-in allows', () => {
    const html = dialog(SIGNED_IN);
    expect(text(html)).toContain('Account signed in (Plus)');
    expect(html).toContain('<option value="gpt-5.5" selected="">GPT-5.5 (default)</option>');
    // Claude's notes are not about ChatGPT, and nothing of the OpenAI API key's is left (codex.6).
    expect(html).not.toContain('data-testid="openai-key-line"');
    expect(html).not.toContain('data-testid="claude-setup-warning"');
    expect(html).not.toContain('Billed per token');
    expect(html).not.toContain('data-testid="openai-maturity-note"');
    expect(html).not.toContain('Open Settings');
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
    expect(buttons(html)).toContain('Open Setup');
    expect(html).toMatch(/<option value=""( selected="")?>sign in first<\/option>/);
    expect(text(html)).toContain('The review cannot start until you sign in with ChatGPT.');
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
  });

  it('before the sign-in has been read says not read yet, with Open Setup, and starts nothing', () => {
    const html = dialog(null, []);
    expect(text(html)).toContain('Account not read yet');
    expect(buttons(html)).toContain('Open Setup');
    expect(text(html)).toContain('The review cannot start until the ChatGPT sign-in has been read.');
  });
});

describe('Review with AI as plain with ChatGPT as with Claude (codex.5)', () => {
  const SIGNED_OUT: ChatGptStatus = { ...SIGNED_IN, signedIn: false, plan: null };

  it("has Claude's rows with the account added, and nothing else of ChatGPT's own", () => {
    const claude = dialog(SIGNED_IN, MODELS, { provider: 'claude' });
    const chatgpt = dialog(SIGNED_IN);
    expect(rows(claude)).toEqual(['Provider', 'Model', 'Effort', 'Guidelines']);
    expect(rows(chatgpt)).toEqual(['Provider', 'Account', 'Model', 'Effort', 'Guidelines']);
    // Line for line the same dialog, the Account row and the lists' options apart.
    expect(withoutOwnRows(chatgpt)).toBe(withoutOwnRows(claude));
  });

  it('leaves out "Using ChatGPT plan" with Manage usage, and the note on how the effort is sent', () => {
    for (const html of [
      dialog(SIGNED_IN),
      dialog(SIGNED_OUT, []),
      dialog({ ...SIGNED_IN, dataSettingsConfirmed: false })
    ]) {
      expect(text(html)).not.toContain('Using ChatGPT plan');
      expect(text(html)).not.toContain('usage limits');
      expect(buttons(html)).not.toContain(MANAGE_USAGE_BUTTON);
      expect(html).not.toContain('chatgpt-plan-note');
      expect(text(html)).not.toMatch(/reasoning effort/i);
      expect(html).not.toContain('openai-effort-note');
    }
  });

  it('leaves out the line a development run gives the runtime, as it does for Claude', () => {
    const html = dialog(SIGNED_IN, MODELS, { runtimeMessage: DEV_ENDPOINT });
    expect(text(html)).not.toContain('development endpoint');
    expect(withoutOwnRows(html)).toBe(withoutOwnRows(dialog(SIGNED_IN, MODELS, { provider: 'claude' })));
  });

  it('offers Open Setup beside the account only while there is no sign-in', () => {
    const account = (html: string): string =>
      /<div class="modal__row modal__row--account"><span>Account<\/span>([\s\S]*?)<\/div>/.exec(html)?.[1] ??
      '';
    expect(buttons(account(dialog(SIGNED_IN)))).toEqual([]);
    expect(buttons(account(dialog({ ...SIGNED_IN, dataSettingsConfirmed: false })))).toEqual([]);
    expect(buttons(account(dialog(SIGNED_OUT, [])))).toEqual(['Open Setup']);
    expect(buttons(account(dialog(SIGNED_OUT, [], { waiting: true })))).toEqual(['Open Setup']);
    expect(account(dialog(SIGNED_OUT, [], { waiting: true }))).toContain(
      'data-testid="chatgpt-account-line">waiting for the browser</span>'
    );
    expect(buttons(account(dialog(null, [])))).toEqual(['Open Setup']);
    // Signed in, the row has its third column still, empty, so the account keeps its width.
    expect(account(dialog(SIGNED_IN))).toMatch(/<span class="modal__buttons"><\/span>$/);
  });

  it('keeps the training warning and its box before the first review, in its place under the account', () => {
    const html = dialog({ ...SIGNED_IN, dataSettingsConfirmed: false });
    const warning = html.indexOf('data-testid="chatgpt-training-warning"');
    expect(warning).toBeGreaterThan(html.indexOf('data-testid="chatgpt-account-line"'));
    expect(warning).toBeLessThan(html.indexOf('aria-label="Model"'));
    expect(text(html)).toContain(DATA_SETTINGS_CHECKBOX);
    expect(buttons(html)).toContain('Open Data controls');
    // The rest is Claude's dialog: the warning and the gate it makes, the line
    // beside a disabled Start, are the one thing more.
    const rest = html
      .replace(/<section[^>]*data-testid="chatgpt-training-warning"[\s\S]*?<\/section>/, '')
      .replace(/<span class="modal__hint"[^>]*data-testid="chatgpt-start-blocker">[^<]*<\/span>/, '');
    const enabled = (markup: string): string => withoutOwnRows(markup).replace(/ disabled=""/g, '');
    expect(enabled(rest)).toBe(enabled(dialog(SIGNED_IN, MODELS, { provider: 'claude' })));
    expect(buttons(html)).toContain('Start review [primary] [disabled]');
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
