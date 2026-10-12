import { describe, expect, it } from "vitest";

import { stackSpans } from "../lanes";
import type { Entry } from "../layout";
import { HOUR_PX, minutesOf, placeBlocks, POINT_MINUTES, splitDay, startHour } from "./hours";
import type { EventPart } from "./types";

let n = 0;
function part(at: string | null, until: string | null, title = `Event ${++n}`): EventPart {
  const event = { calendar: "cal", id: `e${n}`, uid: `u${n}`, title, allDay: at === null, start: "2026-10-12", end: "2026-10-12", location: null, description: null, link: null, tentative: false, zoneGuess: false };
  return { event, day: "2026-10-12", at, until, span: null, key: `cal:e${n}:2026-10-12` };
}

const entry = (at: string | null, until: string | null = null, title?: string): Entry => ({ kind: "event", part: part(at, until, title) });
const task = (at: string | null): Entry => ({ kind: "task", task: { path: "p.md", title: "P", icon: null, line: 1, done: false, text: "Call", due: "2026-10-12", at } });

describe("minutes of a clock time", () => {
  it("counts from midnight, and 24:00 is the day's end", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("09:30")).toBe(570);
    expect(minutesOf("24:00")).toBe(1440);
  });
});

describe("overlapping spans share the day's width", () => {
  const lanes = (spans: [number, number][]) => stackSpans(spans.map(([start, end]) => ({ start, end }))).map((s) => `${s.lane}/${s.lanes}`);

  it("gives a lone span the whole width", () => {
    expect(lanes([[60, 120]])).toEqual(["0/1"]);
    expect(lanes([])).toEqual([]);
  });

  it("puts spans that only touch side by side in no column", () => {
    // 9-10 and 10-11 do not overlap: each has the full width.
    expect(lanes([[540, 600], [600, 660]])).toEqual(["0/1", "0/1"]);
  });

  it("shares the width of a run of overlapping spans, in the order they start", () => {
    expect(lanes([[540, 600], [570, 630]])).toEqual(["0/2", "1/2"]);
    // Three at once; the third starts when the first is over and takes its column.
    expect(lanes([[540, 600], [550, 660], [610, 700]])).toEqual(["0/2", "1/2", "0/2"]);
    // A long one beside two short ones that do not overlap each other.
    expect(lanes([[540, 720], [550, 600], [610, 660]])).toEqual(["0/2", "1/2", "1/2"]);
  });

  it("keeps separate runs separate, in the order given", () => {
    expect(lanes([[900, 960], [540, 600], [570, 630], [1000, 1100]])).toEqual(["0/1", "0/2", "1/2", "0/1"]);
  });

  it("gives longer spans the earlier column when they start together", () => {
    expect(lanes([[540, 570], [540, 660]])).toEqual(["1/2", "0/2"]);
  });
});

describe("a day's hours", () => {
  it("splits what has an hour from what has none", () => {
    const day = splitDay([entry(null), entry("09:00", "10:30", "Meeting"), task("14:00"), task(null)]);
    expect(day.allDay.map((e) => e.kind)).toEqual(["event", "task"]);
    expect(day.timed.map((b) => [b.entry.kind, b.start, b.end])).toEqual([
      ["event", 540, 630],
      ["task", 840, 840 + POINT_MINUTES],
    ]);
  });

  it("gives a short event or a to-do a short stretch to be seen in", () => {
    const [short, point] = splitDay([entry("09:00", "09:05"), task("10:00")]).timed;
    expect(short!.end - short!.start).toBe(POINT_MINUTES);
    expect(point!.end - point!.start).toBe(POINT_MINUTES);
  });

  it("keeps a late event inside the day", () => {
    const [late] = splitDay([entry("23:50", "24:00")]).timed;
    expect(late!.end).toBe(1440);
    expect(late!.start).toBeLessThanOrEqual(1440 - POINT_MINUTES);
  });

  it("places blocks by the hour and the columns they share", () => {
    const placed = placeBlocks(splitDay([entry("09:00", "10:30", "A"), entry("09:30", "10:00", "B"), entry("13:00", "14:00", "C")]).timed);
    expect(placed.map((p) => [p.top, p.height, `${p.lane}/${p.lanes}`])).toEqual([
      [9 * HOUR_PX, 1.5 * HOUR_PX, "0/2"],
      [9.5 * HOUR_PX, 0.5 * HOUR_PX, "1/2"],
      [13 * HOUR_PX, HOUR_PX, "0/1"],
    ]);
  });
});

describe("where the grid opens", () => {
  const block = (clock: string) => splitDay([entry(clock, "24:00")]).timed[0]!;

  it("opens at an hour before now in the current week", () => {
    expect(startHour([block("09:00")], new Date(2026, 9, 12, 15, 20))).toBe(14);
    expect(startHour([], new Date(2026, 9, 12, 0, 5))).toBe(0);
  });

  it("opens at 7:00, or earlier when something is earlier", () => {
    expect(startHour([], null)).toBe(7);
    expect(startHour([block("09:00")], null)).toBe(7);
    expect(startHour([block("05:30")], null)).toBe(4);
    expect(startHour([block("00:30")], null)).toBe(0);
  });
});
