import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SetupScreen } from '../../src/renderer/components/SetupScreen';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import type { RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import {
  PRIVACY_FOOTER,
  installAndLoginCommand,
  setupStatus,
  setupView,
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
  options: { os?: SetupOs; tryAnyway?: boolean; checking?: boolean } = {}
): string {
  return renderToStaticMarkup(
    createElement(SetupScreen, {
      runtime,
      lastFailure,
      checking: options.checking ?? false,
      os: options.os ?? 'windows',
      onCheckAgain: () => undefined,
      onClose: () => undefined,
      ...(options.tryAnyway ? { onTryAnyway: () => undefined } : {})
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

const SIGN_IN_LIKE = /sign[\s-]*in|sign[\s-]*on|log[\s-]*in|log[\s-]*on|authori[sz]e|connect/i;

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
    expect(render(claude({ state: 'not-signed-in' }), null, { checking: true })).toContain(
      '<button type="button" class="primary" disabled="">Checking…</button>'
    );
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
