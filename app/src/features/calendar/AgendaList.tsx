// The agenda: the month as a list of its days, like a diary's pages. A day
// with something on it shows its journal, the ranges that start on it (or
// start earlier and run into the month) and everything else; an empty day
// is one slim line, still a place to click, drop on or add to. This month
// starts at today, with the days before it a click away.

import { memo, useMemo, useState } from "react";

import type { DayMention, NoteMeta, TaskRow } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { useCalendarActions, type AddKind } from "./actions";
import { EntryChip, entryKey } from "./Chip";
import type { DateItem } from "./dates";
import type { EventPart } from "./external/types";
import { AddMenu, DayNumber, JournalChip, QuickAdd, weekdayOf } from "./DayParts";
import { dayEntries, fullDay, type Entry } from "./layout";
import { onDayClick, type GridProps } from "./MonthGrid";
import type { DateRange } from "./ranges";

const NO_RANGES: DateRange[] = [];

export function AgendaList({ days, today, items, tasks, ranges, journals, mentions, made, events, colors, lit, adding, dragging, scopeTag }: GridProps) {
  const month = useMemo(() => days[0] ?? [], [days]);
  const [earlier, setEarlier] = useState(false);
  const cut = earlier ? 0 : Math.max(0, month.indexOf(today));
  const shown = cut ? month.slice(cut) : month;
  // Each range once, on its first day in the month.
  const starts = useMemo(() => {
    const out = new Map<string, DateRange[]>();
    const first = month[0] ?? "";
    for (const range of ranges) {
      const day = range.start < first ? first : range.start;
      out.set(day, [...(out.get(day) ?? []), range]);
    }
    return out;
  }, [ranges, month]);

  return (
    <section className="kasten-cal-agenda" aria-label="Agenda">
      {cut > 0 && (
        <button type="button" className="kasten-cal-agenda-earlier" onClick={() => setEarlier(true)}>
          <Icon name="chevron-up" className="size-3.5" />
          {cut === 1 ? "Show the day before today" : `Show the ${cut} days before today`}
        </button>
      )}
      {shown.map((day) => (
        <AgendaDay
          key={day}
          day={day}
          today={day === today}
          items={items.get(day)}
          tasks={tasks.get(day)}
          mentions={mentions.get(day)}
          made={made.get(day)}
          events={events.get(day)}
          ranges={starts.get(day) ?? NO_RANGES}
          journal={journals.get(day)}
          colors={colors}
          over={lit !== null && lit.start <= day && day <= lit.end}
          adding={adding?.day === day ? adding.kind : null}
          dragging={dragging}
          scopeTag={scopeTag}
        />
      ))}
    </section>
  );
}

interface DayProps {
  day: string;
  today: boolean;
  items: readonly DateItem[] | undefined;
  tasks: readonly TaskRow[] | undefined;
  mentions: readonly DayMention[] | undefined;
  made: readonly NoteMeta[] | undefined;
  events: readonly EventPart[] | undefined;
  ranges: readonly DateRange[];
  journal: NoteMeta | undefined;
  colors: ReadonlyMap<string, string>;
  over: boolean;
  adding: AddKind | null;
  dragging: string | null;
  scopeTag: string | null;
}

const AgendaDay = memo(function AgendaDay({ day, today, items, tasks, mentions, made, events, ranges, journal, colors, over, adding, dragging, scopeTag }: DayProps) {
  const actions = useCalendarActions();
  const entries = useMemo<Entry[]>(() => [...ranges.map((range): Entry => ({ kind: "range", range })), ...dayEntries(items, tasks, mentions, made, events)], [ranges, items, tasks, mentions, made, events]);
  const empty = entries.length === 0 && !journal && !adding;
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return (
    <div
      role="group"
      aria-label={fullDay(day)}
      data-day={day}
      className={`kasten-cal-agenda-day${today ? " is-today" : ""}${empty ? " is-empty" : ""}${weekday === 0 || weekday === 6 ? " is-weekend" : ""}${scopeTag ? "" : " is-pickable"}${over ? " is-over" : ""}`}
      onDragEnter={(event) => actions.dragOver(day, event)}
      onDragOver={(event) => actions.dragOver(day, event)}
      onDragLeave={(event) => actions.dragLeave(day, event)}
      onDrop={(event) => actions.drop(day, event)}
      onClick={onDayClick(actions, day, scopeTag)}
    >
      <div className="kasten-cal-agenda-date">
        <span className="kasten-cal-agenda-weekday">{weekdayOf(day)}</span>
        <DayNumber day={day} today={today} label={String(Number(day.slice(8)))} className="kasten-cal-agenda-num" />
      </div>
      <div className="kasten-cal-agenda-body">
        {journal && <JournalChip day={day} journal={journal} large />}
        {entries.map((entry) => (
          <EntryChip key={entryKey(entry)} entry={entry} colors={colors} dragging={dragging} day={day} large />
        ))}
        {adding && <QuickAdd day={day} kind={adding} scopeTag={scopeTag} />}
      </div>
      <AddMenu day={day} scopeTag={scopeTag} className="kasten-cal-add kasten-cal-agenda-add" />
    </div>
  );
});
