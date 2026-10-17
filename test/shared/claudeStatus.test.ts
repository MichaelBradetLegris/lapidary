import { describe, expect, it } from 'vitest';
import {
  PRO_PLAN_NOTE,
  PRO_PRESELECT_HINT,
  isProPlan,
  modelArgs,
  proPlanNote,
  proPreselection
} from '../../src/shared/ai/claudeModels';
import { APP_NAME } from '../../src/shared/branding';
import {
  FREE_PLAN_WARNING,
  LOGIN_EXPIRED_MESSAGE,
  MIN_CLAUDE_CODE,
  classifyClaude,
  classifyClaudeFailure,
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

  it('preselects Sonnet once for a new user on Pro', () => {
    const patch = proPreselection(fresh, 'pro');
    expect(patch).toEqual({ model: 'sonnet', dismissedHints: [PRO_PRESELECT_HINT] });
    expect(proPreselection({ ...fresh, ...patch! }, 'pro')).toBeNull();
    expect(proPreselection({ ...fresh, dismissedHints: [PRO_PRESELECT_HINT] }, 'pro')).toBeNull();
  });

  it('never changes an existing setting, a chosen model or another plan', () => {
    expect(proPreselection({ ...fresh, model: 'opus' }, 'pro')).toBeNull();
    expect(proPreselection({ ...fresh, onboardingDone: true }, 'pro')).toBeNull();
    expect(proPreselection(fresh, 'max')).toBeNull();
    expect(proPreselection(fresh, undefined)).toBeNull();
  });

  it('notes the Pro limits for Opus and Default, not for Sonnet or Haiku', () => {
    expect(proPlanNote('pro', 'default')).toBe(PRO_PLAN_NOTE);
    expect(proPlanNote('pro', 'claude-opus-5')).toBe(PRO_PLAN_NOTE);
    expect(proPlanNote('pro', 'sonnet')).toBeNull();
    expect(proPlanNote('pro', 'haiku')).toBeNull();
    expect(proPlanNote('max', 'opus')).toBeNull();
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
    expect(classifyClaudeFailure({ assistantError: 'max_output_tokens' }).message).toBe(
      'Claude hit its output limit. Try a shorter chapter.'
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
