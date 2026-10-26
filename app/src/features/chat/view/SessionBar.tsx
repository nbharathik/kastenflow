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
import type { Undone, VaultClient } from "../../../lib/vault/types";
import { UndoOutcome, type Outcome } from "../../review/SessionsTab";
import { ASK_OVER, changesInSession, undoTheUndo } from "../../review/session-undo";
import { useReview } from "../../review/store";
import { ConfirmBar } from "../../review/ui";
import { useAgentMode } from "../../agents/store";
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
  // How much agents may do decides first: Review everything always holds the chat's changes,
  // Autonomous never does, and between them the thread's own switch applies.
  const mode = useAgentMode((s) => s.view?.active);
  const direct = mode === "autonomous" ? true : mode === "review" ? false : Boolean(thread.direct);
  const saying =
    mode === "review"
      ? "Review everything is on, so changes wait for you to review and apply them."
      : mode === "autonomous"
        ? "Autonomous agents are on, so changes are saved as the chat makes them."
        : direct
          ? "Changes are saved as the chat makes them."
          : "Changes wait for you to review and apply them.";
  return (
    <div className="kasten-chat-direct">
      <label>
        <input type="checkbox" checked={direct} disabled={thread.streaming || mode === "review" || mode === "autonomous"} onChange={(event) => useChat.getState().setDirect(thread.id, event.target.checked)} />
        Apply directly
      </label>
      <span>{saying}</span>
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
  /** How many changes the question names; null when it is not asked. */
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const session = thread.session;
  // A new answer while asking puts the question away: the chat may change
  // more, and the undo would not take that in.
  if (asking !== null && thread.streaming) setAsking(null);
  if (!thread.changed || !session) return null;

  const run = async (act: (client: VaultClient) => Promise<Undone>, whenDone: (undone: Undone) => void) => {
    const { client, refresh } = useWorkspace.getState();
    if (!client || useChat.getState().threads[thread.id]?.streaming) return;
    setAsking(null);
    setBusy(true);
    try {
      const undone = await act(client);
      setOutcome(undone);
      if (!undone.conflict) whenDone(undone);
    } catch (err) {
      setOutcome({ error: message(err) });
    }
    setBusy(false);
    deckFilesChanged(decksOf(thread));
    await refresh();
    void useReview.getState().refresh();
  };

  const undo = () =>
    run(
      (client) => client.undoSession(session),
      () => useChat.getState().undone(thread.id),
    );

  // A few changes are undone at once, with a way back; many are counted first.
  const start = async () => {
    const client = useWorkspace.getState().client;
    if (!client) return;
    let left = Number.POSITIVE_INFINITY;
    try {
      left = await changesInSession(client, session);
    } catch {
      // Not knowing how many there are, ask.
    }
    if (left > ASK_OVER) setAsking(Number.isFinite(left) ? left : 0);
    else void undo();
  };

  const redo = (reverted: readonly string[]) =>
    run(
      (client) => undoTheUndo(client, reverted),
      () => {
        useChat.getState().undone(thread.id, false);
        setOutcome(null);
        useWorkspace.getState().toast("Put this chat's changes back");
      },
    );

  const reverted = outcome && !("error" in outcome) && !outcome.conflict && thread.undone ? outcome.reverted : null;

  return (
    <section className="kasten-chat-session" aria-label="This chat's changes">
      {outcome && <UndoOutcome outcome={outcome} />}
      {reverted && reverted.length > 0 && (
        <div className="kasten-chat-session-bar">
          <button type="button" disabled={busy} onClick={() => void redo(reverted)}>
            <Icon name="undo" className="size-3.5" />
            Undo the undo
          </button>
        </div>
      )}
      {asking !== null ? (
        <ConfirmBar
          title={asking > 0 ? `Undo ${asking} changes from this chat?` : "Undo this chat's changes?"}
          detail="Puts back everything this chat changed, newest first. Edits you made since are kept; if one conflicts, the undo stops and says where. You can take it back with Undo the undo."
          confirm="Undo changes"
          onConfirm={() => void undo()}
          onCancel={() => setAsking(null)}
        />
      ) : (
        <div className="kasten-chat-session-bar">
          <Icon name="agent" className="size-4" />
          <span className="kasten-chat-session-text">{thread.undone ? "This chat's changes were undone." : "This chat changed your notes."}</span>
          {!thread.undone && (
            <button type="button" disabled={busy || thread.streaming} onClick={() => void start()} title={thread.streaming ? "Wait for the answer to finish" : undefined}>
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
