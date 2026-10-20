import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** what shows in place of the children once drawing them has failed */
  fallback: ReactNode;
  /** the error and the components it happened in, for the log */
  onError: (error: unknown, componentStack: string | null | undefined) => void;
}

interface State {
  failed: boolean;
  /** an error in the fallback itself, thrown again from this boundary's render so it goes past it */
  fatal: { error: unknown } | null;
}

/**
 * Around the whole app (hardening.4): when drawing the page fails, React
 * takes down everything under the nearest boundary, which without one is
 * the whole window, left blank. This one shows `fallback` instead, which
 * writes what the page holds and offers Reload window and Copy diagnostics
 * (`CrashFallback`). There is no way back but a reload: the page's state may
 * be what made it fail.
 *
 * It catches once. React hands a boundary any error under it in a render
 * where it has not already caught one, so an error in the fallback on a
 * later render (when its writes end, when its report comes, when it asks a
 * question) would be caught here again and the fallback drawn afresh, which
 * writes again, takes the close guard again and asks main for the report
 * again; an error that comes back on that render would go round for good.
 * So an error after the first is thrown again from this boundary's own
 * render, which React never hands to the boundary itself: it goes on to the
 * root's `onUncaughtError`, which is logged and leaves the bare page (C.81).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, fatal: null };

  /** The first error has been caught and handed on. */
  private caught = false;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (this.caught) {
      this.setState({ fatal: { error } });
      return;
    }
    this.caught = true;
    this.props.onError(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.fatal) throw this.state.fatal.error;
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
