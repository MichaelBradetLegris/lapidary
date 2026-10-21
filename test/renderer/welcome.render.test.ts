import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import { WelcomePage, WelcomeScreen, type WelcomeNote } from '../../src/renderer/components/WelcomeScreen';
import { APP_NAME } from '../../src/shared/branding';
import type { EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';
import {
  SHOW_WELCOME_AGAIN,
  WELCOME_GUIDE_NOTE,
  WELCOME_INTRO,
  welcomeStart,
  welcomeSteps,
  type WelcomeActionId,
  type WelcomeInput
} from '../../src/shared/ui/welcome';

/* setup.11: the welcome guide as the author sees it, rendered with
   react-dom/server: its title and Skip, the three steps with where each
   stands and its buttons, and Start; and Settings' Show the welcome guide
   again. Effects do not run here, so nothing is read or called; which call
   each button makes is checked by calling the buttons' own click handlers,
   and App's wiring from its source in welcomeEntry.test.ts. This file is
   type-checked with the renderer's project (tsconfig.web.json). */

const FOLDER = 'C:\\Novel'; // check-public: allow
const GUIDELINES = 'C:\\Novel\\GUIDELINES.md'; // check-public: allow

const PATHS: EffectivePaths = {
  manuscriptFolder: FOLDER,
  reviewsFolder: 'C:\\Data\\ai-grammar-checker\\reviews', // check-public: allow
  reviewsFolderIsDefault: true,
  guidelinesPath: GUIDELINES,
  backupsFolder: 'C:\\Data\\ai-grammar-checker\\backups' // check-public: allow
};

const FRESH: WelcomeInput = {
  provider: 'claude',
  claude: { provider: 'claude', state: 'missing-binary' },
  claudeLastFailure: null,
  openai: null,
  manuscriptFolder: null,
  guidelinesSetting: null,
  paths: null,
  guidelines: null
};

const filled: GuidelinesStatus = { path: GUIDELINES, exists: true, styleSheet: 'filled' };
const ready: RuntimeStatus = { provider: 'claude', state: 'ready', credential: 'subscription' };
const DONE: WelcomeInput = {
  ...FRESH,
  claude: ready,
  manuscriptFolder: FOLDER,
  paths: PATHS,
  guidelines: filled
};

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

/** Each button as `label [blue] [disabled]`, in order. */
function buttons(html: string): string[] {
  return [...decode(html).matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([, attrs = '', label = '']) => {
      const blue = /class="primary"/.test(attrs) ? ' [blue]' : '';
      return `${text(label).trim()}${blue}${/ disabled=""/.test(attrs) ? ' [disabled]' : ''}`;
    }
  );
}

function page(input: WelcomeInput, note: WelcomeNote | null = null): string {
  return renderToStaticMarkup(
    createElement(WelcomePage, {
      steps: welcomeSteps(input),
      note,
      onAction: () => undefined,
      onStart: () => undefined,
      onSkip: () => undefined
    })
  );
}

/* As in setupScreen.render.test.ts: no button may read like a sign-in. */
const SIGN_IN_LIKE = /sign[\s-]*in|sign[\s-]*on|log[\s-]*in|log[\s-]*on|authori[sz]e|connect(?!ion)/i;

describe('the welcome guide on a fresh install (setup.11)', () => {
  const html = page(FRESH);

  it('has its title with Skip, the intro, and the Setup screen scroller and column', () => {
    expect(html).toMatch(/^<div class="setup welcome"><div class="setup__page"><div class="setup__head">/);
    expect(decode(html)).toContain(`<h1>Welcome to ${APP_NAME}</h1>`);
    expect(text(html)).toContain(WELCOME_INTRO);
    expect(buttons(html)[0]).toBe('Skip');
  });

  it('lists the three steps in order, numbered and to do, with where each stands', () => {
    const steps = [
      ...decode(html).matchAll(/<li class="welcome__step welcome__step--(\w+)" data-step="([\w-]+)">/g)
    ];
    expect(steps.map((m) => [m[2], m[1]])).toEqual([
      ['claude', 'todo'],
      ['folder', 'todo'],
      ['style-sheet', 'todo']
    ]);
    expect([...html.matchAll(/aria-label="(Step \d, [\w ]+)"/g)].map((m) => m[1])).toEqual([
      'Step 1, to do',
      'Step 2, to do',
      'Step 3, to do'
    ]);
    expect(
      [...html.matchAll(/<p class="welcome__status" aria-live="polite">([^<]*)<\/p>/g)].map((m) => m[1])
    ).toEqual(['Claude Code is not installed', 'No folder chosen yet', 'Choose a manuscript folder first']);
  });

  it("gives each step its buttons, Start disabled until there is a folder, and Start's note", () => {
    expect(buttons(html)).toEqual([
      'Skip',
      'Set up Claude [blue]',
      'Use OpenAI instead (experimental, pay per use)',
      'Choose folder [blue]',
      'Open in Obsidian [disabled]',
      'Open with default app [disabled]',
      'Show in folder [disabled]',
      'Start [blue] [disabled]'
    ]);
    expect(text(html)).toContain('Choose a manuscript folder to start, or skip the guide for now.');
  });

  it("lists the folder step's four facts under its lead line", () => {
    const facts = [...decode(html).matchAll(/<ul class="welcome__facts">([\s\S]*?)<\/ul>/g)];
    expect(facts).toHaveLength(1);
    expect([...(facts[0]?.[1] ?? '').matchAll(/<li>/g)]).toHaveLength(4);
  });

  it('has no button labelled like a sign-in, with Claude or OpenAI chosen', () => {
    for (const input of [FRESH, { ...FRESH, provider: 'openai' as const }, DONE]) {
      const all = buttons(page(input));
      expect(all.length).toBeGreaterThan(4);
      expect(all.filter((label) => SIGN_IN_LIKE.test(label))).toEqual([]);
    }
  });
});

describe('the welcome guide with every step done', () => {
  const html = page(DONE);

  it('ticks each step, leaves no blue button but Start, and says nothing beside it', () => {
    expect([...html.matchAll(/aria-label="(Step \d, [\w ]+)"/g)].map((m) => m[1])).toEqual([
      'Step 1, done',
      'Step 2, done',
      'Step 3, done'
    ]);
    expect([...html.matchAll(/welcome__step--done/g)]).toHaveLength(3);
    expect(buttons(html).filter((b) => b.includes('[blue]'))).toEqual(['Start [blue]']);
    expect(html).not.toContain('welcome__start-note');
  });
});

describe('the style sheet note', () => {
  it("shows what the last of the style sheet's buttons did under that step only, an error as an alert", () => {
    const info = decode(page(DONE, { tone: 'info', text: `Asked Obsidian to open ${GUIDELINES}.` }));
    expect(info).toContain(
      `<p class="welcome__note welcome__note--info" role="status">Asked Obsidian to open ${GUIDELINES}.</p></div></li></ol>`
    );
    const error = decode(page(DONE, { tone: 'error', text: 'Obsidian could not be started.' }));
    expect(error).toContain(
      '<p class="welcome__note welcome__note--error" role="alert">Obsidian could not be started.</p>'
    );
    expect(page(DONE)).not.toContain('welcome__note');
  });
});

describe('which call each button makes', () => {
  /** Every button element WelcomePage returns, from its own output, without a DOM. */
  function buttonElements(node: ReactNode): ReactElement<{ onClick?: () => void; disabled?: boolean }>[] {
    if (Array.isArray(node)) return node.flatMap(buttonElements);
    if (!isValidElement(node)) return [];
    const el = node as ReactElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>;
    return [...(el.type === 'button' ? [el] : []), ...buttonElements(el.props.children)];
  }

  function press(input: WelcomeInput): string[] {
    const calls: string[] = [];
    const element = WelcomePage({
      steps: welcomeSteps(input),
      onAction: (id: WelcomeActionId) => calls.push(id),
      onStart: () => calls.push('start'),
      onSkip: () => calls.push('skip')
    });
    for (const button of buttonElements(element)) {
      if (!button.props.disabled) button.props.onClick?.();
    }
    return calls;
  }

  it('hands each step its own action, Skip and Start their own, and nothing for a disabled button', () => {
    expect(press(FRESH)).toEqual(['skip', 'set-up-claude', 'use-openai', 'choose-folder']);
    expect(press(DONE)).toEqual([
      'skip',
      'set-up-claude',
      'use-openai',
      'choose-folder',
      'open-obsidian',
      'open-default',
      'show-in-folder',
      'start'
    ]);
    expect(press({ ...DONE, provider: 'openai' })).toContain('use-claude');
    expect(press({ ...DONE, provider: 'openai' })).toContain('open-settings');
  });

  it('has Start disabled exactly when welcomeStart says', () => {
    for (const input of [FRESH, DONE]) {
      expect(press(input).includes('start')).toBe(!welcomeStart(welcomeSteps(input)).disabled);
    }
  });
});

describe('the screen before its reads are in', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const render = (patch: Partial<Settings>): string =>
    renderToStaticMarkup(
      createElement(WelcomeScreen, {
        settings: { ...settings, ...patch },
        claude: null,
        claudeLastFailure: null,
        openai: null,
        onSetUpClaude: () => undefined,
        onUseProvider: () => undefined,
        onOpenSettings: () => undefined,
        onChooseFolder: () => undefined,
        onStart: () => undefined,
        onSkip: () => undefined
      })
    );

  it('follows the settings and the first check, and has not read the guidelines file yet', () => {
    const fresh = text(render({}));
    expect(fresh).toContain('Checking Claude Code…');
    expect(fresh).toContain('No folder chosen yet');
    expect(fresh).toContain('Choose a manuscript folder first');
    const chosen = text(render({ manuscriptFolder: FOLDER, provider: 'openai' }));
    expect(chosen).toContain('Checking OpenAI…');
    expect(chosen).toContain(FOLDER);
    // The path comes from settings:effective, which an effect reads.
    expect(chosen).toContain('Not checked yet');
    expect(chosen).not.toContain('Choose a manuscript folder first');
  });
});

describe("Settings' Show the welcome guide again", () => {
  it('is a row of its own near the foot, with its note', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsDialog, {
        settings: DEFAULT_SETTINGS,
        models: [],
        runtime: null,
        keyStatus: null,
        onApply: () => undefined,
        onKeyChanged: () => undefined,
        onClose: () => undefined,
        onOpenSetup: () => undefined,
        onShowWelcome: () => undefined,
        onAbout: () => undefined
      })
    );
    expect(decode(html)).toContain(
      `<div class="modal__row"><span>Welcome guide</span><span></span><span class="modal__buttons"><button type="button">${SHOW_WELCOME_AGAIN}</button></span></div><p class="modal__note">${WELCOME_GUIDE_NOTE}</p>`
    );
    // About (release.9) sits at the foot, beside Done.
    expect(buttons(html).slice(-3)).toEqual([SHOW_WELCOME_AGAIN, 'About', 'Done [blue]']);
  });
});
