import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { openAiKeyLine } from '../../shared/ai/openai';
import type {
  EffectivePaths,
  ModelInfo,
  OpenAiKeyStatus,
  OpenGuidelinesVia,
  RuntimeStatus
} from '../../shared/ipc';
import { EFFORT_LEVELS, type EffortLevel, type Settings } from '../../shared/types';
import { BACKUPS_NOTE } from '../../shared/ui/backups';
import { SETTINGS_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import { openedGuidelinesNote } from '../../shared/ui/guidelines';
import { claudeAccountLine } from '../../shared/ui/setup';
import { normalizeTheme, THEME_LABELS, THEMES } from '../../shared/ui/theme';
import { SHOW_WELCOME_AGAIN, WELCOME_GUIDE_NOTE } from '../../shared/ui/welcome';
import { call, errorMessage } from '../state/client';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
import { modelOptions } from '../state/models';
import { GuidelinesButtons } from './Guidelines';

interface Props {
  settings: Settings;
  /** Claude's model list */
  models: ModelInfo[];
  /** Claude's runtime */
  runtime: RuntimeStatus | null;
  keyStatus: OpenAiKeyStatus | null;
  onApply: (next: Settings) => void;
  onKeyChanged: (status: OpenAiKeyStatus) => void;
  onClose: () => void;
  onOpenSetup: () => void;
  /** Show the welcome guide again (setup.11): it comes back in place of the main view */
  onShowWelcome: () => void;
}

/**
 * Settings, a modal like the others (ui.1): Escape closes it, as Done does,
 * unless a question is open over it (`useDialogEscape`), and the page's keys
 * do nothing behind it (`reviewKeysActive`, `isModalOpen`), nor does the
 * suggestion editor, which waits under it, inert (EditPopover). The focus goes
 * into its box as it opens, so Tab starts inside it and the arrow keys scroll
 * it, and back where it was, the Settings button as a rule, when it closes.
 * The page behind it is inert meanwhile, so Tab stays inside it (ui.4).
 */
export function SettingsDialog({
  settings,
  models,
  runtime,
  keyStatus,
  onApply,
  onKeyChanged,
  onClose,
  onOpenSetup,
  onShowWelcome
}: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  /* The key only lives in this field until Save key is pressed, then the field is
     emptied before the request goes out. It is never read back from main. */
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const appearanceId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);

  const saveKey = (): void => {
    const key = keyDraft;
    setKeyDraft('');
    setError(null);
    setKeyBusy(true);
    call('secrets:openai-set', { key })
      .then((status) => {
        onKeyChanged(status);
        setNote(`OpenAI key saved, encrypted, ending ${status.last4}.`);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setKeyBusy(false));
  };

  const removeKey = (): void => {
    setError(null);
    setKeyBusy(true);
    call('secrets:openai-clear', undefined)
      .then((status) => {
        onKeyChanged(status);
        setNote(
          status.source === 'environment'
            ? 'Saved key removed. OPENAI_API_KEY from the environment is still in use.'
            : 'Saved key removed.'
        );
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setKeyBusy(false));
  };

  const refreshPaths = useCallback(() => {
    call('settings:effective', undefined)
      .then(setPaths)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(refreshPaths, [refreshPaths]);

  const update = (patch: Partial<Settings>): void => {
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

  const pickGuidelines = (): void => {
    call('dialog:pick-file', { title: 'Choose the guidelines file', extensions: ['md'] })
      .then((file) => {
        if (file) update({ guidelinesPath: file });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const openGuidelines = (via: OpenGuidelinesVia): void => {
    setError(null);
    call('guidelines:open', { via })
      .then((result) => {
        setNote(openedGuidelinesNote(result, via));
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
      <div className="modal" ref={boxRef} tabIndex={-1}>
        <h2>Settings</h2>
        {error ? <p className="modal__hint modal__hint--error">{error}</p> : null}
        {note ? <p className="modal__hint">{note}</p> : null}

        <div className="modal__row">
          <span>Manuscript folder</span>
          <span className="modal__path">{settings.manuscriptFolder ?? 'not set'}</span>
          <span className="modal__buttons">
            <button
              type="button"
              onClick={() => pickFolder('manuscriptFolder', 'Choose the manuscript folder')}
            >
              Change
            </button>
          </span>
        </div>

        <div className="modal__row">
          <span>Reviews folder</span>
          <span className="modal__path">{paths?.reviewsFolder ?? settings.reviewsFolder ?? '…'}</span>
          <span className="modal__buttons">
            <button type="button" onClick={() => pickFolder('reviewsFolder', 'Choose the reviews folder')}>
              Change
            </button>
            <button type="button" onClick={() => reveal('reviews')}>
              Show in folder
            </button>
          </span>
        </div>
        <p className="modal__note">
          Reviews are saved automatically, as soon as the model answers and after every decision. With no
          folder chosen they go to the app&apos;s own data folder shown above
          {paths?.reviewsFolderIsDefault ? ' (in use now)' : ''}.
        </p>

        {/* Where Save to chapter copies what it replaces (apply.11, PLAN 6.5).
            Each chapter has a folder of its own inside; the side panel's Show
            backups opens the open chapter's. */}
        <div className="modal__row">
          <span>Backups</span>
          <span className="modal__path" title={paths?.backupsFolder}>
            {paths?.backupsFolder ?? '…'}
          </span>
          <span className="modal__buttons">
            <button type="button" onClick={() => reveal('backups')}>
              Show in folder
            </button>
          </span>
        </div>
        <p className="modal__note">{BACKUPS_NOTE}</p>

        {/* Two rows, so the path keeps its room: Change and Show in folder
            beside it, and under them the two ways to open the file, Open in
            Obsidian and the system's app (setup.10b). */}
        <div className="modal__row">
          <span>Guidelines file</span>
          <span className="modal__path" title={paths?.guidelinesPath ?? undefined}>
            {paths?.guidelinesPath ?? 'choose a manuscript folder first'}
          </span>
          <span className="modal__buttons">
            <button type="button" onClick={pickGuidelines}>
              Change
            </button>
            <button type="button" disabled={!paths?.guidelinesPath} onClick={() => reveal('guidelines')}>
              Show in folder
            </button>
          </span>
        </div>
        <div className="modal__row">
          <span />
          <span />
          <GuidelinesButtons
            path={paths?.guidelinesPath ?? null}
            openLabel="Open guidelines file"
            onOpen={openGuidelines}
          />
        </div>

        <div className="modal__row">
          <span>Claude model</span>
          <select value={settings.model} onChange={(e) => update({ model: e.target.value })}>
            {modelOptions(models, settings.model).map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          <span />
        </div>

        <div className="modal__row">
          <span>Effort</span>
          <select value={settings.effort} onChange={(e) => update({ effort: e.target.value as EffortLevel })}>
            {EFFORT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <span />
        </div>

        {/* Saved like every other setting; main switches the window as soon as
            settings:set returns (theme.7, PLAN 11.3 e). */}
        <div className="modal__row">
          <label htmlFor={`${appearanceId}-select`}>Appearance</label>
          <select
            id={`${appearanceId}-select`}
            value={settings.theme}
            aria-describedby={`${appearanceId}-note`}
            onChange={(e) => update({ theme: normalizeTheme(e.target.value) })}
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </select>
          <span />
        </div>
        <p className="modal__note" id={`${appearanceId}-note`}>
          Match system follows your computer&apos;s light or dark setting.
        </p>

        <div className="modal__row">
          <span>Claude account</span>
          <span className="modal__path" data-testid="claude-account-line">
            {claudeAccountLine(runtime)}
          </span>
          <span className="modal__buttons">
            <button type="button" onClick={onOpenSetup}>
              Setup
            </button>
          </span>
        </div>

        <div className="modal__row">
          <span>OpenAI API key</span>
          <span
            className={`modal__path ${keyStatus?.configured ? '' : 'modal__path--warn'}`}
            data-testid="settings-key-line"
          >
            {openAiKeyLine(keyStatus)}
          </span>
          <span className="modal__buttons">
            <button type="button" disabled={keyBusy || keyStatus?.source !== 'stored'} onClick={removeKey}>
              Remove key
            </button>
          </span>
        </div>
        <div className="modal__row">
          <span />
          <input
            type="password"
            className="modal__key-input"
            aria-label="OpenAI API key"
            placeholder="Paste a key from platform.openai.com/api-keys"
            autoComplete="off"
            spellCheck={false}
            value={keyDraft}
            disabled={keyBusy || keyStatus?.encryptionAvailable === false}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyDraft.trim()) saveKey();
            }}
          />
          <span className="modal__buttons">
            <button
              type="button"
              disabled={keyBusy || keyDraft.trim().length === 0 || keyStatus?.encryptionAvailable === false}
              onClick={saveKey}
            >
              Save key
            </button>
          </span>
        </div>
        {keyStatus?.encryptionAvailable === false ? (
          <p className="modal__note modal__note--error">
            Windows cannot encrypt secrets for this app right now, so a key cannot be saved here. Set
            OPENAI_API_KEY in the environment before starting the app instead.
          </p>
        ) : (
          <p className="modal__note">
            Only needed for OpenAI reviews, which are billed per token to the account that owns the key. Get
            one at{' '}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com/api-keys
            </a>
            . It is encrypted with your Windows login and stored beside the settings file, never shown again,
            and used only by this app&apos;s background process. With no saved key, OPENAI_API_KEY from the
            environment is used.
          </p>
        )}

        {/* The guide comes back in place of the main view, and Settings
            closes so that it shows (setup.11). */}
        <div className="modal__row">
          <span>Welcome guide</span>
          <span />
          <span className="modal__buttons">
            <button type="button" onClick={onShowWelcome}>
              {SHOW_WELCOME_AGAIN}
            </button>
          </span>
        </div>
        <p className="modal__note">{WELCOME_GUIDE_NOTE}</p>

        <div className="modal__actions">
          <span className="spacer" />
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
