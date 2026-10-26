// Every commit, newest first and grouped by day, a hundred at a time; a
// search and "You" or "Agents" narrow it down.

import { useDeferredValue, useEffect, useMemo, useState } from "react";

import type { CommitInfo } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { describeChange } from "./change-words";
import { CommitRow } from "./CommitRow";
import { groupByDay, undoneIds } from "./group";
import { BUTTON, Empty, QUIET } from "./ui";

/** Commits drawn per page. */
export const PAGE = 100;

export type Who = "all" | "you" | "agents" | "today";

const WHO = [
  { value: "all", label: "All" },
  { value: "you", label: "You" },
  { value: "agents", label: "Agents", icon: "agent" },
  { value: "today", label: "Today by agents", icon: "agent" },
] as const;

/** The commits a search and an author filter keep. "Today by agents" keeps
 * what agents changed since midnight, local time; `now` is for tests. */
export function filterCommits(commits: readonly CommitInfo[], query: string, who: Who, now: Date = new Date()): CommitInfo[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return commits.filter((c) => {
    if ((who === "you" && c.agent) || ((who === "agents" || who === "today") && !c.agent)) return false;
    if (who === "today" && c.time < midnight) return false;
    if (words.length === 0) return true;
    const change = describeChange(c.summary);
    const text = `${change.subject} ${change.action ?? ""} ${change.detail ?? ""} ${c.author}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

interface ChangesProps {
  commits: CommitInfo[];
  /** The list stopped at its limit, so older commits may exist. */
  full: boolean;
  /** Asks for older commits than the list holds. */
  onOlder(): void;
  /** A filter asked for from elsewhere (Home's "Agents today"): it is chosen when it arrives. */
  preset?: { who: Who; at: number } | null;
}

export function ChangesTab({ commits, full, onOlder, preset = null }: ChangesProps) {
  const [shown, setShown] = useState(PAGE);
  const [query, setQuery] = useState("");
  const [who, setWho] = useState<Who>(preset?.who ?? "all");
  useEffect(() => {
    if (preset) setWho(preset.who);
  }, [preset]);
  const typed = useDeferredValue(query);
  const kept = useMemo(() => filterCommits(commits, typed, who), [commits, typed, who]);
  const groups = useMemo(() => groupByDay(kept.slice(0, shown), (c) => c.time), [kept, shown]);
  const undone = useMemo(() => undoneIds(commits), [commits]);

  if (commits.length === 0) {
    return (
      <Empty icon="history" title="No changes yet">
        Every edit is kept as a version once history is on. Your changes and your agents' show up here.
      </Empty>
    );
  }
  const filtered = typed.trim() !== "" || who !== "all";
  const more = kept.length > shown || full;
  return (
    <div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 focus-within:border-accent">
          <Icon name="search" className="size-4 shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a change: a note, a word, an agent"
            aria-label="Find a change"
            className="min-w-0 flex-1 bg-transparent text-13 outline-none placeholder:text-muted"
          />
        </label>
        <Segmented label="Made by" value={who} choices={WHO} onChange={setWho} />
      </div>
      {filtered && kept.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 text-center text-13 text-muted">
          <p>{who === "today" && typed.trim() === "" ? "No agent changes today" : full ? "No changes match in the ones read so far." : "No changes match."}</p>
          <div className="flex gap-2">
            {full && who !== "today" && (
              <button type="button" className={BUTTON} onClick={onOlder}>
                Look further back
              </button>
            )}
            <button
              type="button"
              className={QUIET}
              onClick={() => {
                setQuery("");
                setWho("all");
              }}
            >
              Clear the filter
            </button>
          </div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.day} aria-label={group.label} className="mt-5 first:mt-3">
            <h2 className="sticky top-0 z-10 -mx-2 bg-canvas px-2 py-1.5 text-12 font-medium text-muted">{group.label}</h2>
            <ul className="space-y-px">
              {group.items.map((commit) => (
                <CommitRow key={commit.id} commit={commit} undone={undone.has(commit.id)} />
              ))}
            </ul>
          </section>
        ))
      )}
      {more && kept.length > 0 && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              if (kept.length <= shown) onOlder();
              setShown((n) => n + PAGE);
            }}
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
