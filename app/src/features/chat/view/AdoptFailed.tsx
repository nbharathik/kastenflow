// A saved chat that could not be read back: never an empty new thread in its
// place. One sentence says why, and two buttons go on: Retry, or Start a new one.
// The Chat view and the dock open the chat they were asked for; a deck's
// assistant tab, which shows its chat itself, passes what the buttons do.

import "../history.css";

import { useState } from "react";

import { useChat } from "../store";

const WHY = {
  missing: "This chat’s file is missing.",
  damaged: "This chat’s file is damaged. It was set aside, not deleted.",
  newer: "This chat was saved by a newer version of KastenFlow. It was left as it is.",
} as const;

interface Props {
  id: string;
  /** Instead of opening the chat in the panel once it can be read. */
  onRetry?: () => Promise<void>;
  /** Instead of starting a new chat in the panel. */
  onNew?: () => void;
}

export function AdoptFailed({ id, onRetry, onNew }: Props) {
  const failure = useChat((s) => s.adoptFailures[id]);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    try {
      if (onRetry) await onRetry();
      else await useChat.getState().retryOpen(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kasten-chat-failed" role="alert">
      <h2>Couldn’t reopen this chat</h2>
      <p>{failure?.message || WHY[failure?.reason ?? "missing"]}</p>
      <div className="kasten-chat-failed-actions">
        <button type="button" className="ui-btn" disabled={busy} onClick={() => void retry()}>
          {busy ? "Trying…" : "Retry"}
        </button>
        <button
          type="button"
          className="ui-btn"
          onClick={() => {
            if (onNew) onNew();
            // A new chat takes over the page the failed one was tied to; the failed one stays in the list.
            else void useChat.getState().newThreadFrom(id, { open: true });
          }}
        >
          Start a new one
        </button>
      </div>
    </div>
  );
}
