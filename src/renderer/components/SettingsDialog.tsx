import { useCallback, useEffect, useId, useState } from 'react';
import { openAiKeyLine } from '../../shared/ai/openai';
import type { EffectivePaths, ModelInfo, OpenAiKeyStatus, RuntimeStatus } from '../../shared/ipc';
import { EFFORT_LEVELS, type EffortLevel, type Settings } from '../../shared/types';
import { BACKUPS_NOTE } from '../../shared/ui/backups';
import { normalizeTheme, THEME_LABELS, THEMES } from '../../shared/ui/theme';
import { call, errorMessage } from '../state/client';
import { modelOptions } from '../state/models';

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
}

export function SettingsDialog({
  settings,
  models,
  runtime,
  keyStatus,
  onApply,
  onKeyChanged,
  onClose,
  onOpenSetup
}: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  /* The key only lives in this field until Save key is pressed, then the field is
     emptied before the request goes out. It is never read back from main. */
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const appearanceId = useId();

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

  const openGuidelines = (): void => {
    setError(null);
    call('guidelines:open', { via: 'default' })
      .then((result) => {
        setNote(result.created ? `Created ${result.path} from the template.` : `Opened ${result.path}.`);
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
      <div className="modal">
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

        <div className="modal__row">
          <span>Guidelines file</span>
          <span className="modal__path">{paths?.guidelinesPath ?? 'choose a manuscript folder first'}</span>
          <span className="modal__buttons">
            <button type="button" onClick={pickGuidelines}>
              Change
            </button>
            <button type="button" disabled={!paths?.guidelinesPath} onClick={openGuidelines}>
              Open guidelines file
            </button>
            <button type="button" disabled={!paths?.guidelinesPath} onClick={() => reveal('guidelines')}>
              Show in folder
            </button>
          </span>
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
          <span className="modal__path">
            {runtime
              ? runtime.state === 'ready'
                ? `${runtime.email ?? 'signed in'}${runtime.subscriptionType ? ` (${runtime.subscriptionType})` : ''}${
                    runtime.apiKeySource ? ` key from ${runtime.apiKeySource}` : ''
                  }`
                : (runtime.message ?? runtime.state)
              : 'not checked'}
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
