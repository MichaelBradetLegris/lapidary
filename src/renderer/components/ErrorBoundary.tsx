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
}

/**
 * Around the whole app (hardening.4): when drawing the page fails, React
 * takes down everything under the nearest boundary, which without one is
 * the whole window, left blank. This one shows `fallback` instead, which
 * writes what the page holds and offers Reload window and Copy diagnostics
 * (`CrashFallback`). There is no way back but a reload: the page's state may
 * be what made it fail.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError(error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
