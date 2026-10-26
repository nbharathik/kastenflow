import "./review.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HistoryOnlyHere } from "../backup/told-up-front";
import { TODAY_BY_AGENTS } from "./today-by-agents";
import type { Checkpoint, CommitInfo, SessionInfo } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { ChangesTab } from "./ChangesTab";
import { useSessionRequests } from "./session-request";
import { SessionsTab, type SessionFocus } from "./SessionsTab";
import { message } from "./store";
import { Callout } from "./ui";
import { Icon } from "../../ui/Icon";

/** Commits read per batch; "Show more" past them reads another batch. */
const HISTORY_BATCH = 300;
const SESSION_LIMIT = 50;

type Tab = "changes" | "sessions";

const TABS: { id: Tab; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "sessions", label: "Agent sessions" },
];

/** The vault's history: every change, and
 * agent sessions to look through or undo. */
export function History() {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [tab, setTab] = useState<Tab>("changes");
  const [limit, setLimit] = useState(HISTORY_BATCH);
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const reads = useRef(0);
  // Home's "Agents today" opens History on the changes agents made today.
  const asked = useWorkspace((s) => s.place.view === "history" && s.place.path === TODAY_BY_AGENTS);
  const preset = useMemo(() => (asked ? { who: "today" as const, at: Date.now() } : null), [asked]);
  useEffect(() => {
    if (asked) setTab("changes");
  }, [asked]);

  // "See in History" on an agent's writing opens its session here.
  useSessionRequests((id) => {
    setTab("sessions");
    setFocus({ id, at: Date.now() });
  });

  const load = useCallback(async () => {
    if (!client) return;
    const read = ++reads.current;
    try {
      // The restore points are a convenience: not having them never hides the history.
      const [found, runs, points] = await Promise.all([client.history(null, limit), client.sessions(SESSION_LIMIT), Promise.resolve().then(() => client.checkpoints()).catch((): Checkpoint[] => [])]);
      if (read !== reads.current) return;
      setCheckpoints(points);
      setCommits(found);
      setSessions([...runs].sort((a, b) => b.last - a.last || (a.id < b.id ? 1 : -1)));
      setError(null);
    } catch (err) {
      if (read !== reads.current) return;
      setError(message(err));
      setCommits((c) => c ?? []);
      setSessions((s) => s ?? []);
    }
  }, [client, limit]);

  // Reads again when the notes change: agents and other apps write while the view is open.
  useEffect(() => {
    void load();
  }, [load, notes]);

  useEffect(() => () => void (reads.current += 1), []);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 pb-24 pt-10 sm:px-12">
      <h1 className="text-28 font-bold tracking-tight">
        <Icon name="history" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
        History
      </h1>
      <p className="mt-1 text-14 text-muted">Every change to your notes, newest first. Agent work comes in sessions, and each session can be undone in one step.</p>

      <HistoryOnlyHere />

      <div role="tablist" aria-label="History" className="mt-6 flex gap-5 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`history-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`history-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-2 text-13 transition-colors ${tab === t.id ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label}
            {t.id === "sessions" && sessions && sessions.length > 0 && <span className="ml-1.5 text-12 text-muted">{sessions.length}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4">
          <Callout tone="bad" icon="alert" role="alert">
            Could not read the history: {error}
          </Callout>
        </div>
      )}

      <div role="tabpanel" id={`history-panel-${tab}`} aria-labelledby={`history-tab-${tab}`}>
        {commits === null || sessions === null ? (
          <p className="py-10 text-center text-13 text-muted">Reading the history…</p>
        ) : tab === "changes" ? (
          <ChangesTab commits={commits} full={commits.length >= limit} onOlder={() => setLimit((l) => l + HISTORY_BATCH)} preset={preset} />
        ) : (
          <SessionsTab sessions={sessions} commits={commits} checkpoints={checkpoints} onChanged={load} focus={focus} />
        )}
      </div>
    </div>
  );
}
