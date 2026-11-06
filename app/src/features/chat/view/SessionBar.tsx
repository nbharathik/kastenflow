// After the latest answer that changed notes: a quiet one-line chip, "Changed
// 3 notes", to undo everything the chat did (after asking) or look at it in
// History. It can be hidden until the chat changes something new, and is not
// there while an answer streams; the thread's "…" menu always offers both.
// Undo reverts the session's
// commits newest first as new commits, as the History view's "Undo
// session" does, and shows what it did the same way. (How a thread's writes
// reach the vault is chosen in the chat's "…" menu: view/WriteMenu.tsx.)

import "../../review/review.css";
import "../changes/changes.css";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../../../ui/Icon";
import type { Undone, VaultClient } from "../../../lib/vault/types";
import { UndoOutcome, type Outcome } from "../../review/SessionsTab";
import { ASK_OVER, changesInSession, undoTheUndo } from "../../review/session-undo";
import { useReview } from "../../review/store";
import { ConfirmBar } from "../../review/ui";
import { deckFilesChanged } from "../../slides/events";
import { useWorkspace } from "../../workspace/store";
import { isAgentProvider } from "../agents/names";
import { useChat } from "../store";
import type { Thread } from "../thread";
import { useChatLinks } from "./links";
import { changedLabel, lastChange, useSessionUi } from "./session-ui";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The decks the thread's tools changed, so an open one takes the undo in (the browser preview has no file watcher to tell it). */
const decksOf = (thread: Thread): string[] => [
  ...new Set(thread.messages.flatMap((m) => (m.role === "assistant" ? m.parts.flatMap((p) => (p.kind === "tool" && p.result?.ok ? p.result.paths : [])) : [])).filter((p) => p.endsWith(".deck"))),
];

export function SessionBar({ thread }: { thread: Thread }) {
  // A coding agent changes notes in a session of its own (its MCP connection), which the chat's undo does
  // not hold: those changes are undone from History, where the agent's sessions are listed.
  return thread.changed && thread.session && !isAgentProvider(thread.provider) ? <Undo thread={thread} session={thread.session} /> : null;
}

function Undo({ thread, session }: { thread: Thread; session: string }) {
  const links = useChatLinks();
  /** How many changes the question names; null when it is not asked. */
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { key, notes } = lastChange(thread);
  const hidden = useSessionUi((s) => s.dismissed[thread.id] === key);
  const asked = useSessionUi((s) => s.undoAsked[thread.id] ?? 0);
  const handled = useRef(asked);
  // A new answer while asking puts the question away: the chat may change
  // more, and the undo would not take that in.
  if (asking !== null && thread.streaming) setAsking(null);

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

  // "Undo this chat's changes" in the thread's "…" menu does what the chip's button does.
  useEffect(() => {
    if (asked === handled.current) return;
    handled.current = asked;
    if (!thread.undone && !thread.streaming && !busy) void start();
    // `start` reads the store and `session`, which a new ask finds as they are.
  }, [asked]);

  const reverted = outcome && !("error" in outcome) && !outcome.conflict && thread.undone ? outcome.reverted : null;
  const chip = !hidden && !thread.streaming && asking === null;
  if (!outcome && !(reverted && reverted.length > 0) && asking === null && !chip) return null;

  return (
    <section className="kasten-chat-session" aria-label="This chat's changes">
      {outcome && <UndoOutcome outcome={outcome} />}
      {reverted && reverted.length > 0 && (
        <div className="kasten-chat-session-chip">
          <button type="button" className="kasten-chat-session-text-button" disabled={busy} onClick={() => void redo(reverted)}>
            <Icon name="undo" className="size-3.5" />
            Undo the undo
          </button>
        </div>
      )}
      {asking !== null && (
        <ConfirmBar
          title={asking > 0 ? `Undo ${asking} changes from this chat?` : "Undo this chat's changes?"}
          detail="Puts back everything this chat changed, newest first. Edits you made since are kept; if one conflicts, the undo stops and says where. You can take it back with Undo the undo."
          confirm="Undo changes"
          onConfirm={() => void undo()}
          onCancel={() => setAsking(null)}
        />
      )}
      {chip && (
        <div className="kasten-chat-session-chip">
          <Icon name="agent" className="size-3.5" />
          <span className="kasten-chat-session-text">{thread.undone ? "Changes undone" : changedLabel(notes)}</span>
          {!thread.undone && (
            <button type="button" className="kasten-chat-session-icon" aria-label="Undo this chat's changes" title={busy ? "Undoing…" : "Undo this chat's changes"} disabled={busy} onClick={() => void start()}>
              <Icon name="undo" className="size-3.5" />
            </button>
          )}
          <button type="button" className="kasten-chat-session-icon" aria-label="See in History" title="See in History" onClick={() => links.showSession(session)}>
            <Icon name="history" className="size-3.5" />
          </button>
          <button type="button" className="kasten-chat-session-icon" aria-label="Hide this" title="Hide this until the chat changes something new" onClick={() => useSessionUi.getState().dismiss(thread.id, key)}>
            <Icon name="close" className="size-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}
