import { describe, expect, it } from "vitest";

import { DAY_WIDTH, MAX_DAY, MIN_DAY, bands, boxOf, carry, dayAt, deltaDays, packRows, placeable, scaleOf, spanDays, ticks, viewSpan, widthOf, xOf, type Dates, type Grip } from "./layout";

describe("timeline layout: where days are", () => {
  it.each([
    ["month", "2026-10-01", "2026-10-01", 0],
    ["month", "2026-10-01", "2026-10-05", 4 * 14],
    ["month", "2026-02-01", "2026-03-01", 28 * 14],
    ["month", "2028-02-01", "2028-03-01", 29 * 14], // a leap February
    ["month", "2026-12-01", "2027-01-01", 31 * 14], // across a year
    ["month", "2026-12-31", "2026-12-01", -30 * 14], // before the origin
    ["week", "2026-10-01", "2026-10-03", 2 * 40],
    ["quarter", "2026-01-01", "2026-12-31", 364 * 4],
  ] as const)("%s scale: %s to %s is %i px", (scale, from, day, x) => {
    expect(xOf(day, from, scale)).toBe(x);
  });

  it("measures a span in days, both ends included, and in pixels", () => {
    expect(spanDays({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
    expect(spanDays({ from: "2028-02-01", to: "2028-02-29" })).toBe(29);
    expect(spanDays({ from: "2026-12-30", to: "2027-01-02" })).toBe(4);
    expect(widthOf({ from: "2026-10-01", to: "2026-10-31" }, "month")).toBe(31 * 14);
  });

  it("finds the day under a pixel and turns a travel into whole days", () => {
    expect(dayAt(0, "2026-10-01", "month")).toBe("2026-10-01");
    expect(dayAt(13.9, "2026-10-01", "month")).toBe("2026-10-01");
    expect(dayAt(14, "2026-10-01", "month")).toBe("2026-10-02");
    expect(dayAt(31 * 14, "2026-12-01", "month")).toBe("2027-01-01");
    expect(deltaDays(20, "month")).toBe(1);
    expect(deltaDays(6, "month")).toBe(0);
    expect(deltaDays(-6, "month")).toBe(0);
    expect(Object.is(deltaDays(-6, "month"), 0)).toBe(true);
    expect(deltaDays(-30, "month")).toBe(-2);
    expect(deltaDays(80, "week")).toBe(2);
    expect(deltaDays(80, "quarter")).toBe(20);
  });

  it("reads a scale from a view, month when it names none", () => {
    expect(scaleOf("week")).toBe("week");
    expect(scaleOf("quarter")).toBe("quarter");
    expect(scaleOf(undefined)).toBe("month");
    expect(scaleOf("decade")).toBe("month");
    expect(scaleOf(3)).toBe("month");
  });

  it("only places dates in a sane range", () => {
    expect(placeable("2026-10-23")).toBe(true);
    expect(placeable(MIN_DAY)).toBe(true);
    expect(placeable(MAX_DAY)).toBe(true);
    expect(placeable("0003-01-01")).toBe(false);
    expect(placeable("2999-01-01")).toBe(false);
  });
});

describe("timeline layout: the span of the grid", () => {
  it("covers today with room around it when nothing is dated, from a month's start to a month's end", () => {
    const span = viewSpan([], "2026-10-23", "month");
    expect(span).toEqual({ from: "2026-08-01", to: "2027-01-31" });
    expect(spanDays(span)).toBeGreaterThanOrEqual(150);
  });

  it("covers every date and today, whichever side today is on", () => {
    const span = viewSpan(["2026-03-10", "2026-04-02"], "2026-10-23", "month");
    expect(span.from <= "2026-02-08").toBe(true);
    expect(span.to >= "2026-11-22").toBe(true);
    expect(span.from.endsWith("-01")).toBe(true);
    const later = viewSpan(["2027-06-01"], "2026-10-23", "month");
    expect(later.from <= "2026-09-23").toBe(true);
    expect(later.to >= "2027-07-01").toBe(true);
  });

  it("starts on the first day of a quarter and ends on the last of one at the quarter scale", () => {
    const span = viewSpan(["2026-05-17", "2026-05-18"], "2026-05-17", "quarter");
    expect(span.from).toMatch(/-(01|04|07|10)-01$/);
    expect(span.to).toMatch(/-(03-31|06-30|09-30|12-31)$/);
    expect(span.from <= "2026-05-17" && span.to >= "2026-05-18").toBe(true);
  });

  it("pads a short span to the width of a screen, around today, in a leap year", () => {
    // 14 days either side of 10 February make 29; 13 more are shared out, and the ends snap to months.
    expect(viewSpan(["2028-02-10"], "2028-02-10", "week")).toEqual({ from: "2028-01-01", to: "2028-03-31" });
  });
});

describe("timeline layout: bars and markers", () => {
  it("makes a bar from start through end, the end day included", () => {
    expect(boxOf("2026-10-05", "2026-10-07", "2026-10-01", "month")).toEqual({ left: 56, width: 42 });
    expect(boxOf("2026-10-05", "2026-10-05", "2026-10-01", "month")).toEqual({ left: 56, width: 14 });
  });

  it("makes a marker one day wide when there is no end, or the end is before the start", () => {
    expect(boxOf("2026-10-05", null, "2026-10-01", "week")).toEqual({ left: 160, width: 40 });
    expect(boxOf("2026-10-05", "2026-10-02", "2026-10-01", "month")).toEqual({ left: 56, width: 14 });
  });

  it("places a bar that crosses a year and one in a leap February", () => {
    expect(boxOf("2026-12-30", "2027-01-02", "2026-12-01", "month")).toEqual({ left: 29 * 14, width: 4 * 14 });
    expect(boxOf("2028-02-27", "2028-03-01", "2028-02-01", "month")).toEqual({ left: 26 * 14, width: 4 * 14 }); // 27, 28, 29, Mar 1
  });
});

describe("timeline layout: header ticks and bands", () => {
  it("ticks every day at the week scale, strong on Mondays", () => {
    const list = ticks({ from: "2026-12-28", to: "2027-01-03" }, "week");
    expect(list.map((t) => t.label)).toEqual(["28", "29", "30", "31", "1", "2", "3"]);
    expect(list.filter((t) => t.strong).map((t) => t.day)).toEqual(["2026-12-28"]);
    expect(list[4]!.x).toBe(4 * DAY_WIDTH.week);
  });

  it("ticks every Monday at the month scale, strong for the first of a month", () => {
    const list = ticks({ from: "2026-12-01", to: "2026-12-31" }, "month");
    expect(list.map((t) => t.day)).toEqual(["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
    expect(list[0]!.x).toBe(6 * 14);
    expect(list.map((t) => t.strong)).toEqual([true, false, false, false]);
  });

  it("ticks every month at the quarter scale, strong for the first of a quarter", () => {
    const list = ticks({ from: "2026-01-01", to: "2026-12-31" }, "quarter");
    expect(list).toHaveLength(12);
    expect(list.filter((t) => t.strong).map((t) => t.day)).toEqual(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
    expect(list[1]!.x).toBe(31 * 4);
    expect(list.every((t) => t.title.length > 0)).toBe(true);
  });

  it("makes a band per month, with the true lengths, across a year end", () => {
    const list = bands({ from: "2026-12-01", to: "2027-01-31" }, "month");
    expect(list.map((b) => [b.day, b.x, b.width])).toEqual([
      ["2026-12-01", 0, 31 * 14],
      ["2027-01-01", 31 * 14, 31 * 14],
    ]);
    expect(list[0]!.label).toContain("2026");
    expect(list[1]!.label).toContain("2027");
  });

  it("gives February 29 days in a leap year and 28 in another", () => {
    expect(bands({ from: "2028-02-01", to: "2028-02-29" }, "week")).toEqual([expect.objectContaining({ width: 29 * 40 })]);
    expect(bands({ from: "2027-02-01", to: "2027-02-28" }, "week")).toEqual([expect.objectContaining({ width: 28 * 40 })]);
    expect(bands({ from: "2100-02-01", to: "2100-02-28" }, "month")[0]!.width).toBe(28 * 14); // 2100 is not a leap year
  });

  it("makes a band per year at the quarter scale, the last one cut at the span's end", () => {
    const list = bands({ from: "2026-10-01", to: "2027-03-31" }, "quarter");
    expect(list.map((b) => [b.label, b.x, b.width])).toEqual([
      ["2026", 0, 92 * 4],
      ["2027", 92 * 4, 90 * 4],
    ]);
  });
});

describe("timeline layout: carrying a bar", () => {
  const bar: Dates = { start: "2026-10-05", end: "2026-10-07" };
  const marker: Dates = { start: "2026-10-05", end: null };

  it.each([
    ["move", bar, 3, { start: "2026-10-08", end: "2026-10-10" }],
    ["move", bar, -5, { start: "2026-09-30", end: "2026-10-02" }],
    ["move", { start: "2026-12-30", end: "2027-01-02" }, 3, { start: "2027-01-02", end: "2027-01-05" }],
    ["move", { start: "2028-02-28", end: "2028-03-01" }, 1, { start: "2028-02-29", end: "2028-03-02" }],
    ["move", bar, 0, bar],
    ["start", bar, -4, { start: "2026-10-01", end: "2026-10-07" }],
    ["start", bar, 1, { start: "2026-10-06", end: "2026-10-07" }],
    ["start", bar, 5, { start: "2026-10-07", end: "2026-10-07" }], // cannot pass the end
    ["end", bar, 4, { start: "2026-10-05", end: "2026-10-11" }],
    ["end", bar, -1, { start: "2026-10-05", end: "2026-10-06" }],
    ["end", bar, -9, { start: "2026-10-05", end: "2026-10-05" }], // cannot go before the start
    ["move", marker, 2, { start: "2026-10-07", end: null }],
    ["start", marker, 2, { start: "2026-10-07", end: null }], // a marker has no edges: it moves
    ["end", marker, -2, { start: "2026-10-03", end: null }],
  ] as [Grip, Dates, number, Dates][])("%s by %i", (grip, dates, delta, expected) => {
    expect(carry(dates, grip, delta)).toEqual(expected);
  });

  it("moves an end before a start together, keeping the gap", () => {
    expect(carry({ start: "2026-10-05", end: "2026-10-02" }, "move", 2)).toEqual({ start: "2026-10-07", end: "2026-10-04" });
  });

  it("stops at the limits of the days it can place", () => {
    expect(carry({ start: "1970-01-02", end: null }, "move", -5)).toEqual({ start: MIN_DAY, end: null });
    expect(carry({ start: "1970-01-02", end: "1970-01-04" }, "move", -5)).toEqual({ start: MIN_DAY, end: "1970-01-03" });
    expect(carry({ start: "2100-12-30", end: "2100-12-31" }, "move", 9)).toEqual({ start: "2100-12-30", end: MAX_DAY });
    expect(carry({ start: "2100-12-30", end: "2100-12-31" }, "end", 9)).toEqual({ start: "2100-12-30", end: MAX_DAY });
  });
});

describe("timeline layout: rows of a lane", () => {
  it("puts bars that overlap in different rows and reuses a row once it is clear", () => {
    const { rows, count } = packRows([
      { id: "a", left: 0, right: 50 },
      { id: "b", left: 20, right: 70 },
      { id: "c", left: 60, right: 100 },
    ]);
    expect(count).toBe(2);
    expect([rows.get("a"), rows.get("b"), rows.get("c")]).toEqual([0, 1, 0]);
  });

  it("keeps a gap between neighbours in a row", () => {
    expect(packRows([{ id: "a", left: 0, right: 50 }, { id: "b", left: 55, right: 80 }]).count).toBe(2);
    expect(packRows([{ id: "a", left: 0, right: 50 }, { id: "b", left: 58, right: 80 }]).count).toBe(1);
    expect(packRows([{ id: "a", left: 0, right: 50 }, { id: "b", left: 51, right: 80 }], 0).count).toBe(1);
  });

  it("is steady whatever order the bars come in, and has one row when empty", () => {
    const list = [
      { id: "b", left: 10, right: 40 },
      { id: "a", left: 10, right: 40 },
      { id: "c", left: 0, right: 5 },
    ];
    const one = packRows(list);
    const two = packRows([...list].reverse());
    expect([...one.rows]).toEqual([...two.rows]);
    expect(packRows([]).count).toBe(1);
  });
});
