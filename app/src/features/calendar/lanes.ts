// Ranges as bars across a week: each week row lays its ranges out
// in lanes under the day numbers, as Google Calendar and Fantastical do, and
// a month cell gives the lanes over its day the lines they need before its
// own entries. Pure functions, unit tested.

import { byStart, rangeId, type DateRange } from "./ranges";

/** One range's stretch within one week. */
export interface Bar {
  range: DateRange;
  /** Its row among the week's bars, 0 at the top. */
  lane: number;
  /** The first and last column (0 to 6) it covers this week. */
  from: number;
  to: number;
  /** Whether the range begins, and ends, this week (a rounded end) rather
   * than running on from the week before or into the next (a flat one). */
  starts: boolean;
  ends: boolean;
}

export interface WeekBars {
  /** In the order lanes were filled. */
  bars: Bar[];
  lanes: number;
}

/** The ranges that touch `week` (seven days) as bars in lanes: filled
 * greedily, earlier start first and longer first, each into the top lane
 * free for all its days. `first` names a range to put on top whatever its
 * place, so one moving by keyboard stays in sight. */
export function weekBars(ranges: readonly DateRange[], week: readonly string[], first?: string | null): WeekBars {
  const monday = week[0]!;
  const sunday = week[week.length - 1]!;
  const touching = ranges.filter((r) => r.start <= sunday && r.end >= monday).sort(byStart);
  if (first) {
    const at = touching.findIndex((r) => rangeId(r) === first);
    if (at > 0) touching.unshift(...touching.splice(at, 1));
  }
  // Each lane's taken days, one bit per column.
  const taken: number[] = [];
  const bars = touching.map((range): Bar => {
    const starts = range.start >= monday;
    const ends = range.end <= sunday;
    const from = starts ? week.indexOf(range.start) : 0;
    const to = ends ? week.indexOf(range.end) : week.length - 1;
    const days = ((1 << (to + 1)) - 1) & ~((1 << from) - 1);
    let lane = 0;
    while (lane < taken.length && taken[lane]! & days) lane++;
    taken[lane] = (taken[lane] ?? 0) | days;
    return { range, lane, from, to, starts, ends };
  });
  return { bars, lanes: taken.length };
}

/** The bars over column `col`, top lane first. */
export function barsOver(week: WeekBars, col: number): Bar[] {
  return week.bars.filter((b) => b.from <= col && col <= b.to).sort((a, b) => a.lane - b.lane);
}

/** What the bars take of one day's cell. */
export interface DayBars {
  /** Lines the lanes over the day take at the top of its cell: down to its
   * lowest bar shown, empty lanes above it included (lanes line up). */
  lanes: number;
  /** Its bars in lanes too low to show, which its "+N more" counts. */
  hidden: number;
}

/** How a week row of a month fits its bars into cells of `lines` lines,
 * each day also having `singles[col]` entries of its own. As many lanes
 * show as fit; if a day would then have all its lines taken by bars and
 * still something to show, one lane fewer shows, so "+N more" has a line. */
export function fitBars(week: WeekBars, lines: number, singles: readonly number[]): { shown: number; days: DayBars[] } {
  const on = (col: number, shown: number): DayBars => {
    let lanes = 0;
    let hidden = 0;
    for (const bar of week.bars) {
      if (bar.from > col || col > bar.to) continue;
      if (bar.lane < shown) lanes = Math.max(lanes, bar.lane + 1);
      else hidden++;
    }
    return { lanes, hidden };
  };
  const cols = singles.map((_, col) => col);
  let shown = Math.min(week.lanes, lines);
  if (
    shown > 0 &&
    cols.some((col) => {
      const day = on(col, shown);
      return day.lanes >= lines && (day.hidden > 0 || singles[col]! > 0);
    })
  )
    shown = lines - 1;
  return { shown, days: cols.map((col) => on(col, shown)) };
}

/** Something on a day's hours, from its first minute to its end (minutes
 * from midnight; an end of 1440 is midnight at the day's end). */
export interface Span {
  start: number;
  end: number;
}

/** Where a span sits among the ones it overlaps: its column, and how many
 * columns that run of overlapping spans needs. */
export interface Stacked {
  lane: number;
  lanes: number;
}

/** Spans that overlap share the day's width, as in a paper diary: each gets
 * the first column free for all its minutes, and every span of a run of
 * overlapping ones is as wide as that run's columns need. Earlier first, longer
 * first. Results come in the order of `spans`. */
export function stackSpans(spans: readonly Span[]): Stacked[] {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a]!.start - spans[b]!.start || spans[b]!.end - spans[a]!.end || a - b);
  const out: Stacked[] = new Array(spans.length);
  let run: number[] = [];
  /** Where each column of the run is busy until. */
  let busy: number[] = [];
  let runEnd = -1;
  const close = () => {
    for (const i of run) out[i]!.lanes = busy.length;
    run = [];
    busy = [];
  };
  for (const i of order) {
    const span = spans[i]!;
    if (span.start >= runEnd) close();
    let lane = busy.findIndex((until) => until <= span.start);
    if (lane < 0) lane = busy.length;
    busy[lane] = span.end;
    runEnd = run.length === 0 ? span.end : Math.max(runEnd, span.end);
    out[i] = { lane, lanes: 1 };
    run.push(i);
  }
  close();
  return out;
}
