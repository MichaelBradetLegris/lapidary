import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { ChatGptStatus, RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';
import {
  APPEARANCE_NOTE,
  BACKUPS_TIP,
  CHATGPT_ACCOUNT_TIP,
  CLAUDE_ACCOUNT_TIP,
  EFFORT_TIP,
  FOCUS_HOLD_BEFORE,
  FOCUS_MODE_NOTE,
  FOCUS_MODE_TIP,
  GUIDELINES_TIP,
  MANUSCRIPT_TIP,
  MODEL_TIP,
  REVIEWS_FOLDER_TIP,
  SETTINGS_NOTE_MAX,
  SETTINGS_SECTIONS,
  backupsFolderNote,
  helpButtonLabel,
  reviewsFolderNote
} from '../../src/shared/ui/settingsDialog';
import { SHOW_WELCOME_AGAIN } from '../../src/shared/ui/welcome';

/* polish.4: the Settings dialog, rendered with react-dom/server. Its
   sections and rows in order, the (?) of a row with its tooltip, in a last
   cell at the row's right end since polish.15, the one
   short note under a row, and a name and a description for every control,
   which a screen reader gives. Effects do not run here, so the effective
   paths (settings:effective) are not read: the paths show as they do until
   main answers, and the window check in PLAN covers them read. The words
   themselves are tested in test/shared/settingsDialog.test.ts. This file is
   type-checked with the renderer's project (tsconfig.web.json). The OpenAI
   API key's two rows, its field and its link went with that provider
   (codex.6). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, '')).trim();

const READY: RuntimeStatus = {
  provider: 'claude',
  state: 'ready',
  credential: 'subscription',
  email: 'ann@example.com',
  subscriptionType: 'Claude Max'
};

function render(
  options: {
    settings?: Partial<Settings>;
    runtime?: RuntimeStatus | null;
    chatgpt?: ChatGptStatus | null;
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(SettingsDialog, {
      settings: { ...DEFAULT_SETTINGS, manuscriptFolder: 'C:\\Novel', ...options.settings }, // check-public: allow
      models: [
        { value: 'default', label: 'Default (recommended)', isDefault: true },
        { value: 'sonnet', label: 'Sonnet' }
      ],
      runtime: options.runtime ?? null,
      onApply: () => undefined,
      onClose: () => undefined,
      onOpenSetup: () => undefined,
      chatgpt: options.chatgpt ?? null,
      chatgptWaiting: false,
      onOpenChatGptSetup: () => undefined,
      onShowWelcome: () => undefined,
      onAbout: () => undefined
    })
  );
}

/** Every element's id and its text, from the raw markup. */
function idTexts(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"[^>]*>/g)) {
    const [whole, tag = '', id = ''] = match;
    const start = (match.index ?? 0) + whole.length;
    const end = html.indexOf(`</${tag}>`, start);
    out.set(decode(id), text(html.slice(start, end)));
  }
  return out;
}

/** A row's cells, the markup of each of its top-level elements in order. */
function cells(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (const match of inner.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>/g)) {
    const [whole, closing, tag = '', selfClosing] = match;
    const at = match.index ?? 0;
    if (closing) {
      depth -= 1;
      if (depth === 0) out.push(inner.slice(start, at + whole.length));
    } else if (selfClosing || tag === 'input') {
      if (depth === 0) out.push(whole);
    } else {
      if (depth === 0) start = at;
      depth += 1;
    }
  }
  return out;
}

interface Control {
  tag: string;
  attrs: string;
  name: string;
  description: string;
}

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * Each button, select, field and link as an accessibility tree would name and
 * describe it: the name from aria-label, its own text or its <label for>; the
 * description from aria-describedby's elements or else its title.
 */
function controls(html: string): Control[] {
  const ids = idTexts(html);
  const labels = new Map(
    [...html.matchAll(/<label for="([^"]+)">([\s\S]*?)<\/label>/g)].map(([, f = '', t = '']) => [
      decode(f),
      text(t)
    ])
  );
  const out: Control[] = [];
  for (const match of html.matchAll(/<(button|select|input|a)(\s[^>]*)?>/g)) {
    const [whole, tag = '', attrs = ''] = match;
    const start = (match.index ?? 0) + whole.length;
    const own = tag === 'input' ? '' : text(html.slice(start, html.indexOf(`</${tag}>`, start)));
    const id = attr(attrs, 'id');
    const name =
      decode(attr(attrs, 'aria-label') ?? '') ||
      (tag === 'select' ? '' : own) ||
      (id ? (labels.get(decode(id)) ?? '') : '');
    const describedBy = attr(attrs, 'aria-describedby');
    const description = describedBy
      ? decode(describedBy)
          .split(' ')
          .map((ref) => ids.get(ref) ?? `<missing ${ref}>`)
          .join(' ')
      : decode(attr(attrs, 'title') ?? '');
    out.push({ tag, attrs, name, description });
  }
  return out;
}

describe('the sections and rows (polish.4)', () => {
  /* polish.22: App, the settings of the app itself, went above Review, taking
     Appearance, which was Review's third row. */
  it('has App, Review, Folders and Accounts in order, each a section named by its heading', () => {
    const html = render();
    const headings = [...html.matchAll(/<h3 id="([^"]+)">([^<]+)<\/h3>/g)];
    expect(headings.map((h) => h[2])).toEqual([...SETTINGS_SECTIONS]);
    expect(headings.map((h) => h[2])).toEqual(['App', 'Review', 'Folders', 'Accounts']);
    for (const [, id = ''] of headings) {
      expect(html).toContain(`<section class="settings__section" aria-labelledby="${id}"><h3 id="${id}">`);
    }
  });

  it('holds Appearance and Focus mode with their notes in App, and Claude model and Effort alone in Review', () => {
    const html = decode(render());
    const sections = new Map(
      [...html.matchAll(/<section [^>]*><h3 [^>]*>([^<]+)<\/h3>([\s\S]*?)<\/section>/g)].map(
        ([, heading = '', inner = '']) => [heading, inner]
      )
    );
    const names = (heading: string): string[] =>
      [
        ...(sections.get(heading) ?? '').matchAll(/<div class="modal__row"><(?:label|span)[^>]*>([^<]*)</g)
      ].map(([, name = '']) => name);
    expect(names('App')).toEqual(['Appearance', 'Focus mode']);
    expect(sections.get('App')).toContain(`<p class="modal__note"`);
    expect(sections.get('App')).toContain(`>${APPEARANCE_NOTE}</p>`);
    // focus.1: the box and the hold time, with the note on what it does to Alt+Tab.
    expect(sections.get('App')).toContain(`>${FOCUS_MODE_NOTE}</p>`);
    expect(names('Review')).toEqual(['Claude model', 'Effort']);
    expect(sections.get('Review')).not.toContain('modal__note');
    expect(names('Folders')).toEqual(['Manuscript folder', 'Reviews folder', 'Backups', 'Guidelines file']);
    expect(names('Accounts')).toEqual(['Claude account', 'ChatGPT account']);
  });

  /* focus.1: the box, off by default, and the hold time beside it; 5 seconds by default since focus.3
     (10 from focus.2, 30 before). focus.4: the box is a switch, the checkbox with the switch role and
     app.css's .switch, so it keeps its label, its keys and its state. */
  it('shows focus mode as the settings have it: the switch, and the hold time beside it', () => {
    const off = decode(render());
    expect(off).toMatch(
      /<input id="[^"]+" type="checkbox" role="switch" class="switch" aria-describedby="[^"]+"\/>/
    );
    expect(off).toContain('<option value="5" selected="">5 seconds</option>');
    expect(off).toContain('<option value="10">10 seconds</option>');
    expect(off).toContain('<option value="30">30 seconds</option>');
    const on = decode(render({ settings: { focusMode: true, focusHoldSeconds: 60 } }));
    expect(on).toMatch(
      /<input id="[^"]+" type="checkbox" role="switch" class="switch" aria-describedby="[^"]+" checked=""\/>/
    );
    expect(on).toContain('<option value="60" selected="">60 seconds</option>');
    expect(on).toContain('<option value="15">15 seconds</option>');
    expect(on).toContain('<option value="10">10 seconds</option>');
    expect(on).toContain('<option value="5">5 seconds</option>');
  });

  /* focus.2: five hold times, shortest first, in one list, the row's words either side; a time kept from focus.1 shows as chosen.
     focus.3: 5 the default, and 10, focus.2's, shown as chosen when the settings hold it. */
  it('offers 5, 10, 15, 30 and 60 seconds, shortest first, and shows the time the settings hold', () => {
    const options = (html: string): string[] =>
      [...html.matchAll(/<option value="(\d+)"( selected="")?>([^<]*)<\/option>/g)]
        .filter(([, value]) => ['5', '10', '15', '30', '60'].includes(value ?? ''))
        .map(([, value, selected, label]) => `${value ?? ''}${selected ? '*' : ''} ${label ?? ''}`);
    expect(options(decode(render()))).toEqual([
      '5* 5 seconds',
      '10 10 seconds',
      '15 15 seconds',
      '30 30 seconds',
      '60 60 seconds'
    ]);
    expect(options(decode(render({ settings: { focusHoldSeconds: 10 } })))).toEqual([
      '5 5 seconds',
      '10* 10 seconds',
      '15 15 seconds',
      '30 30 seconds',
      '60 60 seconds'
    ]);
    expect(options(decode(render({ settings: { focusHoldSeconds: 30 } })))).toContain('30* 30 seconds');
    const row =
      /<span class="settings__focus">([\s\S]*?)<\/span>\s*<span><\/span>/.exec(decode(render()))?.[1] ?? '';
    expect(
      row
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    ).toBe(`${FOCUS_HOLD_BEFORE} 5 seconds 10 seconds 15 seconds 30 seconds 60 seconds to leave`);
  });

  it('puts appearance first, then model and effort, then the folders, then the accounts, then the foot', () => {
    const html = decode(render());
    const order = [
      '<h2>Settings</h2>',
      '>App</h3>',
      '>Appearance</label>',
      `>${APPEARANCE_NOTE}</p>`,
      '>Focus mode</label>',
      '>Hold F11 or Esc for</label>',
      '>5 seconds</option>',
      '>10 seconds</option>',
      '>15 seconds</option>',
      '>30 seconds</option>',
      '>60 seconds</option>',
      '<span>to leave</span>',
      `>${FOCUS_MODE_NOTE}</p>`,
      '>Review</h3>',
      '>Claude model</label>',
      '>Effort</label>',
      '>Folders</h3>',
      '<span>Manuscript folder</span>',
      '<span>Reviews folder</span>',
      '<span>Backups</span>',
      '<span>Guidelines file</span>',
      '>Open</button>',
      '>Open folder</button>',
      '>Accounts</h3>',
      '<span>Claude account</span>',
      '<span>ChatGPT account</span>',
      `>${SHOW_WELCOME_AGAIN}</button>`,
      '>About</button>',
      '>Done</button>'
    ];
    const at = order.map((part) => html.indexOf(part));
    expect(
      at.every((i) => i > -1),
      JSON.stringify(at)
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('keeps the title and any message in a head, and the foot buttons in a foot, both outside the sections', () => {
    const html = render();
    expect(html).toMatch(
      /^<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings"><div class="modal modal--settings" tabindex="-1"><div class="settings__head"><h2>Settings<\/h2><\/div><section /
    );
    expect(html).toMatch(
      /<\/section><div class="modal__actions settings__foot"><button [^>]*>[^<]*<\/button><button [^>]*>About<\/button><span class="spacer"><\/span><button type="button" class="primary" [^>]*>Done<\/button><\/div><\/div><\/div>$/
    );
  });
});

describe('the (?) of a row (polish.4)', () => {
  const TIPS: Array<[string, string]> = [
    ['focus mode', FOCUS_MODE_TIP],
    ['Claude model', MODEL_TIP],
    ['Effort', EFFORT_TIP],
    ['the manuscript folder', MANUSCRIPT_TIP],
    ['the reviews folder', REVIEWS_FOLDER_TIP],
    ['backups', BACKUPS_TIP],
    ['the guidelines file', GUIDELINES_TIP],
    ['the Claude account', CLAUDE_ACCOUNT_TIP],
    ['the ChatGPT account', CHATGPT_ACCOUNT_TIP]
  ];

  it('is a button named for what it explains, described by its tooltip, which is hidden until shown', () => {
    const html = decode(render());
    const helps = [
      ...html.matchAll(
        /<button type="button" class="help" aria-label="([^"]+)" aria-describedby="([^"]+)">\?<\/button><span role="tooltip" id="([^"]+)" class="help__tip" hidden="">([^<]+)<\/span>/g
      )
    ];
    expect(helps.map(([, label, , , tip]) => [label, tip])).toEqual(
      TIPS.map(([topic, tip]) => [helpButtonLabel(topic), tip])
    );
    for (const [, , describedBy, id] of helps) expect(describedBy).toBe(id);
  });

  /* polish.15: each (?) left the row's name for a cell of its own at the
     right end of the row, so that they stand in one line down the right of
     the dialog. */
  it("is each row's fourth and last cell, after its buttons; Appearance keeps the cell empty", () => {
    const html = render();
    const rows = [...html.matchAll(/<div class="modal__row">([\s\S]*?)<\/div>/g)].map(([, inner = '']) =>
      cells(inner)
    );
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row, row.join('')).toHaveLength(4);
      expect(row[3]).toMatch(/^<span class="modal__help">/);
      // The name is the first cell, alone, with no (?) beside it.
      expect(row[0]).toMatch(/^<(span|label)[^>]*>[^<]*<\/(span|label)>$/);
    }
    expect(rows.map((row) => text(row[0] ?? ''))).toEqual([
      'Appearance',
      'Focus mode',
      'Claude model',
      'Effort',
      'Manuscript folder',
      'Reviews folder',
      'Backups',
      'Guidelines file',
      'Claude account',
      'ChatGPT account'
    ]);
    // Appearance, first since polish.22, has no (?); every row after it has one.
    expect(rows.map((row) => /aria-label="More about ([^"]+)"/.exec(row[3] ?? '')?.[1] ?? null)).toEqual([
      null,
      ...TIPS.map(([topic]) => topic)
    ]);
    expect(rows[0]?.[3]).toBe('<span class="modal__help"></span>');
    expect(html.match(/class="help"/g)).toHaveLength(TIPS.length);
    expect(html).not.toContain('modal__name');
  });

  /* The keyboard follows the markup (polish.22): Appearance first, then each
     row's controls and its (?) down the dialog, then the foot. The guidelines
     file's Open and Open folder are disabled here, where effects do not run
     and main has given no path, so Tab passes them by, as it passes a control
     with a negative tabindex: neither counts as reached. */
  it('is reached by Tab after its row, in the order of the rows, Appearance first and Done last', () => {
    const html = render({ runtime: READY });
    const reached = controls(html)
      .filter((control) => !/\sdisabled=""|\stabindex="-/.test(control.attrs))
      .map((control) => control.name);
    expect(reached).toEqual([
      'Appearance',
      'Focus mode',
      FOCUS_HOLD_BEFORE,
      helpButtonLabel('focus mode'),
      'Claude model',
      helpButtonLabel('Claude model'),
      'Effort',
      helpButtonLabel('Effort'),
      'Change',
      helpButtonLabel('the manuscript folder'),
      'Change',
      'Show in folder',
      helpButtonLabel('the reviews folder'),
      'Change',
      'Show in folder',
      helpButtonLabel('backups'),
      'Change',
      helpButtonLabel('the guidelines file'),
      'Setup',
      helpButtonLabel('the Claude account'),
      'Setup',
      helpButtonLabel('the ChatGPT account'),
      SHOW_WELCOME_AGAIN,
      'About',
      'Done'
    ]);
    expect(html).not.toMatch(/tabindex="[1-9]/);
  });

  it("comes after the row's own controls, so Tab reaches it after them", () => {
    const html = render({ runtime: READY });
    for (const [, inner = ''] of html.matchAll(/<div class="modal__row">([\s\S]*?)<\/div>/g)) {
      if (!inner.includes('class="help"')) continue;
      const tags = [...inner.matchAll(/<(button|select|input|a)\s[^>]*>/g)].map(([tag]) => tag);
      expect(tags.length, inner).toBeGreaterThan(1);
      expect(tags.at(-1)).toMatch(/^<button type="button" class="help" /);
      expect(tags.filter((tag) => tag.includes('class="help"'))).toHaveLength(1);
    }
  });
});

describe('the Backups row (apply.11, setup.18)', () => {
  const row = (html: string): string => {
    const found = [...html.matchAll(/<div class="modal__row">([\s\S]*?)<\/div>/g)]
      .map(([, inner = '']) => inner)
      .find((inner) => inner.startsWith('<span>Backups</span>'));
    expect(found).toBeDefined();
    return found ?? '';
  };

  it('has Change, then Show in folder, as the reviews folder has', () => {
    const buttons = [...decode(row(render())).matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
      ([, label]) => label
    );
    expect(buttons).toEqual(['Change', 'Show in folder', '?']);
  });

  it('shows the folder chosen in Settings until main has said which is in use, and … for none', () => {
    const chosen = 'E:\\Backups'; // check-public: allow
    expect(decode(row(render({ settings: { backupsFolder: chosen } })))).toContain(`>${chosen}</span>`);
    expect(decode(row(render()))).toContain('>…</span>');
  });
});

describe('the notes under the rows (polish.4)', () => {
  const notes = (html: string): string[] =>
    [...html.matchAll(/<p class="modal__note[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner = '']) =>
      text(inner)
    );

  it('are the short ones, one line each, under Appearance, Focus mode, the reviews folder and the backups', () => {
    const shown = notes(render());
    expect(shown).toEqual([
      APPEARANCE_NOTE,
      FOCUS_MODE_NOTE,
      reviewsFolderNote(false),
      backupsFolderNote(false)
    ]);
    for (const note of shown) expect(note.length, note).toBeLessThanOrEqual(SETTINGS_NOTE_MAX);
  });

  it('has no row, field or link for an OpenAI API key, which codex.6 took out', () => {
    const html = decode(render({ runtime: READY }));
    // The one field is focus mode's box (focus.1); the key's field went in codex.6.
    expect(html.match(/<input [^>]*>/g)).toEqual([expect.stringContaining('type="checkbox"')]);
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/OpenAI API key|Save key|Remove key|platform\.openai\.com|OPENAI_API_KEY/);
    // The one API key Settings names is the one ChatGPT needs none of.
    expect(html.match(/API key/g)).toEqual(['API key']);
    expect(html).toContain('with no API key');
  });

  it('has no welcome guide row or note: its button is at the foot with its note as its tooltip', () => {
    const html = decode(render());
    expect(html).not.toContain('Welcome guide</span>');
    expect(html).toContain(
      `title="The first-start steps: manuscript folder, AI agents, appearance and style sheet.">${SHOW_WELCOME_AGAIN}</button>`
    );
  });
});

describe('every control has a name and a description (polish.4)', () => {
  const states: Array<[string, Parameters<typeof render>[0]]> = [
    ['nothing checked yet', {}],
    ['Claude ready', { runtime: READY }],
    [
      'signed in to ChatGPT',
      {
        chatgpt: {
          signedIn: true,
          plan: 'Plus',
          dataSettingsConfirmed: false,
          signingIn: false,
          registered: true,
          encryptionAvailable: true
        }
      }
    ],
    [
      'no encryption for a ChatGPT sign-in',
      {
        chatgpt: {
          signedIn: false,
          plan: null,
          dataSettingsConfirmed: false,
          signingIn: false,
          registered: false,
          encryptionAvailable: false
        }
      }
    ],
    ['no manuscript folder', { settings: { manuscriptFolder: null } }]
  ];

  it.each(states)('%s', (_label, options) => {
    const list = controls(render(options));
    expect(list.length).toBeGreaterThanOrEqual(23);
    for (const control of list) {
      const what = `${control.tag}${control.attrs}`;
      expect(control.name, what).not.toBe('');
      expect(control.description, what).not.toBe('');
      expect(control.description, what).not.toContain('<missing');
    }
  });

  it('describes each control by what it acts on', () => {
    const list = controls(render({ runtime: READY }));
    const find = (name: string, nth = 0): Control => {
      const found = list.filter((c) => c.name === name)[nth];
      expect(found, name).toBeDefined();
      return found as Control;
    };
    expect(find('Claude model').description).toBe(MODEL_TIP);
    expect(find('Effort').description).toBe(EFFORT_TIP);
    expect(find('Appearance').description).toBe(APPEARANCE_NOTE);
    expect(find('Focus mode').description).toBe(`${FOCUS_MODE_NOTE} ${FOCUS_MODE_TIP}`);
    expect(find(FOCUS_HOLD_BEFORE).description).toBe(FOCUS_MODE_TIP);
    expect(find('Change', 0).description).toBe('C:\\Novel'); // check-public: allow
    expect(find('Change', 1).description).toBe(`… ${reviewsFolderNote(false)}`);
    // The backups folder's Change (setup.18), then its Show in folder.
    expect(find('Change', 2).description).toBe(`… ${backupsFolderNote(false)}`);
    expect(find('Show in folder', 1).description).toBe(`… ${backupsFolderNote(false)}`);
    expect(find('Change', 3).description).toBe('choose a manuscript folder first');
    expect(find('Open').description).toBe('choose a manuscript folder first');
    expect(find('Open folder').description).toBe('choose a manuscript folder first');
    expect(find('Setup').description).toBe('ann@example.com (Claude Max)');
    expect(find('Setup', 1).description).toBe('not read yet');
    expect(find('Done').description).toBe('Each setting is saved as soon as you change it.');
  });
});
