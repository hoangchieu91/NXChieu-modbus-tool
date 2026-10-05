import React from 'react';

interface ErrorBoundaryProps {
  /** Name shown in the console, e.g. "Workspace Studio". */
  name: string;
  /** Called once when a render error or lazy chunk load failure is caught. */
  onError: (error: Error) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Keeps a crash in an optional view (lazy Studio, analyzers, phone remote) from unmounting the
 * whole app. The parent decides how to recover (fall back to the classic UI, close a panel).
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.name} crashed:`, error);
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
