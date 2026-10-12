import { describe, expect, it } from "vitest";

import { longDay } from "../../lib/dates";
import type { NoteMeta, TagSchema, TaskRow } from "../../lib/vault/types";
import { addDays, byDay, dateItems, dateRanges, type DateItem } from "./dates";
import { fitBars, weekBars } from "./lanes";
import {
  briefRange,
  calendarKey,
  chipTone,
  dayEntries,
  dayLabel,
  fit,
  fullDay,
  isDone,
  itemId,
  landing,
  newTaskProps,
  nudgeDays,
  periodDays,
  periodTitle,
  rangeLabel,
  shiftAnchor,
  stretchDays,
  taskText,
  withMoves,
  withRangeMoves,
} from "./layout";
import { movedValue } from "../panel/properties/values";
import { byStart, rangeId, rangesBetween, type DateRange } from "./ranges";

const note = (path: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title: path.replace(/^.*\/|\.md$/g, ""),
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...extra,
});

const item = (path: string, day: string, extra: Partial<DateItem> = {}): DateItem => ({ path, note: note(path), key: "due", day, tag: null, ...extra });

const task = (text: string, due: string, extra: Partial<TaskRow> = {}): TaskRow => ({ path: "plan.md", title: "Plan", icon: null, line: 0, done: false, text, due, ...extra });

const range = (path: string, start: string, end: string, extra: Partial<DateRange> = {}): DateRange => ({ path, note: note(path), startKey: "start", endKey: "end", start, end, tag: null, ...extra });

const TASK: TagSchema = {
  name: "task",
  color: "green",
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["Todo", "Doing", "Done"] },
    { key: "due", type: "date", options: [] },
  ],
};

describe("periods", () => {
  it("draws six weeks for a month and seven days for a week", () => {
    const month = periodDays("2026-09-24", "month");
    expect(month).toHaveLength(6);
    expect(month[0]![0]).toBe("2026-08-31");
    expect(periodDays("2026-09-24", "week")).toEqual([["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]]);
  });

  it("lists a month's own days for the agenda, and steps and names it as a month", () => {
    const [days] = periodDays("2026-09-24", "agenda");
    expect(days).toHaveLength(30);
    expect([days![0], days!.at(-1)]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(periodDays("2027-02-10", "agenda")[0]).toHaveLength(28);
    expect(shiftAnchor("2026-09-24", "agenda", 1, "2026-09-24")).toBe("2026-10-01");
    expect(periodTitle("2026-09-24", "agenda")).toBe(periodTitle("2026-09-24", "month"));
  });

  it("steps a month to its first day, or to today in today's month", () => {
    expect(shiftAnchor("2026-09-24", "month", 1, "2026-09-24")).toBe("2026-10-01");
    expect(shiftAnchor("2026-10-01", "month", -1, "2026-09-24")).toBe("2026-09-24");
    expect(shiftAnchor("2026-01-31", "month", -1, "2026-09-24")).toBe("2025-12-01");
    expect(shiftAnchor("2026-12-15", "month", 1, "2026-09-24")).toBe("2027-01-01");
  });

  it("steps a week by seven days", () => {
    expect(shiftAnchor("2026-09-24", "week", 1, "2026-09-24")).toBe("2026-10-01");
    expect(shiftAnchor("2026-01-02", "week", -1, "2026-09-24")).toBe("2025-12-26");
  });

  it("names a month, and a week by its first and last day", () => {
    expect(periodTitle("2026-09-24", "month")).toBe(new Date(2026, 8, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
    const week = periodTitle("2026-09-30", "week");
    // The week of 30 September runs into October: both months are named.
    expect(week).toContain(new Date(2026, 8, 28).toLocaleDateString(undefined, { month: "long" }));
    expect(week).toContain(new Date(2026, 9, 4).toLocaleDateString(undefined, { month: "long" }));
    expect(week).toContain("2026");
  });

  it("names days as the rest of the app does, with one formatter", () => {
    for (const day of ["2026-09-24", "2026-01-01", "2027-02-28"]) expect(fullDay(day)).toBe(longDay(day));
  });

  it("labels a day briefly, with the year only when it is not this one", () => {
    expect(dayLabel("2026-10-02", "2026-09-24")).toBe(new Date(2026, 9, 2).toLocaleDateString(undefined, { month: "long", day: "numeric" }));
    expect(dayLabel("2027-01-03", "2026-09-24")).toContain("2027");
  });
});

describe("a day's entries", () => {
  it("puts notes before to-dos, open before done, then by title", () => {
    const done = item("b.md", "2026-10-01", { note: note("b.md", { title: "Alpha", props: { status: "Done" } }) });
    const open = item("c.md", "2026-10-01", { note: note("c.md", { title: "Zulu" }) });
    const first = item("a.md", "2026-10-01", { note: note("a.md", { title: "Mike" }) });
    const entries = dayEntries([done, open, first], [task("Call Bob", "2026-10-01")]);
    expect(entries.map((e) => (e.kind === "note" ? e.item.note.title : e.kind === "task" ? e.task.text : e.kind))).toEqual(["Mike", "Zulu", "Alpha", "Call Bob"]);
    expect(dayEntries([], [])).toEqual([]);
  });

  it("adds what mentions the day, then what was made on it, each note once", () => {
    const mention = (path: string) => ({ day: "2026-10-01", path, title: path, icon: null, kind: "page", snippet: "" });
    const entries = dayEntries(
      [item("a.md", "2026-10-01")],
      [task("Call Bob", "2026-10-01", { path: "b.md" })],
      [mention("a.md"), mention("c.md"), mention("b.md")],
      [note("d.md"), note("c.md"), note("a.md")],
    );
    const label = (e: (typeof entries)[number]) =>
      e.kind === "note" ? `note ${e.item.path}` : e.kind === "task" ? `task ${e.task.path}` : e.kind === "mention" ? `mention ${e.mention.path}` : e.kind === "made" ? `made ${e.note.path}` : e.kind;
    // A note already on the day as a date or a to-do is not listed again.
    expect(entries.map(label)).toEqual(["note a.md", "task b.md", "mention c.md", "made d.md"]);
  });

  it("shows every entry that fits, else one fewer and how many more", () => {
    expect(fit([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(fit([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2], more: 2 });
    expect(fit([1, 2, 3, 4, 5, 6], 3)).toEqual({ shown: [1, 2], more: 4 });
  });

  it("keeps an entry in view when asked, in place of the last one shown", () => {
    expect(fit([1, 2, 3, 4, 5], 3, (n) => n === 5)).toEqual({ shown: [1, 5], more: 3 });
    expect(fit([1, 2, 3, 4, 5], 3, (n) => n === 2)).toEqual({ shown: [1, 2], more: 3 });
  });

  it("counts bars that do not fit in “+N more”, which then needs its line", () => {
    expect(fit([1, 2], 2, undefined, 0)).toEqual({ shown: [1, 2], more: 0 });
    expect(fit([1, 2], 2, undefined, 1)).toEqual({ shown: [1], more: 2 });
    expect(fit([1], 1, undefined, 2)).toEqual({ shown: [], more: 3 });
    expect(fit([], 1, undefined, 2)).toEqual({ shown: [], more: 2 });
    // Lanes can take every line but the one "+N more" needs.
    expect(fit([1, 2, 3], 1)).toEqual({ shown: [], more: 3 });
    expect(fit([1], 1)).toEqual({ shown: [1], more: 0 });
    expect(fit([], 0)).toEqual({ shown: [], more: 0 });
  });

  it("drops the day a to-do names from its text, as its cell says it", () => {
    const day = "2026-09-26";
    expect(taskText(task("Buy oat milk @2026-09-26", day))).toBe("Buy oat milk");
    expect(taskText(task("Pick up the parcel [[2026-09-26]]", day))).toBe("Pick up the parcel");
    expect(taskText(task("Pick up the parcel 2026-09-26", day))).toBe("Pick up the parcel");
    expect(taskText(task("📅 2026-09-26 Call the venue", day))).toBe("Call the venue");
    expect(taskText(task("Due @2026-09-26 after the 2026-09-01 review", day))).toBe("Due after the 2026-09-01 review");
    expect(taskText(task("2026-09-26", day))).toBe("2026-09-26");
  });

  it("reads a status of done, in any case", () => {
    expect(isDone(note("a.md", { props: { status: "Done" } }))).toBe(true);
    expect(isDone(note("a.md", { props: { status: "completed" } }))).toBe(true);
    expect(isDone(note("a.md", { props: { status: "Doing" } }))).toBe(false);
    expect(isDone(note("a.md"))).toBe(false);
  });

  it("colours a chip by its tag, else by the note's first coloured tag", () => {
    const colors = new Map([
      ["task", "green"],
      ["travel", "teal"],
      ["odd", "chartreuse"],
      ["paper", "blue"],
    ]);
    const tone = (name: string) => ({ fg: `var(--notion-${name})`, bg: `var(--notion-${name}-bg)` });
    expect(chipTone(item("a.md", "2026-10-01", { tag: "task" }), colors)).toEqual(tone("green"));
    // Teal is teal, as in the Tag Database; a colour written as #hex keeps its own.
    expect(chipTone(item("a.md", "2026-10-01", { note: note("a.md", { tags: ["plain", "Travel"] }) }), colors)).toEqual(tone("teal"));
    expect(chipTone(item("a.md", "2026-10-01", { note: note("a.md", { tags: ["odd"] }) }), colors)).toEqual(tone("gray"));
    expect(chipTone(item("a.md", "2026-10-01", { note: note("a.md", { tags: ["brand"] }) }), new Map([["brand", "#ff8800"]]))?.fg).toBe("#ff8800");
    expect(chipTone(item("a.md", "2026-10-01"), colors)).toBeNull();
    // Ranges take their tone the same way.
    expect(chipTone(range("t.md", "2026-10-01", "2026-10-03", { tag: "paper" }), colors)).toEqual(tone("blue"));
  });

  it("names a range briefly, with the year only when it is not this one", () => {
    const short = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
    expect(rangeLabel("2026-10-01", "2026-10-05", "2026-09-24")).toBe(short.formatRange(new Date(2026, 9, 1), new Date(2026, 9, 5)));
    expect(rangeLabel("2026-10-01", "2026-10-01", "2026-09-24")).toBe(dayLabel("2026-10-01", "2026-09-24"));
    expect(rangeLabel("2026-12-30", "2027-01-02", "2026-09-24")).toContain("2027");
    const brief = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
    expect(briefRange("2026-09-23", "2026-09-28", "2026-09-24")).toBe(brief.formatRange(new Date(2026, 8, 23), new Date(2026, 8, 28)));
    expect(briefRange("2026-09-23", "2026-09-23", "2026-09-24")).toBe(brief.format(new Date(2026, 8, 23)));
    expect(briefRange("2027-01-02", "2027-01-04", "2026-09-24")).toContain("2027");
  });
});

describe("moving", () => {
  it("moves a value's day and keeps any time after it", () => {
    expect(movedValue("2026-10-01", "2026-10-03")).toBe("2026-10-03");
    expect(movedValue("2026-10-01T09:30:00+02:00", "2026-10-03")).toBe("2026-10-03T09:30:00+02:00");
    expect(movedValue(" 2026-10-01 ", "2026-10-03")).toBe("2026-10-03");
    expect(movedValue(undefined, "2026-10-03")).toBe("2026-10-03");
  });

  it("shows items on the day they are moving to", () => {
    const a = item("a.md", "2026-10-01");
    const b = item("b.md", "2026-10-02");
    const items = [a, b];
    expect(withMoves(items, new Map())).toBe(items);
    const moved = withMoves(items, new Map([[itemId(a), ["2026-10-05"]]]));
    expect(moved.map((i) => i.day)).toEqual(["2026-10-05", "2026-10-02"]);
    expect(moved[1]).toBe(b);
    expect(itemId(a)).not.toBe(itemId({ ...a, key: "start" }));
  });

  it("shows ranges where they are moving to, still in order", () => {
    const a = range("a.md", "2026-10-01", "2026-10-03");
    const b = range("b.md", "2026-10-02", "2026-10-06");
    const c = range("c.md", "2026-10-04", "2026-10-04");
    const list = [a, b, c];
    expect(withRangeMoves(list, new Map())).toBe(list);
    expect(withRangeMoves(list, new Map([["other.md#due", ["2026-10-09"]]]))).toBe(list);
    const moved = withRangeMoves(list, new Map([[rangeId(a), ["2026-10-05", "2026-10-07"]]]));
    expect(moved.map((r) => `${r.path} ${r.start} ${r.end}`)).toEqual(["b.md 2026-10-02 2026-10-06", "c.md 2026-10-04 2026-10-04", "a.md 2026-10-05 2026-10-07"]);
    expect(moved[0]).toBe(b);
  });

  it("lands a dropped chip on the day, and a range as far as it was carried", () => {
    const trip = range("trip.md", "2026-09-25", "2026-09-29");
    expect(landing({ kind: "item", item: item("a.md", "2026-10-01") }, "2026-10-04")).toEqual({ start: "2026-10-04", end: "2026-10-04" });
    // Held by its third day and dropped two days later: both ends move two days.
    expect(landing({ kind: "range", range: trip, from: "2026-09-27" }, "2026-09-29")).toEqual({ start: "2026-09-27", end: "2026-10-01" });
    expect(landing({ kind: "range", range: trip, from: "2026-09-25" }, "2026-09-18")).toEqual({ start: "2026-09-18", end: "2026-09-22" });
  });

  it("moves only a range's end when its edge is dragged, never before its start", () => {
    const trip = range("trip.md", "2026-09-25", "2026-09-29");
    expect(landing({ kind: "end", range: trip }, "2026-10-03")).toEqual({ start: "2026-09-25", end: "2026-10-03" });
    expect(landing({ kind: "end", range: trip }, "2026-09-26")).toEqual({ start: "2026-09-25", end: "2026-09-26" });
    expect(landing({ kind: "end", range: trip }, "2026-09-20")).toEqual({ start: "2026-09-25", end: "2026-09-25" });
    // Nor so far that it would stop being a range.
    expect(landing({ kind: "end", range: trip }, "2028-01-01")).toEqual({ start: "2026-09-25", end: "2027-09-25" });
  });

  it("maps Alt+arrows to days and weeks, and nothing else", () => {
    const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    expect(nudgeDays(key("ArrowLeft"))).toBe(-1);
    expect(nudgeDays(key("ArrowRight"))).toBe(1);
    expect(nudgeDays(key("ArrowUp"))).toBe(-7);
    expect(nudgeDays(key("ArrowDown"))).toBe(7);
    expect(nudgeDays(key("ArrowRight", { altKey: false }))).toBeNull();
    expect(nudgeDays(key("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(nudgeDays(key("Enter"))).toBeNull();
  });

  it("maps Alt+Shift+←/→ to a range's end a day earlier or later", () => {
    const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: true, ...extra });
    expect(stretchDays(key("ArrowRight"))).toBe(1);
    expect(stretchDays(key("ArrowLeft"))).toBe(-1);
    expect(stretchDays(key("ArrowDown"))).toBeNull();
    expect(stretchDays(key("ArrowRight", { shiftKey: false }))).toBeNull();
    expect(stretchDays(key("ArrowRight", { metaKey: true }))).toBeNull();
    expect(nudgeDays(key("ArrowRight"))).toBeNull();
  });

  it("maps plain keys to the calendar's moves", () => {
    const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    expect(calendarKey(key("ArrowLeft"))).toBe("prev");
    expect(calendarKey(key("ArrowRight"))).toBe("next");
    expect(calendarKey(key("t"))).toBe("today");
    expect(calendarKey(key("T", { shiftKey: true }))).toBe("today");
    expect(calendarKey(key("m"))).toBe("month");
    expect(calendarKey(key("w"))).toBe("week");
    expect(calendarKey(key("a"))).toBe("agenda");
    expect(calendarKey(key("ArrowLeft", { altKey: true }))).toBeNull();
    expect(calendarKey(key("t", { ctrlKey: true }))).toBeNull();
    expect(calendarKey(key("x"))).toBeNull();
  });
});

describe("speed", () => {
  it("lays out a month of 10,000 dated notes quickly", () => {
    const notes: NoteMeta[] = [];
    for (let i = 0; i < 10_000; i++) {
      const day = addDays("2026-01-01", i % 365);
      const props: Record<string, unknown> = i % 3 === 0 ? { status: "Todo", due: day } : i % 3 === 1 ? { start: day, end: addDays(day, 3) } : { deadline: day };
      notes.push(note(`library/n${i}.md`, { title: `note ${i}`, tags: i % 3 === 0 ? ["task"] : [], props }));
    }
    const schemas = [TASK];
    const t = performance.now();
    const items = dateItems(notes, schemas);
    const ranges = dateRanges(notes, schemas);
    const days = byDay(withMoves(items, new Map([[itemId(items[0]!), ["2026-09-24"]]])));
    const weeks = periodDays("2026-09-24", "month");
    const shown = rangesBetween(withRangeMoves(ranges, new Map([[rangeId(ranges[0]!), ["2026-09-24", "2026-09-27"]]])), weeks[0]![0]!, weeks[5]![6]!);
    for (const week of weeks) {
      const bars = weekBars(shown, week);
      const singles = week.map((day) => days.get(day)?.length ?? 0);
      const fitted = fitBars(bars, 3, singles);
      week.forEach((day, col) => fit(dayEntries(days.get(day)), 3 - fitted.days[col]!.lanes, undefined, fitted.days[col]!.hidden));
    }
    const spent = performance.now() - t;
    expect(items.length).toBeGreaterThan(6_000);
    expect(ranges.length).toBeGreaterThan(3_000);
    expect([...ranges].sort(byStart)).toEqual(ranges);
    // Generous for slow CI machines; a few milliseconds on a laptop.
    expect(spent).toBeLessThan(250);
  });
});

describe("new tasks", () => {
  it("carry the task tag's due day and a Todo status", () => {
    expect(newTaskProps(TASK, "2026-10-02")).toEqual({ due: "2026-10-02", status: "Todo" });
    expect(newTaskProps(undefined, "2026-10-02")).toEqual({ due: "2026-10-02", status: "Todo" });
  });

  it("follow a schema that names things its own way", () => {
    const custom: TagSchema = {
      ...TASK,
      properties: [
        { key: "state", type: "select", options: ["Open", "Closed"] },
        { key: "status", type: "select", options: ["Backlog", "Active"] },
        { key: "when", type: "date", options: [] },
      ],
    };
    expect(newTaskProps(custom, "2026-10-02")).toEqual({ when: "2026-10-02", status: "Backlog" });
    const bare: TagSchema = { ...TASK, properties: [{ key: "due", type: "date", options: [] }] };
    expect(newTaskProps(bare, "2026-10-02")).toEqual({ due: "2026-10-02" });
  });
});
