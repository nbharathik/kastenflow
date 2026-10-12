// Seven tall columns, Monday first: an all-day band of range bars across the
// top (four lines, then "+N more" to open it), then each day's journal and
// every entry with its property and tag, a drop target the height of the
// view, and the "+" menu. A click on a column's free space shows the day's
// journal.

import { memo, useMemo, useState, type CSSProperties } from "react";

import { Icon } from "../../ui/Icon";
import { useCalendarActions } from "./actions";
import { BarLayer } from "./Bar";
import { EntryChip, entryKey } from "./Chip";
import { AddMenu, DayNumber, JournalChip, QuickAdd, weekdayOf } from "./DayParts";
import { fitBars, weekBars } from "./lanes";
import { dayEntries, entryTime, fullDay } from "./layout";
import { litClass, onDayClick, type CellProps, type GridProps } from "./MonthGrid";

/** A lane of the band, and the band's padding (bars.css). */
const BAND_LANE = 28;
const BAND_PAD = 10;
/** Lines the band shows while folded, "+N more" included. */
const BAND_LINES = 4;
const NO_ENTRIES = [0, 0, 0, 0, 0, 0, 0];

/** What a day's column shows under the band's lanes: how many bars are
 * folded away, or (unfolded) that it can fold them again. */
type BandLine = { more: number } | "less" | null;

/** With `hours`, the columns keep only what has no hour (the all-day row of
 * the hour grid, which draws the rest under them). */
export function WeekGrid({ days, today, items, tasks, ranges, journals, mentions, made, events, colors, lit, adding, dragging, pinned, scopeTag, hours = false }: GridProps & { hours?: boolean }) {
  const week = useMemo(() => days[0] ?? [], [days]);
  const [open, setOpen] = useState(false);
  const layout = useMemo(() => weekBars(ranges, week, pinned), [ranges, week, pinned]);
  const folded = useMemo(() => fitBars(layout, BAND_LINES, NO_ENTRIES), [layout]);
  const foldable = folded.days.some((day) => day.hidden > 0);
  const all = open && foldable;
  const shown = all ? layout.lanes : folded.shown;
  const bars = useMemo(() => layout.bars.filter((bar) => bar.lane < shown), [layout, shown]);
  // A line for "+N more" (or "Show fewer") under the lanes when they fold.
  const band = layout.lanes ? (shown + (foldable ? 1 : 0)) * BAND_LANE + BAND_PAD : 0;
  // Folded: "+N more" under each day that hides bars; open: "Show fewer"
  // once, under the first of them.
  const firstFolded = folded.days.findIndex((day) => day.hidden > 0);
  const line = (col: number): BandLine => {
    const hidden = folded.days[col]!.hidden;
    if (!hidden) return null;
    if (!all) return { more: hidden };
    return col === firstFolded ? "less" : null;
  };
  return (
    <div className={`kasten-cal-weekgrid${hours ? " is-hours" : ""}`} style={{ "--band": `${band}px` } as CSSProperties}>
      {week.map((day, col) => (
        <WeekColumn
          key={day}
          day={day}
          weekend={col >= 5}
          band={band > 0}
          line={line(col)}
          onBand={setOpen}
          today={day === today}
          items={items.get(day)}
          tasks={tasks.get(day)}
          mentions={mentions.get(day)}
          made={made.get(day)}
          events={events.get(day)}
          hours={hours}
          journal={journals.get(day)}
          colors={colors}
          over={litClass(lit, week, col)}
          adding={adding?.day === day ? adding.kind : null}
          expanded={false}
          dragging={dragging}
          pinned={null}
          scopeTag={scopeTag}
        />
      ))}
      <BarLayer bars={bars} week={week} colors={colors} dragging={dragging} />
    </div>
  );
}

type ColumnProps = CellProps & { weekend: boolean; band: boolean; line: BandLine; onBand(open: boolean): void; hours: boolean };

const WeekColumn = memo(function WeekColumn({ day, weekend, band, line, onBand, hours, today, items, tasks, mentions, made, events, journal, colors, over, adding, dragging, scopeTag }: ColumnProps) {
  const actions = useCalendarActions();
  const entries = useMemo(() => {
    const all = dayEntries(items, tasks, mentions, made, events);
    return hours ? all.filter((entry) => entryTime(entry) === null) : all;
  }, [items, tasks, mentions, made, events, hours]);
  return (
    <div
      role="group"
      aria-label={fullDay(day)}
      data-day={day}
      className={`kasten-cal-col${weekend ? " is-weekend" : ""}${today ? " is-today" : ""}${scopeTag ? "" : " is-pickable"}${over}`}
      onDragEnter={(event) => actions.dragOver(day, event)}
      onDragOver={(event) => actions.dragOver(day, event)}
      onDragLeave={(event) => actions.dragLeave(day, event)}
      onDrop={(event) => actions.drop(day, event)}
    >
      <div className="kasten-cal-col-head">
        <span className="kasten-cal-col-weekday">{weekdayOf(day)}</span>
        <DayNumber day={day} today={today} label={String(Number(day.slice(8)))} className="kasten-cal-col-num" />
      </div>
      {band && (
        <div className="kasten-cal-col-band">
          {line === "less" ? (
            <button type="button" className="kasten-cal-more" onClick={() => onBand(false)}>
              Show fewer
            </button>
          ) : (
            line && (
              <button type="button" className="kasten-cal-more" aria-label={`${line.more} more over ${fullDay(day)}`} onClick={() => onBand(true)}>
                +{line.more} more
              </button>
            )
          )}
        </div>
      )}
      <div className="kasten-cal-col-body" onClick={onDayClick(actions, day, scopeTag)} onDoubleClick={(event) => scopeTag && event.target === event.currentTarget && actions.addOn(day)}>
        {journal && <JournalChip day={day} journal={journal} large />}
        {entries.map((entry) => (
          <EntryChip key={entryKey(entry)} entry={entry} colors={colors} dragging={dragging} day={day} large />
        ))}
        {adding ? (
          <QuickAdd day={day} kind={adding} scopeTag={scopeTag} />
        ) : (
          <AddMenu day={day} scopeTag={scopeTag} className="kasten-cal-col-add" wide>
            <Icon name="plus" className="size-3.5" />
            Add
          </AddMenu>
        )}
      </div>
    </div>
  );
});
