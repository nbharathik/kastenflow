// Below a thread whose session changed the vault: undo everything the chat
// did (after asking), or look at it in History. Undo reverts the session's
// commits newest first as new commits, as the History view's "Undo
// session" does, and shows what it did the same way. Under every thread, the
// switch for how its writes reach the vault: held back as staged changes to
// review (the default), or made at once ("Apply directly").

import "../../review/review.css";
import "../changes/changes.css";

import { useState } from "react";

import { Icon } from "../../../ui/Icon";
import { UndoOutcome, type Outcome } from "../../review/SessionsTab";
import { useReview } from "../../review/store";
import { ConfirmBar } from "../../review/ui";
import { deckFilesChanged } from "../../slides/events";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import type { Thread } from "../thread";
import { useChatLinks } from "./links";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The decks the thread's tools changed, so an open one takes the undo in (the browser preview has no file watcher to tell it). */
const decksOf = (thread: Thread): string[] => [
  ...new Set(thread.messages.flatMap((m) => (m.role === "assistant" ? m.parts.flatMap((p) => (p.kind === "tool" && p.result?.ok ? p.result.paths : [])) : [])).filter((p) => p.endsWith(".deck"))),
];

/** How the thread's writes reach the vault. */
function WriteSwitch({ thread }: { thread: Thread }) {
  const direct = Boolean(thread.direct);
  return (
    <div className="kasten-chat-direct">
      <label>
        <input type="checkbox" checked={direct} disabled={thread.streaming} onChange={(event) => useChat.getState().setDirect(thread.id, event.target.checked)} />
        Apply directly
      </label>
      <span>{direct ? "Changes are saved as the chat makes them." : "Changes wait for you to review and apply them."}</span>
    </div>
  );
}

export function SessionBar({ thread }: { thread: Thread }) {
  return (
    <>
      <Undo thread={thread} />
      <WriteSwitch thread={thread} />
    </>
  );
}

function Undo({ thread }: { thread: Thread }) {
  const links = useChatLinks();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const session = thread.session;
  // A new answer while asking puts the question away: the chat may change
  // more, and the undo would not take that in.
  if (asking && thread.streaming) setAsking(false);
  if (!thread.changed || !session) return null;

  const undo = async () => {
    const { client, refresh } = useWorkspace.getState();
    if (!client || useChat.getState().threads[thread.id]?.streaming) return;
    setAsking(false);
    setBusy(true);
    try {
      const undone = await client.undoSession(session);
      setOutcome(undone);
      if (!undone.conflict) useChat.getState().undone(thread.id);
    } catch (err) {
      setOutcome({ error: message(err) });
    }
    setBusy(false);
    deckFilesChanged(decksOf(thread));
    await refresh();
    void useReview.getState().refresh();
  };

  return (
    <section className="kasten-chat-session" aria-label="This chat's changes">
      {outcome && <UndoOutcome outcome={outcome} />}
      {asking ? (
        <ConfirmBar
          title="Undo this chat's changes?"
          detail="Reverts everything this chat's session changed, newest first, as new commits. Edits you made since are kept; if one conflicts, the undo stops and says where."
          confirm="Undo changes"
          onConfirm={() => void undo()}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <div className="kasten-chat-session-bar">
          <Icon name="agent" className="size-4" />
          <span className="kasten-chat-session-text">{thread.undone ? "This chat's changes were undone." : "This chat changed your notes."}</span>
          {!thread.undone && (
            <button type="button" disabled={busy || thread.streaming} onClick={() => setAsking(true)} title={thread.streaming ? "Wait for the answer to finish" : undefined}>
              <Icon name="undo" className="size-3.5" />
              {busy ? "Undoing…" : "Undo this chat's changes"}
            </button>
          )}
          <button type="button" onClick={() => links.showSession(session)}>
            <Icon name="history" className="size-3.5" />
            See in History
          </button>
        </div>
      )}
    </section>
  );
}
