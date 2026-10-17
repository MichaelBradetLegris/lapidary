import { useEffect, useState } from 'react';
import { openAiKeyLine, toOpenAiEffort } from '../../shared/ai/openai';
import type {
  EffectivePaths,
  ModelInfo,
  OpenAiKeyStatus,
  ReviewSummary,
  RuntimeStatus
} from '../../shared/ipc';
import { proPlanNote } from '../../shared/ai/claudeModels';
import { claudeUpdateAdvice } from '../../shared/ai/claudeStatus';
import { chapterStats } from '../../shared/text/stats';
import { historyCounts, historyWhen } from '../../shared/ui/history';
import {
  EFFORT_LEVELS,
  PROVIDERS,
  PROVIDER_LABELS,
  modelFor,
  modelPatch,
  type EffortLevel,
  type Provider,
  type Review,
  type Settings
} from '../../shared/types';
import { call, errorMessage } from '../state/client';
import { modelOptions, selectedModel } from '../state/models';
import { useApp } from '../state/store';
import { Command } from './Command';

interface Props {
  review: Review;
  settings: Settings;
  models: Partial<Record<Provider, ModelInfo[]>>;
  modelsLoading: Partial<Record<Provider, boolean>>;
  runtimes: Partial<Record<Provider, RuntimeStatus>>;
  keyStatus: OpenAiKeyStatus | null;
  /** newest first; used for the "last reviewed" line */
  history: ReviewSummary[];
  /** the file the review on screen is kept in, so that line counts it from the page (apply.5) */
  reviewPath: string | null;
  /** decisions on the page that the chapter file does not contain yet */
  unsavedDecisions: number;
  saving: boolean;
  /** Save to chapter, leaving the dialog open */
  onSaveFirst: () => void;
  onApplySettings: (next: Settings) => void;
  /** fetch a provider's model list the first time it is shown */
  onNeedModels: (provider: Provider) => void;
  onOpenSettings: () => void;
  /** run the Claude runtime check again, after the author updated Claude Code */
  onCheckClaude: () => void;
  /** true while a runtime check is running */
  checking: boolean;
  onStart: () => void;
  onClose: () => void;
}

/**
 * Everything a review run needs, asked once, where it is being decided (item 6).
 *
 * Model and effort are settings, so they persist. The provider select swaps the
 * model list, and for OpenAI shows where the key comes from and keeps Start
 * disabled until there is one (Phase 5c).
 */
export function ReviewDialog({
  review,
  settings,
  models,
  modelsLoading,
  runtimes,
  keyStatus,
  history,
  reviewPath,
  unsavedDecisions,
  saving,
  onSaveFirst,
  onApplySettings,
  onNeedModels,
  onOpenSettings,
  onCheckClaude,
  checking,
  onStart,
  onClose
}: Props): React.JSX.Element {
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stats = chapterStats(review.base.text);
  const previous = history[0];
  const previousCounts = previous ? historyCounts(previous, reviewPath, review) : null;
  const provider = settings.provider;
  const isOpenAi = provider === 'openai';
  const list = models[provider] ?? [];
  const loading = modelsLoading[provider] === true;
  const stored = modelFor(settings, provider);
  const current = selectedModel(list, stored);
  const hasKey = keyStatus?.configured === true;
  const runtime = runtimes[provider];
  const canStart = isOpenAi ? hasKey && current !== '' : true;
  const planNote = isOpenAi ? null : proPlanNote(runtime?.subscriptionType, current);
  const updateAdvice = isOpenAi
    ? null
    : claudeUpdateAdvice(
        runtime?.cliVersion,
        runtime?.executablePath,
        navigator.userAgent.includes('Windows')
      );

  useEffect(() => {
    call('settings:effective', undefined)
      .then(setPaths)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    onNeedModels(provider);
  }, [provider, onNeedModels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A question asked over this dialog takes Escape for itself. This
      // listener was added first, so it would otherwise close the dialog too.
      if (event.key === 'Escape' && !useApp.getState().confirmSpec) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const update = (patch: Partial<Settings>): void => {
    call('settings:set', patch)
      .then(onApplySettings)
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  const openGuidelines = (): void => {
    setError(null);
    call('guidelines:open', { via: 'default' }).catch((err: unknown) => setError(errorMessage(err)));
  };

  const modelPlaceholder =
    isOpenAi && !hasKey ? 'add a key first' : loading ? 'loading models…' : 'no models';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Review with AI">
      <div className="modal">
        <h2>Review with AI</h2>
        <p className="modal__hint">
          {stats.paragraphs} paragraph{stats.paragraphs === 1 ? '' : 's'}, {stats.words.toLocaleString()} word
          {stats.words === 1 ? '' : 's'}. Nothing is written to the chapter: every suggestion comes back for
          you to accept or dismiss.
        </p>
        {error ? <p className="modal__hint modal__hint--error">{error}</p> : null}

        <div className="modal__row">
          <span>Provider</span>
          <select
            aria-label="Provider"
            value={provider}
            onChange={(event) => update({ provider: event.target.value as Provider })}
          >
            {PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
          <span />
        </div>

        {isOpenAi ? (
          <>
            <div className="modal__row">
              <span>API key</span>
              <span
                className={`modal__path ${hasKey ? '' : 'modal__path--warn'}`}
                data-testid="openai-key-line"
              >
                {openAiKeyLine(keyStatus)}
              </span>
              <span className="modal__buttons">
                <button type="button" onClick={onOpenSettings}>
                  Open Settings
                </button>
              </span>
            </div>
            <p className="modal__note">
              Billed per token to the OpenAI account the key belongs to, not to a ChatGPT subscription.
            </p>
          </>
        ) : null}

        <div className="modal__row">
          <span>Model</span>
          <select
            aria-label="Model"
            value={current}
            disabled={list.length === 0 && stored === ''}
            onChange={(event) => update(modelPatch(provider, event.target.value))}
          >
            {list.length === 0 && stored === '' ? <option value="">{modelPlaceholder}</option> : null}
            {modelOptions(list, stored).map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          <span />
        </div>
        {planNote ? (
          <p className="modal__note" data-testid="pro-plan-note">
            {planNote}
          </p>
        ) : null}
        {updateAdvice ? (
          <div className="modal__warn modal__warn--stack" role="note" data-testid="claude-update-note">
            <span>
              Claude Code {updateAdvice.installed} is out of date, so it may not offer the newest models.
              Version {updateAdvice.recommended} or newer is recommended. To update it, run this in a
              terminal, then check again:
            </span>
            <Command text={updateAdvice.command} />
            {updateAdvice.fullPathCommand ? (
              <>
                <span className="modal__note">
                  If the terminal does not recognise <code>claude</code>, use this instead:
                </span>
                <Command text={updateAdvice.fullPathCommand} />
              </>
            ) : null}
            <span className="modal__buttons">
              <button type="button" disabled={checking} onClick={onCheckClaude}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
            </span>
          </div>
        ) : null}
        {runtime?.state === 'ready' && runtime.message && isOpenAi ? (
          <p className="modal__note">{runtime.message}</p>
        ) : null}

        <div className="modal__row">
          <span>Effort</span>
          <select
            aria-label="Effort"
            value={settings.effort}
            onChange={(event) => update({ effort: event.target.value as EffortLevel })}
          >
            {EFFORT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
          <span />
        </div>
        {isOpenAi ? (
          <p className="modal__note" data-testid="openai-effort-note">
            Sent as OpenAI reasoning effort &quot;{toOpenAiEffort(settings.effort)}&quot;. The API accepts all
            five levels, so xhigh and max are passed through rather than lowered, but not every model supports
            them; if the model refuses, the error says so and a lower effort will work.
          </p>
        ) : null}

        <div className="modal__row">
          <span>Guidelines</span>
          <span className="modal__path">{paths?.guidelinesPath ?? 'choose a manuscript folder first'}</span>
          <span className="modal__buttons">
            <button type="button" disabled={!paths?.guidelinesPath} onClick={openGuidelines}>
              Open
            </button>
          </span>
        </div>

        <p className="modal__note">
          {previous && previousCounts
            ? `Last reviewed ${historyWhen(previous.createdAt)}:${previousCounts.hunkCount} suggestion${
                previousCounts.hunkCount === 1 ? '' : 's'
              }, ${previousCounts.pendingCount} still pending. A new review replaces the working set; the old one stays in History.`
            : 'This chapter has not been reviewed yet.'}
        </p>

        {/* The model reads the chapter file, not the page, and its result
            replaces the working set. Accepted changes that never reached the
            file would drop out of view (they stay in History), and the model
            would suggest fixes for text the author already fixed. */}
        {unsavedDecisions > 0 ? (
          <div className="modal__warn" role="alert">
            <span>
              {unsavedDecisions} decision{unsavedDecisions === 1 ? ' is' : 's are'} not saved to the chapter
              yet. The review reads the chapter file, so save first to have{' '}
              {unsavedDecisions === 1 ? 'it' : 'them'} included.
            </span>
            <button type="button" disabled={saving} onClick={onSaveFirst}>
              {saving ? 'Saving…' : 'Save to chapter'}
            </button>
          </div>
        ) : null}

        <div className="modal__actions">
          {isOpenAi && !hasKey ? (
            <span className="modal__hint" style={{ margin: 0 }}>
              Start is disabled until an OpenAI key is available.
            </span>
          ) : null}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canStart} onClick={onStart}>
            Start review
          </button>
        </div>
      </div>
    </div>
  );
}
