import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SetupScreen } from '../../src/renderer/components/SetupScreen';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import { heldButton } from '../../src/renderer/state/heldButton';
import type { RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import {
  CONNECTION_TEST_NOTES,
  CONNECTION_TEST_RUNNING,
  PRIVACY_FOOTER,
  canTestConnection,
  checkedAtText,
  connectionTestNote,
  installAndLoginCommand,
  setupStatus,
  setupView,
  type ConnectionTestOutcome,
  type LastFailure,
  type SetupOs,
  type SetupViewId
} from '../../src/shared/ui/setup';

/* setup.7: the Setup screen in each of its views, rendered with
   react-dom/server, as the author would read it: the status card, the steps
   with a Copy for every command, troubleshooting, Advanced and the privacy
   footer. No button may read like a sign-in: the app never signs anyone in
   (CLAUDE.md rule 2), it says how to in Claude Code. The status bar's runtime
   label as a button, and the review dialog's warning, are checked here too.
   Effects do not run under react-dom/server, so nothing is called. This file
   is type-checked with the renderer's project (tsconfig.web.json). */

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    provider: 'claude',
    state: 'ready',
    executablePath: PATH,
    cliVersion: '2.1.283',
    minCliVersion: '2.1.266',
    checkedAt: '2026-10-18T12:02:11.000Z',
    ...patch
  };
}

/** One runtime and last failure for each view, as `setupView` reads them. */
const CASES: ReadonlyArray<[SetupViewId, RuntimeStatus | null, LastFailure | null]> = [
  ['checking', null, null],
  [
    'not-installed',
    {
      provider: 'claude',
      state: 'missing-binary',
      message: 'Claude Code is not installed. Open Setup to install it, then check again.'
    },
    null
  ],
  ['signed-out', claude({ state: 'not-signed-in', authMethod: 'none' }), null],
  ['expired', claude({ state: 'not-signed-in' }), { code: 'claude-login-expired' }],
  ['could-not-check', claude({ state: 'error', message: 'Claude Code did not answer within 60 s.' }), null],
  ['outdated', claude({ state: 'error', cliVersion: '2.1.200' }), null],
  ['usage-limit', claude({ credential: 'subscription' }), { code: 'claude-usage-limit' }],
  ['api-key', claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }), null],
  [
    'ready',
    claude({ credential: 'subscription', email: 'ann@example.com', subscriptionType: 'Claude Max' }),
    null
  ]
];

function render(
  runtime: RuntimeStatus | null,
  lastFailure: LastFailure | null,
  options: {
    os?: SetupOs;
    host?: SetupOs;
    tryAnyway?: boolean;
    checking?: boolean;
    /** App always gives Test the connection a handler; false leaves it out */
    test?: boolean;
    testing?: boolean;
    testOutcome?: ConnectionTestOutcome;
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(SetupScreen, {
      runtime,
      lastFailure,
      checking: options.checking ?? false,
      os: options.os ?? 'windows',
      // This machine, as the user agent would say; Node's own says neither.
      host: options.host ?? 'windows',
      onCheckAgain: () => undefined,
      onClose: () => undefined,
      ...(options.tryAnyway ? { onTryAnyway: () => undefined } : {}),
      ...(options.test === false ? {} : { onTest: () => undefined }),
      ...(options.testing ? { testing: true } : {}),
      ...(options.testOutcome ? { testOutcome: options.testOutcome } : {})
    })
  );
}

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The page's text, tags taken out. */
const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

/** Every button: its text, and its name and tooltip when it has them. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const attrs = m[1] ?? '';
    const named = [...attrs.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((a) => a[1] ?? '');
    return decode([text(m[2] ?? '').trim(), ...named].join(' | '));
  });
}

/** The commands, in order. */
const commands = (html: string): string[] =>
  [...html.matchAll(/<div class="cmd"><code id="[^"]+">([\s\S]*?)<\/code>/g)].map((m) => decode(m[1] ?? ''));

/* "Connect", as in "Connect Claude", reads like a sign-in; the noun in Test the
   connection (setup.8), which sends a request and signs no one in, does not. */
const SIGN_IN_LIKE = /sign[\s-]*in|sign[\s-]*on|log[\s-]*in|log[\s-]*on|authori[sz]e|connect(?!ion)/i;

describe('the Setup screen in each view (setup.7)', () => {
  it('covers every view', () => {
    expect(CASES.map(([view, runtime, last]) => [view, setupView(runtime, last)])).toEqual(
      CASES.map(([view]) => [view, view])
    );
  });

  for (const [view, runtime, last] of CASES) {
    describe(view, () => {
      const html = render(runtime, last, { tryAnyway: true });
      const page = text(html);

      it('shows the status card with its title and lines, and Check again', () => {
        const status = setupStatus(view, runtime, last);
        expect(html).toContain(`class="setup__status setup__status--${status.tone}"`);
        expect(page).toContain(status.title);
        for (const line of status.lines) expect(page).toContain(line);
        expect(buttons(html)).toContain(view === 'checking' ? 'Checking…' : 'Check again');
      });

      it('has no button labelled like a sign-in', () => {
        const all = buttons(html);
        expect(all.length).toBeGreaterThan(1);
        expect(all.filter((label) => SIGN_IN_LIKE.test(label))).toEqual([]);
      });

      it('gives every command a Copy of its own, described by the command', () => {
        const ids = [...html.matchAll(/<div class="cmd"><code id="([^"]+)">/g)].map((m) => m[1]);
        const copies = [
          ...html.matchAll(/<button type="button" aria-describedby="([^"]+)">Copy<\/button>/g)
        ].map((m) => m[1]);
        expect(copies).toEqual(ids);
      });

      it('ends with Advanced, the Claude Code path and version, and the privacy footer', () => {
        expect(html).toMatch(/<details class="setup__advanced"><summary>Advanced<\/summary>/);
        expect(page).toContain(runtime?.executablePath ?? 'not found');
        expect(page).toContain(`Version ${runtime?.cliVersion ?? 'none'}`);
        expect(page).toContain(PRIVACY_FOOTER);
        expect(html).toContain('href="https://code.claude.com/docs/en/setup"');
      });
    });
  }

  it('leads a missing Claude Code with the one line that installs it and signs in, and never npm', () => {
    for (const os of ['windows', 'mac', 'linux'] as const) {
      const html = render(CASES[1]?.[1] ?? null, null, { os });
      expect(commands(html)[0]).toBe(installAndLoginCommand(os));
      expect(text(html)).not.toMatch(/npm install -g|@anthropic-ai\/claude-code/);
    }
    const windows = render(CASES[1]?.[1] ?? null, null, { os: 'windows' });
    expect(commands(windows)).toEqual([
      installAndLoginCommand('windows'),
      'winget install Anthropic.ClaudeCode'
    ]);
    expect(text(windows)).toContain('Installed Claude Code with npm?');
    expect(text(windows)).toContain('claude.cmd');
    expect(commands(render(CASES[1]?.[1] ?? null, null, { os: 'mac' }))).toEqual([
      installAndLoginCommand('mac'),
      'brew install --cask claude-code'
    ]);
    expect(text(render(CASES[1]?.[1] ?? null, null, { os: 'mac' }))).not.toContain('npm');
  });

  it('preselects the system it is given, and marks it pressed', () => {
    const html = render(null, null, { os: 'mac' });
    expect(html).not.toContain('aria-pressed');
    const missing = render(CASES[1]?.[1] ?? null, null, { os: 'mac' });
    expect(missing).toContain(
      '<button type="button" class="setup__tab--active" aria-pressed="true">macOS</button>'
    );
    expect(missing).toContain('<button type="button" class="" aria-pressed="false">Windows</button>');
  });

  it('signs in with claude auth login, and by full path for a terminal that does not find claude', () => {
    const html = render(claude({ state: 'not-signed-in' }), null);
    expect(commands(html)).toEqual(['claude auth login', `& '${PATH}' auth login`]);
    expect(text(html)).toContain('If the terminal does not recognise claude, use this instead:');
    expect(text(html)).toContain('Which Claude plans work?');
  });

  it("gives the full-path forms only on this machine's own tab (setup.7 review)", () => {
    // This machine's Windows path, quoted for a Mac or Linux terminal, would run nowhere.
    for (const os of ['mac', 'linux'] as const) {
      const signedOut = render(claude({ state: 'not-signed-in' }), null, { os, host: 'windows' });
      expect(commands(signedOut)).toEqual(['claude auth login']);
      expect(text(signedOut)).not.toContain('If the terminal does not recognise claude');
      // Advanced still names the Claude Code found here.
      expect(text(signedOut)).toContain(`Claude Code ${PATH}`);
      const tooOld = render(claude({ state: 'error', cliVersion: '2.1.200' }), null, { os, host: 'windows' });
      expect(commands(tooOld)).toEqual(['claude update']);
      const older = render(claude({ cliVersion: '2.1.270', credential: 'subscription' }), null, {
        os,
        host: 'windows'
      });
      expect(older).toContain('data-testid="claude-update-note"');
      expect(commands(older)).toEqual(['claude update']);
    }
    // The tab of the system the user agent names is chosen first, with them.
    const home = '/Users/ann/.local/bin/claude'; // check-public: allow
    const mac = render(claude({ state: 'not-signed-in', executablePath: home }), null, {
      os: 'mac',
      host: 'mac'
    });
    expect(commands(mac)).toEqual(['claude auth login', `'${home}' auth login`]);
  });

  it('updates an old Claude Code from its steps, without the update note as well', () => {
    const html = render(claude({ state: 'error', cliVersion: '2.1.200' }), null);
    expect(commands(html)).toEqual(['claude update', `& '${PATH}' update`]);
    expect(html).not.toContain('data-testid="claude-update-note"');
  });

  it("shows the review dialog's out-of-date note when Claude Code is ready but older than recommended", () => {
    const html = render(claude({ cliVersion: '2.1.270', credential: 'subscription' }), null);
    expect(html).toContain('data-testid="claude-update-note"');
    expect(text(html)).toContain(
      'Claude Code 2.1.270 is out of date, so it may not offer the newest models.'
    );
    expect(commands(html)).toEqual(['claude update', `& '${PATH}' update`]);
    // Setup has its own Check again in the status card: the note adds none.
    expect(buttons(html).filter((label) => label === 'Check again')).toHaveLength(1);
  });

  it('offers "Try the review anyway" only when it is given', () => {
    const failed = claude({ state: 'error', message: 'Timed out.' });
    expect(buttons(render(failed, null, { tryAnyway: true }))).toContain('Try the review anyway');
    expect(buttons(render(failed, null))).not.toContain('Try the review anyway');
  });

  it('makes Check again the blue button only where there is something to do, and holds it while checking', () => {
    expect(render(claude({ state: 'not-signed-in' }), null)).toContain(
      '<button type="button" class="primary">Check again</button>'
    );
    expect(render(claude(), null)).toContain('<button type="button">Check again</button>');
    // Held, not disabled, so a Check again pressed from the keyboard keeps the focus (setup.8 review).
    expect(render(claude({ state: 'not-signed-in' }), null, { checking: true })).toContain(
      '<button type="button" class="primary" aria-disabled="true">Checking…</button>'
    );
    expect(render(null, null)).toContain('<button type="button" aria-disabled="true">Checking…</button>');
    for (const [, runtime, last] of CASES) {
      expect(render(runtime, last, { checking: true, testing: true })).not.toMatch(/<button[^>]* disabled=/);
    }
  });
});

describe('Test the connection on the Setup screen (setup.8)', () => {
  const noteOf = (runtime: RuntimeStatus | null): string =>
    `<p class="setup__test-note">${connectionTestNote(runtime)}</p>`;
  const NOTE = noteOf(claude());

  it('sits beside Check again, with what it costs under the buttons, wherever Claude Code is found and not signed out', () => {
    for (const [view, runtime, last] of CASES) {
      const html = render(runtime, last);
      const offered = buttons(html).includes('Test the connection');
      expect([view, offered]).toEqual([view, canTestConnection(runtime)]);
      expect([view, html.includes(noteOf(runtime))]).toEqual([view, offered]);
      if (!offered) continue;
      // In the status card, after Check again, and the note under the buttons.
      const card = html.slice(html.indexOf('<section class="setup__status'), html.indexOf('</section>'));
      expect(card).toMatch(
        /<div class="setup__status-actions"><button type="button"[^>]*>Check again<\/button><button type="button">Test the connection<\/button><\/div><div class="setup__test"><p class="setup__test-note">/
      );
    }
    // Offered in the views where it helps: ready, and a sign-in the last review said had ended.
    expect(buttons(render(claude(), { code: 'claude-login-expired' }))).toContain('Test the connection');
    expect(buttons(render(claude({ state: 'error', message: 'Timed out.' }), null))).toContain(
      'Test the connection'
    );
  });

  it('is the only button that names a connection, and none reads like a sign-in', () => {
    expect(SIGN_IN_LIKE.test('Connect Claude')).toBe(true);
    expect(SIGN_IN_LIKE.test('Reconnect')).toBe(true);
    expect(SIGN_IN_LIKE.test('Test the connection')).toBe(false);
    const all = CASES.flatMap(([, runtime, last]) => buttons(render(runtime, last, { tryAnyway: true })));
    expect(new Set(all.filter((label) => /connect/i.test(label)))).toEqual(new Set(['Test the connection']));
  });

  it('is held while a test runs, keeping its label, and says it is waiting where the result will be', () => {
    // The label stays, so the buttons keep their width and the card's text does not reflow.
    const outcome: ConnectionTestOutcome = {
      result: { ok: true, durationMs: 1700 },
      finishedAt: '2026-10-18T12:02:11.000Z'
    };
    const html = render(claude(), null, { testing: true, testOutcome: outcome });
    // Held with aria-disabled, not disabled: Chromium moves the focus of a
    // focused button that becomes disabled to the page, so a test started from
    // the keyboard would leave the author at the top of the window (setup.8
    // review). The window check in PLAN saw the focus stay on it.
    expect(html).toContain('<button type="button" aria-disabled="true">Test the connection</button>');
    expect(html).not.toMatch(/<button[^>]* disabled=/);
    expect(html).toContain(
      `${NOTE}<p class="setup__test-result setup__test-result--running">${CONNECTION_TEST_RUNNING}</p></div>`
    );
    expect(CONNECTION_TEST_RUNNING).toBe('Testing: waiting for Claude to answer…');
    // The last result gives way to it.
    expect(html).not.toContain('Claude answered the test');
    expect(render(claude(), null, { testOutcome: outcome })).toContain('Claude answered the test');
  });

  it('says under the buttons how the last test went, and when', () => {
    const at = '2026-10-18T12:02:11.000Z';
    const ok = render(claude(), null, {
      testOutcome: {
        result: { ok: true, model: 'claude-haiku-4-5-20251001', durationMs: 2900 },
        finishedAt: at
      }
    });
    expect(ok).toContain(
      `<p class="setup__test-result setup__test-result--ok">Claude answered the test at ${checkedAtText(at)}, in 2.9 s (claude-haiku-4-5-20251001).</p>`
    );
    const failed = render(
      claude(),
      { code: 'claude-not-signed-in' },
      {
        testOutcome: {
          result: {
            ok: false,
            durationMs: 800,
            error: { code: 'claude-not-signed-in', message: 'Claude Code is not signed in.' }
          },
          finishedAt: at
        }
      }
    );
    expect(failed).toContain(
      `<p class="setup__test-result setup__test-result--failed">The test at ${checkedAtText(at)} did not go through: Claude Code is not signed in.</p>`
    );
    // Inside the status card, which is the live region that reads it out.
    expect(failed.indexOf('setup__test-result')).toBeLessThan(failed.indexOf('</section>'));
    expect(failed.indexOf('role="status"')).toBeLessThan(failed.indexOf('setup__test-result'));
  });

  it('keeps the last result in view when the button goes, and offers nothing without a handler', () => {
    const outcome: ConnectionTestOutcome = {
      result: {
        ok: false,
        durationMs: 300,
        error: { code: 'claude-missing-binary', message: 'Not installed.' }
      },
      finishedAt: '2026-10-18T12:02:11.000Z'
    };
    const missing = render(CASES[1]?.[1] ?? null, null, { testOutcome: outcome });
    expect(buttons(missing)).not.toContain('Test the connection');
    expect(missing).not.toContain(NOTE);
    expect(missing).toContain('setup__test-result--failed');
    const noHandler = render(claude(), null, { test: false });
    expect(buttons(noHandler)).not.toContain('Test the connection');
    expect(noHandler).not.toContain('class="setup__test"');
  });

  it('says what the test costs in the terms the card uses for the credential', () => {
    const note = (html: string): string =>
      decode(/<p class="setup__test-note">([^<]*)<\/p>/.exec(html)?.[1] ?? '');
    // An API key: billed to the key, as the card's own line says, never "your plan" (setup.8 review).
    const key = render(claude({ credential: 'api-key', apiKeySource: 'ANTHROPIC_API_KEY' }), null);
    expect(text(key)).toContain('not to a Claude plan');
    expect(note(key)).toBe(CONNECTION_TEST_NOTES['api-key']);
    expect(note(key)).not.toContain('plan');
    const plan = render(claude({ credential: 'subscription', email: 'ann@example.com' }), null);
    expect(note(plan)).toBe(
      'Sends one very small request to Claude, which counts against your plan like any other.'
    );
    const cloud = render(claude({ credential: 'cloud' }), null);
    expect(note(cloud)).toBe(CONNECTION_TEST_NOTES.cloud);
    expect(note(cloud)).not.toContain('plan');
    const failed = render(claude({ state: 'error', message: 'Timed out.' }), null);
    expect(note(failed)).toBe(CONNECTION_TEST_NOTES.unknown);
  });
});

describe('a button held while its work runs (setup.8 review)', () => {
  it('is aria-disabled with no click handler while held, and takes the click otherwise', () => {
    const onClick = (): void => undefined;
    expect(heldButton(true, onClick)).toEqual({ 'aria-disabled': true });
    expect(heldButton(false, onClick)).toEqual({ onClick });
    expect(heldButton(false, undefined)).toEqual({});
    expect('disabled' in heldButton(true, onClick)).toBe(false);
  });
});

describe('the status bar runtime label (setup.7)', () => {
  it('is a button that says what it opens', () => {
    const html = renderToStaticMarkup(
      createElement(StatusBar, {
        review: null,
        runtimeLabel: 'Claude Code not installed',
        runtimeTitle: 'Open Setup',
        onRuntime: () => undefined
      })
    );
    expect(html).toContain(
      '<button type="button" class="statusbar__runtime" title="Open Setup">Claude Code not installed</button>'
    );
  });

  it('stays text without a handler', () => {
    const html = renderToStaticMarkup(
      createElement(StatusBar, { review: null, runtimeLabel: 'Claude ready' })
    );
    expect(html).toContain('<span>Claude ready</span>');
  });
});

describe('the review dialog with Claude not quite ready (setup.7)', () => {
  const review: Review = {
    version: 1,
    id: 'chapter-1--2026-10-18T09-00-00-000Z',
    sourcePath: 'C:/vault/Chapter 1.md',
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:00:00.000Z',
    base: { text: 'One.\n\nTwo.', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    generator: { kind: 'manual' },
    hunks: [],
    comments: []
  };

  const dialog = (
    runtime: RuntimeStatus,
    last: LastFailure | null,
    provider: 'claude' | 'openai' = 'claude'
  ) =>
    renderToStaticMarkup(
      createElement(ReviewDialog, {
        review,
        settings: { ...DEFAULT_SETTINGS, provider },
        models: {},
        modelsLoading: {},
        runtimes: { claude: runtime },
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
        claudeLastFailure: last,
        onOpenSetup: () => undefined,
        onStart: () => undefined,
        onClose: () => undefined
      })
    );

  it('opens with a warning and Open Setup when the check failed', () => {
    const html = dialog(claude({ state: 'error', message: 'Timed out.' }), null);
    expect(html).toContain('data-testid="claude-setup-warning"');
    expect(text(html)).toContain('Lapidary could not check Claude Code, so this review may fail.');
    expect(buttons(html)).toContain('Open Setup');
  });

  it('says Claude Code is missing or signed out when a check open over it finds so, with Open Setup (setup.7 review)', () => {
    const missing = dialog(
      { provider: 'claude', state: 'missing-binary', message: 'Claude Code is not installed.' },
      null
    );
    expect(missing).toContain('data-testid="claude-setup-warning"');
    expect(text(missing)).toContain('Claude Code is not installed, so this review cannot run yet.');
    expect(buttons(missing)).toContain('Open Setup');
    const signedOut = dialog(claude({ state: 'not-signed-in' }), null);
    expect(text(signedOut)).toContain('Claude Code is not signed in, so this review cannot run yet.');
    expect(text(signedOut)).not.toContain('The last review said');
    expect(buttons(signedOut)).toContain('Open Setup');
  });

  it('leaves an old Claude Code below the minimum to Setup, and keeps the update note above it', () => {
    const tooOld = dialog(claude({ state: 'error', cliVersion: '2.1.200' }), null);
    expect(tooOld).toContain('data-testid="claude-setup-warning"');
    expect(tooOld).not.toContain('data-testid="claude-update-note"');
    const older = dialog(claude({ cliVersion: '2.1.270' }), null);
    expect(older).toContain('data-testid="claude-update-note"');
    expect(older).not.toContain('data-testid="claude-setup-warning"');
    expect(buttons(older)).toContain('Check again');
  });

  it('says nothing about Claude when it is ready, or when OpenAI is the provider', () => {
    expect(dialog(claude(), null)).not.toMatch(/claude-setup-warning|claude-update-note/);
    expect(dialog(claude({ state: 'error' }), null, 'openai')).not.toMatch(
      /claude-setup-warning|claude-update-note/
    );
  });
});
