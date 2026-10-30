// Home's "Agents today": a line of totals, then the agent sessions that changed
// something today, the ones waiting on you first. Three show in full (who it
// is, a routine's own name, how many changes and notes, what waits for you,
// and Undo); the rest open in place, a line each. Your own edits are never in
// it. Off until asked for in Customize, and loaded only then; the History view
// has the same changes under "Today by agents".

import "./cards.css";

import { useState } from "react";

import type { DigestSession } from "../../lib/vault/types";
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
import { useAgentDigest } from "./agents-digest";
import { changeLine, notesLine, SESSION_LIMIT, summaryLine, waitingFirst, waitingLine } from "./agents-today";
import { Fold, FoldToggle } from "./Fold";
import { roveKeys } from "./roving";

export function AgentsToday() {
  const { digest, error, reload } = useAgentDigest();
  const [more, setMore] = useState(false);
  const seeAll = <SeeAll label="History" run={() => useWorkspace.getState().go({ view: "history", path: TODAY_BY_AGENTS })} />;
  const sessions = waitingFirst(digest?.sessions ?? []);
  const rest = sessions.slice(SESSION_LIMIT);
  return (
    <DashCard title="Agents today" icon="agent" count={sessions.length} actions={seeAll}>
      {error ? (
        <DashEmpty>
          Could not read what agents did: {error}{" "}
          <button type="button" className="kasten-dash-link" onClick={() => void reload()}>
            Try again
          </button>
        </DashEmpty>
      ) : digest === null ? (
        <div className="kasten-todo-skeleton" aria-hidden="true">
          <span className="kasten-todo-bone" />
          <span className="kasten-todo-bone" />
          <span className="kasten-todo-bone" />
        </div>
      ) : sessions.length === 0 ? (
        <DashEmpty>No agent changes today</DashEmpty>
      ) : (
        <div onKeyDown={roveKeys}>
          <p className="kasten-agent-summary">{summaryLine(digest)}</p>
          <ul className="kasten-agent-list">
            {sessions.slice(0, SESSION_LIMIT).map((session) => (
              <AgentRow key={session.id} session={session} onChanged={reload} />
            ))}
          </ul>
          {rest.length > 0 && (
            <>
              <Fold open={more} id="agents-more">
                <ul className="kasten-agent-list is-compact">
                  {rest.map((session) => (
                    <AgentLine key={session.id} session={session} />
                  ))}
                </ul>
              </Fold>
              <FoldToggle open={more} label={`and ${rest.length} more`} controls="agents-more" onToggle={() => setMore((o) => !o)} />
            </>
          )}
        </div>
      )}
    </DashCard>
  );
}

/** A session past the first three: one line, a click for the rest in History. */
function AgentLine({ session }: { session: DigestSession }) {
  const waiting = waitingLine(session);
  return (
    <li className="kasten-agent-row is-line">
      <button type="button" data-rove="" className="kasten-agent-oneline" title={`${session.client} · ${changeLine(session)}`} aria-label={`See ${session.client} in History`} onClick={() => showSession(session.id)}>
        <ClientBadge client={session.client} />
        <span className="kasten-agent-oneline-text">
          {changeLine(session)}
          {waiting && ` · ${waiting}`}
        </span>
      </button>
    </li>
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

  const waits = session.proposalsWaiting > 0;
  return (
    <li className={`kasten-agent-row${waits ? " is-waiting" : ""}`}>
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
        {waits && (
          <Button size="sm" icon="review" data-rove="" aria-label={`Review what ${session.client} is waiting on`} onClick={() => useWorkspace.getState().go({ view: "review" })}>
            Review
          </Button>
        )}
        <Button size="sm" icon="history" data-rove={waits ? undefined : ""} aria-label={`See ${session.client} in History`} onClick={() => showSession(session.id)}>
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
