import { describe, expect, it } from 'vitest';
import {
  PRO_PLAN_NOTE,
  PRO_PLAN_NOTE_OPUS_ONLY,
  PRO_PRESELECT_HINT,
  claudeModelOptions,
  defaultIsOpus,
  isProPlan,
  modelArgs,
  proPlanNote,
  proPreselection
} from '../../src/shared/ai/claudeModels';
import { replyLimitMessage } from '../../src/shared/ai/replyLimit';
import { APP_NAME } from '../../src/shared/branding';
import { normalizeSettings } from '../../src/shared/settings';
import { welcomeAgainPatch, welcomeShown } from '../../src/shared/ui/welcome';
import {
  FREE_PLAN_WARNING,
  LOGIN_EXPIRED_MESSAGE,
  MIN_CLAUDE_CODE,
  classifyClaude,
  classifyClaudeFailure,
  claudeReplyLimit,
  parseAuthStatus,
  RECOMMENDED_CLAUDE_CODE,
  claudeUpdateAdvice,
  compareVersions,
  isOutdated,
  isUsageLimit,
  isUsageNotice,
  parseCliVersion
} from '../../src/shared/ai/claudeStatus';

/* cli.1: reading what the user's Claude Code says about itself. */

describe('versions', () => {
  it('reads the version Claude Code prints', () => {
    expect(parseCliVersion('2.1.283 (Claude Code)\n')).toBe('2.1.283');
    expect(parseCliVersion('Claude Code v2.10.4')).toBe('2.10.4');
    expect(parseCliVersion('not a version')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions('2.1.266', '2.1.283')).toBeLessThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.283', '2.1.283')).toBe(0);
    expect(compareVersions('3.0', '2.99.99')).toBeGreaterThan(0);
  });

  it('calls anything older than the minimum outdated', () => {
    expect(MIN_CLAUDE_CODE).toBe('2.1.266');
    expect(isOutdated('2.1.265')).toBe(true);
    expect(isOutdated('2.1.266')).toBe(false);
    expect(isOutdated('2.2.0')).toBe(false);
  });
});

describe('usage and sign-in wording', () => {
  it('recognises a usage limit by how it starts', () => {
    expect(isUsageLimit("You've hit your limit · resets 3pm")).toBe(true);
    expect(isUsageLimit('Your org is out of usage · contact your admin')).toBe(true);
    expect(isUsageLimit('Here is the review')).toBe(false);
  });

  it('tells a warning or a switch to extra usage from a limit', () => {
    expect(isUsageNotice("You've used 90% of your weekly limit")).toBe(true);
    expect(isUsageNotice('Now using extra usage')).toBe(true);
    expect(isUsageLimit('Now using extra usage')).toBe(false);
  });
});

describe('modelArgs', () => {
  it('passes a model, but not Default or nothing', () => {
    expect(modelArgs('opus')).toEqual(['--model', 'opus']);
    expect(modelArgs(' claude-opus-5 ')).toEqual(['--model', 'claude-opus-5']);
    expect(modelArgs('default')).toEqual([]);
    expect(modelArgs('')).toEqual([]);
  });
});

describe('claudeUpdateAdvice', () => {
  it('says nothing for a current or unknown version', () => {
    expect(RECOMMENDED_CLAUDE_CODE).toBe('2.1.283');
    expect(claudeUpdateAdvice('2.1.283', 'C:/x/claude.exe', true)).toBeNull();
    expect(claudeUpdateAdvice('2.2.0', 'C:/x/claude.exe', true)).toBeNull();
    expect(claudeUpdateAdvice(undefined, 'C:/x/claude.exe', true)).toBeNull();
  });

  it('advises claude update for an older version, with a full-path fallback', () => {
    const exe = 'C:/Users/Ann/.local/bin/claude.exe'; // check-public: allow
    expect(claudeUpdateAdvice('2.1.266', exe, true)).toEqual({
      installed: '2.1.266',
      recommended: '2.1.283',
      command: 'claude update',
      fullPathCommand: "& 'C:/Users/Ann/.local/bin/claude.exe' update" // check-public: allow
    });
  });

  it('quotes a path with a single quote for PowerShell and for a POSIX shell', () => {
    const windows = "C:/Users/Ann O'Neil/claude.exe"; // check-public: allow
    const posix = "/home/ann o'neil/.local/bin/claude"; // check-public: allow
    expect(claudeUpdateAdvice('2.1.266', windows, true)?.fullPathCommand).toBe(
      "& 'C:/Users/Ann O''Neil/claude.exe' update" // check-public: allow
    );
    expect(claudeUpdateAdvice('2.1.266', posix, false)?.fullPathCommand).toBe(
      "'/home/ann o'\\''neil/.local/bin/claude' update" // check-public: allow
    );
  });

  it('leaves out the fallback when the path is unknown', () => {
    expect(claudeUpdateAdvice('2.1.266', undefined, true)?.fullPathCommand).toBeNull();
  });
});

describe('Pro plans (setup.1)', () => {
  const fresh = { model: 'default', onboardingDone: false, dismissedHints: [] as string[] };

  it('recognises a Pro plan however Claude Code spells it', () => {
    expect(isProPlan('pro')).toBe(true);
    expect(isProPlan('Claude Pro')).toBe(true);
    expect(isProPlan('max')).toBe(false);
    expect(isProPlan('professional')).toBe(false);
    expect(isProPlan(undefined)).toBe(false);
  });

  it('preselects Sonnet once for a new user on Pro, while the first guide is open', () => {
    const patch = proPreselection(fresh, 'pro', true);
    expect(patch).toEqual({ model: 'sonnet', dismissedHints: [PRO_PRESELECT_HINT] });
    expect(proPreselection({ ...fresh, ...patch! }, 'pro', true)).toBeNull();
    expect(proPreselection({ ...fresh, dismissedHints: [PRO_PRESELECT_HINT] }, 'pro', true)).toBeNull();
  });

  it('never changes an existing setting, a chosen model or another plan', () => {
    expect(proPreselection({ ...fresh, model: 'opus' }, 'pro', true)).toBeNull();
    expect(proPreselection({ ...fresh, onboardingDone: true }, 'pro', true)).toBeNull();
    expect(proPreselection(fresh, 'max', true)).toBeNull();
    expect(proPreselection(fresh, undefined, true)).toBeNull();
  });

  /* setup.11 review: Show the welcome guide again writes onboardingDone
     false, which alone made an install on Pro whose model is Default look
     new, and the next check moved it to Sonnet. */
  it('never preselects on a guide brought back by Show the welcome guide again', () => {
    const installs = [
      // settings from before 1.0 that name a folder
      normalizeSettings({ manuscriptFolder: 'C:/vault' }),
      // a fresh install that pressed Skip before Claude was ready
      { ...normalizeSettings({}), onboardingDone: true },
      // one with the Save hint already put away
      normalizeSettings({ manuscriptFolder: 'C:/vault', dismissedHints: ['save-to-chapter'] })
    ];
    for (const before of installs) {
      expect(proPreselection(before, 'pro', welcomeShown(before))).toBeNull();
      const again = { ...before, ...welcomeAgainPatch(before.dismissedHints) };
      expect(welcomeShown(again)).toBe(true);
      expect(again.model).toBe('default');
      expect(proPreselection(again, 'pro', welcomeShown(again))).toBeNull();
      expect(again.dismissedHints).toEqual([...before.dismissedHints, PRO_PRESELECT_HINT]);
    }
  });

  /* setup.11 review, (b): the preselection belongs to the first guide (C.67).
     Start or Skip before a check finds Claude ready leaves Default, and the
     review dialog's Pro note says what it costs. */
  it('leaves the model alone when Start or Skip came before the check that found Claude ready', () => {
    const first = normalizeSettings({});
    expect(proPreselection(first, 'pro', welcomeShown(first))).toEqual({
      model: 'sonnet',
      dismissedHints: [PRO_PRESELECT_HINT]
    });
    // Start or Skip, written
    const done = { ...first, manuscriptFolder: 'C:/vault', onboardingDone: true };
    expect(proPreselection(done, 'pro', welcomeShown(done))).toBeNull();
    // Start or Skip whose write failed: main's settings still say not done,
    // but the guide is closed for the rest of the run
    expect(proPreselection(first, 'pro', welcomeShown(first, true))).toBeNull();
    expect(proPlanNote('pro', done.model)).toBe(PRO_PLAN_NOTE);
  });

  it('notes the Pro limits for Opus and Default, not for Sonnet or Haiku', () => {
    expect(proPlanNote('pro', 'default')).toBe(PRO_PLAN_NOTE);
    expect(proPlanNote('pro', 'claude-opus-5')).toBe(PRO_PLAN_NOTE);
    expect(proPlanNote('pro', 'sonnet')).toBeNull();
    expect(proPlanNote('pro', 'haiku')).toBeNull();
    expect(proPlanNote('max', 'opus')).toBeNull();
  });

  /* setup.17 (c): on Claude Code 2.1.266 to 2.1.279 a Pro plan's Default is
     Sonnet 5 (C.69), and the model list says so in Default's label. */
  it('reads from the model list whether Default is an Opus model', () => {
    const list = (description: string | undefined) =>
      claudeModelOptions([
        { value: 'default', displayName: 'Default (recommended)', ...(description ? { description } : {}) },
        { value: 'opus', description: 'Opus 5.5 · Most capable' }
      ]);
    expect(defaultIsOpus(list('Opus 5.5 · Best for everyday, complex tasks'))).toBe(true);
    expect(defaultIsOpus(list('Sonnet 5 · Best for everyday tasks'))).toBe(false);
    // No version to read, no Default, or no list yet: not known.
    expect(defaultIsOpus(list(undefined))).toBeNull();
    expect(defaultIsOpus(list('Use the default model'))).toBeNull();
    expect(defaultIsOpus([{ value: 'opus', label: 'Opus 5.5' }])).toBeNull();
    expect(defaultIsOpus([])).toBeNull();
  });

  it('leaves Default out of the Pro note where the model list says it is not an Opus model', () => {
    expect(proPlanNote('pro', 'default', false)).toBeNull();
    expect(proPlanNote('pro', '', false)).toBeNull();
    expect(proPlanNote('pro', 'opus', false)).toBe(PRO_PLAN_NOTE_OPUS_ONLY);
    expect(proPlanNote('pro', 'claude-opus-5', false)).toBe(PRO_PLAN_NOTE_OPUS_ONLY);
    expect(PRO_PLAN_NOTE_OPUS_ONLY).not.toContain('Default');
    // Opus, or not known yet: as before, since Default is Opus 5.5 from 2.1.280.
    for (const known of [true, null]) {
      expect(proPlanNote('pro', 'default', known)).toBe(PRO_PLAN_NOTE);
      expect(proPlanNote('pro', 'opus', known)).toBe(PRO_PLAN_NOTE);
    }
    expect(proPlanNote('pro', 'sonnet', false)).toBeNull();
    expect(proPlanNote('max', 'default', false)).toBeNull();
  });
});

/* setup.2: reading `auth status`, classifying the sign-in, and wording failures. */

/** A placeholder profile folder, escaped as JSON writes it. */
const ANN_JSON = 'C:\\\\Users\\\\Ann'; // check-public: allow

/** `claude auth status --json` as Claude Code 2.1.266 printed it on 2026-10-14. */
const SIGNED_OUT = `{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "${ANN_JSON}\\\\.claude\\\\projects",
  "configDirectory": "${ANN_JSON}\\\\.claude"
}`;
const SIGNED_IN = `{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "${ANN_JSON}\\\\.claude\\\\projects",
  "email": "ann@example.com",
  "orgId": "00000000-0000-4000-8000-000000000000",
  "orgName": "ann@example.com's Organization",
  "subscriptionType": "max"
}`;

describe('parseAuthStatus', () => {
  it('keeps only the fields the app may read', () => {
    expect(parseAuthStatus(SIGNED_OUT)).toEqual({
      loggedIn: false,
      authMethod: 'none',
      apiProvider: 'firstParty'
    });
    expect(parseAuthStatus(SIGNED_IN)).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'ann@example.com',
      subscriptionType: 'max'
    });
  });

  it('refuses anything that is not a status', () => {
    expect(parseAuthStatus('Not logged in')).toBeNull();
    expect(parseAuthStatus('{"email":"ann@example.com"}')).toBeNull();
    expect(parseAuthStatus('[]')).toBeNull();
  });
});

describe('classifyClaude', () => {
  const signedIn = parseAuthStatus(SIGNED_IN);
  const signedOut = parseAuthStatus(SIGNED_OUT);

  it.each([
    ['auth says signed out', signedOut, { email: 'ann@example.com' }, { state: 'not-signed-in' }],
    [
      'an API key in use',
      signedIn,
      { apiKeySource: 'ANTHROPIC_API_KEY' },
      { state: 'ready', credential: 'api-key' }
    ],
    ['a cloud provider', signedIn, { apiProvider: 'bedrock' }, { state: 'ready', credential: 'cloud' }],
    [
      'a Claude account',
      signedIn,
      { email: 'ann@example.com', subscriptionType: 'max', tokenSource: 'claude.ai', apiKeySource: 'none' },
      { state: 'ready', credential: 'subscription' }
    ],
    ['no token and no auth status', null, { tokenSource: 'none' }, { state: 'not-signed-in' }],
    ['no account, auth through claude.ai', signedIn, null, { state: 'ready', credential: 'subscription' }],
    [
      'no account, auth through an API key helper',
      { loggedIn: true, authMethod: 'api_key_helper' },
      null,
      { state: 'ready', credential: 'api-key' }
    ],
    [
      'no account, auth through a cloud provider',
      { loggedIn: true, authMethod: 'third_party' },
      null,
      { state: 'ready', credential: 'cloud' }
    ],
    ['nothing to go on', null, null, { state: 'error' }]
  ] as const)('%s', (_label, auth, account, expected) => {
    expect(classifyClaude({ auth, account })).toMatchObject(expected);
  });

  /* setup.17 (e): Claude Code 2.1.302 with ANTHROPIC_AUTH_TOKEN set, as
     `auth status --json` and the initialize reply gave it on 2026-10-19, with
     an empty config folder, over a Claude plan's sign-in, and beside an
     ANTHROPIC_API_KEY. Not a Claude plan: the token outranks the sign-in. */
  it('reads an ANTHROPIC_AUTH_TOKEN as the token, never as a Claude plan', () => {
    const tokenAuth = { loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' };
    const tokenAccount = { tokenSource: 'ANTHROPIC_AUTH_TOKEN', apiProvider: 'firstParty' };
    expect(classifyClaude({ auth: tokenAuth, account: tokenAccount })).toEqual({
      state: 'ready',
      credential: 'auth-token'
    });
    // Beside an API key, which it outranks; `auth status` names the key's source too.
    expect(
      classifyClaude({
        auth: { ...tokenAuth, apiKeySource: 'ANTHROPIC_API_KEY' },
        account: { ...tokenAccount, apiKeySource: 'ANTHROPIC_API_KEY' }
      }).credential
    ).toBe('auth-token');
    // A cloud provider outranks the token.
    expect(
      classifyClaude({ auth: tokenAuth, account: { ...tokenAccount, apiProvider: 'bedrock' } }).credential
    ).toBe('cloud');
    // With no account to read, oauth_token reads as before.
    expect(classifyClaude({ auth: tokenAuth, account: null }).credential).toBe('subscription');
  });

  it('explains a sign-in that lives in settings the app does not load', () => {
    const result = classifyClaude({
      auth: { loggedIn: true, authMethod: 'api_key_helper' },
      account: { tokenSource: 'none' }
    });
    expect(result.state).toBe('not-signed-in');
    expect(result.message).toBe(
      `Claude Code is signed in through its own settings (api_key_helper), which ${APP_NAME} does not load. Sign in with the command below instead.`
    );
  });

  it('warns about a free plan, and only that', () => {
    expect(
      classifyClaude({ auth: signedIn, account: { email: 'a@example.com', subscriptionType: 'free' } })
    ).toEqual({
      state: 'ready',
      credential: 'subscription',
      planWarning: FREE_PLAN_WARNING
    });
    expect(classifyClaude({ auth: signedIn, account: null }).planWarning).toBeUndefined();
    // The initialize reply names plans as "Claude Max" and "Claude Free".
    expect(
      classifyClaude({ auth: null, account: { email: 'a@example.com', subscriptionType: 'Claude Free' } })
        .planWarning
    ).toBe(FREE_PLAN_WARNING);
    expect(
      classifyClaude({ auth: null, account: { email: 'a@example.com', subscriptionType: 'Claude Max' } })
        .planWarning
    ).toBeUndefined();
  });
});

describe('classifyClaudeFailure', () => {
  it.each([
    ['cli_version_too_old', 'claude-outdated'],
    ['org_verify_failed', 'claude-login-expired'],
    ['gateway_signin_required', 'claude-login-expired'],
    ['org_pin_api_key_conflict', 'claude-billing'],
    ['shell_tool_missing', 'claude-failed']
  ] as const)('maps the start-up reason %s to %s', (startupReason, code) => {
    expect(classifyClaudeFailure({ startupReason, text: 'whatever' }).code).toBe(code);
  });

  it('says PowerShell or Git Bash is missing, and that an API key was refused', () => {
    expect(classifyClaudeFailure({ startupReason: 'shell_tool_missing' }).message).toContain(
      'PowerShell or Git Bash'
    );
    expect(classifyClaudeFailure({ startupReason: 'org_pin_api_key_conflict' }).message).toMatch(
      /^An ANTHROPIC_API_KEY is in use and was refused/
    );
  });

  it('passes a usage limit through in Claude Code s own words', () => {
    const text = "You've hit your weekly limit · resets Mon 9am";
    expect(classifyClaudeFailure({ text, assistantError: 'rate_limit' })).toEqual({
      code: 'claude-usage-limit',
      message: text
    });
  });

  it.each(['OAuth token has expired. Please run /login', 'Your session expired', 'OAuth token revoked'])(
    'calls %j an ended sign-in, keeping the words',
    (text) => {
      expect(classifyClaudeFailure({ text })).toEqual({
        code: 'claude-login-expired',
        message: LOGIN_EXPIRED_MESSAGE,
        detail: text
      });
    }
  );

  it.each([
    ['authentication_failed', 'claude-not-signed-in'],
    ['oauth_org_not_allowed', 'claude-not-signed-in'],
    ['cloud_credential_error', 'claude-not-signed-in'],
    ['rate_limit', 'claude-rate-limit'],
    ['overloaded', 'claude-rate-limit'],
    ['billing_error', 'claude-billing'],
    ['account_on_hold', 'claude-billing'],
    ['verification_required', 'claude-billing'],
    ['model_not_found', 'claude-failed'],
    ['max_output_tokens', 'claude-failed'],
    ['server_error', 'claude-failed'],
    ['something_new', 'claude-failed']
  ] as const)('maps the assistant error %s to %s', (assistantError, code) => {
    expect(classifyClaudeFailure({ assistantError }).code).toBe(code);
  });

  it('words the assistant errors as the app always has', () => {
    expect(classifyClaudeFailure({ assistantError: 'model_not_found' }).message).toBe(
      'That model is not available on your plan. Pick another in Settings.'
    );
    // files.10: a reply that ran out of room says why and what helps (replyLimit.test.ts).
    expect(classifyClaudeFailure({ assistantError: 'max_output_tokens' }).message).toBe(
      replyLimitMessage('output', { who: 'Claude' })
    );
    expect(classifyClaudeFailure({ assistantError: 'something_new' }).message).toBe(
      'Claude reported an error: something_new'
    );
  });

  it.each([
    ['Not logged in · Please run /login', 'claude-not-signed-in'],
    ['Invalid API key · Please run /login', 'claude-not-signed-in'],
    ['Invalid API key', 'claude-billing'],
    ['This organization has been disabled.', 'claude-billing'],
    ['Credit balance is too low', 'claude-billing'],
    ['You have reached your spend limit', 'claude-billing'],
    ['Claude Opus is not available with the Claude Pro plan', 'claude-failed'],
    ['Claude Code does not support this model. Please update.', 'claude-outdated'],
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'claude-rate-limit'],
    ['API Error: 429 Too Many Requests', 'claude-rate-limit'],
    ['Anthropic is experiencing high load', 'claude-rate-limit']
  ] as const)('maps the text %j to %s', (text, code) => {
    expect(classifyClaudeFailure({ text }).code).toBe(code);
  });

  it('does not take "the author" for a sign-in problem', () => {
    const failure = classifyClaudeFailure({ text: 'Could not parse the note about the author' });
    expect(failure.code).toBe('claude-failed');
    expect(failure.message).toBe('Claude reported: Could not parse the note about the author');
  });

  it.each([
    ['error_max_turns', 'claude-failed', 'Claude ran out of turns before producing a result.'],
    [
      'error_max_structured_output_retries',
      'claude-invalid-output',
      'Claude could not produce output matching the schema after several tries.'
    ],
    ['error_max_budget_usd', 'claude-failed', 'The query hit its cost budget.'],
    ['error_during_execution', 'claude-failed', 'Claude could not finish the review.']
  ] as const)('maps the subtype %s', (subtype, code, message) => {
    expect(classifyClaudeFailure({ subtype })).toEqual({ code, message });
  });

  it('keeps Claude Code s words in detail whenever the message is the app s', () => {
    expect(
      classifyClaudeFailure({ subtype: 'error_max_turns', text: 'Reached maximum number of turns (3)' })
    ).toEqual({
      code: 'claude-failed',
      message: 'Claude ran out of turns before producing a result.',
      detail: 'Reached maximum number of turns (3)'
    });
    expect(classifyClaudeFailure({ text: 'first line\nsecond line' })).toEqual({
      code: 'claude-failed',
      message: 'Claude reported: first line',
      detail: 'first line\nsecond line'
    });
  });
});

/* files.10: a reply that ran out of room, in Claude Code 2.1.302's words
   (PLAN C.77). The runs themselves are in test/main/claudeCli.test.ts. */
describe('a Claude reply that runs out of room', () => {
  const OUTPUT =
    "API Error: Claude's response exceeded the 64000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable.";
  const THINKING = `${OUTPUT} The last attempt reached the limit while still thinking. Lower the effort level to leave room for a reply.`;
  const CONTEXT = 'API Error: The model has reached its context window limit.';
  const facts = { words: 41_000, effort: 'medium' as const };

  it.each([
    [{ text: OUTPUT }, { limit: 'output', maxTokens: 64_000 }],
    [{ text: THINKING }, { limit: 'output', maxTokens: 64_000 }],
    [{ assistantError: 'max_output_tokens' }, { limit: 'output' }],
    [{ apiError: 'max_output_tokens' }, { limit: 'output' }],
    [{ assistantError: 'max_output_tokens', text: CONTEXT }, { limit: 'context' }],
    [{ stopReason: 'model_context_window_exceeded' }, { limit: 'context' }],
    [{ assistantError: 'invalid_request', text: 'Prompt is too long' }, { limit: 'input' }],
    [{ text: 'Input is too long for requested model.' }, { limit: 'input' }],
    [{ stopReason: 'max_tokens' }, null],
    [{ assistantError: 'rate_limit' }, null],
    [{ text: 'Reached maximum number of turns (3)' }, null]
  ] as const)('reads %j as %j', (input, expected) => {
    expect(claudeReplyLimit(input)).toEqual(expected);
  });

  it('words each limit with the chapter and the effort, and keeps Claude Code s words in detail', () => {
    expect(classifyClaudeFailure({ text: OUTPUT, limitFacts: facts })).toEqual({
      code: 'claude-failed',
      message: replyLimitMessage('output', { who: 'Claude', maxTokens: 64_000, ...facts }),
      detail: OUTPUT
    });
    expect(
      classifyClaudeFailure({ assistantError: 'max_output_tokens', text: CONTEXT, limitFacts: facts })
    ).toEqual({
      code: 'claude-failed',
      message: replyLimitMessage('context', { who: 'Claude', ...facts }),
      detail: CONTEXT
    });
    expect(classifyClaudeFailure({ text: 'Prompt is too long', limitFacts: facts }).message).toBe(
      replyLimitMessage('input', { who: 'Claude', ...facts })
    );
  });

  it('puts a usage limit and an ended sign-in first, and the output limit before the assistant error and the text rules', () => {
    expect(
      classifyClaudeFailure({ apiError: 'max_output_tokens', text: "You've hit your limit · resets 3pm" })
        .code
    ).toBe('claude-usage-limit');
    expect(
      classifyClaudeFailure({ apiError: 'max_output_tokens', text: 'OAuth token has expired' }).code
    ).toBe('claude-login-expired');
    expect(
      classifyClaudeFailure({ assistantError: 'rate_limit', apiError: 'max_output_tokens' }).message
    ).toBe(replyLimitMessage('output', { who: 'Claude' }));
  });

  it('reads a last reply stopped at max_tokens after the assistant error and the text rules, before the subtype', () => {
    const limit = replyLimitMessage('output', { who: 'Claude', ...facts });
    expect(
      classifyClaudeFailure({ subtype: 'error_max_turns', stopReason: 'max_tokens', limitFacts: facts })
        .message
    ).toBe(limit);
    expect(
      classifyClaudeFailure({ subtype: 'error_max_structured_output_retries', stopReason: 'max_tokens' })
    ).toMatchObject({ code: 'claude-failed', message: replyLimitMessage('output', { who: 'Claude' }) });
    expect(classifyClaudeFailure({ text: 'some new failure', stopReason: 'max_tokens' }).message).toBe(
      replyLimitMessage('output', { who: 'Claude' })
    );
    expect(classifyClaudeFailure({ assistantError: 'rate_limit', stopReason: 'max_tokens' }).code).toBe(
      'claude-rate-limit'
    );
    expect(
      classifyClaudeFailure({ text: 'Not logged in · Please run /login', stopReason: 'max_tokens' }).code
    ).toBe('claude-not-signed-in');
    expect(classifyClaudeFailure({ subtype: 'error_max_turns', stopReason: 'end_turn' }).message).toBe(
      'Claude ran out of turns before producing a result.'
    );
  });
});
