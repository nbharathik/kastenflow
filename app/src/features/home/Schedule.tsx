// Home's "Today": what is on today in one list in the order of the day: the
// all-day events first, then everything with a time (events from the calendars
// you subscribed to, and to-dos like `@14:00`), then the to-dos due today with
// no time. A click on an event shows its details, as in the Calendar; events
// are read-only. A quiet day says so in one line.

import "../calendar/external/external.css";

import { useMemo, useRef, useState } from "react";

import { dayFrom } from "../../lib/dates";
import type { TaskRow } from "../../lib/vault/types";
import { DashCard, DashEmpty } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { byUrgency, useTaskList } from "../dashboard/task-rows";
import { TodoRow } from "../dashboard/TodoList";
import { canSubscribe } from "../calendar/external/api";
import { EventPopover } from "../calendar/external/EventPopover";
import { hoursOf, partsByDay } from "../calendar/external/external";
import { useExternalEvents, useFeeds } from "../calendar/external/store";
import type { EventPart } from "../calendar/external/types";
import { swatch } from "../panel/properties/schemas";
import { toneStyle } from "../calendar/actions";
import { useWorkspace } from "../workspace/store";

/** Things listed before "N more", which opens the Calendar. */
const LIMIT = 5;

type Item = { kind: "event"; at: string | null; part: EventPart } | { kind: "todo"; at: string | null; row: TaskRow };

/** All-day events, then what has a time, then to-dos with none. */
const rank = (item: Item) => (item.kind === "event" && item.at === null ? 0 : item.at !== null ? 1 : 2);

/** The to-dos that are due on `day`, open ones only. */
export const dueOn = (rows: readonly TaskRow[] | null, day: string): TaskRow[] => (rows ?? []).filter((r) => !r.done && r.due === day && !r.path.startsWith("templates/")).sort(byUrgency);

export function Schedule() {
  const today = dayFrom(0);
  const events = useExternalEvents(today, today, canSubscribe());
  const parts = useMemo(() => partsByDay(events, today, today).get(today) ?? [], [events, today]);
  const rows = useTaskList();
  const items = useMemo<Item[]>(() => {
    const all: Item[] = [...parts.map((part): Item => ({ kind: "event", at: part.at, part })), ...dueOn(rows, today).map((row): Item => ({ kind: "todo", at: row.at ?? null, row }))];
    // Array.sort is stable, so equal times keep the order they came in.
    return all.sort((a, b) => rank(a) - rank(b) || (a.at ?? "").localeCompare(b.at ?? ""));
  }, [parts, rows, today]);
  const calendar = () => useWorkspace.getState().go({ view: "calendar" });
  return (
    <DashCard title="Today" icon="calendar" actions={<SeeAll label="Calendar" run={calendar} />}>
      {rows === null && items.length === 0 ? (
        <div className="kasten-todo-skeleton" aria-hidden="true">
          <span className="kasten-todo-bone" />
          <span className="kasten-todo-bone" />
        </div>
      ) : items.length === 0 ? (
        <DashEmpty>Nothing on today.</DashEmpty>
      ) : (
        <ul className="kasten-today-list">
          {items.slice(0, LIMIT).map((item) =>
            item.kind === "event" ? <EventRow key={item.part.key} part={item.part} /> : <TodoRow key={`${item.row.path}:${item.row.line}`} row={item.row} today={today} showPage={false} timed />,
          )}
        </ul>
      )}
      {items.length > LIMIT && (
        <button type="button" className="kasten-dash-more" onClick={calendar}>
          {items.length - LIMIT} more
        </button>
      )}
    </DashCard>
  );
}

function EventRow({ part }: { part: EventPart }) {
  const { event } = part;
  const calendar = useFeeds((s) => s.list?.find((c) => c.id === event.calendar));
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const tone = useMemo(() => toneStyle(swatch(calendar?.color)), [calendar?.color]);
  const hours = hoursOf(part);
  return (
    <li>
      <button ref={row} type="button" className="kasten-dash-row" aria-haspopup="dialog" aria-expanded={open} title={[hours ?? "All day", event.title, calendar?.name, event.location].filter(Boolean).join(" · ")} onClick={() => setOpen((o) => !o)}>
        <span className="kasten-dash-row-icon" aria-hidden="true">
          <span className="kasten-feed-dot kasten-ext-dot" style={{ background: swatch(calendar?.color)?.fg ?? "var(--color-accent)" }} />
        </span>
        <span className="kasten-dash-row-title">
          <span className="kasten-ext-time">{hours ?? "All day"}</span>
          {event.title}
        </span>
      </button>
      {open && <EventPopover part={part} calendar={calendar} anchor={row} tone={tone} onClose={() => setOpen(false)} />}
    </li>
  );
}
