import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps one failing page from blanking the whole app; offers a retry. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="glass mx-auto mt-10 max-w-lg rounded-2xl p-6 text-center">
        <p className="text-sm font-semibold text-risk">This view hit a problem</p>
        <p className="mt-2 text-xs text-slate-400">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-lg border border-line bg-ink-800 px-3 py-1.5 text-sm text-slate-200 hover:border-line-strong">
          Try again
        </button>
      </div>
    );
  }
}
