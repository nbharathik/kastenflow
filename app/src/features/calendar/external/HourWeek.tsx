// The week by the hour: the usual week's columns with only what has no hour
// (journal, dated notes, range bars, all-day events), and under them the
// day's 24 hours with each timed event, and each to-do or mention with a
// time (`@14:00`), placed on its hour. Things that overlap share the column.

import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";

import { ActionsContext } from "../actions";
import { EntryChip, entryKey } from "../Chip";
import { dayEntries, fullDay } from "../layout";
import type { GridProps } from "../MonthGrid";
import { WeekGrid } from "../WeekGrid";
import { carriesEvent } from "./event-drag";
import { HOUR_PX, placeBlocks, splitDay, startHour, type Placed } from "./hours";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const label = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function HourWeek(props: GridProps) {
  const { days, today, items, tasks, mentions, made, events, colors, dragging, lit } = props;
  const week = useMemo(() => days[0] ?? [], [days]);
  return (
    <div className="kasten-cal-hourweek" style={{ "--hour": `${HOUR_PX}px` } as CSSProperties}>
      <div className="kasten-cal-hourweek-in">
        <WeekGrid {...props} hours />
        <HourBody week={week} today={today} items={items} tasks={tasks} mentions={mentions} made={made} events={events} colors={colors} dragging={dragging} lit={lit} />
      </div>
    </div>
  );
}

type BodyProps = Pick<GridProps, "today" | "items" | "tasks" | "mentions" | "made" | "events" | "colors" | "dragging" | "lit"> & { week: readonly string[] };

/** The minutes since midnight now. */
const minutesNow = (now: Date) => now.getHours() * 60 + now.getMinutes();

function HourBody({ week, today, items, tasks, mentions, made, events, colors, dragging, lit }: BodyProps) {
  const columns = useMemo(
    () => week.map((day) => placeBlocks(splitDay(dayEntries(items.get(day), tasks.get(day), mentions.get(day), made.get(day), events.get(day))).timed)),
    [week, items, tasks, mentions, made, events],
  );
  const current = week.includes(today);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [current]);

  // The week opens at its first hour: an hour before now in this week.
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef({ columns, current });
  // Kept first, so the effect below reads this render's week.
  useLayoutEffect(() => {
    latest.current = { columns, current };
  });
  const first = week[0];
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const { columns: placed, current: thisWeek } = latest.current;
    el.scrollTop = startHour(placed.flat(), thisWeek ? new Date() : null) * HOUR_PX;
  }, [first]);

  return (
    <div ref={scroller} className="kasten-cal-hours" tabIndex={0} role="region" aria-label="Hours of the week">
      <div className="kasten-cal-hours-gutter" aria-hidden="true">
        {HOURS.slice(1).map((hour) => (
          <span key={hour} style={{ top: hour * HOUR_PX }}>
            {label(hour)}
          </span>
        ))}
      </div>
      {week.map((day, col) => (
        <HourColumn key={day} day={day} weekend={col >= 5} today={day === today} placed={columns[col]!} now={day === today ? minutesNow(now) : null} colors={colors} dragging={dragging} over={lit !== null && lit.start <= day && day <= lit.end} />
      ))}
    </div>
  );
}

interface ColumnProps {
  day: string;
  weekend: boolean;
  today: boolean;
  placed: readonly Placed[];
  /** The minutes since midnight, in today's column. */
  now: number | null;
  colors: ReadonlyMap<string, string>;
  dragging: string | null;
  /** An event is being carried over the day. */
  over: boolean;
}

const HourColumn = memo(function HourColumn({ day, weekend, today, placed, now, colors, dragging, over }: ColumnProps) {
  const actions = useContext(ActionsContext);
  // Only an event of a subscribed calendar is taken here: a note's date is moved on the day's cell above.
  const onlyEvents = (take: (drag: DragEvent<HTMLElement>) => void) => (drag: DragEvent<HTMLElement>) => carriesEvent(drag) && take(drag);
  return (
    <div
      role="group"
      aria-label={`${fullDay(day)}, by the hour`}
      data-day={day}
      className={`kasten-cal-hours-col${weekend ? " is-weekend" : ""}${today ? " is-today" : ""}${over ? " is-over" : ""}`}
      onDragEnter={onlyEvents((drag) => actions?.dragOver(day, drag))}
      onDragOver={onlyEvents((drag) => actions?.dragOver(day, drag))}
      onDragLeave={(drag) => actions?.dragLeave(day, drag)}
      onDrop={onlyEvents((drag) => actions?.drop(day, drag))}
    >
      {placed.map((block) => (
        <div
          key={entryKey(block.entry)}
          className={`kasten-cal-block${block.height >= HOUR_PX * 1.5 ? " is-tall" : ""}`}
          style={{ top: block.top, height: block.height, left: `${(block.lane / block.lanes) * 100}%`, width: `${100 / block.lanes}%` }}
        >
          <EntryChip entry={block.entry} colors={colors} dragging={dragging} day={day} />
        </div>
      ))}
      {now !== null && <div className="kasten-cal-now" style={{ top: (now / 60) * HOUR_PX }} aria-hidden="true" />}
    </div>
  );
});
