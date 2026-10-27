import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import { WelcomePage, WelcomeScreen, type WelcomeNote } from '../../src/renderer/components/WelcomeScreen';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus, EffectivePaths, GuidelinesStatus, RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';
import { FOCUS_HOLD_SECONDS } from '../../src/shared/ui/focusMode';
import {
  APPEARANCE_LABEL,
  APPEARANCE_NOTE,
  FOCUS_HOLD_AFTER,
  FOCUS_HOLD_BEFORE,
  FOCUS_MODE_LABEL,
  FOCUS_MODE_NOTE
} from '../../src/shared/ui/settingsDialog';
import {
  IN_DATA_FOLDER,
  SHOW_WELCOME_AGAIN,
  WELCOME_BACKUPS_NOTE,
  WELCOME_GUIDE_NOTE,
  WELCOME_INTRO,
  WELCOME_REVIEWS_NOTE,
  stepActions,
  welcomeStart,
  welcomeSteps,
  type WelcomeActionId,
  type WelcomeFolderId,
  type WelcomeInput,
  type WelcomeLook
} from '../../src/shared/ui/welcome';

/* setup.11, and setup.18's new order: the welcome guide as the author sees
   it, rendered with react-dom/server: its title and Skip, the four steps
   with where each stands and its buttons, the folder step's two rows, the
   agents step's two sections and, since setup.20, the look step's Appearance
   and Focus mode, and Start; and Settings' Show the welcome guide again. Effects do not run here, so nothing is read or called; which call
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
  backupsFolder: 'C:\\Data\\ai-grammar-checker\\backups', // check-public: allow
  backupsFolderIsDefault: true
};

const SIGNED_OUT: ChatGptStatus = {
  signedIn: false,
  plan: null,
  dataSettingsConfirmed: false,
  signingIn: false,
  registered: false,
  encryptionAvailable: true
};

const FRESH: WelcomeInput = {
  provider: 'claude',
  claude: { provider: 'claude', state: 'missing-binary' },
  claudeLastFailure: null,
  chatgpt: SIGNED_OUT,
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

function page(
  input: WelcomeInput,
  note: WelcomeNote | null = null,
  rowNotes: Partial<Record<WelcomeFolderId, string>> = {},
  lookNote: string | null = null
): string {
  return renderToStaticMarkup(
    createElement(WelcomePage, {
      steps: welcomeSteps(input),
      note,
      rowNotes,
      lookNote,
      onAction: () => undefined,
      onChoose: () => undefined,
      onStart: () => undefined,
      onSkip: () => undefined
    })
  );
}

/* As in setupScreen.render.test.ts: no button may read like a sign-in, but
   ChatGPT's own, Sign in with ChatGPT, in its section (5.6 item 7, setup.18). */
const SIGN_IN_LIKE = /sign[\s-]*in|sign[\s-]*on|log[\s-]*in|log[\s-]*on|authori[sz]e|connect(?!ion)/i;

describe('the welcome guide on a fresh install (setup.11, setup.18)', () => {
  const html = page(FRESH);

  it('has its title with Skip, the intro, and the Setup screen scroller and column', () => {
    expect(html).toMatch(/^<div class="setup welcome"><div class="setup__page"><div class="setup__head">/);
    expect(decode(html)).toContain(`<h1>Welcome to ${APP_NAME}</h1>`);
    expect(text(html)).toContain(WELCOME_INTRO);
    expect(buttons(html)[0]).toBe('Skip');
  });

  it('lists the four steps in order, the last three marked optional, with where each stands', () => {
    const steps = [
      ...decode(html).matchAll(/<li class="welcome__step welcome__step--(\w+)" data-step="([\w-]+)">/g)
    ];
    // The look step is a choice, never undone, so it has its tick from the start (setup.20).
    expect(steps.map((m) => [m[2], m[1]])).toEqual([
      ['folder', 'todo'],
      ['agents', 'todo'],
      ['look', 'done'],
      ['style-sheet', 'todo']
    ]);
    expect([...html.matchAll(/aria-label="(Step \d, [\w ]+)"/g)].map((m) => m[1])).toEqual([
      'Step 1, to do',
      'Step 2, to do',
      'Step 3, done',
      'Step 4, to do'
    ]);
    expect([...decode(html).matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1])).toEqual([
      'Connect your manuscript folder',
      'Connect AI agents<span class="welcome__optional"> (optional)</span>',
      'Choose appearance and focus mode<span class="welcome__optional"> (optional)</span>',
      'Fill in your style sheet<span class="welcome__optional"> (optional)</span>'
    ]);
    expect(
      [...html.matchAll(/<p class="welcome__status" aria-live="polite">([^<]*)<\/p>/g)].map((m) => m[1])
    ).toEqual([
      'No folder chosen yet',
      'Not connected yet',
      'Matching your system. Focus mode off.',
      'Choose a manuscript folder first'
    ]);
  });

  it("gives each step its buttons, the rows' and the sections' in their place, Start disabled until there is a folder", () => {
    expect(buttons(html)).toEqual([
      'Skip',
      'Choose folder [blue]',
      'Change',
      'Change',
      'Set up Claude [blue]',
      'Sign in with ChatGPT [blue]',
      'Open [disabled]',
      'Open folder [disabled]',
      'Start [blue] [disabled]'
    ]);
    expect(text(html)).toContain('Choose a manuscript folder to start, or skip the guide for now.');
  });

  it("lists the folder step's three facts under its lead line", () => {
    const facts = [...decode(html).matchAll(/<ul class="welcome__facts">([\s\S]*?)<\/ul>/g)];
    expect(facts).toHaveLength(1);
    expect([...(facts[0]?.[1] ?? '').matchAll(/<li>/g)]).toHaveLength(3);
  });

  it("has no button labelled like a sign-in but ChatGPT's own, with Claude or ChatGPT chosen", () => {
    for (const input of [FRESH, { ...FRESH, provider: 'chatgpt' as const }, DONE]) {
      const all = buttons(page(input));
      expect(all.length).toBeGreaterThan(4);
      expect(all.filter((label) => SIGN_IN_LIKE.test(label))).toEqual(
        all.filter((label) => label.startsWith('Sign in with ChatGPT'))
      );
    }
  });
});

describe("the folder step's two rows (setup.18)", () => {
  const rows = (html: string): string[] =>
    [
      ...decode(html).matchAll(
        /<div class="welcome__row" data-row="(\w+)">([\s\S]*?)<\/div><\/div>(?=<div class="welcome__row"|<\/div>)/g
      )
    ].map(([, id = '', inner = '']) => `${id}: ${text(inner).trim()}`);

  it('come after Choose folder, each named, marked optional, in the data folder by default, with Change', () => {
    const html = decode(page(FRESH));
    expect(html.indexOf('data-action="choose-folder"')).toBeLessThan(html.indexOf('data-row="reviews"'));
    expect(html.indexOf('data-row="reviews"')).toBeLessThan(html.indexOf('data-row="backups"'));
    expect(html.indexOf('data-row="backups"')).toBeLessThan(html.indexOf('data-step="agents"'));
    expect(rows(page(FRESH))).toEqual([
      `reviews: Reviews folder (optional) ${IN_DATA_FOLDER} ${WELCOME_REVIEWS_NOTE} Change`,
      `backups: Backups folder (optional) ${IN_DATA_FOLDER} ${WELCOME_BACKUPS_NOTE} Change`
    ]);
    expect(html).toContain('<h3>Reviews folder<span class="welcome__optional"> (optional)</span></h3>');
  });

  it('give the folder in use as the tooltip of where it is, once read', () => {
    const html = decode(page(DONE));
    expect(html).toContain(
      `<p class="welcome__row-value" title="${PATHS.reviewsFolder}">${IN_DATA_FOLDER}</p>`
    );
    expect(html).toContain(
      `<p class="welcome__row-value" title="${PATHS.backupsFolder}">${IN_DATA_FOLDER}</p>`
    );
    expect(decode(page(FRESH))).toContain(`<p class="welcome__row-value">${IN_DATA_FOLDER}</p>`);
  });

  it("show main's refusal under the row whose Change it refused, as an alert, and under no other", () => {
    const refusal = `The backups folder cannot be the manuscript folder, ${FOLDER}, or a folder inside it.`;
    const html = decode(page(DONE, null, { backups: refusal }));
    const backups = html.slice(html.indexOf('data-row="backups"'), html.indexOf('data-step="agents"'));
    expect(backups).toContain(`<p class="welcome__note welcome__note--error" role="alert">${refusal}</p>`);
    expect(html.match(/welcome__note--error/g)).toHaveLength(1);
    expect(decode(page(DONE))).not.toContain('welcome__note');
  });
});

describe("the agents step's two sections (setup.18)", () => {
  const sections = (html: string): Array<[string, string, string]> =>
    [
      ...decode(html).matchAll(
        /<section class="welcome__section welcome__section--(\w+)" data-section="(\w+)" aria-label="(\w+)"><h3>\3<\/h3><p class="welcome__section-status" aria-live="polite">([^<]*)<\/p>/g
      )
    ].map(([, done = '', id = '', , status = '']) => [id, done, status]);

  it('are Claude, then ChatGPT, each named, with where it stands, read out as it changes', () => {
    expect(sections(page(FRESH))).toEqual([
      ['claude', 'todo', 'Claude Code is not installed'],
      ['chatgpt', 'todo', 'Not signed in to ChatGPT']
    ]);
    expect(sections(page({ ...FRESH, chatgpt: { ...SIGNED_OUT, signedIn: true, plan: 'Plus' } }))).toEqual([
      ['claude', 'todo', 'Claude Code is not installed'],
      ['chatgpt', 'done', 'Signed in to ChatGPT']
    ]);
    expect(sections(page(DONE))[0]).toEqual(['claude', 'done', 'Claude is ready']);
  });

  it("tick the step for either agent, and leave the other's button plain", () => {
    const html = page({ ...FRESH, chatgpt: { ...SIGNED_OUT, signedIn: true }, manuscriptFolder: FOLDER });
    expect(decode(html)).toContain('<li class="welcome__step welcome__step--done" data-step="agents">');
    expect(buttons(html).filter((b) => b.includes('[blue]'))).toEqual(['Start [blue]']);
    expect(buttons(html)).toContain('Set up Claude');
    expect(buttons(html)).toContain('Set up ChatGPT');
  });
});

describe('the welcome guide with every step done', () => {
  const html = page(DONE);

  it('ticks each step, leaves no blue button but Start, and says nothing beside it', () => {
    expect([...html.matchAll(/aria-label="(Step \d, [\w ]+)"/g)].map((m) => m[1])).toEqual([
      'Step 1, done',
      'Step 2, done',
      'Step 3, done',
      'Step 4, done'
    ]);
    expect([...html.matchAll(/welcome__step--done/g)]).toHaveLength(4);
    expect(buttons(html).filter((b) => b.includes('[blue]'))).toEqual(['Start [blue]']);
    expect(html).not.toContain('welcome__start-note');
  });
});

describe('the style sheet note', () => {
  it("shows what the last of the style sheet's buttons did under that step only, an error as an alert", () => {
    const info = decode(page(DONE, { tone: 'info', text: `Opened ${GUIDELINES}.` }));
    expect(info).toContain(
      `<p class="welcome__note welcome__note--info" role="status">Opened ${GUIDELINES}.</p></div></li></ol>`
    );
    const error = decode(
      page(DONE, { tone: 'error', text: 'No app is set to open .md files on this computer.' })
    );
    expect(error).toContain(
      '<p class="welcome__note welcome__note--error" role="alert">No app is set to open .md files on this computer.</p>'
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
    // The rows' and sections' buttons are drawn by a component of the page's own.
    if (typeof el.type === 'function') {
      return buttonElements((el.type as (props: unknown) => ReactNode)(el.props));
    }
    return [...(el.type === 'button' ? [el] : []), ...buttonElements(el.props.children)];
  }

  function press(input: WelcomeInput): string[] {
    const calls: string[] = [];
    const element = WelcomePage({
      steps: welcomeSteps(input),
      onAction: (id: WelcomeActionId) => calls.push(id),
      onChoose: () => calls.push('choose'),
      onStart: () => calls.push('start'),
      onSkip: () => calls.push('skip')
    });
    for (const button of buttonElements(element)) {
      if (!button.props.disabled) button.props.onClick?.();
    }
    return calls;
  }

  it('hands each step, row and section its own action, Skip and Start their own, and nothing for a disabled button', () => {
    expect(press(FRESH)).toEqual([
      'skip',
      'choose-folder',
      'change-reviews-folder',
      'change-backups-folder',
      'set-up-claude',
      'sign-in-chatgpt'
    ]);
    expect(press(DONE)).toEqual([
      'skip',
      'choose-folder',
      'change-reviews-folder',
      'change-backups-folder',
      'set-up-claude',
      'sign-in-chatgpt',
      'open-guidelines',
      'open-guidelines-folder',
      'start'
    ]);
    expect(press({ ...DONE, chatgpt: { ...SIGNED_OUT, signedIn: true } })).toContain('set-up-chatgpt');
    // Held until the sign-in has been read.
    expect(press({ ...FRESH, chatgpt: null })).not.toContain('sign-in-chatgpt');
  });

  it('has Start disabled exactly when welcomeStart says', () => {
    for (const input of [FRESH, DONE]) {
      expect(press(input).includes('start')).toBe(!welcomeStart(welcomeSteps(input)).disabled);
    }
  });

  it('marks each button with its action, which the focus finds when Setup goes back to the guide (setup.19)', () => {
    for (const input of [FRESH, DONE, { ...DONE, provider: 'chatgpt' as const }]) {
      const marked = [
        ...renderToStaticMarkup(
          createElement(WelcomePage, {
            steps: welcomeSteps(input),
            onAction: () => undefined,
            onChoose: () => undefined,
            onStart: () => undefined,
            onSkip: () => undefined
          })
        ).matchAll(/<button type="button" data-action="([\w-]+)"/g)
      ].map((m) => m[1]);
      expect(marked).toEqual(
        welcomeSteps(input).flatMap((step) => stepActions(step).map((action) => action.id))
      );
    }
  });
});

describe("the look step's two rows (setup.20)", () => {
  const LOOK: WelcomeLook = { theme: 'dark', focusMode: true, focusHoldSeconds: 30 };
  const step3 = (html: string): string => {
    const all = decode(html);
    return all.slice(all.indexOf('data-step="look"'), all.indexOf('data-step="style-sheet"'));
  };
  const selected = (html: string, id: string): string[] => {
    const list = html.slice(
      html.indexOf(`<select id="${id}"`),
      html.indexOf('</select>', html.indexOf(`<select id="${id}"`))
    );
    return [...list.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map(
      ([, value = '', on, label = '']) => `${value}=${label}${on ? ' [selected]' : ''}`
    );
  };

  it('come in the look step, between the agents step and the style sheet, Appearance first', () => {
    const html = decode(page(FRESH));
    expect(html.indexOf('data-step="agents"')).toBeLessThan(html.indexOf('data-step="look"'));
    expect(html.indexOf('data-step="look"')).toBeLessThan(html.indexOf('data-choice="appearance"'));
    expect(html.indexOf('data-choice="appearance"')).toBeLessThan(html.indexOf('data-choice="focus-mode"'));
    expect(html.indexOf('data-choice="focus-mode"')).toBeLessThan(html.indexOf('data-step="style-sheet"'));
    // Nowhere else.
    expect(html.match(/data-choice=/g)).toHaveLength(2);
  });

  it("draw Appearance in Settings' words, its list showing the theme chosen, the note describing it", () => {
    const html = step3(page({ ...FRESH, look: LOOK }));
    expect(html).toContain(
      `<h3><label for="welcome-look-appearance">${APPEARANCE_LABEL}</label></h3><select id="welcome-look-appearance" aria-describedby="welcome-look-appearance-note">`
    );
    expect(selected(html, 'welcome-look-appearance')).toEqual([
      'system=Match system',
      'light=Light',
      'dark=Dark [selected]'
    ]);
    expect(html).toContain(
      `<p class="welcome__choice-note" id="welcome-look-appearance-note">${APPEARANCE_NOTE}</p>`
    );
    expect(selected(step3(page(FRESH)), 'welcome-look-appearance')[0]).toBe('system=Match system [selected]');
  });

  it("draw Focus mode in Settings' words: the box, the hold time's list beside it, the note under both", () => {
    const html = step3(page({ ...FRESH, look: LOOK }));
    expect(html).toContain(
      `<h3><label for="welcome-look-focus">${FOCUS_MODE_LABEL}</label></h3><span class="welcome__focus"><input id="welcome-look-focus" type="checkbox" aria-describedby="welcome-look-focus-note" checked=""/><label for="welcome-look-focus-hold">${FOCUS_HOLD_BEFORE}</label><select id="welcome-look-focus-hold" aria-describedby="welcome-look-focus-note">`
    );
    expect(selected(html, 'welcome-look-focus-hold')).toEqual(
      FOCUS_HOLD_SECONDS.map((n) => `${n}=${n} seconds${n === 30 ? ' [selected]' : ''}`)
    );
    expect(html).toContain(`</select><span>${FOCUS_HOLD_AFTER}</span></span>`);
    expect(html).toContain(
      `<p class="welcome__choice-note" id="welcome-look-focus-note">${FOCUS_MODE_NOTE}</p>`
    );
    // A fresh install's: the box empty, 5 seconds chosen (focus.3).
    const fresh = step3(page(FRESH));
    expect(fresh).toContain(
      '<input id="welcome-look-focus" type="checkbox" aria-describedby="welcome-look-focus-note"/>'
    );
    expect(selected(fresh, 'welcome-look-focus-hold')[0]).toBe('5=5 seconds [selected]');
    expect(text(fresh)).toContain(`${FOCUS_MODE_LABEL} ${FOCUS_HOLD_BEFORE} 5 seconds 10 seconds`);
  });

  it('give every control a label and a description that are there, and an id no other element has', () => {
    const html = decode(page({ ...FRESH, look: LOOK }));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, target] of html.matchAll(/<label for="([^"]+)">/g)) expect(ids).toContain(target);
    for (const [, described] of html.matchAll(/aria-describedby="([^"]+)"/g))
      expect(ids).toContain(described);
    // Settings, which can open over the guide, takes its ids from useId, never these.
    expect(ids.filter((id) => id?.startsWith('welcome-look-'))).toHaveLength(5);
  });

  it("show main's refusal of a change under the step's rows, as an alert, and under no other step", () => {
    const refusal = 'Lapidary could not save its settings: the disk is full.';
    const html = decode(page(FRESH, null, {}, refusal));
    expect(step3(html)).toContain(
      `</div></div><p class="welcome__note welcome__note--error" role="alert">${refusal}</p></div></li>`
    );
    expect(html.match(/welcome__note--error/g)).toHaveLength(1);
    expect(decode(page(FRESH))).not.toContain('welcome__note');
  });

  it('hand each change to onChoose as the one setting it writes, as Settings writes it', () => {
    type Control = ReactElement<{
      id?: string;
      children?: ReactNode;
      onChange?: (event: { target: { value?: string; checked?: boolean } }) => void;
    }>;
    const controls = (node: ReactNode): Control[] => {
      if (Array.isArray(node)) return node.flatMap(controls);
      if (!isValidElement(node)) return [];
      const el = node as Control;
      if (typeof el.type === 'function')
        return controls((el.type as (props: unknown) => ReactNode)(el.props));
      return [...(el.type === 'select' || el.type === 'input' ? [el] : []), ...controls(el.props.children)];
    };
    const patches: Array<Partial<WelcomeLook>> = [];
    const found = controls(
      WelcomePage({
        steps: welcomeSteps(FRESH),
        onAction: () => undefined,
        onChoose: (patch) => patches.push(patch),
        onStart: () => undefined,
        onSkip: () => undefined
      })
    );
    const by = (id: string): Control => {
      const el = found.find((c) => c.props.id === id);
      if (!el) throw new Error(`no ${id}`);
      return el;
    };
    expect(found.map((c) => c.props.id)).toEqual([
      'welcome-look-appearance',
      'welcome-look-focus',
      'welcome-look-focus-hold'
    ]);
    by('welcome-look-appearance').props.onChange?.({ target: { value: 'dark' } });
    by('welcome-look-appearance').props.onChange?.({ target: { value: 'light' } });
    by('welcome-look-appearance').props.onChange?.({ target: { value: 'sepia' } });
    by('welcome-look-focus').props.onChange?.({ target: { checked: true } });
    by('welcome-look-focus').props.onChange?.({ target: { checked: false } });
    by('welcome-look-focus-hold').props.onChange?.({ target: { value: '10' } });
    by('welcome-look-focus-hold').props.onChange?.({ target: { value: '45' } });
    expect(patches).toEqual([
      { theme: 'dark' },
      { theme: 'light' },
      // Anything else as the normalisers make it, as Settings' controls do.
      { theme: 'system' },
      { focusMode: true },
      { focusMode: false },
      { focusHoldSeconds: 10 },
      { focusHoldSeconds: 5 }
    ]);
  });
});

describe('the screen before its reads are in', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const render = (patch: Partial<Settings>, chatgpt: ChatGptStatus | null = null): string =>
    renderToStaticMarkup(
      createElement(WelcomeScreen, {
        settings: { ...settings, ...patch },
        claude: null,
        claudeLastFailure: null,
        chatgpt,
        onSetUpClaude: () => undefined,
        onUseProvider: () => undefined,
        onChooseFolder: () => undefined,
        onStart: () => undefined,
        onSkip: () => undefined
      })
    );

  it('follows the settings and the first checks, and has not read the guidelines file yet', () => {
    const fresh = text(render({}));
    expect(fresh).toContain('Checking Claude Code…');
    expect(fresh).toContain('Reading the ChatGPT sign-in…');
    expect(fresh).toContain('No folder chosen yet');
    expect(fresh).toContain('Choose a manuscript folder first');
    const chosen = text(render({ manuscriptFolder: FOLDER, provider: 'chatgpt' }, SIGNED_OUT));
    expect(chosen).toContain('Not signed in to ChatGPT');
    expect(chosen).toContain(FOLDER);
    // The path comes from settings:effective, which an effect reads.
    expect(chosen).toContain('Not checked yet');
    expect(chosen).not.toContain('Choose a manuscript folder first');
  });

  it('shows the look the settings hold in step 3, its line and its controls (setup.20)', () => {
    const html = decode(render({ theme: 'light', focusMode: true, focusHoldSeconds: 15 }));
    expect(text(html)).toContain('Always light. Focus mode on, with a 15-second hold.');
    expect(html).toContain('<option value="light" selected="">Light</option>');
    expect(html).toContain('checked=""');
    expect(html).toContain('<option value="15" selected="">15 seconds</option>');
    expect(text(render({}))).toContain('Matching your system. Focus mode off.');
  });

  it('shows a reviews or backups folder chosen in Settings by its path, before settings:effective is in', () => {
    const reviews = 'D:\\Reviews'; // check-public: allow
    const backups = 'E:\\Backups'; // check-public: allow
    const html = decode(render({ reviewsFolder: reviews, backupsFolder: backups }));
    expect(html).toContain(`<p class="welcome__row-value" title="${reviews}">${reviews}</p>`);
    expect(html).toContain(`<p class="welcome__row-value" title="${backups}">${backups}</p>`);
  });
});

describe("Settings' Show the welcome guide again", () => {
  // At the foot beside About since polish.4; its note is its tooltip, and so its description.
  it('is at the foot, before About and Done, with its note as its tooltip', () => {
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
    expect(decode(html)).toContain(
      `<div class="modal__actions settings__foot"><button type="button" title="${WELCOME_GUIDE_NOTE}">${SHOW_WELCOME_AGAIN}</button>`
    );
    expect(WELCOME_GUIDE_NOTE).toBe(
      'The first-start steps: manuscript folder, AI agents, appearance and style sheet.'
    );
    expect(decode(html)).not.toContain('<span>Welcome guide</span>');
    // About (release.9) sits at the foot, beside Done.
    expect(buttons(html).slice(-3)).toEqual([SHOW_WELCOME_AGAIN, 'About', 'Done [blue]']);
  });
});
