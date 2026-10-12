// Agent sessions, newest first. Each opens
// into its commits, with "Undo session", which reverts them as new commits,
// and "Trust for an hour", which lifts the soft limits but not the refusals.

import { useEffect, useRef, useState } from "react";

import type { CommitInfo, SessionInfo, Undone } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { CommitRow } from "./CommitRow";
import { changesLeft, clock, sessionCommits, sessionSpan, undoneIds } from "./group";
import { message, useReview } from "./store";
import { BUTTON, Callout, ClientBadge, ConfirmBar, Empty, Pill } from "./ui";
import { count } from "./words";

const TRUST_MINUTES = 60;

/** A session asked for from elsewhere ("See in History"), and when. */
export interface SessionFocus {
  id: string;
  at: number;
}

interface SessionsProps {
  sessions: SessionInfo[];
  /** The history list, for each session's commits. */
  commits: CommitInfo[];
  /** Reads the lists again after a change. */
  onChanged(): Promise<void>;
  /** The session to open and scroll to. */
  focus?: SessionFocus | null;
}

export function SessionsTab({ sessions, commits, onChanged, focus = null }: SessionsProps) {
  if (sessions.length === 0) {
    return (
      <Empty icon="agent" title="No agent sessions yet">
        When Claude Code or another agent works on your notes through KastenFlow's MCP server, each connection shows up here with everything it changed.
      </Empty>
    );
  }
  const undone = undoneIds(commits);
  return (
    <ul className="mt-3 space-y-2">
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} commits={commits} undone={undone} onChanged={onChanged} focus={focus?.id === session.id ? focus : null} />
      ))}
    </ul>
  );
}

export type Outcome = Undone | { error: string };

interface RowProps {
  session: SessionInfo;
  commits: CommitInfo[];
  undone: Set<string>;
  onChanged(): Promise<void>;
  focus: SessionFocus | null;
}

function SessionRow({ session, commits, undone, onChanged, focus }: RowProps) {
  const [open, setOpen] = useState(focus !== null);
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    row.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"undo" | "trust" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [trustedUntil, setTrustedUntil] = useState<number | null>(null);
  const own = sessionCommits(commits, session.id);
  const left = changesLeft(session, commits);

  const undo = async () => {
    const { client, refresh } = useWorkspace.getState();
    if (!client) return;
    setAsking(false);
    setBusy("undo");
    try {
      setOutcome(await client.undoSession(session.id));
    } catch (err) {
      setOutcome({ error: message(err) });
    }
    setBusy(null);
    await onChanged();
    void refresh();
    void useReview.getState().refresh();
  };

  const trust = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    setBusy("trust");
    try {
      await client.trustSession(session.id, TRUST_MINUTES);
      setTrustedUntil(Date.now() + TRUST_MINUTES * 60_000);
      toast(`Trusted this ${session.client} session for an hour: its soft limits are lifted, the refusals still apply`);
    } catch (err) {
      toast(message(err));
    }
    setBusy(null);
    void useReview.getState().refresh();
  };

  return (
    <li ref={row} className={`rounded-lg border bg-canvas shadow-(--kr-shadow) ${focus ? "border-(--kasten-agent)" : "border-line"}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3.5 py-2.5 text-left transition-colors hover:bg-panel/60">
        <ClientBadge client={session.client} />
        <span className="text-13">{sessionSpan(session.started, session.last)}</span>
        <span className="text-13 text-muted">{count(session.commits, "change")}</span>
        {session.undone && <Pill>Undone</Pill>}
        {trustedUntil && <Pill tone="ok">Trusted until {clock(trustedUntil)}</Pill>}
        <Icon name="chevron" className={`ml-auto size-3.5 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line px-3.5 pb-3.5 pt-2">
          {own.length > 0 ? (
            <ul className="-mx-1.5 space-y-px">
              {own.map((commit) => (
                <CommitRow key={commit.id} commit={commit} undone={undone.has(commit.id)} author={false} />
              ))}
            </ul>
          ) : (
            <p className="py-1 text-13 text-muted">Its changes are older than the ones the Changes tab has loaded.</p>
          )}

          {outcome && (
            <div className="mt-3">
              <UndoOutcome outcome={outcome} />
            </div>
          )}

          {asking ? (
            <div className="mt-3">
              <ConfirmBar
                title="Undo this session?"
                detail={`Reverts this session's ${count(left, "change")} as new commits. Later edits you made are kept; if one conflicts the undo stops and tells you.`}
                confirm="Undo session"
                onConfirm={() => void undo()}
                onCancel={() => setAsking(false)}
              />
            </div>
          ) : (
            !session.undone && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={BUTTON} disabled={busy !== null || left === 0} onClick={() => setAsking(true)}>
                  <Icon name="undo" className="size-4" />
                  {busy === "undo" ? "Undoing…" : "Undo session"}
                </button>
                <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => void trust()}>
                  <Icon name="review" className="size-4" />
                  {trustedUntil ? "Trust for another hour" : "Trust for an hour"}
                </button>
              </div>
            )
          )}
          {!session.undone && !asking && (
            <p className="mt-2 text-12 leading-snug text-muted">
              Trusting lifts this session's soft limits for an hour: how much of a note one edit may remove, how many notes it may change in 10 minutes and how many it may
              trash. The refusals stay: locked notes, templates, hidden folders and oversized writes.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** What an undo did: all reverted, or where it stopped and why. A chat
 * shows the undo of its session with it too. */
export function UndoOutcome({ outcome }: { outcome: Outcome }) {
  const notes = useWorkspace((s) => s.notes);
  const openPath = useWorkspace((s) => s.openPath);
  if ("error" in outcome) {
    return (
      <Callout tone="bad" icon="alert" role="alert">
        The undo did not run: {outcome.error}
      </Callout>
    );
  }
  const { reverted, conflict } = outcome;
  if (!conflict) {
    return (
      <Callout tone="ok" role="status">
        Reverted {count(reverted.length, "change")}.
      </Callout>
    );
  }
  const exists = notes.some((n) => n.path === conflict.path);
  return (
    <Callout tone="warn" icon="alert" role="alert">
      <p>
        <span className="font-medium">The undo stopped at “{conflict.summary}”</span>
        {reverted.length > 0 ? `, after reverting ${count(reverted.length, "change")}.` : "."}
      </p>
      <p className="mt-1">
        <code className="font-mono text-12">{conflict.path}</code>: {conflict.detail}
      </p>
      {exists && (
        <button type="button" className={`${BUTTON} mt-2`} onClick={() => openPath(conflict.path)}>
          Open the note
        </button>
      )}
    </Callout>
  );
}
