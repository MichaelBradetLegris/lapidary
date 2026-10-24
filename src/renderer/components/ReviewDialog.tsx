import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatGptStatus,
  EffectivePaths,
  GuidelinesStatus,
  ModelInfo,
  ReviewSummary,
  RuntimeStatus
} from '../../shared/ipc';
import { defaultIsOpus, proPlanNote } from '../../shared/ai/claudeModels';
import { AI_OUTPUT_NOTICE } from '../../shared/branding';
import { claudeUpdateAdvice } from '../../shared/ai/claudeStatus';
import { CHATGPT_EMPTY_MODEL_LIST, chatGptAccountLine, chatGptStartBlocker } from '../../shared/ui/chatgpt';
import { LIST_MODELS_AGAIN, NO_MODEL_BLOCKER, modelListFailedText } from '../../shared/ui/models';
import { reviewDialogWarning, type LastFailure } from '../../shared/ui/setup';
import { chapterStats, reviewSizeAdvice } from '../../shared/text/stats';
import { historyCounts, historyWhen } from '../../shared/ui/history';
import { REVIEW_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import { reviewStartLabels, reviewStartNote } from '../../shared/ui/save';
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
import { heldButton } from '../state/heldButton';
import { modelOptions, selectedModel } from '../state/models';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
import { DataSettingsWarning } from './DataSettingsWarning';
import { GuidelinesRow } from './Guidelines';
import { UpdateNote } from './UpdateNote';

interface Props {
  review: Review;
  settings: Settings;
  models: Partial<Record<Provider, ModelInfo[]>>;
  modelsLoading: Partial<Record<Provider, boolean>>;
  /** main's words for a model list that could not be fetched, by provider (codex.3 review) */
  modelsError?: Partial<Record<Provider, string>>;
  runtimes: Partial<Record<Provider, RuntimeStatus>>;
  /** newest first; used for the "last reviewed" line */
  history: ReviewSummary[];
  /** the file the review on screen is kept in, so that line counts it from the page (apply.5) */
  reviewPath: string | null;
  /** decisions on the page that the chapter file does not contain yet */
  unsavedDecisions: number;
  /** a Save to chapter is under way */
  saving: boolean;
  /**
   * "Save N changes, then review": save, then start once the file reads like
   * the page (apply.20). When the save does not get there, `onNotSaved` gets
   * the lines the dialog shows about it (apply.20 review).
   */
  onSaveThenStart: (onNotSaved: (lines: string[]) => void) => void;
  /** "Review without them": ask, then start from the chapter file as it is (apply.20) */
  onStartWithout: () => void;
  onApplySettings: (next: Settings) => void;
  /** fetch a provider's model list the first time it is shown */
  onNeedModels: (provider: Provider) => void;
  /** fetch a provider's model list again after it failed: Try again, and once as the dialog opens */
  onRetryModels?: (provider: Provider) => void;
  /** run the Claude runtime check again, after the author updated Claude Code */
  onCheckClaude: () => void;
  /** true while a runtime check is running */
  checking: boolean;
  /** the last Claude failure that says something about setup, for the warning (setup.7) */
  claudeLastFailure: LastFailure | null;
  /** close this dialog and open the Setup screen (setup.7) */
  onOpenSetup: () => void;
  /** the ChatGPT sign-in (codex.2), null until main has answered */
  chatgpt?: ChatGptStatus | null;
  /** a ChatGPT sign-in waits for the browser */
  chatgptWaiting?: boolean;
  /** close this dialog and open the Setup screen's ChatGPT view (codex.3) */
  onOpenChatGptSetup?: () => void;
  /** tick or clear the signed-in account's data settings box (5.7 item 7) */
  onConfirmDataSettings?: (confirmed: boolean) => void;
  /** ChatGPT's Data controls in the browser */
  onOpenDataControls?: () => void;
  onStart: () => void;
  onClose: () => void;
}

/**
 * Everything a review run needs, asked once, where it is being decided (item 6).
 *
 * Model and effort are settings, so they persist. The provider select swaps the
 * model list (Phase 5c). For ChatGPT (codex.3) the rows are Claude's with the
 * account added, with Open Setup while not signed in, and, while the account's
 * data settings box is not ticked, the training warning with the box, which
 * the first review needs: Start stays disabled until there is a sign-in and
 * the box is ticked. No other words of ChatGPT's own: OpenAI's "Using ChatGPT
 * plan" with Manage usage and the note on how the effort is sent went in
 * codex.5, at the author's word, the first to the ChatGPT view's status card
 * (ChatGptSetup). A model list that could not be fetched says why under the
 * Model row, with Try again, and is asked for again as the dialog next opens
 * (codex.3 review).
 */
export function ReviewDialog({
  review,
  settings,
  models,
  modelsLoading,
  modelsError = {},
  runtimes,
  history,
  reviewPath,
  unsavedDecisions,
  saving,
  onSaveThenStart,
  onStartWithout,
  onApplySettings,
  onNeedModels,
  onRetryModels,
  onCheckClaude,
  checking,
  claudeLastFailure,
  onOpenSetup,
  chatgpt = null,
  chatgptWaiting = false,
  onOpenChatGptSetup,
  onConfirmDataSettings,
  onOpenDataControls,
  onStart,
  onClose
}: Props): React.JSX.Element {
  const [paths, setPaths] = useState<EffectivePaths | null>(null);
  const [guidelines, setGuidelines] = useState<GuidelinesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* What a save that did not reach the chapter file said. Its cards sit under
     this dialog's backdrop, so the dialog says it instead (apply.20 review). */
  const [notSaved, setNotSaved] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const stats = chapterStats(review.base.text);
  const sizeAdvice = reviewSizeAdvice(stats.words);
  const previous = history[0];
  const previousCounts = previous ? historyCounts(previous, reviewPath, review) : null;
  const provider = settings.provider;
  const isChatGpt = provider === 'chatgpt';
  /* The training warning and the box, before the first ChatGPT review (5.7
     item 7): shown while the account's box is not ticked, and kept for the
     rest of this opening once the box has been ticked in it, so a box ticked
     from the keyboard keeps its place and its focus. */
  const needsBox = isChatGpt && chatgpt?.dataSettingsConfirmed !== true;
  const [tickedHere, setTickedHere] = useState(false);
  const showTrainingWarning = isChatGpt && (needsBox || tickedHere);
  const confirmDataSettings = (confirmed: boolean): void => {
    setTickedHere(true);
    onConfirmDataSettings?.(confirmed);
  };
  /* Open Setup stands beside the account only while there is no sign-in
     (codex.5): signed in, the row says so and nothing more, as Claude's
     rows do. */
  const accountSetup = isChatGpt && chatgpt?.signedIn !== true && onOpenChatGptSetup !== undefined;
  const chatGptBlocker = isChatGpt ? chatGptStartBlocker(chatgpt) : null;
  const list = models[provider] ?? [];
  const loading = modelsLoading[provider] === true;
  const stored = modelFor(settings, provider);
  const current = selectedModel(list, stored);
  const runtime = runtimes[provider];
  const canStart = isChatGpt ? chatGptBlocker === null && current !== '' : true;
  /* A list that could not be fetched says why under the Model row, with Try
     again, and so does a ChatGPT list that came back empty; Start, which
     waits for a model, then says so beside it (codex.3 review). Both stay
     while the list is asked for again, Try again held, so a press keeps the
     focus on it until the answer. */
  const listFailure = modelsError[provider];
  const listEmpty = isChatGpt && chatgpt?.signedIn === true && models.chatgpt?.length === 0;
  const listNote =
    listFailure !== undefined
      ? modelListFailedText(provider, listFailure)
      : listEmpty
        ? CHATGPT_EMPTY_MODEL_LIST
        : null;
  const modelBlocker =
    !loading && current === '' && isChatGpt && chatGptBlocker === null ? NO_MODEL_BLOCKER : null;
  const labels = reviewStartLabels(unsavedDecisions);
  const note = reviewStartNote(unsavedDecisions);
  const showNotSaved = notSaved.length > 0 && unsavedDecisions > 0;
  const saveThenStart = (): void => {
    setNotSaved([]);
    onSaveThenStart(setNotSaved);
  };
  const isClaude = provider === 'claude';
  const planNote = isClaude ? proPlanNote(runtime?.subscriptionType, current, defaultIsOpus(list)) : null;
  const claudeWarning = isClaude ? reviewDialogWarning(runtime, claudeLastFailure) : null;
  const updateAdvice = !isClaude
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

  /* Each provider's list is fetched the first time the dialog shows it. One
     that failed before is asked for once more as this opening first shows
     that provider, and then only by Try again: never on every draw (codex.3
     review). */
  const shown = useRef(new Set<Provider>());
  const failedBefore = modelsError[provider] !== undefined;
  useEffect(() => {
    const first = !shown.current.has(provider);
    shown.current.add(provider);
    if (first && failedBefore && onRetryModels) onRetryModels(provider);
    else onNeedModels(provider);
  }, [provider, failedBefore, onNeedModels, onRetryModels]);

  /* Once the list arrives, the box with Try again goes, and with it a focus
     left on its button: the Model select takes it, or the dialog's box while
     the select has nothing to offer. */
  const modelSelect = useRef<HTMLSelectElement>(null);
  const hadListNote = useRef(listNote !== null);
  useEffect(() => {
    if (hadListNote.current && listNote === null && document.activeElement === document.body) {
      const select = modelSelect.current;
      (select && !select.disabled ? select : boxRef.current)?.focus();
    }
    hadListNote.current = listNote !== null;
  }, [listNote]);

  /* A sign-in that ends its wait while the dialog is open, one started on
     the Setup screen before it, takes Open Setup away: a focus left on it
     goes to the dialog's box, so the keyboard carries on inside it. */
  const hadAccountSetup = useRef(accountSetup);
  useEffect(() => {
    if (hadAccountSetup.current && !accountSetup && document.activeElement === document.body) {
      boxRef.current?.focus();
    }
    hadAccountSetup.current = accountSetup;
  }, [accountSetup]);

  /* Escape closes it, as in Settings (ui.1). A question asked over it, such
     as "Review without them", takes Escape for itself. The focus goes into
     its box as it opens and back to the toolbar's Review menu when it closes,
     and the page behind it is inert meanwhile, so Tab stays inside it (ui.4,
     `polish.7`). */
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, REVIEW_BUTTON_SELECTOR);

  const update = (patch: Partial<Settings>): void => {
    call('settings:set', patch)
      .then(onApplySettings)
      .catch((err: unknown) => setError(errorMessage(err)));
  };

  /* Whether the style sheet is still empty (setup.10b): read as the dialog
     opens, after Open or Open folder, either of which may create the file,
     and whenever the window gets the focus back, as when the author returns
     from filling it in. A status that cannot be read shows no note; starting
     the review says what is wrong with the file. */
  const readGuidelines = useCallback((): void => {
    call('guidelines:status', undefined).then(setGuidelines, () => setGuidelines(null));
  }, []);

  useEffect(() => {
    readGuidelines();
    window.addEventListener('focus', readGuidelines);
    return () => window.removeEventListener('focus', readGuidelines);
  }, [readGuidelines]);

  const openGuidelines = (): void => {
    setError(null);
    call('guidelines:open', undefined).then(
      () => readGuidelines(),
      (err: unknown) => setError(errorMessage(err))
    );
  };

  // Main creates the file from the template first when it is missing (polish.3).
  const openGuidelinesFolder = (): void => {
    setError(null);
    call('shell:reveal', { target: 'guidelines' }).then(
      () => readGuidelines(),
      (err: unknown) => setError(errorMessage(err))
    );
  };

  const modelPlaceholder =
    isChatGpt && chatgpt?.signedIn !== true ? 'sign in first' : loading ? 'loading models…' : 'no models';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Review with AI">
      <div className="modal" ref={boxRef} tabIndex={-1}>
        <h2>Review with AI</h2>
        <p className="modal__hint">
          {stats.paragraphs} paragraph{stats.paragraphs === 1 ? '' : 's'}, {stats.words.toLocaleString()} word
          {stats.words === 1 ? '' : 's'}. Nothing is written to the chapter: every suggestion comes back for
          you to accept or dismiss.
        </p>
        {/* A long chapter takes longer and costs more; a very long one may not
            fit in one reply (files.10, PLAN 5.5). */}
        {sizeAdvice?.level === 'warn' ? (
          <div className="modal__warn" role="note" data-testid="review-size-advice">
            <span>{sizeAdvice.text}</span>
          </div>
        ) : sizeAdvice ? (
          <p className="modal__note" data-testid="review-size-advice">
            {sizeAdvice.text}
          </p>
        ) : null}
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

        {/* ChatGPT, on the plan (codex.3): the account, with the way to its
            Setup view while not signed in, and the training warning before
            the first review. Nothing else of ChatGPT's own (codex.5). */}
        {isChatGpt ? (
          <>
            <div className="modal__row modal__row--account">
              <span>Account</span>
              <span
                className={`modal__path ${chatgpt?.signedIn ? '' : 'modal__path--warn'}`}
                data-testid="chatgpt-account-line"
              >
                {chatGptAccountLine(chatgpt, chatgptWaiting)}
              </span>
              <span className="modal__buttons">
                {accountSetup ? (
                  <button type="button" onClick={onOpenChatGptSetup}>
                    Open Setup
                  </button>
                ) : null}
              </span>
            </div>
            {showTrainingWarning && onConfirmDataSettings && onOpenDataControls ? (
              <DataSettingsWarning
                status={chatgpt}
                onOpenDataControls={onOpenDataControls}
                onConfirm={confirmDataSettings}
                headingLevel={3}
              />
            ) : null}
          </>
        ) : null}

        <div className="modal__row">
          <span>Model</span>
          <select
            ref={modelSelect}
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
        {listNote ? (
          <div className="modal__warn" role="alert" data-testid="model-list-failed">
            <span>{listNote}</span>
            {onRetryModels ? (
              <button type="button" {...heldButton(loading, () => onRetryModels(provider))}>
                {LIST_MODELS_AGAIN}
              </button>
            ) : null}
          </div>
        ) : null}
        {planNote ? (
          <p className="modal__note" data-testid="pro-plan-note">
            {planNote}
          </p>
        ) : null}
        {/* Claude is the provider and Setup has something to say, but nothing
            the check found stops a review: the dialog opens with a warning
            and Open Setup rather than Setup itself (setup.7, 11.3 f). An
            out-of-date Claude Code has its commands in Setup then. */}
        {claudeWarning ? (
          <div className="modal__warn" role="note" data-testid="claude-setup-warning">
            <span>{claudeWarning}</span>
            <button type="button" onClick={onOpenSetup}>
              Open Setup
            </button>
          </div>
        ) : updateAdvice ? (
          <UpdateNote advice={updateAdvice} checking={checking} onCheckAgain={onCheckClaude} />
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

        <GuidelinesRow
          path={paths?.guidelinesPath ?? null}
          status={guidelines}
          onOpen={openGuidelines}
          onOpenFolder={openGuidelinesFolder}
        />

        <p className="modal__note">
          {previous && previousCounts
            ? `Last reviewed ${historyWhen(previous.createdAt)}: ${previousCounts.hunkCount} suggestion${
                previousCounts.hunkCount === 1 ? '' : 's'
              }, ${previousCounts.pendingCount} still pending. A new review replaces the working set; the old one stays in History.`
            : 'This chapter has not been reviewed yet.'}
        </p>

        {/* The model reads the chapter file, not the page, and its result
            replaces the working set. Changes that never reached the file
            would stay behind in the old review, out of sight in History, and
            the model would suggest fixes for text the author already fixed.
            So the blue button saves them first, and starting without them
            asks (apply.20). When that save does not reach the file, this box
            says why instead, in the save's own words. */}
        {showNotSaved ? (
          <div className="modal__warn modal__warn--stack modal__warn--error" role="alert">
            {notSaved.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </div>
        ) : note ? (
          <div className="modal__warn" role="alert">
            <span>{note}</span>
          </div>
        ) : null}

        {/* Labels never break inside a button; zoomed in, the last buttons
            move to a second row, as in the confirm dialog. */}
        <div className="modal__actions modal__actions--confirm">
          {chatGptBlocker ? (
            <span className="modal__hint" style={{ margin: 0 }} data-testid="chatgpt-start-blocker">
              {chatGptBlocker}
            </span>
          ) : modelBlocker ? (
            <span className="modal__hint" style={{ margin: 0 }} data-testid="model-start-blocker">
              {modelBlocker}
            </span>
          ) : null}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {labels.secondary ? (
            <button type="button" disabled={!canStart || saving} onClick={onStartWithout}>
              {labels.secondary}
            </button>
          ) : null}
          <button
            type="button"
            className="primary"
            disabled={!canStart || saving}
            onClick={unsavedDecisions > 0 ? saveThenStart : onStart}
          >
            {saving ? 'Saving…' : labels.primary}
          </button>
        </div>
        {/* The caution that goes with every review (release.9), under Start review. */}
        <p className="modal__note modal__ai-notice" data-testid="ai-output-notice">
          {AI_OUTPUT_NOTICE}
        </p>
      </div>
    </div>
  );
}
