import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiProgressEvent,
  ConnectionTestResult,
  ModelInfo,
  RateLimitInfo,
  RuntimeStatus
} from '../../shared/ipc';
import { PROMPT_PARAGRAPH_BASE, fromPromptNumbering } from '../../shared/prompt/chapter';
import { guidelinesFingerprint } from '../../shared/prompt/system';
import { createAiReview, toChangeCategory } from '../../shared/review';
import { PROVIDERS, modelFor, type Provider, type Review, type Settings } from '../../shared/types';
import {
  failureSetupEvent,
  focusRecheckDue,
  nextLastFailure,
  testSetupEvent,
  type ConnectionTestOutcome,
  type LastFailure,
  type SetupViewId
} from '../../shared/ui/setup';
import { ApiError, call } from './client';

/**
 * Everything the renderer knows about the AI providers: whether each can run,
 * which models each offers, and the one review that may be running. Phase 5c
 * generalised this from a Claude-only hook; the provider is always named
 * explicitly, so nothing here can quietly send a Claude model name to ChatGPT
 * or the other way round.
 */
export interface AiController {
  runtimes: Partial<Record<Provider, RuntimeStatus>>;
  models: Partial<Record<Provider, ModelInfo[]>>;
  /** true while the model list for that provider is being fetched */
  modelsLoading: Partial<Record<Provider, boolean>>;
  /**
   * Main's words for why a provider's model list could not be fetched, until
   * it is asked for again. Such a list is left unfetched rather than kept as
   * empty, so Try again, and the next opening of Review with AI, ask again
   * (codex.3 review).
   */
  modelsError: Partial<Record<Provider, string>>;
  checking: boolean;
  running: boolean;
  /** which provider the running review belongs to */
  runningProvider: Provider | null;
  /** Date.now() when the running request was sent, for the elapsed counter */
  startedAt: number;
  progress: AiProgressEvent | null;
  /** Claude Code's last usage notice (setup.9) */
  rateLimit: RateLimitInfo | null;
  /** the ChatGPT plan's last usage notice, from its reviews' answers (codex.3) */
  chatGptRateLimit: RateLimitInfo | null;
  /**
   * The latest usage notice, at once: a notice that arrived just before a
   * failed review may not be drawn yet when the failure is handled, and the
   * card for a usage limit reads which limit it was (setup.9, `usageLimitCard`).
   */
  latestRateLimit: () => RateLimitInfo | null;
  /** the ChatGPT plan's latest notice, at once, for the card of a review that reached a limit (codex.3) */
  latestChatGptRateLimit: () => RateLimitInfo | null;
  /** the last Claude failure that says something about setup (setup.5, nextLastFailure) */
  lastFailure: LastFailure | null;
  /**
   * ChatGPT's last failure, moved as Claude's is (`nextLastFailure`): the
   * status bar says "ChatGPT: usage limit reached" while it is a usage limit,
   * until a review goes through or the sign-in changes (codex.3)
   */
  chatGptLastFailure: LastFailure | null;
  /** providers whose connection test is running (setup.8) */
  testing: Partial<Record<Provider, boolean>>;
  /** each provider's last finished connection test, kept for the rest of the run */
  testOutcomes: Partial<Record<Provider, ConnectionTestOutcome>>;
  /**
   * Test the connection: one very small request (setup.8). Resolves with the
   * answer, or null when a test of that provider is running already. A
   * Claude test that went through clears the last failure, as a review that
   * went through does; one that did not is remembered (`testSetupEvent`).
   */
  testConnection: (provider: Provider) => Promise<ConnectionTestResult | null>;
  /** check a provider's runtime; its model list is fetched again when ready, unless `fetchModels` is false */
  check: (provider: Provider, fetchModels?: boolean) => void;
  /**
   * The window came back to the front: check Claude again when Setup has
   * something for the author to do, Claude is in use, and the last check
   * started at least 3 s ago (setup.7, `focusRecheckDue`).
   */
  recheckOnFocus: (claudeInUse: boolean, view: SetupViewId) => void;
  /** fetch a provider's model list if it is ready and has not been fetched yet, nor failed */
  ensureModels: (provider: Provider) => void;
  /** fetch a provider's model list again, after it failed: Try again, or Review with AI opening again */
  retryModels: (provider: Provider) => void;
  /**
   * The ChatGPT sign-in changed, on the Setup screen's ChatGPT view or after
   * a review found it had ended (codex.3): check its runtime again, which only
   * reads a file, forget its model list, or why it could not be fetched,
   * which belongs to the account and is fetched again when the dialog next
   * shows ChatGPT, and forget its last failure.
   */
  chatGptAccountChanged: () => void;
  cancel: () => void;
  runReview: (review: Review, settings: Settings) => Promise<Review>;
}

let counter = 0;

function newRequestId(): string {
  counter += 1;
  return `req-${Date.now().toString(36)}-${counter}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `record` without `provider`'s entry. */
function without<T>(record: Partial<Record<Provider, T>>, provider: Provider): Partial<Record<Provider, T>> {
  if (!(provider in record)) return record;
  const rest = { ...record };
  delete rest[provider];
  return rest;
}

export function useAi(): AiController {
  const [runtimes, setRuntimes] = useState<Partial<Record<Provider, RuntimeStatus>>>({});
  const [models, setModels] = useState<Partial<Record<Provider, ModelInfo[]>>>({});
  const [modelsLoading, setModelsLoading] = useState<Partial<Record<Provider, boolean>>>({});
  const [modelsError, setModelsError] = useState<Partial<Record<Provider, string>>>({});
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningProvider, setRunningProvider] = useState<Provider | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [progress, setProgress] = useState<AiProgressEvent | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [chatGptRateLimit, setChatGptRateLimit] = useState<RateLimitInfo | null>(null);
  const [lastFailure, setLastFailure] = useState<LastFailure | null>(null);
  const [chatGptLastFailure, setChatGptLastFailure] = useState<LastFailure | null>(null);
  const [testing, setTesting] = useState<Partial<Record<Provider, boolean>>>({});
  const [testOutcomes, setTestOutcomes] = useState<Partial<Record<Provider, ConnectionTestOutcome>>>({});
  const testsRunning = useRef(new Set<Provider>());
  const claudeRuntime = useRef<RuntimeStatus | null>(null);
  const activeRequest = useRef<string | null>(null);
  /* When the last check of Claude started, and how many are running, for
     the re-check as the window comes back to the front (setup.7). */
  const claudeCheckAt = useRef<number | null>(null);
  const claudeChecking = useRef(0);
  /* The usage notice as it arrives, kept beside the state for the usage-limit
     card (setup.9): every notice is written to both. */
  const rateLimitNow = useRef<RateLimitInfo | null>(null);
  const latestRateLimit = useCallback(() => rateLimitNow.current, []);
  const chatGptRateLimitNow = useRef<RateLimitInfo | null>(null);
  const latestChatGptRateLimit = useCallback(() => chatGptRateLimitNow.current, []);

  /* A ChatGPT model list that finds the sign-in gone, or ended, has its
     runtime checked again, which then says not signed in (codex.3). */
  const recheckSignedOut = useRef<() => void>(() => undefined);

  /* A list that fails is left unfetched, with main's words for why, never
     kept as an empty one: an empty list stood for the rest of the run, so one
     failure, offline or a server error, left the provider with no model and
     Start review disabled with nothing said (codex.3 review). The words stay
     while it is asked for again, so what shows them, and its Try again, stay
     in place until the answer. A ChatGPT sign-in that has gone is the
     exception: its runtime check then says not signed in, which empties the
     list as for any provider not ready. */
  const loadModels = useCallback((provider: Provider) => {
    setModelsLoading((prev) => ({ ...prev, [provider]: true }));
    void call('ai:models', { provider })
      .then((list) => {
        setModels((prev) => ({ ...prev, [provider]: list }));
        setModelsError((prev) => without(prev, provider));
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'chatgpt-not-signed-in') {
          setModels((prev) => ({ ...prev, [provider]: [] }));
          setModelsError((prev) => without(prev, provider));
          recheckSignedOut.current();
          return;
        }
        setModels((prev) => without(prev, provider));
        setModelsError((prev) => ({ ...prev, [provider]: messageOf(err) }));
      })
      .finally(() => setModelsLoading((prev) => ({ ...prev, [provider]: false })));
  }, []);

  /* Claude's list comes with its runtime check, as it always has. ChatGPT's is
     a network call on the author's sign-in, so it waits until the review
     dialog actually shows ChatGPT (ensureModels), and is forgotten whenever
     the sign-in changes (chatGptAccountChanged). */
  const apply = useCallback(
    (status: RuntimeStatus, fetchModels: boolean) => {
      setRuntimes((prev) => ({ ...prev, [status.provider]: status }));
      if (status.provider === 'claude') {
        claudeRuntime.current = status;
        setLastFailure((prev) => nextLastFailure(prev, { type: 'check', runtime: status }));
      }
      if (status.provider === 'chatgpt') {
        setChatGptLastFailure((prev) => nextLastFailure(prev, { type: 'check', runtime: status }));
      }
      if (status.state !== 'ready') {
        setModels((prev) => ({ ...prev, [status.provider]: [] }));
        setModelsError((prev) => without(prev, status.provider));
      } else if (fetchModels) loadModels(status.provider);
    },
    [loadModels]
  );

  /* Not after a failure, or every draw of the dialog would ask again:
     retryModels does that, once as the dialog opens and on Try again. */
  const ensureModels = useCallback(
    (provider: Provider) => {
      if (models[provider] !== undefined || modelsLoading[provider]) return;
      if (modelsError[provider] !== undefined) return;
      if (runtimes[provider]?.state !== 'ready') return;
      loadModels(provider);
    },
    [models, modelsLoading, modelsError, runtimes, loadModels]
  );

  const retryModels = useCallback(
    (provider: Provider) => {
      if (modelsLoading[provider]) return;
      if (runtimes[provider]?.state === 'ready') loadModels(provider);
      else setModelsError((prev) => without(prev, provider));
    },
    [modelsLoading, runtimes, loadModels]
  );

  const check = useCallback(
    (provider: Provider, fetchModels = true) => {
      setChecking(true);
      if (provider === 'claude') {
        claudeCheckAt.current = Date.now();
        claudeChecking.current += 1;
      }
      call('ai:runtime', { provider })
        .then((status) => apply(status, fetchModels))
        .catch((err: unknown) => {
          apply({ provider, state: 'error', message: messageOf(err) }, false);
        })
        .finally(() => {
          if (provider === 'claude') claudeChecking.current -= 1;
          setChecking(false);
        });
    },
    [apply]
  );

  const recheckOnFocus = useCallback(
    (claudeInUse: boolean, view: SetupViewId) => {
      const due = focusRecheckDue({
        view,
        claudeInUse,
        inFlight: claudeChecking.current > 0,
        lastCheckAt: claudeCheckAt.current,
        now: Date.now()
      });
      if (due) check('claude');
    },
    [check]
  );

  const chatGptAccountChanged = useCallback(() => {
    setModels((prev) => without(prev, 'chatgpt'));
    setModelsError((prev) => without(prev, 'chatgpt'));
    setChatGptLastFailure(null);
    check('chatgpt', false);
  }, [check]);
  useEffect(() => {
    recheckSignedOut.current = () => check('chatgpt', false);
  }, [check]);

  /* Startup: the Claude runtime check as before (plan 5.6), plus the ChatGPT
     sign-in's (codex.3), which costs nothing because it only reads a local
     file. ChatGPT's model list is fetched only when the review dialog shows
     it. */
  useEffect(() => {
    let alive = true;
    for (const provider of PROVIDERS) {
      if (provider === 'claude') {
        claudeCheckAt.current = Date.now();
        claudeChecking.current += 1;
      }
      call('ai:runtime', { provider })
        .then((status) => {
          if (alive) apply(status, provider === 'claude');
        })
        .catch((err: unknown) => {
          if (alive) apply({ provider, state: 'error', message: messageOf(err) }, false);
        })
        .finally(() => {
          if (provider === 'claude') claudeChecking.current -= 1;
        });
    }
    return () => {
      alive = false;
    };
  }, [apply]);

  useEffect(() => {
    if (typeof window.api?.on !== 'function') return;
    const offProgress = window.api.on('ai:progress', (event) => {
      if (event.requestId === activeRequest.current) setProgress(event);
    });
    const offRate = window.api.on('ai:rate-limit', (info) => {
      // A ChatGPT plan's notice is kept apart, so it never reads as Claude's (codex.3).
      if (info.provider === 'chatgpt') {
        chatGptRateLimitNow.current = info;
        setChatGptRateLimit(info);
        return;
      }
      rateLimitNow.current = info;
      setRateLimit(info);
    });
    return () => {
      offProgress();
      offRate();
    };
  }, []);

  const testConnection = useCallback(async (provider: Provider): Promise<ConnectionTestResult | null> => {
    if (testsRunning.current.has(provider)) return null;
    testsRunning.current.add(provider);
    setTesting((prev) => ({ ...prev, [provider]: true }));
    let result: ConnectionTestResult;
    try {
      result = await call('ai:test', { provider });
    } catch (err) {
      // Main answers a failed test; only the bridge itself can throw here.
      result = {
        ok: false,
        durationMs: 0,
        error:
          err instanceof ApiError
            ? { code: err.code, message: err.message }
            : { code: 'unknown', message: messageOf(err) }
      };
    } finally {
      testsRunning.current.delete(provider);
    }
    if (result.rateLimit) {
      rateLimitNow.current = result.rateLimit;
      setRateLimit(result.rateLimit);
    }
    if (provider === 'claude') {
      const event = testSetupEvent(result, claudeRuntime.current);
      if (event) setLastFailure((prev) => nextLastFailure(prev, event));
    }
    setTestOutcomes((prev) => ({ ...prev, [provider]: { result, finishedAt: new Date().toISOString() } }));
    setTesting((prev) => ({ ...prev, [provider]: false }));
    return result;
  }, []);

  const cancel = useCallback(() => {
    const id = activeRequest.current;
    if (!id) return;
    void call('ai:cancel', { requestId: id }).catch(() => undefined);
  }, []);

  /**
   * Run one review with the provider named in Settings and return a fresh
   * Review anchored onto the same base. The caller decides what to do with it,
   * so a failed call never disturbs the review already on screen.
   */
  const runReview = useCallback(async (review: Review, settings: Settings): Promise<Review> => {
    const provider = settings.provider;
    const requestId = newRequestId();
    activeRequest.current = requestId;
    setStartedAt(Date.now());
    setRunning(true);
    setRunningProvider(provider);
    setProgress({ requestId, provider, phase: 'starting' });

    try {
      const guidelines = await call('guidelines:ensure', undefined);
      const response = await call('ai:review', {
        requestId,
        provider,
        sourcePath: review.sourcePath,
        text: review.base.text,
        model: modelFor(settings, provider),
        effort: settings.effort,
        guidelines: guidelines.text
      });

      if (response.rateLimit?.provider === 'chatgpt') {
        chatGptRateLimitNow.current = response.rateLimit;
        setChatGptRateLimit(response.rateLimit);
      } else if (response.rateLimit) {
        rateLimitNow.current = response.rateLimit;
        setRateLimit(response.rateLimit);
      }
      if (provider === 'claude') setLastFailure((prev) => nextLastFailure(prev, { type: 'success' }));
      if (provider === 'chatgpt') setChatGptLastFailure(null);

      // The model was shown paragraphs numbered from 1; the app counts from 0.
      const output = fromPromptNumbering({ changes: response.changes, comments: response.comments });

      return createAiReview({
        sourcePath: review.sourcePath,
        base: review.base,
        changes: output.changes.map((change) => ({
          paragraph: change.paragraph,
          before: change.before,
          after: change.after,
          category: toChangeCategory(change.category),
          reason: change.reason
        })),
        comments: output.comments,
        raw: response.raw,
        generator: {
          kind: response.provider,
          provider: response.provider,
          ...(response.model ? { model: response.model } : {}),
          effort: settings.effort,
          guidelinesHash: guidelinesFingerprint(guidelines.text),
          ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
          ...(response.usage === undefined ? {} : { usage: response.usage }),
          ...(response.durationMs === undefined ? {} : { durationMs: response.durationMs }),
          ...(response.sessionId ? { sessionId: response.sessionId } : {}),
          ...(response.fallbackNote ? { fallbackNote: response.fallbackNote } : {}),
          paragraphBase: PROMPT_PARAGRAPH_BASE
        }
      });
    } catch (err) {
      if (provider === 'claude' && err instanceof ApiError && err.code !== 'cancelled') {
        /* Read now, with the notice that came before the failure, as the
           usage-limit card reads it, so Setup says what that card says
           (setup.9 review). */
        const event = failureSetupEvent(err.code, err.message, rateLimitNow.current, claudeRuntime.current);
        setLastFailure((prev) => nextLastFailure(prev, event));
      }
      if (provider === 'chatgpt' && err instanceof ApiError && err.code !== 'cancelled') {
        // Kept for the status bar's "usage limit reached" (codex.3).
        const failed = failureSetupEvent(err.code, err.message, null, null);
        setChatGptLastFailure((prev) => nextLastFailure(prev, failed));
      }
      throw err;
    } finally {
      activeRequest.current = null;
      setRunning(false);
      setRunningProvider(null);
      setProgress(null);
    }
  }, []);

  return {
    runtimes,
    models,
    modelsLoading,
    modelsError,
    checking,
    running,
    runningProvider,
    startedAt,
    progress,
    rateLimit,
    chatGptRateLimit,
    latestRateLimit,
    latestChatGptRateLimit,
    lastFailure,
    chatGptLastFailure,
    testing,
    testOutcomes,
    testConnection,
    check,
    recheckOnFocus,
    ensureModels,
    retryModels,
    chatGptAccountChanged,
    cancel,
    runReview
  };
}
