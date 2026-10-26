import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AboutDialog, AboutView, type AboutViewProps } from '../../src/renderer/components/AboutDialog';
import { ReviewDialog } from '../../src/renderer/components/ReviewDialog';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import { SetupScreen } from '../../src/renderer/components/SetupScreen';
import { UpdateOverlay } from '../../src/renderer/components/UpdateOverlay';
import {
  AI_OUTPUT_NOTICE,
  APP_NAME,
  APP_REPOSITORY,
  APP_TAGLINE,
  DISCLAIMER
} from '../../src/shared/branding';
import type { AppInfo, RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Review } from '../../src/shared/types';
import { COPY_DIAGNOSTICS, DIAGNOSTICS_INTRO } from '../../src/shared/ui/diagnostics';
import { AUTO_CHECK_NOTE } from '../../src/shared/ui/update';
import { updateStatusLine, type UpdateState, type UpdateStatus } from '../../src/shared/updates';

/* release.9: About, Restart now's overlay, the review dialog's caution, the
   Setup screen's version and Settings' About, rendered with react-dom/server
   as the author would read them. Effects do not run here, so About asks main
   nothing; `AboutView` is drawn with the answers given. Type-checked with the
   renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

/** Each button as `label [blue] [disabled] [held]`, in order. */
function buttons(html: string): string[] {
  return [...decode(html).matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([, attrs = '', label = '']) =>
      `${text(label).trim()}${/class="primary"/.test(attrs) ? ' [blue]' : ''}${
        / disabled=""/.test(attrs) ? ' [disabled]' : ''
      }${/aria-disabled="true"/.test(attrs) ? ' [held]' : ''}`
  );
}

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

const INFO: AppInfo = {
  name: APP_NAME,
  version: '1.0.0',
  packaged: true,
  electron: '44.3.0',
  chromium: '142.0.7444.59',
  node: '24.11.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.26300',
  openai: '6.3.0',
  claudeCode: { state: 'found', version: '2.1.302', onPath: true },
  claudeCodeMin: '2.1.266'
};

const CLAUDE: RuntimeStatus = {
  provider: 'claude',
  state: 'ready',
  executablePath: PATH,
  cliVersion: '2.1.302'
};

function status(state: UpdateState, patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    mode: 'auto',
    offReason: null,
    current: '1.0.0',
    state,
    checkedAt: null,
    releaseUrl: `https://github.com/${APP_REPOSITORY}/releases`,
    ...patch
  };
}

function view(patch: Partial<AboutViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AboutView, {
      info: INFO,
      error: null,
      checking: false,
      settings: DEFAULT_SETTINGS,
      runtime: CLAUDE,
      update: status({ phase: 'up-to-date', manual: true }),
      report: {
        text: 'diagnostics text',
        error: null,
        copyState: 'idle',
        copy: () => undefined,
        retry: () => undefined
      },
      onCheck: () => undefined,
      onAutoCheck: () => undefined,
      onUpdateAction: () => undefined,
      onOpenNotices: () => undefined,
      onReveal: () => undefined,
      onClose: () => undefined,
      ...patch
    })
  );
}

describe('About (release.9)', () => {
  it('is a modal named after the app, with the icon, the name, the version and the tagline', () => {
    // React hoists a preload of the icon before the dialog.
    const html = decode(view()).replace(/^<link rel="preload" as="image" href="[^"]*"\/>/, '');
    expect(html).toMatch(
      /^<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="About [^"]+">/
    );
    expect(html).toContain(`aria-label="About ${APP_NAME}"`);
    expect(html).toContain('<div class="modal modal--about" tabindex="-1">');
    expect(html).toMatch(
      /<img class="about__icon" src="[^"]*icon[^"]*\.svg[^"]*" alt="" width="64" height="64"\/>/
    );
    expect(html).toContain(`<h2>${APP_NAME}</h2>`);
    expect(html).toContain('<p class="about__version">Version 1.0.0</p>');
    expect(html).toContain(`<p class="about__tagline">${APP_TAGLINE}</p>`);
  });

  it('has Check for updates with the status line, the automatic toggle and its note, word for word', () => {
    const html = decode(view());
    expect(buttons(html)[0]).toBe('Check for updates');
    expect(html).toContain(
      '<span class="about__status" role="status" data-testid="about-update-line">Up to date</span>'
    );
    expect(html).toMatch(
      /<input id="([^"]+)" type="checkbox" aria-describedby="\1-note" checked=""\/><label for="\1">Check for updates automatically<\/label>/
    );
    expect(html).toContain(`>${AUTO_CHECK_NOTE}</p>`);
    expect(decode(view({ settings: { ...DEFAULT_SETTINGS, checkForUpdates: false } }))).not.toContain(
      'checked=""'
    );
  });

  it("offers the card's button beside the line, and holds Check for updates while a check runs", () => {
    const available = status({ phase: 'available', version: '1.0.1', size: 114_000_000 });
    expect(buttons(view({ update: available })).slice(0, 2)).toEqual(['Check for updates', 'Download']);
    expect(text(view({ update: available }))).toContain(updateStatusLine(available));
    expect(buttons(view({ update: status({ phase: 'downloaded', version: '1.0.1' }) })).slice(0, 2)).toEqual([
      'Check for updates [held]',
      'Restart now'
    ]);
    expect(buttons(view({ update: status({ phase: 'checking', manual: true }) }))[0]).toBe(
      'Check for updates [held]'
    );
    expect(buttons(view({ checking: true }))[0]).toBe('Check for updates [held]');
  });

  it('turns Check for updates off in a development run with no fake, and says why', () => {
    const off = view({ update: status({ phase: 'idle' }, { mode: 'off', offReason: 'development' }) });
    expect(buttons(off)[0]).toBe('Check for updates [disabled]');
    expect(text(off)).toContain('Updates are off in a development run.');
    expect(decode(off)).not.toMatch(/<button[^>]*title=/);
  });

  /* release.9 review: pressed here, Check for updates did nothing, since
     main's check() answers without checking; seen in a window after a failed
     install. It is held, not disabled, so a press that resumes a download
     keeps the focus on it, and its title says why. */
  it('holds Check for updates where main would not check, with a title that says why', () => {
    const check = (update: UpdateStatus): string =>
      /<button type="button"[^>]*>Check for updates<\/button>/.exec(decode(view({ update })))?.[0] ?? '';
    const cases: [UpdateStatus, string, string][] = [
      [
        status({ phase: 'downloading', version: '1.0.1', percent: 40, transferred: 0, total: 1 }),
        `Not while ${APP_NAME} 1.0.1 is downloading.`,
        'Licences and notices'
      ],
      [
        status({ phase: 'downloaded', version: '1.0.1' }),
        `Not while ${APP_NAME} 1.0.1 is ready to install. Restart now installs it.`,
        'Restart now'
      ],
      [
        status({
          phase: 'failed',
          stage: 'install',
          kind: 'failed',
          manual: false,
          version: '1.0.1',
          retry: false
        }),
        `Close ${APP_NAME} and open it again to check for updates.`,
        'Open the release page'
      ]
    ];
    for (const [update, why, second] of cases) {
      const html = view({ update });
      expect(buttons(html)[0], update.state.phase).toBe('Check for updates [held]');
      expect(check(update)).toContain(`title="${why}"`);
      expect(check(update)).not.toContain('disabled=""');
      expect(buttons(html)[1]).toBe(second);
    }
    // While Restart now runs, under the overlay, both are held, and Restart now stays for the focus to come back to.
    const installing = view({ update: status({ phase: 'installing', version: '1.0.1' }) });
    expect(buttons(installing).slice(0, 2)).toEqual(['Check for updates [held]', 'Restart now [held]']);
    expect(check(status({ phase: 'installing', version: '1.0.1' }))).toContain(
      `title="Not while ${APP_NAME} 1.0.1 is installing."`
    );
    // Where main checks, it is live, with no title.
    for (const update of [
      status({ phase: 'available', version: '1.0.1', size: 1 }),
      status({
        phase: 'failed',
        stage: 'install',
        kind: 'failed',
        manual: false,
        version: '1.0.1',
        retry: true
      })
    ]) {
      expect(buttons(view({ update }))[0]).toBe('Check for updates');
      expect(check(update)).not.toContain('title=');
    }
  });

  it("links What's new to the version's release page, and has Licences and notices", () => {
    const html = decode(view());
    expect(html).toContain(
      `<a href="https://github.com/${APP_REPOSITORY}/releases/tag/v1.0.0" target="_blank" rel="noreferrer">What's new</a>`
    );
    expect(buttons(html)).toContain('Licences and notices');
  });

  it('says what the app is and gives the caution for every review', () => {
    const html = decode(view());
    expect(html).toContain(`<p class="about__text">${DISCLAIMER}</p>`);
    expect(html).toContain(`<p class="about__text">${AI_OUTPUT_NOTICE}</p>`);
  });

  it('lists the versions it runs on, with the Claude Code line from the live status', () => {
    const html = decode(view());
    const list = /<ul class="about__components" data-testid="about-components">([\s\S]*?)<\/ul>/.exec(
      html
    )?.[1];
    expect([...(list ?? '').matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1])).toEqual([
      'Electron 44.3.0',
      'Chromium 142.0.7444.59',
      'Node.js 24.11.0',
      'OpenAI library 6.3.0',
      `Claude Code 2.1.302, installed at ${PATH}`
    ]);
    expect(text(view({ runtime: { provider: 'claude', state: 'missing-binary' } }))).toContain(
      'Claude Code: not installed'
    );
  });

  it('has Diagnostics with a plain Copy, Open log folder, Open data folder, and Close as the blue button', () => {
    const html = view();
    expect(text(html)).toContain(DIAGNOSTICS_INTRO);
    expect(buttons(html).slice(-4)).toEqual([
      COPY_DIAGNOSTICS,
      'Open log folder',
      'Open data folder',
      'Close [blue]'
    ]);
    expect(buttons(html).filter((b) => b.includes('[blue]'))).toEqual(['Close [blue]']);
  });

  it("shows main's words when something did nothing", () => {
    expect(decode(view({ error: 'THIRD_PARTY_NOTICES.txt is missing.' }))).toContain(
      '<p class="modal__hint modal__hint--error">THIRD_PARTY_NOTICES.txt is missing.</p>'
    );
  });

  it('as it opens, waits for app:info, with the version from the updater for the link', () => {
    const html = decode(
      renderToStaticMarkup(
        createElement(AboutDialog, {
          settings: DEFAULT_SETTINGS,
          runtime: null,
          update: status({ phase: 'idle' }, { current: '0.1.0' }),
          onApply: () => undefined,
          onCheck: () => Promise.resolve(),
          onUpdateAction: () => undefined,
          onClose: () => undefined
        })
      )
    );
    expect(html).toContain('<p class="about__version">Version …</p>');
    expect(html).toContain(`href="https://github.com/${APP_REPOSITORY}/releases/tag/v0.1.0"`);
    expect(html).toContain('<ul class="about__components" data-testid="about-components"></ul>');
    expect(html).toContain('Collecting…');
  });
});

describe("Restart now's overlay (release.9)", () => {
  it('says the app closes for the installer, takes the focus and has no button', () => {
    const html = decode(
      renderToStaticMarkup(
        createElement(UpdateOverlay, { update: status({ phase: 'installing', version: '1.0.1' }) })
      )
    );
    expect(html).toContain(
      `<div class="modal-backdrop modal-backdrop--overlay" role="alertdialog" aria-modal="true" aria-label="Installing ${APP_NAME} 1.0.1…">`
    );
    expect(html).toContain('tabindex="-1" aria-busy="true"');
    expect(html).toContain(`<h2>Installing ${APP_NAME} 1.0.1…</h2>`);
    expect(text(html)).toContain(
      `${APP_NAME} closes now. The installer shows its progress, then opens ${APP_NAME} again.`
    );
    expect(buttons(html)).toEqual([]);
  });
});

describe('Settings, Setup and Review with AI (release.9)', () => {
  it("has About in Settings' last row, beside Done", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        models: [],
        runtime: null,
        onApply: () => undefined,
        onClose: () => undefined,
        onOpenSetup: () => undefined,
        chatgpt: null,
        chatgptWaiting: false,
        onOpenChatGptSetup: () => undefined,
        onShowWelcome: () => undefined,
        onAbout: () => undefined
      })
    );
    expect(buttons(html).slice(-2)).toEqual(['About', 'Done [blue]']);
  });

  it("ends the Setup screen with the app's name and version, once known", () => {
    const setup = (version: string | null): string =>
      renderToStaticMarkup(
        createElement(SetupScreen, {
          runtime: { provider: 'claude', state: 'missing-binary' },
          lastFailure: null,
          checking: false,
          host: 'windows',
          onCheckAgain: () => undefined,
          onClose: () => undefined,
          version
        })
      );
    expect(setup('1.0.0')).toMatch(
      new RegExp(`<p class="setup__version">${APP_NAME} 1\\.0\\.0</p></div></div>$`)
    );
    expect(setup(null)).not.toContain('setup__version');
  });

  it('gives the AI output notice under Start review', () => {
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
    const html = decode(
      renderToStaticMarkup(
        createElement(ReviewDialog, {
          review,
          settings: DEFAULT_SETTINGS,
          models: {},
          modelsLoading: {},
          runtimes: { claude: CLAUDE },
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
          onStart: () => undefined,
          onClose: () => undefined
        })
      )
    );
    const start = html.lastIndexOf('>Start review</button>');
    const notice = html.indexOf(AI_OUTPUT_NOTICE);
    expect(start).toBeGreaterThan(0);
    expect(notice).toBeGreaterThan(start);
    expect(html).toContain(
      `</div><p class="modal__note modal__ai-notice" data-testid="ai-output-notice">${AI_OUTPUT_NOTICE}</p></div></div>`
    );
  });
});
