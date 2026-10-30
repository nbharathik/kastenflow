// Home's "Agents today": for each agent session that changed something today,
// who it is (a routine's own name), how many changes and notes, what waits
// for you, and Undo. Your own edits are never in it. Off until asked for in
// Customize, and loaded only then; the History view has the same changes
// under "Today by agents".

import { useCallback, useEffect, useRef, useState } from "react";

import type { Digest, DigestSession } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { DashCard, DashEmpty } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { clock } from "../review/group";
import { showSession } from "../review/session-request";
import { message, useReview } from "../review/store";
import { TODAY_BY_AGENTS } from "../review/today-by-agents";
import { ClientBadge, Pill } from "../review/ui";
import { count } from "../review/words";
import { useWorkspace } from "../workspace/store";
import { changeLine, notesLine, startOfToday, waitingLine } from "./agents-today";

export function AgentsToday() {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(0);

  const load = useCallback(async () => {
    if (!client) return;
    const read = ++reads.current;
    try {
      const found = await client.activityDigest(startOfToday());
      if (read !== reads.current) return;
      setDigest(found);
      setError(null);
    } catch (err) {
      if (read !== reads.current) return;
      setError(message(err));
    }
  }, [client]);

  // Agents write while Home is open: read again when the notes change.
  useEffect(() => {
    void load();
  }, [load, notes]);
  useEffect(() => () => void (reads.current += 1), []);

  const seeAll = <SeeAll label="History" run={() => useWorkspace.getState().go({ view: "history", path: TODAY_BY_AGENTS })} />;
  const sessions = digest?.sessions ?? [];
  return (
    <DashCard title="Agents today" icon="agent" count={sessions.length} actions={seeAll}>
      {error ? (
        <DashEmpty>
          Could not read what agents did: {error}{" "}
          <button type="button" className="kasten-dash-link" onClick={() => void load()}>
            Try again
          </button>
        </DashEmpty>
      ) : digest === null ? (
        <DashEmpty>Looking at today's changes…</DashEmpty>
      ) : sessions.length === 0 ? (
        <DashEmpty>No agent changes today</DashEmpty>
      ) : (
        <ul className="kasten-agent-list">
          {sessions.map((session) => (
            <AgentRow key={session.id} session={session} onChanged={load} />
          ))}
        </ul>
      )}
    </DashCard>
  );
}

function AgentRow({ session, onChanged }: { session: DigestSession; onChanged(): Promise<void> }) {
  const notes = useWorkspace((s) => s.notes);
  const [busy, setBusy] = useState(false);
  const touched = notesLine(session, notes);
  const waiting = waitingLine(session);

  // Undo takes the whole session back and says what it did; nothing asks "are you sure".
  const undo = async () => {
    const { client, toast, refresh } = useWorkspace.getState();
    if (!client) return;
    setBusy(true);
    try {
      const { reverted, conflict } = await client.undoSession(session.id);
      if (conflict) toast(`The undo stopped at “${conflict.summary}”: ${conflict.detail}`, { label: "See in History", run: () => showSession(session.id) });
      else toast(`Took back ${count(reverted.length, "change")} by ${session.client}`);
    } catch (err) {
      toast(`The undo did not run: ${message(err)}`);
    }
    setBusy(false);
    await onChanged();
    void refresh();
    void useReview.getState().refresh();
  };

  return (
    <li className="kasten-agent-row">
      <div className="kasten-agent-head">
        <ClientBadge client={session.client} />
        <span className="kasten-agent-time">since {clock(session.started)}</span>
        {session.mode === "autonomous" && <Pill title="It worked on its own">On its own</Pill>}
        {session.undone && <Pill>Taken back</Pill>}
      </div>
      <p className="kasten-agent-line">
        {changeLine(session)}
        {waiting && (
          <>
            {" · "}
            <span className="kasten-agent-waiting">{waiting}</span>
          </>
        )}
      </p>
      {touched && (
        <p className="kasten-agent-notes" title={session.notes.join(", ")}>
          {touched}
        </p>
      )}
      <div className="kasten-agent-actions">
        {session.proposalsWaiting > 0 && (
          <Button size="sm" icon="review" aria-label={`Review what ${session.client} is waiting on`} onClick={() => useWorkspace.getState().go({ view: "review" })}>
            Review
          </Button>
        )}
        <Button size="sm" icon="history" aria-label={`See ${session.client} in History`} onClick={() => showSession(session.id)}>
          See in History
        </Button>
        {session.canUndo && (
          <Button size="sm" icon="undo" aria-label={`Undo everything ${session.client} changed`} disabled={busy} onClick={() => void undo()}>
            {busy ? "Undoing…" : "Undo"}
          </Button>
        )}
      </div>
    </li>
  );
}
