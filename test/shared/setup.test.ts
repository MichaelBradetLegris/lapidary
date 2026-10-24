import { describe, expect, it } from 'vitest';
import {
  FREE_PLAN_WARNING,
  NOT_SIGNED_IN_MESSAGE,
  RECOMMENDED_CLAUDE_CODE,
  signedInElsewhereMessage
} from '../../src/shared/ai/claudeStatus';
import type { RateLimitInfo, RuntimeStatus } from '../../src/shared/ipc';
import { APP_NAME } from '../../src/shared/branding';
import {
  CLAUDE_RUNTIME_CARD,
  CONNECTION_TEST_NOTES,
  COULD_NOT_CHECK_ADVICE,
  DESKTOP_ALIAS_QUESTION,
  EXPIRED_INTRO,
  FOCUS_RECHECK_MS,
  NOT_INSTALLED_INTRO,
  NOT_RECOGNISED_QUESTION,
  OTHER_USAGE_LIMIT_TEXT,
  SIGNED_IN_AGAIN,
  SIGNED_OUT_INTRO,
  USAGE_LIMIT_TEXT,
  advancedRows,
  apiKeySourceOf,
  canTestConnection,
  canTryReviewAnyway,
  checkedAtText,
  claudeAccountLine,
  failureSetupEvent,
  connectionTestLine,
  connectionTestNote,
  focusRecheckDue,
  installAndLoginCommand,
  installerPathCommand,
  loginCommand,
  needsSetup,
  nextLastFailure,
  openTerminalHint,
  osFromUserAgent,
  otherInstalls,
  pathForTab,
  reviewDialogWarning,
  reviewGate,
  runtimeButtonTitle,
  runtimeCard,
  runtimeCardAction,
  runtimeLabel,
  setupStatus,
  setupSteps,
  setupTroubleshooting,
  setupView,
  stepsHeading,
  testDurationText,
  testSetupEvent,
  updateAdvice,
  updateCommand,
  type LastFailure,
  type SetupViewId
} from '../../src/shared/ui/setup';
import { OTHER_MODELS_ADVICE, WAIT_ADVICE, usageLimitCard } from '../../src/shared/ui/usage';

/* setup.6: what the Setup screen shows, and when a failure stops counting. */

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

/**
 * An up-to-date Claude Code. It follows the constant, so the Claude Code check
 * of each release (docs/RELEASING.md) moves only the pin in claudeStatus.test.ts.
 */
const CURRENT = RECOMMENDED_CLAUDE_CODE;

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return { provider: 'claude', state: 'ready', executablePath: PATH, cliVersion: CURRENT, ...patch };
}

const expired: LastFailure = { code: 'claude-login-expired' };

describe('setupView', () => {
  it.each([
    ['no check yet', null, null, 'checking'],
    ['Claude Code missing', claude({ state: 'missing-binary' }), expired, 'not-installed'],
    ['signed out', claude({ state: 'not-signed-in' }), null, 'signed-out'],
    ['signed out after an ended sign-in', claude({ state: 'not-signed-in' }), expired, 'expired'],
    ['ready, but the last review said the sign-in ended', claude(), expired, 'expired'],
    [
      'ready, but the last review said not signed in',
      claude(),
      { code: 'claude-not-signed-in' },
      'signed-out'
    ],
    ['the check failed', claude({ state: 'error' }), null, 'could-not-check'],
    [
      'the check found Claude Code too old',
      claude({ state: 'error', cliVersion: '2.1.200' }),
      null,
      'outdated'
    ],
    ['the last review said too old', claude(), { code: 'claude-outdated' }, 'outdated'],
    ['a usage limit in force', claude(), { code: 'claude-usage-limit' }, 'usage-limit'],
    ['an API key in use', claude({ credential: 'api-key' }), null, 'api-key'],
    ['ready', claude({ credential: 'subscription' }), { code: 'claude-rate-limit' }, 'ready']
  ] as const)('%s', (_label, runtime, last, view) => {
    expect(setupView(runtime, last)).toBe(view);
  });
});

describe('nextLastFailure', () => {
  it('remembers a failure with the Claude Code it happened with', () => {
    expect(nextLastFailure(null, { type: 'failure', code: 'claude-outdated', runtime: claude() })).toEqual({
      code: 'claude-outdated',
      executablePath: PATH,
      cliVersion: CURRENT
    });
  });

  it('keeps an ended sign-in through a plain re-check that says ready', () => {
    const after = nextLastFailure(expired, { type: 'check', runtime: claude() });
    expect(after).toBe(expired);
    expect(setupView(claude(), after)).toBe('expired');
  });

  it('clears it once a check said signed out and a later one says ready', () => {
    const signedOut = nextLastFailure(expired, {
      type: 'check',
      runtime: claude({ state: 'not-signed-in' })
    });
    expect(signedOut).toEqual({ ...expired, signedOutSince: true });
    expect(nextLastFailure(signedOut, { type: 'check', runtime: claude({ state: 'not-signed-in' }) })).toBe(
      signedOut
    );
    expect(nextLastFailure(signedOut, { type: 'check', runtime: claude() })).toBeNull();
  });

  it('clears on a review or connection test that went through', () => {
    expect(nextLastFailure(expired, { type: 'success' })).toBeNull();
  });

  it("keeps whether a usage limit was one of the plan's, as the review's card decided (setup.9 review)", () => {
    const limit = nextLastFailure(
      null,
      failureSetupEvent(
        'claude-usage-limit',
        "You've hit your team's shared budget. Switch to another model to continue.",
        { status: 'rejected', kind: 'overage' },
        claude()
      )
    );
    expect(limit).toEqual({
      code: 'claude-usage-limit',
      executablePath: PATH,
      cliVersion: CURRENT,
      planLimit: false
    });
    expect(nextLastFailure(limit, { type: 'check', runtime: claude() })).toBe(limit);
    expect(
      nextLastFailure(
        null,
        failureSetupEvent(
          'claude-usage-limit',
          "You've hit your session limit · resets 3pm",
          { status: 'rejected', kind: 'five_hour' },
          claude()
        )
      )?.planLimit
    ).toBe(true);
  });

  it('clears an outdated failure when Claude Code changes, and only then', () => {
    const outdated = nextLastFailure(null, {
      type: 'failure',
      code: 'claude-outdated',
      runtime: claude({ cliVersion: '2.1.266' })
    });
    expect(nextLastFailure(outdated, { type: 'check', runtime: claude({ cliVersion: '2.1.266' }) })).toBe(
      outdated
    );
    expect(
      nextLastFailure(outdated, { type: 'check', runtime: claude({ cliVersion: '2.1.290' }) })
    ).toBeNull();
    expect(
      nextLastFailure(outdated, {
        type: 'check',
        runtime: claude({ cliVersion: '2.1.266', executablePath: 'D:\\claude.exe' })
      })
    ).toBeNull();
    expect(nextLastFailure(expired, { type: 'check', runtime: claude({ cliVersion: '2.1.290' }) })).toBe(
      expired
    );
  });
});

describe('runtimeLabel', () => {
  it('names the state, the account and an API key', () => {
    expect(runtimeLabel(claude({ email: 'ann@example.com' }))).toBe('Claude ready ann@example.com');
    expect(runtimeLabel(claude({ credential: 'api-key' }))).toBe('Claude ready (API key)');
    expect(runtimeLabel(claude(), expired)).toBe('Claude: sign-in ended');
    expect(runtimeLabel(claude({ state: 'missing-binary' }))).toBe('Claude Code not installed');
    expect(runtimeLabel(null)).toBeNull();
  });

  it('labels OpenAI by its key', () => {
    expect(runtimeLabel({ provider: 'openai', state: 'ready', keyLast4: 'ab12' })).toBe(
      'OpenAI ready (key ends ab12)'
    );
    expect(runtimeLabel({ provider: 'openai', state: 'not-signed-in' })).toBe('OpenAI: no API key');
  });
});

describe('commands', () => {
  it('reads the operating system from the user agent', () => {
    expect(osFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38')).toBe('windows');
    expect(osFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Electron/38')).toBe('mac');
    expect(osFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Electron/38')).toBe('linux');
  });

  it('signs in with claude, or through the full path, quoted for the shell', () => {
    const windows = loginCommand("C:\\Users\\Ann O'Neil\\.local\\bin\\claude.exe", 'windows'); // check-public: allow
    expect(windows).toEqual({
      command: 'claude auth login',
      fullPathCommand: "& 'C:\\Users\\Ann O''Neil\\.local\\bin\\claude.exe' auth login" // check-public: allow
    });
    const posix = "/home/ann o'neil/.local/bin/claude"; // check-public: allow
    expect(loginCommand(posix, 'linux').fullPathCommand).toBe(
      "'/home/ann o'\\''neil/.local/bin/claude' auth login" // check-public: allow
    );
    expect(loginCommand(undefined, 'mac').fullPathCommand).toBeNull();
  });

  it('installs and signs in with one line', () => {
    expect(installAndLoginCommand('windows')).toBe(
      'irm https://claude.ai/install.ps1 | iex; & "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login'
    );
    expect(installAndLoginCommand('mac')).toBe(
      'curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude auth login'
    );
  });

  it('advises claude update for an older Claude Code, as the review dialog does', () => {
    expect(updateAdvice(claude({ cliVersion: '2.1.266' }), 'windows', 'windows')).toMatchObject({
      command: 'claude update',
      fullPathCommand: `& '${PATH}' update`
    });
    expect(updateAdvice(claude(), 'windows', 'windows')).toBeNull();
  });

  it("gives this machine's path only on its own system's tab (setup.7 review)", () => {
    // A Windows path quoted for a Mac or Linux terminal runs nowhere.
    expect(pathForTab(claude(), 'windows', 'windows')).toBe(PATH);
    expect(pathForTab(claude(), 'mac', 'windows')).toBeUndefined();
    expect(pathForTab(claude(), 'linux', 'windows')).toBeUndefined();
    expect(pathForTab(claude({ executablePath: '/usr/local/bin/claude' }), 'windows', 'mac')).toBeUndefined();
    expect(pathForTab(claude({ executablePath: '/usr/local/bin/claude' }), 'mac', 'mac')).toBe(
      '/usr/local/bin/claude'
    );
    for (const os of ['mac', 'linux'] as const) {
      expect(updateAdvice(claude({ cliVersion: '2.1.266' }), os, 'windows')).toEqual({
        installed: '2.1.266',
        recommended: CURRENT,
        command: 'claude update',
        fullPathCommand: null
      });
    }
  });

  it('says how to open a terminal on each system', () => {
    expect(openTerminalHint('windows')).toContain('PowerShell');
    expect(openTerminalHint('mac')).toContain('Terminal');
    expect(openTerminalHint('linux')).toContain('Ctrl+Alt+T');
  });
});

/* setup.7: the Setup screen's words, the launch card, the review gate and the
   re-check as the window comes back to the front. */

const VIEWS: readonly SetupViewId[] = [
  'checking',
  'not-installed',
  'signed-out',
  'expired',
  'could-not-check',
  'outdated',
  'usage-limit',
  'api-key',
  'ready'
];

describe('reviewGate', () => {
  it('stands Setup in front of the dialog only for a missing or a definitely signed-out Claude Code', () => {
    expect(reviewGate(claude({ state: 'missing-binary' }))).toBe('setup');
    expect(reviewGate(claude({ state: 'not-signed-in' }))).toBe('setup');
    expect(reviewGate(claude({ state: 'error' }))).toBe('dialog');
    expect(reviewGate(claude({ state: 'error', cliVersion: '2.1.200' }))).toBe('dialog');
    expect(reviewGate(claude())).toBe('dialog');
    // The first check has not answered yet: the dialog, whose list is loading.
    expect(reviewGate(null)).toBe('dialog');
  });

  it('offers "Try the review anyway" wherever the dialog would open and the view is not ready', () => {
    expect(canTryReviewAnyway(claude({ state: 'error' }), null)).toBe(true);
    expect(canTryReviewAnyway(claude({ state: 'error', cliVersion: '2.1.200' }), null)).toBe(true);
    expect(canTryReviewAnyway(claude(), expired)).toBe(true);
    expect(canTryReviewAnyway(claude(), { code: 'claude-usage-limit' })).toBe(true);
    expect(canTryReviewAnyway(claude({ state: 'missing-binary' }), null)).toBe(false);
    expect(canTryReviewAnyway(claude({ state: 'not-signed-in' }), null)).toBe(false);
    expect(canTryReviewAnyway(claude(), null)).toBe(false);
    expect(canTryReviewAnyway(claude({ credential: 'api-key' }), null)).toBe(false);
    expect(canTryReviewAnyway(null, null)).toBe(false);
  });
});

describe('focusRecheckDue', () => {
  const due = (patch: Partial<Parameters<typeof focusRecheckDue>[0]> = {}): boolean =>
    focusRecheckDue({
      view: 'signed-out',
      claudeInUse: true,
      inFlight: false,
      lastCheckAt: 10_000,
      now: 10_000 + FOCUS_RECHECK_MS,
      ...patch
    });

  it('checks again 3 s after the last check started, and not before', () => {
    expect(FOCUS_RECHECK_MS).toBe(3000);
    expect(due()).toBe(true);
    expect(due({ now: 10_000 + FOCUS_RECHECK_MS - 1 })).toBe(false);
    expect(due({ lastCheckAt: null })).toBe(true);
  });

  it('never over a check that is running, and only while Claude is in use', () => {
    expect(due({ inFlight: true })).toBe(false);
    expect(due({ claudeInUse: false })).toBe(false);
  });

  it('only while Setup has something for the author to do', () => {
    const views = VIEWS.filter((view) => due({ view }));
    expect(views).toEqual(['not-installed', 'signed-out', 'expired', 'could-not-check', 'outdated']);
    expect(VIEWS.filter(needsSetup)).toEqual(views);
  });
});

describe('the launch card', () => {
  it('has a key of its own', () => {
    expect(CLAUDE_RUNTIME_CARD).toBe('claude-runtime');
  });

  it('says what is wrong in each view with something to do, and nothing otherwise', () => {
    expect(runtimeCard('not-installed', claude({ state: 'missing-binary' }))).toEqual({
      tone: 'warn',
      text: 'Claude Code is not installed, so reviews with Claude cannot run yet.'
    });
    expect(runtimeCard('signed-out', claude({ state: 'not-signed-in' }))?.text).toBe(
      'Claude Code is not signed in, so reviews with Claude cannot run yet.'
    );
    expect(runtimeCard('expired', claude())?.text).toContain('nothing in Lapidary is lost');
    expect(runtimeCard('outdated', claude({ state: 'error', cliVersion: '2.1.200' }))?.text).toBe(
      'Claude Code 2.1.200 is older than Lapidary needs (2.1.266 or newer). Reviews with Claude may fail until it is updated.'
    );
    expect(runtimeCard('could-not-check', claude({ state: 'error' }))).toEqual({
      tone: 'info',
      text: 'Lapidary could not check Claude Code.'
    });
    for (const view of ['checking', 'usage-limit', 'api-key', 'ready'] as const) {
      expect(runtimeCard(view, claude()), view).toBeNull();
    }
  });
});

describe('the launch card after a check (runtimeCardAction)', () => {
  const card = runtimeCard('signed-out', claude({ state: 'not-signed-in' }));
  const act = (patch: Partial<Parameters<typeof runtimeCardAction>[0]> = {}) =>
    runtimeCardAction({
      card,
      showing: false,
      pastLaunch: false,
      provider: 'claude',
      setupOpen: false,
      ...patch
    });

  it('is put up by the first check only, with Claude the provider and Setup closed', () => {
    expect(act()).toBe('raise');
    expect(act({ pastLaunch: true })).toBe('none');
    expect(act({ provider: 'openai' })).toBe('none');
    expect(act({ setupOpen: true })).toBe('none');
    expect(act({ card: null })).toBe('none');
  });

  it('stays closed once closed with its X: a later check, or each focus re-check, puts nothing up', () => {
    // Raised at launch, then closed: the store no longer shows it.
    expect(act()).toBe('raise');
    for (let check = 0; check < 3; check += 1) {
      expect(act({ pastLaunch: true, showing: false })).toBe('none');
    }
  });

  it('keeps its words current while it is up', () => {
    expect(act({ showing: true, pastLaunch: true })).toBe('update');
  });

  it('is taken away once nothing is left to do, when OpenAI becomes the provider, or when Setup opens', () => {
    expect(act({ showing: true, pastLaunch: true, card: null })).toBe('withdraw');
    expect(act({ showing: true, pastLaunch: true, provider: 'openai' })).toBe('withdraw');
    expect(act({ showing: true, pastLaunch: true, setupOpen: true })).toBe('withdraw');
    // Back on Claude, or Setup closed, it does not come back.
    expect(act({ showing: false, pastLaunch: true })).toBe('none');
  });

  it('is not put up over the welcome guide, whose first step says the same, and goes when it shows (setup.11)', () => {
    expect(act({ welcomeOpen: true })).toBe('none');
    expect(act({ showing: true, pastLaunch: true, welcomeOpen: true })).toBe('withdraw');
    // The guide put away after the first check: that check had its chance.
    expect(act({ pastLaunch: true, welcomeOpen: false })).toBe('none');
    expect(act({ welcomeOpen: false })).toBe('raise');
  });
});

describe('reviewDialogWarning', () => {
  it('says what the check found when it finds Claude Code missing or signed out (setup.7 review)', () => {
    // The dialog can be open over such a check: its Provider list, Check again or a focus re-check.
    expect(reviewDialogWarning(claude({ state: 'missing-binary' }), null)).toBe(
      'Claude Code is not installed, so this review cannot run yet.'
    );
    expect(reviewDialogWarning(claude({ state: 'not-signed-in' }), null)).toBe(
      'Claude Code is not signed in, so this review cannot run yet.'
    );
    expect(reviewDialogWarning(claude({ state: 'not-signed-in' }), { code: 'claude-not-signed-in' })).toBe(
      'Claude Code is not signed in, so this review cannot run yet.'
    );
    expect(reviewDialogWarning(claude({ state: 'not-signed-in' }), expired)).toBe(
      'Your Claude sign-in has ended, so this review cannot run until you sign in again.'
    );
    const signedOut: LastFailure = { code: 'claude-not-signed-in' };
    for (const runtime of [claude({ state: 'missing-binary' }), claude({ state: 'not-signed-in' })]) {
      for (const last of [null, expired, signedOut]) {
        expect(reviewDialogWarning(runtime, last)).not.toMatch(/The last review said|go ahead/);
      }
    }
  });

  it('warns in the views the dialog opens in with something wrong', () => {
    expect(reviewDialogWarning(claude({ state: 'error' }), null)).toBe(
      'Lapidary could not check Claude Code, so this review may fail. If it does, it says why.'
    );
    expect(reviewDialogWarning(claude({ state: 'error', cliVersion: '2.1.200' }), null)).toContain(
      'older than Lapidary needs'
    );
    expect(reviewDialogWarning(claude(), { code: 'claude-outdated' })).toBe(
      `The last review said that Claude Code ${CURRENT} is too old for it. The review may fail until it is updated.`
    );
    expect(reviewDialogWarning(claude(), expired)).toContain('sign-in had ended');
    expect(reviewDialogWarning(claude(), { code: 'claude-not-signed-in' })).toContain('not signed in');
    expect(reviewDialogWarning(claude(), { code: 'claude-usage-limit', planLimit: true })).toBe(
      "The last review stopped at your Claude plan's usage limit. If the limit has reset since, go ahead."
    );
    // A team's budget or usage credits: not the plan's limit, which may not reset.
    expect(reviewDialogWarning(claude(), { code: 'claude-usage-limit', planLimit: false })).toBe(
      "The last review stopped at a usage limit other than your Claude plan's own. If it no longer applies, go ahead."
    );
  });

  it('says nothing when Claude is ready, or before the first check', () => {
    expect(reviewDialogWarning(claude(), null)).toBeNull();
    expect(reviewDialogWarning(claude({ credential: 'api-key' }), null)).toBeNull();
    expect(reviewDialogWarning(null, null)).toBeNull();
  });
});

describe('setupStatus', () => {
  it('gives every view a title and at least one line', () => {
    for (const view of VIEWS) {
      const status = setupStatus(view, claude());
      expect(status.title, view).not.toBe('');
      expect(status.lines.length, view).toBeGreaterThan(0);
    }
  });

  it('leads a missing Claude Code with what it is and that the app does not include it', () => {
    const status = setupStatus('not-installed', claude({ state: 'missing-binary' }));
    expect(status).toEqual({
      tone: 'warn',
      title: 'Claude Code is not installed',
      lines: [NOT_INSTALLED_INTRO]
    });
    expect(NOT_INSTALLED_INTRO).toContain("Anthropic's free command-line tool");
    expect(NOT_INSTALLED_INTRO).toContain('Lapidary does not include it');
  });

  it('opens a signed-out view with the words of 11.3 (f), and keeps a sign-in Lapidary does not load', () => {
    expect(setupStatus('signed-out', claude({ state: 'not-signed-in' })).lines).toEqual([SIGNED_OUT_INTRO]);
    expect(SIGNED_OUT_INTRO).toBe(
      'Claude Code is not signed in. If reviews worked before, your sign-in has ended; this happens from time to time and nothing in Lapidary is lost.'
    );
    const elsewhere = claude({
      state: 'not-signed-in',
      authMethod: 'api_key_helper',
      message: signedInElsewhereMessage('api_key_helper')
    });
    expect(setupStatus('signed-out', elsewhere).lines).toEqual([
      SIGNED_OUT_INTRO,
      signedInElsewhereMessage('api_key_helper')
    ]);
    // The check's own "Open Setup" words are not repeated on Setup.
    expect(
      setupStatus('signed-out', claude({ state: 'not-signed-in', message: NOT_SIGNED_IN_MESSAGE })).lines
    ).toEqual([SIGNED_OUT_INTRO]);
  });

  it('says when the check now finds a sign-in that the last review said had gone', () => {
    expect(setupStatus('expired', claude(), expired).lines).toEqual([EXPIRED_INTRO, SIGNED_IN_AGAIN]);
    expect(setupStatus('expired', claude({ state: 'not-signed-in' }), expired).lines).toEqual([
      EXPIRED_INTRO
    ]);
  });

  it("names the account and plan when ready, and the key's source with an API key", () => {
    expect(
      setupStatus('ready', claude({ email: 'ann@example.com', subscriptionType: 'Claude Max' }))
    ).toEqual({
      tone: 'ok',
      title: 'Claude is ready',
      lines: [
        `Claude Code ${CURRENT} is signed in as ann@example.com (Claude Max). Claude, in the Review menu, starts a review.`
      ]
    });
    const key = setupStatus('api-key', claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }));
    expect(key.lines[0]).toContain('signs in with an API key (ANTHROPIC_API_KEY)');
    expect(key.lines[1]).toContain('remove ANTHROPIC_API_KEY');
  });

  it('advises on a usage limit from the last notice: wait, or the models a one-model limit leaves free (setup.9)', () => {
    const limit: LastFailure = { code: 'claude-usage-limit', planLimit: true };
    expect(setupStatus('usage-limit', claude(), limit)).toEqual({
      tone: 'warn',
      title: 'Claude usage limit reached',
      lines: [USAGE_LIMIT_TEXT, WAIT_ADVICE]
    });
    expect(
      setupStatus('usage-limit', claude(), limit, { status: 'rejected', kind: 'seven_day_opus' }).lines
    ).toEqual([USAGE_LIMIT_TEXT, OTHER_MODELS_ADVICE.seven_day_opus]);
    expect(
      setupStatus('usage-limit', claude(), limit, { status: 'rejected', kind: 'five_hour' }).lines
    ).toEqual([USAGE_LIMIT_TEXT, WAIT_ADVICE]);
    expect(setupStatus('usage-limit', claude({ planWarning: FREE_PLAN_WARNING }), limit).lines).toEqual([
      USAGE_LIMIT_TEXT,
      WAIT_ADVICE,
      FREE_PLAN_WARNING
    ]);
    expect(
      setupStatus('usage-limit', claude(), limit, { status: 'rejected', kind: 'seven_day_overage_included' })
        .lines
    ).toEqual([USAGE_LIMIT_TEXT, OTHER_MODELS_ADVICE.seven_day_overage_included]);
    // The notice speaks only to a usage limit.
    expect(
      setupStatus('ready', claude(), null, { status: 'rejected', kind: 'seven_day_opus' }).lines.join(' ')
    ).not.toContain('Opus');
  });

  it('advises on the weekly Sonnet limit as Claude Code names it on the plan the check found', () => {
    const limit: LastFailure = { code: 'claude-usage-limit', planLimit: true };
    const sonnet: RateLimitInfo = { status: 'rejected', kind: 'seven_day_sonnet' };
    expect(setupStatus('usage-limit', claude({ subscriptionType: 'pro' }), limit, sonnet).lines).toEqual([
      USAGE_LIMIT_TEXT,
      WAIT_ADVICE
    ]);
    expect(
      setupStatus('usage-limit', claude({ subscriptionType: 'enterprise' }), limit, sonnet).lines
    ).toEqual([USAGE_LIMIT_TEXT, WAIT_ADVICE]);
    expect(setupStatus('usage-limit', claude({ subscriptionType: 'max' }), limit, sonnet).lines).toEqual([
      USAGE_LIMIT_TEXT,
      OTHER_MODELS_ADVICE.seven_day_sonnet
    ]);
  });

  it("says no more than Claude Code's message for a usage limit that is not one of the plan's (setup.9 review)", () => {
    const other: LastFailure = { code: 'claude-usage-limit', planLimit: false };
    for (const notice of [
      null,
      { status: 'rejected', kind: 'overage' },
      { status: 'rejected', kind: 'five_hour', usingOverage: true },
      // A later notice does not change what the card decided.
      { status: 'rejected', kind: 'five_hour' }
    ]) {
      expect(setupStatus('usage-limit', claude(), other, notice), JSON.stringify(notice)).toEqual({
        tone: 'warn',
        title: 'Claude usage limit reached',
        lines: [OTHER_USAGE_LIMIT_TEXT]
      });
    }
    expect(setupStatus('usage-limit', claude({ planWarning: FREE_PLAN_WARNING }), other).lines).toEqual([
      OTHER_USAGE_LIMIT_TEXT,
      FREE_PLAN_WARNING
    ]);
    expect(OTHER_USAGE_LIMIT_TEXT).not.toContain('resets on its own');
  });

  it("gives the same advice as the review's card, or none where it gives none: one rule for both", () => {
    // Claude Code 2.1.302's messages, each with the notice it sends before it.
    const pairs: Array<[string, RateLimitInfo | null, string | undefined]> = [
      ["You've hit your session limit · resets 3pm", { status: 'rejected', kind: 'five_hour' }, 'max'],
      ["You've hit your limit · resets 3pm", null, 'max'],
      [
        "You've hit your Opus limit · resets Oct 24, 9am",
        { status: 'rejected', kind: 'seven_day_opus' },
        'max'
      ],
      [
        "You've hit your weekly limit · resets Oct 24, 9am",
        { status: 'rejected', kind: 'seven_day_sonnet' },
        'pro'
      ],
      [
        "You've hit your Sonnet limit · resets Oct 24, 9am",
        { status: 'rejected', kind: 'seven_day_sonnet' },
        'max'
      ],
      [
        "You've hit your Fable limit · resets Oct 24, 9am",
        { status: 'rejected', kind: 'seven_day_overage_included' },
        'max'
      ],
      ["You're out of usage credits · resets 3pm", { status: 'rejected', kind: 'five_hour' }, 'max'],
      ["You're out of usage credits", { status: 'rejected', kind: 'overage' }, 'max'],
      ["You're out of usage credits", null, 'max'],
      [
        "You've hit your team's shared budget. Switch to another model to continue.",
        { status: 'rejected', kind: 'overage' },
        'team'
      ],
      ["You've hit your monthly spend limit. Switch to another model to continue.", null, 'pro'],
      ["You've reached your Fable limit. Switch to another model to continue.", null, 'max'],
      ["Your seat type doesn't include usage", null, 'enterprise']
    ];
    const advised: string[] = [];
    for (const [message, notice, plan] of pairs) {
      const card = usageLimitCard(message, notice, plan);
      const last = nextLastFailure(null, failureSetupEvent('claude-usage-limit', message, notice, claude()));
      const lines = setupStatus('usage-limit', claude({ subscriptionType: plan }), last, notice).lines;
      if (card === message) {
        expect(lines, message).toEqual([OTHER_USAGE_LIMIT_TEXT]);
      } else {
        advised.push(message);
        expect(lines[0], message).toBe(USAGE_LIMIT_TEXT);
        expect(card, message).toBe(`${message}. ${lines[1] ?? ''}`);
      }
    }
    expect(advised).toHaveLength(7);
  });

  it('turns a free plan into a warning', () => {
    const status = setupStatus('ready', claude({ planWarning: FREE_PLAN_WARNING }));
    expect(status.tone).toBe('warn');
    expect(status.lines).toEqual([FREE_PLAN_WARNING]);
  });

  it("shows a check that failed in the check's own words, with what to do", () => {
    expect(setupStatus('could-not-check', claude({ state: 'error', message: 'Timed out.' })).lines).toEqual([
      'Timed out.',
      COULD_NOT_CHECK_ADVICE
    ]);
  });
});

describe('setupSteps', () => {
  it('installs and signs in with one line, on the system chosen', () => {
    const steps = setupSteps('not-installed', claude({ state: 'missing-binary' }), 'windows', 'windows');
    expect(steps.map((step) => step.command?.command)).toEqual([
      undefined,
      installAndLoginCommand('windows'),
      undefined
    ]);
    expect(steps[0]?.text).toBe(openTerminalHint('windows'));
    expect(setupSteps('not-installed', null, 'mac', 'windows')[1]?.command?.command).toBe(
      installAndLoginCommand('mac')
    );
  });

  it('signs in with claude auth login, with the full-path form, in both sign-in views', () => {
    for (const view of ['signed-out', 'expired'] as const) {
      expect(setupSteps(view, claude(), 'windows', 'windows')[1]?.command).toEqual(
        loginCommand(PATH, 'windows')
      );
    }
  });

  it("gives the full-path form only on this machine's own tab (setup.7 review)", () => {
    for (const os of ['mac', 'linux'] as const) {
      expect(setupSteps('signed-out', claude({ state: 'not-signed-in' }), os, 'windows')[1]?.command).toEqual(
        {
          command: 'claude auth login',
          fullPathCommand: null
        }
      );
      expect(setupSteps('outdated', claude({ cliVersion: '2.1.200' }), os, 'windows')[1]?.command).toEqual({
        command: 'claude update',
        fullPathCommand: null
      });
    }
    const home = '/home/ann/.local/bin/claude'; // check-public: allow
    const posix = claude({ state: 'not-signed-in', executablePath: home });
    expect(setupSteps('signed-out', posix, 'linux', 'linux')[1]?.command?.fullPathCommand).toBe(
      `'${home}' auth login`
    );
    expect(setupSteps('signed-out', posix, 'windows', 'linux')[1]?.command?.fullPathCommand).toBeNull();
  });

  it('updates an old Claude Code with claude update', () => {
    expect(
      setupSteps('outdated', claude({ cliVersion: '2.1.200' }), 'windows', 'windows')[1]?.command
    ).toEqual({
      command: 'claude update',
      fullPathCommand: `& '${PATH}' update`
    });
    expect(updateCommand(undefined, 'linux')).toEqual({ command: 'claude update', fullPathCommand: null });
  });

  it('has no steps where there is nothing to run', () => {
    for (const view of ['checking', 'could-not-check', 'usage-limit', 'api-key', 'ready'] as const) {
      expect(setupSteps(view, claude(), 'windows', 'windows'), view).toEqual([]);
      expect(stepsHeading(view), view).toBeNull();
    }
  });
});

describe('installs, troubleshooting and Advanced', () => {
  it('offers WinGet and Homebrew, and never npm', () => {
    expect(otherInstalls('windows')).toEqual([
      { name: 'WinGet', command: 'winget install Anthropic.ClaudeCode' }
    ]);
    expect(otherInstalls('mac')).toEqual([{ name: 'Homebrew', command: 'brew install --cask claude-code' }]);
    expect(otherInstalls('linux')).toEqual([]);
    for (const os of ['windows', 'mac', 'linux'] as const) {
      expect(JSON.stringify(otherInstalls(os))).not.toMatch(/npm/);
    }
  });

  it("explains, on Windows only, why npm's claude.cmd reads as not installed", () => {
    const npm = (os: 'windows' | 'mac'): string | undefined =>
      setupTroubleshooting('not-installed', null, os, os).find((item) => /npm/.test(item.question))?.answer;
    expect(npm('windows')).toContain('claude.cmd');
    expect(npm('windows')).toContain('not installed');
    expect(npm('mac')).toBeUndefined();
  });

  it('has troubleshooting for each view with something to do', () => {
    for (const view of VIEWS) {
      expect(setupTroubleshooting(view, claude(), 'windows', 'windows').length > 0, view).toBe(
        needsSetup(view)
      );
    }
  });
});

describe('the terminal questions, per view and tab (setup.17)', () => {
  const TERMINAL_VIEWS = ['not-installed', 'signed-out', 'expired', 'outdated'] as const;
  const SYSTEMS = ['windows', 'mac', 'linux'] as const;
  const HOME_MAC = '/Users/ann/.local/bin/claude'; // check-public: allow
  const pathOn = (host: (typeof SYSTEMS)[number]): string => (host === 'windows' ? PATH : HOME_MAC);
  const answer = (
    view: SetupViewId,
    os: (typeof SYSTEMS)[number],
    host: (typeof SYSTEMS)[number],
    question: string,
    runtime: RuntimeStatus | null = claude({ executablePath: pathOn(host) })
  ): string | undefined =>
    setupTroubleshooting(view, runtime, os, host).find((item) => item.question === question)?.answer;

  it('points at the full-path form exactly where the steps show one, and nowhere else', () => {
    for (const view of TERMINAL_VIEWS) {
      for (const os of SYSTEMS) {
        for (const host of SYSTEMS) {
          const runtime = claude({ executablePath: pathOn(host) });
          const shown = setupSteps(view, runtime, os, host).some((step) => step.command?.fullPathCommand);
          const items = setupTroubleshooting(view, runtime, os, host).filter((item) =>
            [NOT_RECOGNISED_QUESTION, DESKTOP_ALIAS_QUESTION].includes(item.question)
          );
          expect(items.length, `${view} ${os} ${host}`).toBe(os === 'windows' ? 2 : 1);
          for (const item of items) {
            expect([view, os, host, item.answer.includes('shown under it')]).toEqual([view, os, host, shown]);
          }
        }
      }
    }
  });

  it('leads with the full-path form on this machine s tab, in the views that show it', () => {
    for (const view of ['signed-out', 'expired', 'outdated'] as const) {
      const text = answer(view, 'windows', 'windows', NOT_RECOGNISED_QUESTION) ?? '';
      expect(text).toMatch(
        /^Use the full-path form of the command, shown under it: it names the Claude Code/
      );
      expect(text).toContain("Opening a new terminal helps only once Claude Code's folder is on PATH");
      expect(text).not.toMatch(/^Close the terminal/);
    }
    expect(answer('signed-out', 'mac', 'mac', NOT_RECOGNISED_QUESTION)).toMatch(/^Use the full-path form/);
  });

  it("names the installer's folder on another system's tab, with the view's command by its full path", () => {
    const mac = answer('signed-out', 'mac', 'windows', NOT_RECOGNISED_QUESTION) ?? '';
    expect(mac).toContain("Anthropic's installer puts Claude Code in ~/.local/bin");
    expect(mac).toContain('as in ~/.local/bin/claude auth login,');
    expect(mac).toContain('A copy installed with Homebrew is found by name');
    expect(answer('outdated', 'linux', 'windows', NOT_RECOGNISED_QUESTION)).toContain(
      'as in ~/.local/bin/claude update,'
    );
    expect(answer('outdated', 'linux', 'windows', NOT_RECOGNISED_QUESTION)).not.toMatch(/Homebrew|WinGet/);
    const windows = answer('expired', 'windows', 'mac', NOT_RECOGNISED_QUESTION) ?? '';
    expect(windows).toContain('%USERPROFILE%\\.local\\bin and does not add that folder to PATH');
    expect(windows).toContain('as in & "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login,');
    expect(windows).toContain('A copy installed with WinGet is found by name');
    // This machine's tab, with no path to show, says the same as another system's.
    expect(
      answer(
        'signed-out',
        'windows',
        'windows',
        NOT_RECOGNISED_QUESTION,
        claude({ executablePath: undefined })
      )
    ).toBe(windows);
  });

  it('says in the not-installed view that the install line needs no PATH, and when to open a new terminal', () => {
    for (const host of SYSTEMS) {
      expect(answer('not-installed', 'windows', host, NOT_RECOGNISED_QUESTION, null)).toBe(
        'The install line above does not need it: it signs in through the full path of the copy it installs. After a WinGet install, a terminal that was already open may not see the folder WinGet put Claude Code in, so open a new terminal, then run claude auth login.'
      );
    }
    expect(answer('not-installed', 'mac', 'windows', NOT_RECOGNISED_QUESTION, null)).toContain(
      'After a Homebrew install, a terminal that was already open may not see the folder Homebrew put Claude Code in'
    );
    expect(answer('not-installed', 'linux', 'linux', NOT_RECOGNISED_QUESTION, null)).toBe(
      "The install line above does not need it: it signs in through the full path of the copy it installs, ~/.local/bin/claude. To run claude by name later, add ~/.local/bin to PATH, as the installer's output says, then open a new terminal."
    );
  });

  it('answers a terminal whose claude starts Claude Desktop, on the Windows tab only', () => {
    const intro =
      "An older Claude Desktop can put a Claude.exe in %LOCALAPPDATA%\\Microsoft\\WindowsApps, and where that folder comes before Claude Code's on PATH, typing claude starts Claude Desktop.";
    expect(answer('signed-out', 'windows', 'windows', DESKTOP_ALIAS_QUESTION)).toBe(
      `${intro} Use the full-path form of the command, shown under it, which names Claude Code itself.`
    );
    expect(answer('outdated', 'windows', 'linux', DESKTOP_ALIAS_QUESTION)).toBe(
      `${intro} Run Claude Code by its full path in place of claude, as in & "$env:USERPROFILE\\.local\\bin\\claude.exe" update for a copy from Anthropic's installer.`
    );
    expect(answer('not-installed', 'windows', 'windows', DESKTOP_ALIAS_QUESTION, null)).toContain(
      'The install line above is not affected, as it signs in through the full path of the copy it installs.'
    );
    for (const os of ['mac', 'linux'] as const) {
      for (const view of TERMINAL_VIEWS) {
        expect(answer(view, os, os, DESKTOP_ALIAS_QUESTION), `${view} ${os}`).toBeUndefined();
      }
    }
    for (const view of ['could-not-check', 'ready', 'api-key', 'usage-limit', 'checking'] as const) {
      expect(answer(view, 'windows', 'windows', DESKTOP_ALIAS_QUESTION), view).toBeUndefined();
    }
  });

  it('builds the install line from the same full path it names', () => {
    expect(installAndLoginCommand('windows')).toBe(
      `irm https://claude.ai/install.ps1 | iex; ${installerPathCommand('windows', 'auth login')}`
    );
    expect(installAndLoginCommand('linux')).toBe(
      `curl -fsSL https://claude.ai/install.sh | bash && ${installerPathCommand('linux', 'auth login')}`
    );
  });
});

describe('Settings Claude account line (setup.17)', () => {
  const plan = claude({
    credential: 'subscription',
    email: 'ann@example.com',
    subscriptionType: 'Claude Max'
  });

  it('names the account and its plan, and no key for a plan s sign-in that reports none', () => {
    expect(claudeAccountLine(plan)).toBe('ann@example.com (Claude Max)');
    expect(claudeAccountLine({ ...plan, apiKeySource: 'none' })).toBe('ann@example.com (Claude Max)');
    expect(apiKeySourceOf({ ...plan, apiKeySource: 'none' })).toBeNull();
  });

  it("names an API key's source, and the token", () => {
    expect(claudeAccountLine(claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }))).toBe(
      'signed in, API key from ANTHROPIC_API_KEY'
    );
    expect(apiKeySourceOf(claude({ apiKeySource: 'ANTHROPIC_API_KEY' }))).toBe('ANTHROPIC_API_KEY');
    // The token outranks a key set beside it (Appendix A, Authentication).
    expect(claudeAccountLine(claude({ credential: 'auth-token', apiKeySource: 'ANTHROPIC_API_KEY' }))).toBe(
      'signed in, token from ANTHROPIC_AUTH_TOKEN'
    );
  });

  it("gives the check's own words when it is not ready, and says when nothing was checked", () => {
    expect(claudeAccountLine(null)).toBe('not checked');
    expect(claudeAccountLine(claude({ state: 'not-signed-in', message: NOT_SIGNED_IN_MESSAGE }))).toBe(
      NOT_SIGNED_IN_MESSAGE
    );
    expect(claudeAccountLine(claude({ state: 'error' }))).toBe('error');
  });
});

describe('a token in ANTHROPIC_AUTH_TOKEN (setup.17)', () => {
  const token = claude({ credential: 'auth-token', authMethod: 'oauth_token' });

  it('reads as ready with the token, billed to the account behind it, with how to use the sign-in instead', () => {
    expect(setupView(token, null)).toBe('ready');
    expect(runtimeLabel(token)).toBe('Claude ready (token)');
    expect(setupStatus('ready', token).lines).toEqual([
      `Claude Code ${CURRENT} signs in with the token in ANTHROPIC_AUTH_TOKEN, such as a gateway or proxy hands out, so reviews are billed to the account behind that token, not through your Claude sign-in. Claude, in the Review menu, starts a review.`,
      `To use your Claude sign-in instead, remove ANTHROPIC_AUTH_TOKEN from your environment and start ${APP_NAME} again.`
    ]);
    expect(connectionTestNote(token)).toBe(CONNECTION_TEST_NOTES['auth-token']);
    expect(connectionTestNote(token)).not.toContain('your plan');
    expect(
      Object.fromEntries(advancedRows(token, 'windows').map((row) => [row.label, row.value]))['Signs in with']
    ).toBe('a token from ANTHROPIC_AUTH_TOKEN, auth method oauth_token');
  });
});

describe('Advanced and the status bar button', () => {
  it('lists the Claude Code path and version, and where it looks', () => {
    const checkedAt = new Date(2026, 9, 18, 14, 2, 11).toISOString();
    const rows = advancedRows(
      claude({ credential: 'subscription', authMethod: 'claude.ai', checkedAt }),
      'windows'
    );
    expect(Object.fromEntries(rows.map((row) => [row.label, row.value]))).toEqual({
      'Claude Code': PATH,
      Version: CURRENT,
      Needs: `2.1.266 or newer, and ${CURRENT} or newer for the newest models`,
      'Signs in with': 'a Claude plan, auth method claude.ai',
      'Last checked': '14:02:11',
      'Looks in': expect.stringContaining('claude.exe') as unknown
    });
    expect(
      advancedRows(null, 'linux')
        .map((row) => row.value)
        .slice(0, 2)
    ).toEqual(['not found', 'none']);
    expect(checkedAtText('not a time')).toBe('not a time');
  });

  it('labels the status bar button by what it opens', () => {
    expect(runtimeButtonTitle('claude')).toBe('Open Setup');
    expect(runtimeButtonTitle('openai')).toBe('Open Settings');
  });
});

describe('Test the connection (setup.8)', () => {
  it('is offered once Claude Code is found and not definitely signed out', () => {
    expect(canTestConnection(null)).toBe(false);
    expect(canTestConnection(claude({ state: 'missing-binary' }))).toBe(false);
    expect(canTestConnection(claude({ state: 'not-signed-in' }))).toBe(false);
    expect(canTestConnection(claude())).toBe(true);
    expect(canTestConnection(claude({ state: 'error' }))).toBe(true);
  });

  it('says what it costs, in the terms of what Claude Code signs in with', () => {
    // The task's words, for a Claude plan.
    expect(connectionTestNote(claude({ credential: 'subscription' }))).toBe(
      'Sends one very small request to Claude, which counts against your plan like any other.'
    );
    // Not "your plan" under a card that says the key is billed "not to a Claude plan" (setup.8 review).
    expect(connectionTestNote(claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }))).toBe(
      'Sends one very small request to Claude, which is billed to your API key like any other.'
    );
    expect(setupStatus('api-key', claude({ credential: 'api-key' })).lines.join(' ')).toContain(
      'not to a Claude plan'
    );
    expect(connectionTestNote(claude({ credential: 'cloud' }))).toBe(
      'Sends one very small request to Claude, which is billed through your cloud provider like any other.'
    );
    // A failed check does not say what Claude Code signs in with.
    const unknown =
      'Sends one very small request to Claude, which counts against your plan or API key like any other.';
    expect(connectionTestNote(claude({ state: 'error' }))).toBe(unknown);
    expect(connectionTestNote(claude())).toBe(unknown);
    expect(connectionTestNote(null)).toBe(unknown);
    expect(Object.keys(CONNECTION_TEST_NOTES).sort()).toEqual([
      'api-key',
      'auth-token',
      'cloud',
      'subscription',
      'unknown'
    ]);
    for (const note of Object.values(CONNECTION_TEST_NOTES)) {
      expect(note).toMatch(/^Sends one very small request to Claude, which .+ like any other\.$/);
    }
  });

  it('clears the last failure when it goes through, as a review does, which a re-check never does', () => {
    const ok = { ok: true, model: 'claude-haiku-4-5-20251001', durationMs: 2900 };
    expect(testSetupEvent(ok, claude())).toEqual({ type: 'success' });
    // Signed in again after the sign-in ended: only a test or a review clears it.
    expect(setupView(claude(), nextLastFailure(expired, { type: 'check', runtime: claude() }))).toBe(
      'expired'
    );
    const after = nextLastFailure(
      expired,
      testSetupEvent(ok, claude()) ?? { type: 'check', runtime: claude() }
    );
    expect(after).toBeNull();
    expect(setupView(claude(), after)).toBe('ready');
    expect(SIGNED_IN_AGAIN).toContain('test the connection or try the review');
  });

  it('remembers a failure with the Claude Code it happened with, and forgets nothing when cancelled', () => {
    const signedOut = {
      ok: false,
      durationMs: 800,
      error: { code: 'claude-not-signed-in' as const, message: 'Claude Code is not signed in.' }
    };
    const event = testSetupEvent(signedOut, claude());
    expect(event).toEqual({ type: 'failure', code: 'claude-not-signed-in', runtime: claude() });
    expect(setupView(claude(), nextLastFailure(null, event ?? { type: 'success' }))).toBe('signed-out');
    expect(
      testSetupEvent(
        { ok: false, durationMs: 10, error: { code: 'cancelled', message: 'Test cancelled.' } },
        claude()
      )
    ).toBeNull();
    expect(testSetupEvent({ ok: false, durationMs: 10 }, null)).toEqual({
      type: 'failure',
      code: 'unknown',
      runtime: null
    });
  });

  it("remembers whether a usage limit it stopped at is one of the plan's, from its own notice (setup.9 review)", () => {
    const limited = (message: string, rateLimit?: RateLimitInfo) => ({
      ok: false,
      durationMs: 900,
      error: { code: 'claude-usage-limit' as const, message },
      ...(rateLimit ? { rateLimit } : {})
    });
    expect(
      testSetupEvent(
        limited("You've hit your session limit · resets 3pm", { status: 'rejected', kind: 'five_hour' }),
        claude()
      )
    ).toEqual({ type: 'failure', code: 'claude-usage-limit', runtime: claude(), planLimit: true });
    expect(
      testSetupEvent(
        limited("You've hit your team's shared budget. Switch to another model to continue.", {
          status: 'rejected',
          kind: 'overage'
        }),
        claude()
      )
    ).toEqual({ type: 'failure', code: 'claude-usage-limit', runtime: claude(), planLimit: false });
    expect(testSetupEvent(limited("You're out of usage credits"), claude())).toMatchObject({
      planLimit: false
    });
    // The same words with the plan's reset, after a notice that names the plan's limit.
    expect(
      testSetupEvent(
        limited("You're out of usage credits · resets 3pm", { status: 'rejected', kind: 'five_hour' }),
        claude()
      )
    ).toMatchObject({ planLimit: true });
    // With no notice, Claude Code's words decide.
    expect(testSetupEvent(limited("You've hit your session limit · resets 3pm"), claude())).toMatchObject({
      planLimit: true
    });
  });

  it('says how long it took, and when, in a line', () => {
    expect(testDurationText(2949)).toBe('2.9 s');
    expect(testDurationText(0)).toBe('0.0 s');
    expect(testDurationText(12_400)).toBe('12 s');
    const at = '2026-10-18T12:02:11.000Z';
    expect(
      connectionTestLine({
        result: { ok: true, model: 'claude-haiku-4-5-20251001', durationMs: 2900 },
        finishedAt: at
      })
    ).toEqual({
      tone: 'ok',
      text: `Claude answered the test at ${checkedAtText(at)}, in 2.9 s (claude-haiku-4-5-20251001).`
    });
    expect(connectionTestLine({ result: { ok: true, durationMs: 31_000 }, finishedAt: at }).text).toBe(
      `Claude answered the test at ${checkedAtText(at)}, in 31 s.`
    );
    expect(
      connectionTestLine({
        result: {
          ok: false,
          durationMs: 60_000,
          error: {
            code: 'claude-failed',
            message:
              'Claude did not answer within 60 seconds, so the test was stopped. Try again in a minute.'
          }
        },
        finishedAt: at
      })
    ).toEqual({
      tone: 'failed',
      text: `The test at ${checkedAtText(at)} did not go through: Claude did not answer within 60 seconds, so the test was stopped. Try again in a minute.`
    });
  });
});
