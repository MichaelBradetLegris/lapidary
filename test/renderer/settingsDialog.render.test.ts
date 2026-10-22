import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog';
import type { OpenAiKeyStatus, RuntimeStatus } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types';
import {
  APPEARANCE_NOTE,
  BACKUPS_ROW_NOTE,
  BACKUPS_TIP,
  CLAUDE_ACCOUNT_TIP,
  EFFORT_TIP,
  GUIDELINES_TIP,
  KEY_CANNOT_ENCRYPT,
  MANUSCRIPT_TIP,
  MODEL_TIP,
  OPENAI_KEY_NOTE,
  OPENAI_KEY_TIP,
  OPENAI_KEYS_PAGE,
  REVIEWS_FOLDER_TIP,
  SETTINGS_NOTE_MAX,
  helpButtonLabel,
  reviewsFolderNote
} from '../../src/shared/ui/settingsDialog';
import { SHOW_WELCOME_AGAIN } from '../../src/shared/ui/welcome';

/* polish.4: the Settings dialog, rendered with react-dom/server. Its
   sections and rows in order, the (?) beside a row with its tooltip, the one
   short note under a row, and a name and a description for every control,
   which a screen reader gives. Effects do not run here, so the effective
   paths (settings:effective) are not read: the paths show as they do until
   main answers, and the window check in PLAN covers them read. The words
   themselves are tested in test/shared/settingsDialog.test.ts. This file is
   type-checked with the renderer's project (tsconfig.web.json). */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = (html: string): string => decode(html.replace(/<[^>]+>/g, '')).trim();

const STORED: OpenAiKeyStatus = {
  configured: true,
  source: 'stored',
  last4: 'abcd',
  encryptionAvailable: true
};
const NO_ENCRYPTION: OpenAiKeyStatus = {
  configured: false,
  source: 'none',
  last4: '',
  encryptionAvailable: false
};
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
    keyStatus?: OpenAiKeyStatus | null;
    runtime?: RuntimeStatus | null;
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
      keyStatus: options.keyStatus ?? null,
      onApply: () => undefined,
      onKeyChanged: () => undefined,
      onClose: () => undefined,
      onOpenSetup: () => undefined,
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
  it('has Review, Folders and Accounts in order, each a section named by its heading', () => {
    const html = render();
    const headings = [...html.matchAll(/<h3 id="([^"]+)">([^<]+)<\/h3>/g)];
    expect(headings.map((h) => h[2])).toEqual(['Review', 'Folders', 'Accounts']);
    for (const [, id = ''] of headings) {
      expect(html).toContain(`<section class="settings__section" aria-labelledby="${id}"><h3 id="${id}">`);
    }
  });

  it('puts model, effort and appearance first, then the folders, then the accounts, then the foot', () => {
    const html = decode(render());
    const order = [
      '<h2>Settings</h2>',
      '>Review</h3>',
      '>Claude model</label>',
      '>Effort</label>',
      '>Appearance</label>',
      '>Folders</h3>',
      '<span>Manuscript folder</span>',
      '<span>Reviews folder</span>',
      '<span>Backups</span>',
      '<span>Guidelines file</span>',
      '>Open in Obsidian</button>',
      '>Open guidelines file</button>',
      '>Accounts</h3>',
      '<span>Claude account</span>',
      '<span>OpenAI API key (experimental)</span>',
      'aria-label="OpenAI API key"',
      '>Save key</button>',
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

describe('the (?) beside a row (polish.4)', () => {
  const TIPS: Array<[string, string]> = [
    ['Claude model', MODEL_TIP],
    ['Effort', EFFORT_TIP],
    ['the manuscript folder', MANUSCRIPT_TIP],
    ['the reviews folder', REVIEWS_FOLDER_TIP],
    ['backups', BACKUPS_TIP],
    ['the guidelines file', GUIDELINES_TIP],
    ['the Claude account', CLAUDE_ACCOUNT_TIP],
    ['the OpenAI API key', OPENAI_KEY_TIP]
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

  it("sits in the row's name, after the name, and Appearance has none", () => {
    const html = decode(render());
    expect(html).toMatch(
      /<span class="modal__name"><span>Backups<\/span><button type="button" class="help" aria-label="More about backups"/
    );
    expect(html).toMatch(/<span class="modal__name"><label for="[^"]+">Appearance<\/label><\/span>/);
    expect(html.match(/class="help"/g)).toHaveLength(TIPS.length);
  });
});

describe('the notes under the rows (polish.4)', () => {
  const notes = (html: string): string[] =>
    [...html.matchAll(/<p class="modal__note[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map(([, inner = '']) =>
      text(inner)
    );

  it('are the short ones, one line each, under Appearance, the reviews folder, the backups and the key', () => {
    const shown = notes(render());
    expect(shown).toEqual([
      APPEARANCE_NOTE,
      reviewsFolderNote(false),
      BACKUPS_ROW_NOTE,
      `${OPENAI_KEY_NOTE} ${OPENAI_KEYS_PAGE}.`
    ]);
    for (const note of shown) expect(note.length, note).toBeLessThanOrEqual(SETTINGS_NOTE_MAX);
  });

  it('says that no key can be saved, in red, when Windows cannot encrypt, and disables the field', () => {
    const html = render({ keyStatus: NO_ENCRYPTION });
    expect(notes(html).at(-1)).toBe(KEY_CANNOT_ENCRYPT);
    expect(html).toMatch(
      new RegExp(`<p class="modal__note modal__note--error" id="[^"]+">${KEY_CANNOT_ENCRYPT}</p>`)
    );
    expect(html).toMatch(
      /<input type="password" class="modal__key-input" aria-label="OpenAI API key" [^>]*disabled=""/
    );
  });

  it('has no welcome guide row or note: its button is at the foot with its note as its tooltip', () => {
    const html = decode(render());
    expect(html).not.toContain('Welcome guide</span>');
    expect(html).toContain(
      `title="The first-start steps: Claude, the manuscript folder and the style sheet.">${SHOW_WELCOME_AGAIN}</button>`
    );
  });
});

describe('every control has a name and a description (polish.4)', () => {
  const states: Array<[string, Parameters<typeof render>[0]]> = [
    ['nothing checked yet', {}],
    ['a saved key and Claude ready', { keyStatus: STORED, runtime: READY }],
    ['no encryption', { keyStatus: NO_ENCRYPTION }],
    ['no manuscript folder', { settings: { manuscriptFolder: null } }]
  ];

  it.each(states)('%s', (_label, options) => {
    const list = controls(render(options));
    expect(list.length).toBeGreaterThanOrEqual(24);
    for (const control of list) {
      const what = `${control.tag}${control.attrs}`;
      expect(control.name, what).not.toBe('');
      expect(control.description, what).not.toBe('');
      expect(control.description, what).not.toContain('<missing');
    }
  });

  it('describes each control by what it acts on', () => {
    const list = controls(render({ keyStatus: STORED, runtime: READY }));
    const find = (name: string, nth = 0): Control => {
      const found = list.filter((c) => c.name === name)[nth];
      expect(found, name).toBeDefined();
      return found as Control;
    };
    expect(find('Claude model').description).toBe(MODEL_TIP);
    expect(find('Effort').description).toBe(EFFORT_TIP);
    expect(find('Appearance').description).toBe(APPEARANCE_NOTE);
    expect(find('Change', 0).description).toBe('C:\\Novel'); // check-public: allow
    expect(find('Change', 1).description).toBe(`… ${reviewsFolderNote(false)}`);
    expect(find('Show in folder', 1).description).toBe(`… ${BACKUPS_ROW_NOTE}`);
    expect(find('Change', 2).description).toBe('choose a manuscript folder first');
    expect(find('Open in Obsidian').description).toBe('choose a manuscript folder first');
    expect(find('Setup').description).toBe('ann@example.com (Claude Max)');
    expect(find('Remove key').description).toBe('saved in Settings, encrypted (ends abcd)');
    expect(find('OpenAI API key').description).toBe(`${OPENAI_KEY_NOTE} ${OPENAI_KEYS_PAGE}.`);
    expect(find('Save key').description).toBe(OPENAI_KEY_TIP);
    expect(find('Done').description).toBe('Each setting is saved as soon as you change it.');
  });
});
