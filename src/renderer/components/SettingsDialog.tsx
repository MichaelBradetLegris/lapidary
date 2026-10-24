import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChatGptStatus, EffectivePaths, ModelInfo, RuntimeStatus } from '../../shared/ipc';
import { EFFORT_LEVELS, type EffortLevel, type Settings } from '../../shared/types';
import { ABOUT_BUTTON } from '../../shared/ui/about';
import { chatGptAccountLine } from '../../shared/ui/chatgpt';
import { SETTINGS_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import { openedGuidelinesNote } from '../../shared/ui/guidelines';
import {
  ABOUT_BUTTON_NOTE,
  APPEARANCE_NOTE,
  BACKUPS_ROW_NOTE,
  BACKUPS_TIP,
  CHATGPT_ACCOUNT_TIP,
  CLAUDE_ACCOUNT_TIP,
  DONE_NOTE,
  EFFORT_TIP,
  GUIDELINES_TIP,
  MANUSCRIPT_TIP,
  MODEL_TIP,
  REVIEWS_FOLDER_TIP,
  reviewsFolderNote
} from '../../shared/ui/settingsDialog';
import { claudeAccountLine } from '../../shared/ui/setup';
import { normalizeTheme, THEME_LABELS, THEMES } from '../../shared/ui/theme';
import { SHOW_WELCOME_AGAIN, WELCOME_GUIDE_NOTE } from '../../shared/ui/welcome';
import { call, errorMessage } from '../state/client';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
import { modelOptions } from '../state/models';
import { GuidelinesButtons } from './Guidelines';
import { HelpTip } from './HelpTip';

/** How far a control the keyboard moves to stays from the head and the foot, in CSS px. */
const STICKY_CLEARANCE_PX = 8;

interface Props {
  settings: Settings;
  /** Claude's model list */
  models: ModelInfo[];
  /** Claude's runtime */
  runtime: RuntimeStatus | null;
  /** the ChatGPT sign-in's status (codex.2), null until main has answered */
  chatgpt: ChatGptStatus | null;
  /** a ChatGPT sign-in is waiting for the browser */
  chatgptWaiting: boolean;
  onApply: (next: Settings) => void;
  onClose: () => void;
  onOpenSetup: () => void;
  /** the Setup screen's ChatGPT view (codex.2), in place of Settings */
  onOpenChatGptSetup: () => void;
  /** Show the welcome guide again (setup.11): it comes back in place of the main view */
  onShowWelcome: () => void;
  /** About (release.9): it opens in place of Settings */
  onAbout: () => void;
}

/**
 * Settings, a modal like the others (ui.1): Escape closes it, as Done does,
 * unless a question is open over it (`useDialogEscape`), and the page's keys
 * do nothing behind it (`reviewKeysActive`, `isModalOpen`), nor does the
 * suggestion editor, which waits under it, inert (EditPopover). The focus goes
 * into its box as it opens, so Tab starts inside it and the arrow keys scroll
 * it, and back where it was, the Settings button as a rule, when it closes.
 * The page behind it is inert meanwhile, so Tab stays inside it (ui.4).
 *
 * Three sections, Review, Folders and Accounts (Claude, and ChatGPT since
 * codex.2), and at the foot the welcome guide, About and Done (polish.4). A
 * row has at most one short note; the longer explanations are the tooltips
 * of the (?) in each row's last cell, after its buttons, so that they stand
 * in one line down the right of the dialog (`HelpTip`, polish.15; Appearance
 * keeps the cell empty), whose words are in `src/shared/ui/settingsDialog.ts`.
 * Each control names its row's path, status line, note or tooltip as its
 * description. The box still scrolls when the window is too short for it,
 * with its title and any message at the top, and its buttons at the foot,
 * held in view, and a scroll padding of their measured height keeps a control
 * Tab or Shift+Tab reaches clear of them.
 */
export function SettingsDialog({
  settings,
  models,
  runtime,
  chatgpt,
  chatgptWaiting,
  onApply,
  onClose,
  onOpenSetup,
  onOpenChatGptSetup,
  onShowWelcome,
  onAbout
}: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  const uid = useId();
  const id = (part: string): string => `${uid}-${part}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);

  /* The scroll padding keeps a control the keyboard moves to clear of the head
     and the foot, which stay in view (polish.4). The head grows with a message,
     an error and a note at once, or a path that wraps, and both change with
     the zoom, so the padding is each one's measured height and a little more,
     set again whenever either changes size; app.css's values are the start
     (polish.4 review: a fixed 56 px covered only a head with no message, so
     Shift+Tab could stop on a control under a taller one). */
  useLayoutEffect(() => {
    const box = boxRef.current;
    const head = headRef.current;
    const foot = footRef.current;
    if (!box || !head || !foot) return;
    const fit = (): void => {
      box.style.scrollPaddingTop = `${head.offsetHeight + STICKY_CLEARANCE_PX}px`;
      box.style.scrollPaddingBottom = `${foot.offsetHeight + STICKY_CLEARANCE_PX}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(head);
    observer.observe(foot);
    return () => observer.disconnect();
  }, []);

  const refreshPaths = useCallback(() => {
    call('settings:effective', undefined)
      .then(setPaths)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(refreshPaths, [refreshPaths]);

  /* A refusal, such as a guidelines file that is not .md or .txt, stays on
     screen until the next change, which clears it as the other actions do
     (hardening.8 review). */
  const update = (patch: Partial<Settings>): void => {
    setError(null);
    call('settings:set', patch)
      .then((next) => {
        onApply(next);
        refreshPaths();
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const pickFolder = (key: 'manuscriptFolder' | 'reviewsFolder', title: string): void => {
    call('dialog:pick-folder', { title, ...(settings[key] ? { defaultPath: settings[key] } : {}) })
      .then((folder) => {
        if (folder) update({ [key]: folder });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  /* The picker shows the two types main takes; a name typed in it can still be
     anything, and main refuses one that is not .md or .txt in words this
     dialog shows, keeping the file chosen before (hardening.8 review). */
  const pickGuidelines = (): void => {
    call('dialog:pick-file', { title: 'Choose the guidelines file', extensions: ['md', 'txt'] })
      .then((file) => {
        if (file) update({ guidelinesPath: file });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const openGuidelines = (): void => {
    setError(null);
    call('guidelines:open', undefined)
      .then((result) => {
        setNote(openedGuidelinesNote(result));
        refreshPaths();
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const reveal = (target: 'guidelines' | 'reviews' | 'backups'): void => {
    setError(null);
    call('shell:reveal', { target })
      .then(() => setNote(null))
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal modal--settings" ref={boxRef} tabIndex={-1}>
        {/* The title and any message stay in view while the box scrolls (polish.4). */}
        <div className="settings__head" ref={headRef}>
          <h2>Settings</h2>
          {error ? <p className="modal__hint modal__hint--error">{error}</p> : null}
          {note ? <p className="modal__hint">{note}</p> : null}
        </div>

        <section className="settings__section" aria-labelledby={id('review')}>
          <h3 id={id('review')}>Review</h3>

          <div className="modal__row">
            <label htmlFor={id('model')}>Claude model</label>
            <select
              id={id('model')}
              value={settings.model}
              aria-describedby={id('model-tip')}
              onChange={(e) => update({ model: e.target.value })}
            >
              {modelOptions(models, settings.model).map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
            <span />
            <HelpTip id={id('model-tip')} topic="Claude model" text={MODEL_TIP} />
          </div>

          <div className="modal__row">
            <label htmlFor={id('effort')}>Effort</label>
            <select
              id={id('effort')}
              value={settings.effort}
              aria-describedby={id('effort-tip')}
              onChange={(e) => update({ effort: e.target.value as EffortLevel })}
            >
              {EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <span />
            <HelpTip id={id('effort-tip')} topic="Effort" text={EFFORT_TIP} />
          </div>

          {/* Saved like every other setting; main switches the window as soon as
              settings:set returns (theme.7, PLAN 11.3 e). */}
          <div className="modal__row">
            <label htmlFor={id('appearance')}>Appearance</label>
            <select
              id={id('appearance')}
              value={settings.theme}
              aria-describedby={id('appearance-note')}
              onChange={(e) => update({ theme: normalizeTheme(e.target.value) })}
            >
              {THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {THEME_LABELS[theme]}
                </option>
              ))}
            </select>
            <span />
            <span className="modal__help" />
          </div>
          <p className="modal__note" id={id('appearance-note')}>
            {APPEARANCE_NOTE}
          </p>
        </section>

        <section className="settings__section" aria-labelledby={id('folders')}>
          <h3 id={id('folders')}>Folders</h3>

          <div className="modal__row">
            <span>Manuscript folder</span>
            <span className="modal__path" id={id('manuscript-path')}>
              {settings.manuscriptFolder ?? 'not set'}
            </span>
            <span className="modal__buttons">
              <button
                type="button"
                aria-describedby={id('manuscript-path')}
                onClick={() => pickFolder('manuscriptFolder', 'Choose the manuscript folder')}
              >
                Change
              </button>
            </span>
            <HelpTip id={id('manuscript-tip')} topic="the manuscript folder" text={MANUSCRIPT_TIP} />
          </div>

          <div className="modal__row">
            <span>Reviews folder</span>
            <span className="modal__path" id={id('reviews-path')}>
              {paths?.reviewsFolder ?? settings.reviewsFolder ?? '…'}
            </span>
            <span className="modal__buttons">
              <button
                type="button"
                aria-describedby={`${id('reviews-path')} ${id('reviews-note')}`}
                onClick={() => pickFolder('reviewsFolder', 'Choose the reviews folder')}
              >
                Change
              </button>
              <button
                type="button"
                aria-describedby={`${id('reviews-path')} ${id('reviews-note')}`}
                onClick={() => reveal('reviews')}
              >
                Show in folder
              </button>
            </span>
            <HelpTip id={id('reviews-tip')} topic="the reviews folder" text={REVIEWS_FOLDER_TIP} />
          </div>
          <p className="modal__note" id={id('reviews-note')}>
            {reviewsFolderNote(paths?.reviewsFolderIsDefault ?? false)}
          </p>

          {/* Where Save to chapter copies what it replaces (apply.11, PLAN 6.5).
              Each chapter has a folder of its own inside; Show backups, in the
              toolbar's Actions menu, opens the open chapter's. */}
          <div className="modal__row">
            <span>Backups</span>
            <span className="modal__path" id={id('backups-path')} title={paths?.backupsFolder}>
              {paths?.backupsFolder ?? '…'}
            </span>
            <span className="modal__buttons">
              <button
                type="button"
                aria-describedby={`${id('backups-path')} ${id('backups-note')}`}
                onClick={() => reveal('backups')}
              >
                Show in folder
              </button>
            </span>
            <HelpTip id={id('backups-tip')} topic="backups" text={BACKUPS_TIP} />
          </div>
          <p className="modal__note" id={id('backups-note')}>
            {BACKUPS_ROW_NOTE}
          </p>

          {/* Change, then Open, the system's app for the file, and Open
              folder, which shows it in its folder (polish.3). */}
          <div className="modal__row">
            <span>Guidelines file</span>
            <span
              className="modal__path"
              id={id('guidelines-path')}
              title={paths?.guidelinesPath ?? undefined}
            >
              {paths?.guidelinesPath ?? 'choose a manuscript folder first'}
            </span>
            <GuidelinesButtons
              path={paths?.guidelinesPath ?? null}
              onOpen={openGuidelines}
              onOpenFolder={() => reveal('guidelines')}
              describedBy={id('guidelines-path')}
            >
              <button type="button" aria-describedby={id('guidelines-path')} onClick={pickGuidelines}>
                Change
              </button>
            </GuidelinesButtons>
            <HelpTip id={id('guidelines-tip')} topic="the guidelines file" text={GUIDELINES_TIP} />
          </div>
        </section>

        <section className="settings__section" aria-labelledby={id('accounts')}>
          <h3 id={id('accounts')}>Accounts</h3>

          <div className="modal__row">
            <span>Claude account</span>
            <span className="modal__path" id={id('claude-line')} data-testid="claude-account-line">
              {claudeAccountLine(runtime)}
            </span>
            <span className="modal__buttons">
              <button type="button" aria-describedby={id('claude-line')} onClick={onOpenSetup}>
                Setup
              </button>
            </span>
            <HelpTip id={id('claude-tip')} topic="the Claude account" text={CLAUDE_ACCOUNT_TIP} />
          </div>

          {/* Signed in or not, and the plan; Setup opens the Setup screen's
              ChatGPT view, where the sign-in and the training warning are
              (codex.2). */}
          <div className="modal__row">
            <span>ChatGPT account</span>
            <span className="modal__path" id={id('chatgpt-line')} data-testid="chatgpt-account-line">
              {chatGptAccountLine(chatgpt, chatgptWaiting)}
            </span>
            <span className="modal__buttons">
              <button type="button" aria-describedby={id('chatgpt-line')} onClick={onOpenChatGptSetup}>
                Setup
              </button>
            </span>
            <HelpTip id={id('chatgpt-tip')} topic="the ChatGPT account" text={CHATGPT_ACCOUNT_TIP} />
          </div>
        </section>

        {/* The guide comes back in place of the main view, and Settings closes
            so that it shows (setup.11); About opens in place of Settings, as
            Setup does (release.9). The row stays in view while the box scrolls. */}
        <div className="modal__actions settings__foot" ref={footRef}>
          <button type="button" title={WELCOME_GUIDE_NOTE} onClick={onShowWelcome}>
            {SHOW_WELCOME_AGAIN}
          </button>
          <button type="button" title={ABOUT_BUTTON_NOTE} onClick={onAbout}>
            {ABOUT_BUTTON}
          </button>
          <span className="spacer" />
          <button type="button" className="primary" title={DONE_NOTE} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
