import { describe, expect, it } from 'vitest';
import {
  CHATGPT_LIMITS_UNKNOWN,
  CHATGPT_LIMIT_HEADERS,
  chatGptModelOptions,
  chatGptModelToSend,
  defaultChatGptModel,
  readChatGptLimits,
  readChatGptModels,
  usageLimitNotice,
  windowKind
} from '../../src/shared/ai/chatgpt';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus, RateLimitInfo, RuntimeStatus } from '../../src/shared/ipc';
import { withGeneratorProvider } from '../../src/shared/review';
import { normalizeSettings } from '../../src/shared/settings';
import type { Review } from '../../src/shared/types';
import {
  CHATGPT_REVIEW_FAILURES,
  CHATGPT_USAGE_URL,
  DATA_SETTINGS_CHECKBOX,
  DATA_SETTINGS_GATE_TEXT,
  EXTERNAL_PAGE_URLS,
  MANAGE_USAGE_BUTTON,
  PLAN_WELCOME_DONE,
  PLAN_WELCOME_HINT,
  PLAN_WELCOME_TEXT,
  PLAN_WELCOME_TITLE,
  SIGN_IN_BUTTON,
  chatGptFailureRoute,
  chatGptStartBlocker,
  chatGptUsageLimitCard,
  notSignedInText,
  planWelcomeShown,
  renewRefusedText,
  renewServerText,
  unsupportedRequestText
} from '../../src/shared/ui/chatgpt';
import { RUNTIME_BUTTON_TITLE, runtimeLabel } from '../../src/shared/ui/setup';
import { describeRateLimit, limitName, rateLimitTitle } from '../../src/shared/ui/usage';
import { CHATGPT_STEP_TEXT, SET_UP_CHATGPT, USE_CLAUDE, welcomeSteps } from '../../src/shared/ui/welcome';

/* codex.3: the pure half of a review on the ChatGPT plan (PLAN 5.8): the
   model list the sign-in allows, the plan's limits from an answer's headers,
   in setup.9's words, the status bar's label, and what the page says when a
   review cannot run or stops. The provider itself is driven end to end in
   test/main/chatgptProvider.test.ts. */

const SIGNED_IN: ChatGptStatus = {
  signedIn: true,
  plan: 'Plus',
  dataSettingsConfirmed: true,
  signingIn: false,
  registered: true,
  encryptionAvailable: true
};

const NOW = new Date(2026, 9, 24, 12, 0, 0);

/** Headers as a ChatGPT answer would carry them. */
function headers(values: Record<string, string>): (name: string) => string | null {
  return (name) => values[name] ?? null;
}

describe('the model list a sign-in allows', () => {
  it("shows the models OpenAI marks `list`, in OpenAI's order, by their names, each once", () => {
    expect(
      readChatGptModels({
        models: [
          { slug: 'gpt-5.5-codex', display_name: 'GPT-5.5 Codex', visibility: 'list' },
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
          { slug: 'gpt-5.5-hidden', display_name: 'Hidden', visibility: 'hide' },
          { slug: 'gpt-5-mini', visibility: 'list' },
          { slug: 'gpt-5.5', display_name: 'Again', visibility: 'list' },
          { display_name: 'No slug', visibility: 'list' },
          { slug: 'no-visibility', display_name: 'Unmarked' },
          'junk'
        ]
      })
    ).toEqual([
      { slug: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex' },
      { slug: 'gpt-5.5', displayName: 'GPT-5.5' },
      { slug: 'gpt-5-mini', displayName: 'gpt-5-mini' }
    ]);
  });

  it('reads the shape the endpoint gives an API key too, each id as its own name, and nothing else', () => {
    expect(readChatGptModels({ object: 'list', data: [{ id: 'gpt-5.5' }, { id: '' }, { nope: 1 }] })).toEqual(
      [{ slug: 'gpt-5.5', displayName: 'gpt-5.5' }]
    );
    expect(readChatGptModels({ models: [] })).toEqual([]);
    expect(readChatGptModels({ nothing: true })).toBeNull();
    expect(readChatGptModels([])).toBeNull();
    expect(readChatGptModels(null)).toBeNull();
  });

  it("defaults to the first model that is not a -pro, -codex or -chat one, else the first, in the list's order", () => {
    const list = (...slugs: string[]): Array<{ slug: string; displayName: string }> =>
      slugs.map((slug) => ({ slug, displayName: slug }));
    expect(defaultChatGptModel(list('gpt-5.5-codex', 'gpt-5.5', 'gpt-6'))).toBe('gpt-5.5');
    expect(defaultChatGptModel(list('gpt-5.5-pro', 'gpt-5-chat-latest', 'gpt-5-mini'))).toBe('gpt-5-mini');
    expect(defaultChatGptModel(list('gpt-5.5-codex', 'gpt-5.5-pro'))).toBe('gpt-5.5-codex');
    expect(defaultChatGptModel([])).toBeNull();
  });

  it('marks the default "(default)", and gives the slug where the name differs', () => {
    expect(
      chatGptModelOptions([
        { slug: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex' },
        { slug: 'gpt-5.5', displayName: 'GPT-5.5' },
        { slug: 'gpt-5-mini', displayName: 'gpt-5-mini' }
      ])
    ).toEqual([
      { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex', description: 'gpt-5.5-codex' },
      { value: 'gpt-5.5', label: 'GPT-5.5 (default)', isDefault: true, description: 'gpt-5.5' },
      { value: 'gpt-5-mini', label: 'gpt-5-mini' }
    ]);
  });

  it("sends the author's choice, else the default, or nothing from an empty list", () => {
    const models = [{ slug: 'gpt-5.5', displayName: 'GPT-5.5' }];
    expect(chatGptModelToSend(' gpt-5-mini ', models)).toBe('gpt-5-mini');
    expect(chatGptModelToSend('', models)).toBe('gpt-5.5');
    expect(chatGptModelToSend('', [])).toBeNull();
  });
});

describe("the plan's limits, from an answer's headers", () => {
  it("names a limit by its window, as Claude's are named", () => {
    expect(windowKind(300)).toBe('five_hour');
    expect(windowKind(10080)).toBe('seven_day');
    expect(windowKind(60)).toBe('hourly');
    expect(windowKind(1440)).toBe('daily');
    expect(windowKind(180)).toBe('3_hour');
    expect(windowKind(43200)).toBe('30_day');
    for (const odd of [0, -60, 45, 90.5, Number.NaN]) expect(windowKind(odd)).toBeUndefined();
    expect(limitName('five_hour')).toBe('5-hour limit');
    expect(limitName('seven_day')).toBe('weekly limit');
    expect(limitName('hourly')).toBe('hourly limit');
    expect(limitName('daily')).toBe('daily limit');
    expect(limitName('3_hour')).toBe('3-hour limit');
    expect(limitName('30_day')).toBe('30-day limit');
    expect(limitName('99999_day')).toBe('usage limit');
    expect(limitName(undefined)).toBe('usage limit');
  });

  it('reads the headers Codex reads, and nothing from an answer that has none', () => {
    expect(CHATGPT_LIMIT_HEADERS.primary).toEqual({
      used: 'x-codex-primary-used-percent',
      window: 'x-codex-primary-window-minutes',
      resetAt: 'x-codex-primary-reset-at',
      resetAfter: 'x-codex-primary-reset-after-seconds'
    });
    expect(readChatGptLimits(headers({}), NOW)).toBeNull();
    expect(readChatGptLimits(headers({ 'x-codex-primary-used-percent': 'lots' }), NOW)).toBeNull();
    expect(readChatGptLimits(headers({ 'x-codex-primary-used-percent': '-3' }), NOW)).toBeNull();
  });

  it('gives the limit most used while none is reached, with when it resets', () => {
    const reset = Math.floor(NOW.getTime() / 1000) + 95 * 60;
    expect(
      readChatGptLimits(
        headers({
          'x-codex-primary-used-percent': '85',
          'x-codex-primary-window-minutes': '300',
          'x-codex-primary-reset-at': String(reset),
          'x-codex-secondary-used-percent': '40',
          'x-codex-secondary-window-minutes': '10080'
        }),
        NOW
      )
    ).toEqual({
      provider: 'chatgpt',
      status: 'allowed',
      kind: 'five_hour',
      utilization: 0.85,
      resetsAt: new Date(reset * 1000).toISOString()
    });
    // An older Codex's form: seconds until the reset.
    expect(
      readChatGptLimits(
        headers({
          'x-codex-secondary-used-percent': '92.5',
          'x-codex-secondary-window-minutes': '10080',
          'x-codex-secondary-reset-after-seconds': '3600'
        }),
        NOW
      )
    ).toEqual({
      provider: 'chatgpt',
      status: 'allowed',
      kind: 'seven_day',
      utilization: 0.925,
      resetsAt: new Date(NOW.getTime() + 3_600_000).toISOString()
    });
  });

  it('gives a limit reached, the one that resets last when both are, since no review runs until both have', () => {
    const at = (minutes: number): string => String(Math.floor(NOW.getTime() / 1000) + minutes * 60);
    const both = readChatGptLimits(
      headers({
        'x-codex-primary-used-percent': '100',
        'x-codex-primary-window-minutes': '300',
        'x-codex-primary-reset-at': at(30),
        'x-codex-secondary-used-percent': '100',
        'x-codex-secondary-window-minutes': '10080',
        'x-codex-secondary-reset-at': at(3000)
      }),
      NOW
    );
    expect(both).toMatchObject({ status: 'rejected', kind: 'seven_day', utilization: 1 });
    const weekly = readChatGptLimits(
      headers({
        'x-codex-primary-used-percent': '99',
        'x-codex-primary-window-minutes': '300',
        'x-codex-secondary-used-percent': '100',
        'x-codex-secondary-window-minutes': '10080'
      }),
      NOW
    );
    expect(weekly).toMatchObject({ status: 'rejected', kind: 'seven_day' });
  });

  it('stands a refusal with no limit in its headers for a limit reached with no name and no reset', () => {
    expect(usageLimitNotice(null)).toEqual({ provider: 'chatgpt', status: 'rejected' });
    const reached: RateLimitInfo = { provider: 'chatgpt', status: 'rejected', kind: 'five_hour' };
    expect(usageLimitNotice(reached)).toBe(reached);
    expect(usageLimitNotice({ provider: 'chatgpt', status: 'allowed', utilization: 0.5 })).toEqual({
      provider: 'chatgpt',
      status: 'rejected'
    });
    expect(describeRateLimit(CHATGPT_LIMITS_UNKNOWN, NOW)).toBeNull();
  });

  it("words a ChatGPT plan's notice in setup.9's words, and its tooltip as the ChatGPT plan's", () => {
    const resetsAt = new Date(NOW.getTime() + 130 * 60_000).toISOString();
    const near: RateLimitInfo = {
      provider: 'chatgpt',
      status: 'allowed',
      kind: 'five_hour',
      utilization: 0.85,
      resetsAt
    };
    expect(describeRateLimit(near, NOW)).toBe('5-hour limit 85% used, resets 14:10');
    expect(rateLimitTitle(near, NOW)).toBe(
      "85% of your ChatGPT plan's 5-hour limit is used. It resets at 14:10, in 2 hours and 10 minutes."
    );
    const reached: RateLimitInfo = { provider: 'chatgpt', status: 'rejected', kind: 'seven_day', resetsAt };
    expect(describeRateLimit(reached, NOW)).toBe('Weekly limit reached, resets 14:10');
    expect(rateLimitTitle(reached, NOW)).toBe(
      "Your ChatGPT plan's weekly limit is used up, so reviews with ChatGPT stop until it resets at 14:10, in 2 hours and 10 minutes."
    );
    const bare: RateLimitInfo = { provider: 'chatgpt', status: 'rejected' };
    expect(describeRateLimit(bare, NOW)).toBe('Usage limit reached');
    expect(rateLimitTitle(bare, NOW)).toBe(
      "A ChatGPT usage limit has been reached, your plan's or one OpenAI sets for this app, so reviews with ChatGPT stop until it resets."
    );
    // Claude's own are as they were.
    expect(rateLimitTitle({ status: 'rejected', kind: 'five_hour', resetsAt }, NOW)).toBe(
      "Your Claude plan's 5-hour limit is used up, so reviews with Claude stop until it resets at 14:10, in 2 hours and 10 minutes."
    );
  });
});

describe("the status bar's words for ChatGPT", () => {
  const runtime = (patch: Partial<RuntimeStatus>): RuntimeStatus => ({
    provider: 'chatgpt',
    state: 'ready',
    ...patch
  });

  it('says ready with the plan, not signed in, a usage limit reached, or a check that failed', () => {
    expect(runtimeLabel(runtime({ plan: 'Plus' }))).toBe('ChatGPT ready (Plus)');
    expect(runtimeLabel(runtime({}))).toBe('ChatGPT ready');
    expect(runtimeLabel(runtime({ state: 'not-signed-in' }))).toBe('ChatGPT: not signed in');
    expect(runtimeLabel(runtime({ state: 'error' }))).toBe('ChatGPT: could not check');
    expect(runtimeLabel(runtime({ plan: 'Plus' }), { code: 'chatgpt-usage-limit' })).toBe(
      'ChatGPT: usage limit reached'
    );
    expect(runtimeLabel(runtime({ plan: 'Plus' }), { code: 'chatgpt-failed' })).toBe('ChatGPT ready (Plus)');
  });

  it("opens Setup, its ChatGPT view, from the label, as Claude's opens its own", () => {
    expect(RUNTIME_BUTTON_TITLE).toBe('Open Setup');
  });
});

describe('what the page says about a review on the plan', () => {
  it('keeps the review from starting until there is a sign-in, then the box', () => {
    expect(chatGptStartBlocker(null)).toBe(
      'The review cannot start until the ChatGPT sign-in has been read.'
    );
    expect(chatGptStartBlocker({ ...SIGNED_IN, signedIn: false, dataSettingsConfirmed: false })).toBe(
      'The review cannot start until you sign in with ChatGPT.'
    );
    expect(chatGptStartBlocker({ ...SIGNED_IN, dataSettingsConfirmed: false })).toBe(
      `The review cannot start until you tick ${DATA_SETTINGS_CHECKBOX}.`
    );
    expect(chatGptStartBlocker(SIGNED_IN)).toBeNull();
    expect(DATA_SETTINGS_GATE_TEXT).toContain(DATA_SETTINGS_CHECKBOX);
  });

  it('says a sign-in that is not there, has ended or lost the plan as not signed in, with the way back', () => {
    expect(notSignedInText('signed-out')).toBe(
      `${APP_NAME} is not signed in to ChatGPT. Choose ${SIGN_IN_BUTTON} to review on your ChatGPT plan.`
    );
    expect(notSignedInText('ended')).toContain('Your ChatGPT sign-in has ended.');
    expect(notSignedInText('ended')).toContain(`nothing in ${APP_NAME} is lost`);
    expect(notSignedInText('no-plan-use')).toContain(
      `OpenAI no longer lets ${APP_NAME} use your ChatGPT plan`
    );
    for (const reason of ['signed-out', 'ended', 'no-plan-use'] as const) {
      expect(notSignedInText(reason)).not.toMatch(/fail/i);
    }
  });

  it('sends a sign-in that is not there, and the box, to the ChatGPT view, a usage limit to its card, the rest to a card', () => {
    expect(chatGptFailureRoute('chatgpt-not-signed-in')).toBe('setup');
    expect(chatGptFailureRoute('chatgpt-data-settings')).toBe('setup');
    expect(chatGptFailureRoute('chatgpt-usage-limit')).toBe('usage-card');
    for (const code of ['chatgpt-failed', 'chatgpt-server', 'chatgpt-invalid-output', 'cancelled']) {
      expect(chatGptFailureRoute(code)).toBe('card');
    }
  });

  it("adds when the limit resets to the usage limit's card, when the notice says, and never a time gone by", () => {
    const message = CHATGPT_REVIEW_FAILURES.usageLimit;
    const resetsAt = new Date(NOW.getTime() + 95 * 60_000).toISOString();
    expect(
      chatGptUsageLimitCard(
        message,
        { provider: 'chatgpt', status: 'rejected', kind: 'five_hour', resetsAt },
        NOW
      )
    ).toBe(`${message} The 5-hour limit resets at 13:35.`);
    expect(chatGptUsageLimitCard(message, { provider: 'chatgpt', status: 'rejected' }, NOW)).toBe(message);
    expect(chatGptUsageLimitCard(message, { status: 'rejected', kind: 'five_hour', resetsAt }, NOW)).toBe(
      message
    );
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    expect(
      chatGptUsageLimitCard(message, { provider: 'chatgpt', status: 'rejected', resetsAt: past }, NOW)
    ).toBe(message);
    expect(chatGptUsageLimitCard(message, null, NOW)).toBe(message);
  });

  it("says the plan's failures in its own words, naming no more of OpenAI's than a parameter or a status", () => {
    expect(CHATGPT_REVIEW_FAILURES.usageLimit).toContain(
      "review your plan or this app's limit in ChatGPT's settings"
    );
    expect(CHATGPT_REVIEW_FAILURES.structuredOutput).toContain('structured output (text.format)');
    expect(unsupportedRequestText('top_p')).toContain('(top_p)');
    expect(unsupportedRequestText('a sentence with spaces')).not.toContain('(');
    expect(unsupportedRequestText(null)).not.toContain('(');
    expect(renewServerText(503)).toContain('(status 503)');
    expect(renewServerText(503)).toContain('The sign-in is kept');
    expect(renewRefusedText(400)).toContain('(status 400)');
    for (const text of Object.values(CHATGPT_REVIEW_FAILURES))
      expect(text).not.toContain('Lapidary Lapidary');
  });

  it("uses OpenAI's words for Manage usage and the welcome, and opens ChatGPT's usage settings by name", () => {
    expect(MANAGE_USAGE_BUTTON).toBe('Manage usage');
    expect(PLAN_WELCOME_TITLE).toBe("You're using your ChatGPT plan");
    expect(PLAN_WELCOME_TEXT).toBe(
      'Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.'
    );
    expect(PLAN_WELCOME_DONE).toBe('Got it');
    expect(EXTERNAL_PAGE_URLS['chatgpt-usage']).toBe(CHATGPT_USAGE_URL);
  });

  it('shows the welcome while signed in until Got it, with the settings read', () => {
    expect(planWelcomeShown(SIGNED_IN, [])).toBe(true);
    expect(planWelcomeShown(SIGNED_IN, ['save-to-chapter'])).toBe(true);
    expect(planWelcomeShown(SIGNED_IN, [PLAN_WELCOME_HINT])).toBe(false);
    expect(planWelcomeShown({ ...SIGNED_IN, signedIn: false }, [])).toBe(false);
    expect(planWelcomeShown(null, [])).toBe(false);
    expect(planWelcomeShown(SIGNED_IN, null)).toBe(false);
  });
});

describe('ChatGPT in the settings, the reviews and the welcome guide', () => {
  it('keeps a model of its own, empty for the default, and ChatGPT as a provider', () => {
    expect(normalizeSettings({}).chatgptModel).toBe('');
    expect(normalizeSettings({ chatgptModel: 'gpt-5.5' }).chatgptModel).toBe('gpt-5.5');
    expect(normalizeSettings({ chatgptModel: 5 }).chatgptModel).toBe('');
    expect(normalizeSettings({ provider: 'chatgpt' }).provider).toBe('chatgpt');
  });

  it('fills in the provider of a review ChatGPT wrote', () => {
    const review = { generator: { kind: 'chatgpt' } } as unknown as Review;
    expect(withGeneratorProvider(review).generator.provider).toBe('chatgpt');
  });

  it("puts ChatGPT's sign-in in the guide's first step while it is the provider", () => {
    const steps = (chatgpt: ChatGptStatus | null): ReturnType<typeof welcomeSteps> =>
      welcomeSteps({
        provider: 'chatgpt',
        claude: null,
        claudeLastFailure: null,
        chatgpt,
        manuscriptFolder: null,
        guidelinesSetting: null,
        paths: null,
        guidelines: null
      });
    const [out] = steps({ ...SIGNED_IN, signedIn: false });
    expect(out).toMatchObject({
      done: false,
      status: 'Not signed in to ChatGPT',
      lines: [CHATGPT_STEP_TEXT]
    });
    expect(out?.actions).toEqual([
      { id: 'set-up-chatgpt', label: SET_UP_CHATGPT, primary: true },
      { id: 'use-claude', label: USE_CLAUDE }
    ]);
    const [done] = steps(SIGNED_IN);
    expect(done).toMatchObject({ done: true, status: 'Signed in to ChatGPT' });
    expect(done?.actions[0]).toMatchObject({ id: 'set-up-chatgpt', primary: false });
    expect(steps(null)[0]?.status).toBe('Reading the ChatGPT sign-in…');
  });
});
