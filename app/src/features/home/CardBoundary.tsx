// One of Home's cards that fails while it loads or draws says so in its own
// place, with a way to try again, and the rest of Home carries on.

import { Component, type ReactNode } from "react";

interface Props {
  /** The card's name, for the sentence. */
  name: string;
  children: ReactNode;
}

export class CardBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`Home's ${this.props.name} card failed:`, error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="kasten-home-nothing is-failed">
        <p>The {this.props.name} card could not be drawn.</p>
        <button type="button" className="ui-btn is-sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
