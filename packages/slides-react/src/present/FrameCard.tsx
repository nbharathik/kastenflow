// What stands over a page that is not showing: a clear sentence about why, a button to open the address outside, and, when the embed has
// a snapshot, a way back to it. Over a page that is loading or ready there is no card; the small "Not showing?" link is always there.

import type { JSX } from "react";

import { type FrameStatus, frameProblem } from "./web-frame.ts";

export interface FrameCardProps {
  status: FrameStatus;
  /** Whether the embed has a snapshot to fall back to. */
  hasSnapshot?: boolean;
  /** Asks to show the snapshot instead of the page. */
  onSnapshot?: (() => void) | undefined;
  /** Opens the address outside the slide. Without it the card is only words (the editor's layer takes no pointer). */
  onOpen?: (() => void) | undefined;
}

export function FrameCard({ status, hasSnapshot = false, onSnapshot, onOpen }: FrameCardProps): JSX.Element | null {
  const sentence = frameProblem(status);
  if (sentence === null) return null;
  return (
    <div className="ks-embed-card" role="status" data-status={status}>
      <p className="ks-embed-card-text">{sentence}</p>
      {onOpen || (hasSnapshot && onSnapshot) ? (
        <div className="ks-embed-card-actions">
          {onOpen ? (
            <button type="button" className="ks-embed-card-btn" onClick={onOpen}>
              Open externally
            </button>
          ) : null}
          {hasSnapshot && onSnapshot ? (
            <button type="button" className="ks-embed-card-btn" onClick={onSnapshot}>
              Show the snapshot
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The link that is always on a live page, for when it is not showing and nothing could tell. */
export function OpenOutside({ onOpen }: { onOpen(): void }): JSX.Element {
  return (
    <button type="button" className="ks-embed-ext" title="Open this page outside the slide" onClick={onOpen}>
      Not showing? Open externally
    </button>
  );
}
