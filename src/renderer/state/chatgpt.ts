import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatGptStatus } from '../../shared/ipc';
import { SIGNED_OUT_NOT_REVOKED, SIGNED_OUT_REVOKED } from '../../shared/ui/chatgpt';
import { ApiError, call, errorMessage } from './client';

/**
 * The page's side of Sign in with ChatGPT (codex.2, PLAN 5.7): main's
 * status, the sign-in the page started and is waiting on, and what the last
 * sign-in, sign-out or change said. Main does the work and keeps the tokens;
 * the page only asks, through the `chatgpt:` channels, and is told the status
 * (`ChatGptStatus`), never a token or an id.
 */

/** A line under the status card's buttons: how the last sign-in or sign-out went. */
export interface ChatGptOutcome {
  tone: 'ok' | 'warn' | 'failed';
  text: string;
}

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
  const waitingElsewhere = status?.signingIn === true && !signingIn;
  useEffect(() => {
    if (!waitingElsewhere) return;
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [waitingElsewhere, refresh]);

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
          if (!(err instanceof ApiError && err.code === 'cancelled')) {
            setOutcome({ tone: 'failed', text: errorMessage(err) });
          }
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
        setOutcome(
          revoked ? { tone: 'ok', text: SIGNED_OUT_REVOKED } : { tone: 'warn', text: SIGNED_OUT_NOT_REVOKED }
        );
      })
      .catch((err: unknown) => setOutcome({ tone: 'failed', text: errorMessage(err) }))
      .finally(() => setBusy(false));
  }, []);

  const setDataSettingsConfirmed = useCallback(
    (confirmed: boolean) => {
      setBusy(true);
      call('chatgpt:confirm-data-settings', { confirmed })
        .then(setStatus)
        .catch((err: unknown) => {
          setOutcome({ tone: 'failed', text: errorMessage(err) });
          refresh();
        })
        .finally(() => setBusy(false));
    },
    [refresh]
  );

  const openDataControls = useCallback(() => {
    void call('shell:open-external', { page: 'chatgpt-data-controls' }).catch((err: unknown) =>
      setOutcome({ tone: 'failed', text: errorMessage(err) })
    );
  }, []);

  return {
    status,
    waiting: signingIn || status?.signingIn === true,
    busy,
    outcome,
    signIn,
    cancelSignIn,
    signOut,
    setDataSettingsConfirmed,
    openDataControls
  };
}
