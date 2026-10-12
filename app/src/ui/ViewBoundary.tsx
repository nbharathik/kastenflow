// A view that fails while drawing shows what went wrong, with a way to try
// again, instead of taking the whole window down with it. Going elsewhere
// (a new `place`) clears the problem without remounting what works: a page
// renamed or switched keeps its editor. Details name the components it
// happened in, and copy everything a bug report needs.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Where the view is; a new one starts afresh. */
  place: string;
  /** A way out when trying again fails the same way, such as forgetting a
   * saved layout that no longer draws. */
  reset?: { label: string; run(): void };
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** The place the error happened in. */
  at: string;
  /** React's component stack for the error, innermost first. */
  stack: string | null;
  copied: boolean;
}

/** The components in a React component stack, innermost first: "HistoryTab ‹ RightPanel". */
export function componentsOf(stack: string | null, most = 5): string[] {
  const names = [...(stack ?? "").matchAll(/^\s*at ([A-Z][\w$.]*)/gm)].map((m) => m[1]!);
  return names.filter((name, i) => name !== names[i - 1]).slice(0, most);
}

export class ViewBoundary extends Component<Props, State> {
  override state: State = { error: null, at: this.props.place, stack: null, copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)), copied: false };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.place === state.at) return null;
    return { error: null, at: props.place, stack: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`The view at “${this.props.place}” failed:`, error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private copy = (error: Error) => {
    const report = [`KastenFlow: the view at “${this.props.place}” failed`, "", error.stack ?? String(error), "", "Components:", (this.state.stack ?? "").trim(), "", navigator.userAgent].join("\n");
    void navigator.clipboard?.writeText(report).then(
      () => this.setState({ copied: true }),
      () => {},
    );
  };

  override render() {
    const { error, stack, copied } = this.state;
    if (!error) return this.props.children;
    const components = componentsOf(stack);
    return (
      <div role="alert" className="mx-auto mt-24 flex max-w-md flex-col items-center gap-3 px-6 text-center">
        <p className="text-16 font-semibold">This view ran into a problem</p>
        <p className="text-13 leading-relaxed text-muted">{error.message}</p>
        <div className="flex items-center gap-2">
          <button type="button" className="h-8 rounded-lg bg-accent px-3.5 text-13 font-semibold text-on-accent" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.reset && (
            <button type="button" className="h-8 rounded-lg border border-line px-3.5 text-13 font-medium text-ink hover:bg-hover" onClick={this.props.reset.run}>
              {this.props.reset.label}
            </button>
          )}
        </div>
        <details className="mt-2 w-full text-left text-13 text-muted">
          <summary className="cursor-pointer text-center">Details</summary>
          {components.length > 0 && <p className="mt-2 break-words font-mono text-12">In {components.join(" ‹ ")}</p>}
          <button type="button" className="mt-2 rounded-md border border-line px-2.5 py-1 text-13 text-ink hover:bg-hover" onClick={() => this.copy(error)}>
            {copied ? "Copied" : "Copy details"}
          </button>
        </details>
      </div>
    );
  }
}
