import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey?: string;
  /** Replaces the default card, e.g. to fall back from a 3-D chart to a 2-D one. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps one failing part from blanking the app; offers a retry. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div role="alert" className="glass mx-auto mt-10 max-w-lg rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold text-risk">This view hit a problem</p>
        <p className="mt-2 text-xs text-slate-400">{error.message}</p>
        <button type="button" onClick={this.reset}
          className="mt-4 rounded-lg border border-line bg-ink-800 px-3 py-1.5 text-sm text-slate-200 hover:border-line-strong">
          Try again
        </button>
      </div>
    );
  }
}
