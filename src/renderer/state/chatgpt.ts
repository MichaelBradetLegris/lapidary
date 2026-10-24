import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatGptStatus } from '../../shared/ipc';
import {
  SIGN_IN_POLL_MS,
  chatGptWaiting,
  failedOutcome,
  pollsForSignIn,
  signInFailureOutcome,
  signOutOutcome,
  type ChatGptOutcome
} from '../../shared/ui/chatgpt';
import { ApiError, call, errorMessage } from './client';

/**
 * The page's side of Sign in with ChatGPT (codex.2, PLAN 5.7): main's
 * status, the sign-in the page started and is waiting on, and what the last
 * sign-in, sign-out or change said. Main does the work and keeps the tokens;
 * the page only asks, through the `chatgpt:` channels, and is told the status
 * (`ChatGptStatus`), never a token or an id. What it shows is decided in
 * `src/shared/ui/chatgpt.ts` (`chatGptWaiting`, `pollsForSignIn`,
 * `signInFailureOutcome`, `signOutOutcome`), where it is tested;
 * test/renderer/chatgptState.test.ts pins how this hook uses them.
 */

export interface ChatGptController {
  /** null until main has answered */
  status: ChatGptStatus | null;
  /** a sign-in is waiting for the browser, this page's or one main had before the page loaded */
  waiting: boolean;
  /** a sign-out, or a change to the data settings box, is under way */
  busy: boolean;
  outcome: ChatGptOutcome | null;
  /** open OpenAI's page; `another` registers the app anew, for another account */
  signIn: (another?: boolean) => void;
  cancelSignIn: () => void;
  signOut: () => void;
  setDataSettingsConfirmed: (confirmed: boolean) => void;
  openDataControls: () => void;
  /** ChatGPT's usage settings, OpenAI's Manage usage (codex.3) */
  openUsage: () => void;
  /** ask main for the status again, as after a review found the sign-in gone (codex.3) */
  refresh: () => void;
  /**
   * Say `outcome` under the view's buttons, as a review that found no
   * sign-in, or the box not ticked, does when it opens the view (codex.3)
   */
  say: (outcome: ChatGptOutcome) => void;
}

export function useChatGpt(): ChatGptController {
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ChatGptOutcome | null>(null);
  /* Only the newest sign-in's answer counts: a new one, from this page or
     after Cancel, replaces the one before, which then fails as cancelled. */
  const ticket = useRef(0);

  const refresh = useCallback(() => {
    void call('chatgpt:status', undefined)
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(refresh, [refresh]);

  /* A sign-in this page did not start, as after a reload while one waited:
     main says it is waiting, and only asking again tells when it ends. */
  const polling = pollsForSignIn(signingIn, status);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(refresh, SIGN_IN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  /* Sign in, Sign out, the box and Open Data controls each start by clearing
     the line under the buttons, so it says how the last of them went, never
     an earlier failure (codex.2 review). */
  const signIn = useCallback(
    (another = false) => {
      const mine = ++ticket.current;
      setOutcome(null);
      setSigningIn(true);
      call('chatgpt:sign-in', { another })
        .then((next) => {
          if (mine === ticket.current) setStatus(next);
        })
        .catch((err: unknown) => {
          if (mine !== ticket.current) return;
          // A cancelled sign-in, by Cancel or a new one, says nothing.
          setOutcome(signInFailureOutcome(err instanceof ApiError ? err.code : null, errorMessage(err)));
          refresh();
        })
        .finally(() => {
          if (mine === ticket.current) setSigningIn(false);
        });
    },
    [refresh]
  );

  const cancelSignIn = useCallback(() => {
    void call('chatgpt:cancel-sign-in', undefined)
      .catch(() => undefined)
      .finally(refresh);
  }, [refresh]);

  const signOut = useCallback(() => {
    setOutcome(null);
    setBusy(true);
    call('chatgpt:sign-out', undefined)
      .then(({ status: next, revoked }) => {
        setStatus(next);
        setOutcome(signOutOutcome(revoked));
      })
      .catch((err: unknown) => setOutcome(failedOutcome(errorMessage(err))))
      .finally(() => setBusy(false));
  }, []);

  const setDataSettingsConfirmed = useCallback(
    (confirmed: boolean) => {
      setOutcome(null);
      setBusy(true);
      call('chatgpt:confirm-data-settings', { confirmed })
        .then(setStatus)
        .catch((err: unknown) => {
          setOutcome(failedOutcome(errorMessage(err)));
          refresh();
        })
        .finally(() => setBusy(false));
    },
    [refresh]
  );

  const openDataControls = useCallback(() => {
    setOutcome(null);
    void call('shell:open-external', { page: 'chatgpt-data-controls' }).catch((err: unknown) =>
      setOutcome(failedOutcome(errorMessage(err)))
    );
  }, []);

  const openUsage = useCallback(() => {
    setOutcome(null);
    void call('shell:open-external', { page: 'chatgpt-usage' }).catch((err: unknown) =>
      setOutcome(failedOutcome(errorMessage(err)))
    );
  }, []);

  return {
    status,
    waiting: chatGptWaiting(signingIn, status),
    busy,
    outcome,
    signIn,
    cancelSignIn,
    signOut,
    setDataSettingsConfirmed,
    openDataControls,
    openUsage,
    refresh,
    say: setOutcome
  };
}
