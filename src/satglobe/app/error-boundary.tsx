import { Component, type ReactNode } from 'react';
import { Icon } from './icon';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort boundary around the SatGlobe shell. React unmounts the entire
 * tree on an uncaught render error, so without this boundary a single bad
 * catalog record would blank every panel with no recovery path. The fallback
 * mirrors the engine-failure presentation and offers a reload.
 */
export class SatGlobeErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  /** Captures the render-time error that unmounted the subtree. */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /** Renders the children until a render error swaps in the recovery panel. */
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="sg-engine-loading sg-engine-error" data-testid="shell-error" role="alert">
          <Icon name="info" />
          <strong>The SatGlobe interface hit an unexpected error</strong>
          <small>{this.state.error.message}</small>
          <button onClick={() => window.location.reload()} type="button">Reload</button>
        </div>
      );
    }

    return this.props.children;
  }
}
