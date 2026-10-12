// Six weeks of days, Monday first. Each week row lays its ranges out as bars
// in lanes under the day numbers; each cell then lists its first entries in
// the lines the lanes leave and "+N more", takes drops, and adds from its
// "+". A click on a cell's free space shows the day's journal. Cells show as
// many lines as the pane's height leaves room for.

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from "react";

import type { DayMention, NoteMeta, TaskRow } from "../../lib/vault/types";
import { useCalendarActions, type AddKind, type Adding, type CalendarActions } from "./actions";
import { BarLayer } from "./Bar";
import { EntryChip, entryKey } from "./Chip";
import { weekdayNames, type DateItem } from "./dates";
import { AddMenu, DayNumber, JournalLink, MorePopover, QuickAdd, dayNumber } from "./DayParts";
import { barsOver, fitBars, weekBars } from "./lanes";
import type { EventPart } from "./external/types";
import { dayEntries, fit, fullDay, itemId, type Entry } from "./layout";
import type { DateRange } from "./ranges";
import { usePrefs } from "../workspace/prefs";

/** Lines a month cell shows before "+N more", at the least and at most. */
export const MONTH_LINES = 3;
const MAX_LINES = 8;
/** A cell's own height besides its lines (number row, padding), and a line's (grid.css). */
const CELL_CHROME = 41;
const LINE = 25;
/** The view's padding under the grid (calendar.css). */
const BELOW = 32;

export interface GridProps {
  days: string[][];
  today: string;
  items: ReadonlyMap<string, DateItem[]>;
  tasks: ReadonlyMap<string, TaskRow[]>;
  /** The ranges that touch the days shown, by start. */
  ranges: readonly DateRange[];
  journals: ReadonlyMap<string, NoteMeta>;
  /** Notes that link a day, and notes made on it, by day (Show chooses). */
  mentions: ReadonlyMap<string, DayMention[]>;
  made: ReadonlyMap<string, NoteMeta[]>;
  /** Events of the subscribed calendars, by day: read-only. */
  events: ReadonlyMap<string, EventPart[]>;
  colors: ReadonlyMap<string, string>;
  /** The days a dragged chip or range would cover, dropped where it is. */
  lit: { start: string; end: string } | null;
  adding: Adding | null;
  expanded: string | null;
  /** What is being dragged, by id. */
  dragging: string | null;
  /** A chip or range kept in sight whatever its place (moved by keyboard). */
  pinned: string | null;
  /** A tag database's calendar: its tag. Its days add a note with the tag,
   * and a click on one does not open the journal. */
  scopeTag: string | null;
}

/** A click on a day's own free space, not on anything in it: shows the
 * day's journal (not in a tag database's calendar). */
export function onDayClick(actions: CalendarActions, day: string, scopeTag: string | null) {
  return (event: MouseEvent<HTMLElement>) => {
    if (scopeTag || (event.target as Element).closest("button, a, input, [role='button'], [role='dialog'], [role='menu']")) return;
    actions.openDay(day, event);
  };
}

/** Whether a drop would cover `day`. */
const isLit = (lit: GridProps["lit"], day: string) => lit !== null && lit.start <= day && day <= lit.end;

/** A day's classes while a drop would cover it: lit, and where the lit days
 * begin and end in its week, so they read as one outlined stretch. */
export function litClass(lit: GridProps["lit"], week: readonly string[], col: number): string {
  if (!isLit(lit, week[col]!)) return "";
  const start = col === 0 || !isLit(lit, week[col - 1]!);
  const end = col === week.length - 1 || !isLit(lit, week[col + 1]!);
  return ` is-over${start ? " is-over-start" : ""}${end ? " is-over-end" : ""}`;
}

/** Lines a cell has room for, from the height the pane gives the grid
 * rather than the grid's own (which its lines would feed back into). */
function useLines(grid: RefObject<HTMLDivElement | null>): number {
  const [lines, setLines] = useState(MONTH_LINES);
  useLayoutEffect(() => {
    const el = grid.current;
    const scroller = el?.closest<HTMLElement>("[data-scroll-root]");
    if (!el || !scroller || typeof ResizeObserver !== "function") return;
    const measure = () => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const head = (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
      const row = (scroller.clientHeight - top - head - BELOW) / 6;
      if (row > 0) setLines(Math.max(MONTH_LINES, Math.min(MAX_LINES, Math.floor((row - CELL_CHROME) / LINE))));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(scroller);
    return () => watch.disconnect();
  }, [grid]);
  return lines;
}

export function MonthGrid({ days, month, ...rest }: GridProps & { month: string }) {
  const weekStart = usePrefs((s) => s.weekStart);
  const names = useMemo(() => weekdayNames(weekStart), [weekStart]);
  const grid = useRef<HTMLDivElement>(null);
  const lines = useLines(grid);
  return (
    <div ref={grid} className="kasten-cal-month">
      <div className="kasten-cal-weekdays" aria-hidden="true">
        {names.map((name, i) => (
          <span key={i}>{name}</span>
        ))}
      </div>
      {days.map((week, row) => (
        <MonthRow key={week[0]} week={week} row={row} lines={lines} month={month} {...rest} />
      ))}
    </div>
  );
}

type RowProps = Omit<GridProps, "days"> & { week: string[]; row: number; lines: number; month: string };

/** One week: its bars in lanes, over cells that leave them room. */
const MonthRow = memo(function MonthRow({ week, row, lines, month, today, items, tasks, ranges, journals, mentions, made, events, colors, lit, adding, expanded, dragging, pinned, scopeTag }: RowProps) {
  const layout = useMemo(() => weekBars(ranges, week, pinned), [ranges, week, pinned]);
  // Each day's own entries, as a key that only changes when a count does.
  const counts = week.map((day) => (items.get(day)?.length ?? 0) + (tasks.get(day)?.length ?? 0) + (mentions.get(day)?.length ?? 0) + (made.get(day)?.length ?? 0) + (events.get(day)?.length ?? 0)).join();
  const fitted = useMemo(() => fitBars(layout, lines, counts.split(",").map(Number)), [layout, lines, counts]);
  const bars = useMemo(() => layout.bars.filter((bar) => bar.lane < fitted.shown), [layout, fitted.shown]);
  return (
    <div className="kasten-cal-row">
      {week.map((day, col) => (
        <MonthCell
          key={day}
          day={day}
          row={row}
          col={col}
          lines={lines}
          lanes={fitted.days[col]!.lanes}
          hidden={fitted.days[col]!.hidden}
          other={day.slice(0, 7) !== month}
          today={day === today}
          items={items.get(day)}
          tasks={tasks.get(day)}
          mentions={mentions.get(day)}
          made={made.get(day)}
          events={events.get(day)}
          ranges={expanded === day ? barsOver(layout, col).map((bar) => bar.range) : undefined}
          journal={journals.get(day)}
          colors={colors}
          over={litClass(lit, week, col)}
          adding={adding?.day === day ? adding.kind : null}
          expanded={expanded === day}
          dragging={dragging}
          pinned={pinned}
          scopeTag={scopeTag}
        />
      ))}
      <BarLayer bars={bars} week={week} colors={colors} dragging={dragging} />
    </div>
  );
});

export interface CellProps {
  day: string;
  today: boolean;
  items: readonly DateItem[] | undefined;
  tasks: readonly TaskRow[] | undefined;
  mentions: readonly DayMention[] | undefined;
  made: readonly NoteMeta[] | undefined;
  events: readonly EventPart[] | undefined;
  journal: NoteMeta | undefined;
  colors: ReadonlyMap<string, string>;
  /** Its classes while a drop would cover it (`litClass`); empty otherwise. */
  over: string;
  /** What its quick-add field adds, while one is open on it. */
  adding: AddKind | null;
  expanded: boolean;
  dragging: string | null;
  pinned: string | null;
  scopeTag: string | null;
}

/** Keeps the chip `pinned` names in sight. */
const pinnedTest = (pinned: string | null) => (pinned ? (entry: Entry) => entry.kind === "note" && itemId(entry.item) === pinned : undefined);

type MonthCellProps = CellProps & {
  row: number;
  col: number;
  lines: number;
  /** Lines the bars over the day take, and its bars that did not fit. */
  lanes: number;
  hidden: number;
  /** Every range over the day, for its popover (only while it is open). */
  ranges: readonly DateRange[] | undefined;
  other: boolean;
};

const MonthCell = memo(function MonthCell({ day, row, col, lines, lanes, hidden, ranges, other, today, items, tasks, mentions, made, events, journal, colors, over, adding, expanded, dragging, pinned, scopeTag }: MonthCellProps) {
  const actions = useCalendarActions();
  const entries = useMemo(() => dayEntries(items, tasks, mentions, made, events), [items, tasks, mentions, made, events]);
  // The lanes take their lines first, and the quick-add field one more.
  const { shown, more } = fit(entries, lines - lanes - (adding ? 1 : 0), pinnedTest(pinned), hidden);
  return (
    <div
      role="group"
      aria-label={fullDay(day)}
      data-day={day}
      className={`kasten-cal-cell${other ? " is-other" : ""}${today ? " is-today" : ""}${scopeTag ? "" : " is-pickable"}${over}`}
      onDragEnter={(event) => actions.dragOver(day, event)}
      onDragOver={(event) => actions.dragOver(day, event)}
      onDragLeave={(event) => actions.dragLeave(day, event)}
      onDrop={(event) => actions.drop(day, event)}
      onClick={onDayClick(actions, day, scopeTag)}
      onDoubleClick={(event) => scopeTag && event.target === event.currentTarget && actions.addOn(day)}
    >
      <div className="kasten-cal-cell-head">
        <DayNumber day={day} today={today} label={dayNumber(day)} className="kasten-cal-daynum" />
        <span className="flex-1" />
        {journal && <JournalLink day={day} journal={journal} />}
        <AddMenu day={day} scopeTag={scopeTag} />
      </div>
      {lanes > 0 && <div className="kasten-cal-lanes" style={{ "--lanes": lanes } as CSSProperties} aria-hidden="true" />}
      {adding && <QuickAdd day={day} kind={adding} scopeTag={scopeTag} />}
      {shown.map((entry) => (
        <EntryChip key={entryKey(entry)} entry={entry} colors={colors} dragging={dragging} day={day} />
      ))}
      {more > 0 && (
        <button type="button" className="kasten-cal-more" aria-label={`${more} more on ${fullDay(day)}`} onClick={() => actions.expand(day)}>
          +{more} more
        </button>
      )}
      {expanded && <MorePopover day={day} entries={ranges?.length ? [...ranges.map((range): Entry => ({ kind: "range", range })), ...entries] : entries} colors={colors} dragging={dragging} up={row >= 3} end={col >= 5} />}
    </div>
  );
});
