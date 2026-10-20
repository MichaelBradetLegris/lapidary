import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagnosticsCopyState } from '../../shared/ui/diagnostics';
import { call, errorMessage } from './client';

/** The report and its Copy, for `DiagnosticsPanel`. */
export interface DiagnosticsReportState {
  /** the report as main wrote it, or null while it is gathered */
  text: string | null;
  /** why it could not be gathered */
  error: string | null;
  copyState: DiagnosticsCopyState;
  /** put the report on screen on the clipboard */
  copy: () => void;
  /** ask main again, after a failure */
  retry: () => void;
}

/**
 * Copy diagnostics' report (hardening.5), for the Diagnostics dialog and the
 * page shown after a crash (hardening.4). It asks main once as it mounts
 * (`app:diagnostics`), which runs no check of Claude or OpenAI, and only the
 * latest answer is kept, so the text on screen is the text copied: each
 * report has its own time, and a development run's StrictMode asks twice.
 * With `copyOnOpen` it copies once, when the report first comes in.
 */
export function useDiagnosticsReport(copyOnOpen: boolean): DiagnosticsReportState {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<DiagnosticsCopyState>('idle');
  const copiedOnOpen = useRef(false);

  const latest = useRef(0);
  const fetchReport = useCallback(() => {
    const request = ++latest.current;
    call('app:diagnostics', undefined)
      .then((report) => {
        if (request === latest.current) setText(report.text);
      })
      .catch((err: unknown) => {
        if (request === latest.current) setError(errorMessage(err));
      });
  }, []);

  useEffect(() => {
    fetchReport();
    return () => {
      latest.current += 1;
    };
  }, [fetchReport]);

  const retry = useCallback((): void => {
    setError(null);
    setText(null);
    fetchReport();
  }, [fetchReport]);

  const copyText = useCallback((report: string) => {
    setCopyState('idle');
    navigator.clipboard.writeText(report).then(
      () => setCopyState('copied'),
      () => setCopyState('failed')
    );
  }, []);

  useEffect(() => {
    if (!copyOnOpen || text === null || copiedOnOpen.current) return;
    copiedOnOpen.current = true;
    copyText(text);
  }, [copyOnOpen, text, copyText]);

  const copy = useCallback(() => {
    if (text !== null) copyText(text);
  }, [text, copyText]);

  return { text, error, copyState, copy, retry };
}
