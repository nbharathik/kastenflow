// Two cards Home keeps in reserve, for the person who turns them on with
// Customize: the week ahead and the journal. They load when asked for, so
// Home's first paint carries neither.

import { useMemo } from "react";

import { dayFrom, longDay } from "../../lib/dates";
import { DashCard, DashEmpty } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { NoteRow } from "../dashboard/NoteRow";
import { useTaskList } from "../dashboard/task-rows";
import { useWorkspace } from "../workspace/store";
import { journalDays } from "../workspace/tree";

export function ExtraCard({ id }: { id: "week" | "journal" }) {
  return id === "week" ? <Week /> : <Journal />;
}

/** "Mon" for a YYYY-MM-DD day. */
function weekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString(undefined, { weekday: "short" });
}

/** The next seven days, each a button to its journal day, with the to-dos due on it. */
function Week() {
  const rows = useTaskList();
  const today = dayFrom(0);
  // `today` is in the list so the week moves on when midnight passes and the view draws again.
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => dayFrom(i)), [today]);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of rows ?? []) if (!row.done && row.due && days.includes(row.due)) out.set(row.due, (out.get(row.due) ?? 0) + 1);
    return out;
  }, [rows, days]);
  return (
    <DashCard title="This week" icon="calendar-days" actions={<SeeAll label="Calendar" run={() => useWorkspace.getState().go({ view: "calendar" })} />}>
      <div role="group" aria-label="The next seven days" className="kasten-week">
        {days.map((day) => {
          const n = counts.get(day) ?? 0;
          return (
            <button key={day} type="button" className={`kasten-week-day${day === today ? " is-today" : ""}`} aria-label={`${longDay(day)}${n ? `: ${n} to-do${n === 1 ? "" : "s"}` : ""}`} onClick={() => void useWorkspace.getState().openJournal(day)}>
              <span className="kasten-week-name">{weekday(day)}</span>
              <span className="kasten-week-date">{Number(day.slice(8))}</span>
              <span className="kasten-week-count">{n || ""}</span>
            </button>
          );
        })}
      </div>
    </DashCard>
  );
}

function Journal() {
  const days = useWorkspace((s) => journalDays(s.notes));
  const { openJournal } = useWorkspace.getState();
  const latest = [...days].sort((a, b) => b.title.localeCompare(a.title)).slice(0, 4);
  return (
    <DashCard title="Journal" icon="journal" actions={<SeeAll label="Write today" run={() => void openJournal()} />}>
      {latest.length === 0 ? (
        <DashEmpty>No days written yet. Today's page is one click away.</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {latest.map((day) => (
            <NoteRow key={day.path} note={day} detail={day.excerpt || "No entry"} />
          ))}
        </div>
      )}
    </DashCard>
  );
}
