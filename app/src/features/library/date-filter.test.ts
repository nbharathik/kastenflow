import { describe, expect, it } from "vitest";

import { dateFilterLabel, dateFilterSpan, monthFilter, rangeEnds, rangeFilter, readDateFilter, spanOfValue, updatedSince } from "./date-filter";

// Thursday 24 September 2026, 15:00 local time.
const NOW = new Date(2026, 8, 24, 15, 0).getTime();
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe("dateFilterSpan", () => {
  it("is nothing for any time", () => {
    expect(dateFilterSpan("any", NOW)).toBeNull();
  });

  it("reads today and the months around it", () => {
    expect(dateFilterSpan("today", NOW)).toEqual({ from: day(2026, 9, 24), to: day(2026, 9, 25) });
    expect(dateFilterSpan("month", NOW)).toEqual({ from: day(2026, 9, 1), to: day(2026, 10, 1) });
    expect(dateFilterSpan("last-month", NOW)).toEqual({ from: day(2026, 8, 1), to: day(2026, 9, 1) });
  });

  it("crosses a year for last month in January", () => {
    const january = new Date(2027, 0, 15, 9).getTime();
    expect(dateFilterSpan("last-month", january)).toEqual({ from: day(2026, 12, 1), to: day(2027, 1, 1) });
  });

  it("starts weeks on Monday, or the day asked for", () => {
    expect(dateFilterSpan("week", NOW)).toEqual({ from: day(2026, 9, 21), to: day(2026, 9, 28) });
    expect(dateFilterSpan("last-week", NOW)).toEqual({ from: day(2026, 9, 14), to: day(2026, 9, 21) });
    expect(dateFilterSpan("week", NOW, 0)).toEqual({ from: day(2026, 9, 20), to: day(2026, 9, 27) });
    expect(dateFilterSpan("last-week", NOW, 0)).toEqual({ from: day(2026, 9, 13), to: day(2026, 9, 20) });
    expect(dateFilterSpan("week", NOW, 6)).toEqual({ from: day(2026, 9, 19), to: day(2026, 9, 26) });
  });

  it("reads a chosen month and a custom range, the last day included", () => {
    expect(dateFilterSpan("month:2026-02", NOW)).toEqual({ from: day(2026, 2, 1), to: day(2026, 3, 1) });
    expect(dateFilterSpan("month:2026-12", NOW)).toEqual({ from: day(2026, 12, 1), to: day(2027, 1, 1) });
    expect(dateFilterSpan("range:2026-09-10..2026-09-12", NOW)).toEqual({ from: day(2026, 9, 10), to: day(2026, 9, 13) });
    expect(dateFilterSpan("range:2026-09-10..", NOW)).toEqual({ from: day(2026, 9, 10), to: Number.POSITIVE_INFINITY });
    expect(dateFilterSpan("range:..2026-09-12", NOW)).toEqual({ from: Number.NEGATIVE_INFINITY, to: day(2026, 9, 13) });
  });
});

describe("updatedSince", () => {
  it("is where the filter's span starts, honouring the week start", () => {
    const sunday = new Date(2026, 8, 27, 10).getTime();
    expect(updatedSince("week", sunday)).toBe(day(2026, 9, 21));
    expect(updatedSince("week", sunday, 0)).toBe(day(2026, 9, 27));
    expect(updatedSince("month", sunday)).toBe(day(2026, 9, 1));
    expect(updatedSince("today", sunday)).toBe(day(2026, 9, 27));
    expect(updatedSince("any", sunday)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("spanOfValue", () => {
  it("reads a day, a month and a year", () => {
    expect(spanOfValue("2026-10-07")).toEqual({ from: day(2026, 10, 7), to: day(2026, 10, 8) });
    expect(spanOfValue("2026-10")).toEqual({ from: day(2026, 10, 1), to: day(2026, 11, 1) });
    expect(spanOfValue("2026")).toEqual({ from: day(2026, 1, 1), to: day(2027, 1, 1) });
  });

  it("reads a range with its units, and open ends", () => {
    expect(spanOfValue("2026-09-01..2026-09-15")).toEqual({ from: day(2026, 9, 1), to: day(2026, 9, 16) });
    expect(spanOfValue("2026-08..2026-09")).toEqual({ from: day(2026, 8, 1), to: day(2026, 10, 1) });
    expect(spanOfValue("2026-09-01..")).toEqual({ from: day(2026, 9, 1), to: Number.POSITIVE_INFINITY });
    expect(spanOfValue("..2026-09")).toEqual({ from: Number.NEGATIVE_INFINITY, to: day(2026, 10, 1) });
  });

  it("is null for what is no date, a day that does not exist, or a backwards range", () => {
    for (const text of ["", "soon", "2026-13", "2026-02-30", "2026-10-7", "..", "2026-10-05..2026-10-03", "a..b", "2026-02-29"]) {
      expect(spanOfValue(text), text).toBeNull();
    }
  });
});

describe("stored filters", () => {
  it("keep what reads and drop the rest", () => {
    expect(readDateFilter("week")).toBe("week");
    expect(readDateFilter("last-month")).toBe("last-month");
    expect(readDateFilter("month:2026-02")).toBe("month:2026-02");
    expect(readDateFilter("range:2026-09-01..2026-09-15")).toBe("range:2026-09-01..2026-09-15");
    expect(readDateFilter("range:2026-09-01..")).toBe("range:2026-09-01..");
    expect(readDateFilter("month:2026-13")).toBe("any");
    expect(readDateFilter("range:nonsense")).toBe("any");
    expect(readDateFilter("range:2026-09-01")).toBe("any");
    expect(readDateFilter("yesterday")).toBe("any");
    expect(readDateFilter(7)).toBe("any");
    expect(readDateFilter(undefined)).toBe("any");
  });

  it("are made from a month and from a range's days", () => {
    expect(monthFilter("2026-10")).toBe("month:2026-10");
    expect(monthFilter("")).toBe("any");
    expect(rangeFilter("2026-09-01", "2026-09-15")).toBe("range:2026-09-01..2026-09-15");
    expect(rangeFilter("2026-09-01", "")).toBe("range:2026-09-01..");
    expect(rangeFilter("", "2026-09-15")).toBe("range:..2026-09-15");
    expect(rangeFilter("", "")).toBe("any");
    expect(rangeFilter("2026-09-15", "2026-09-01")).toBe("any");
    expect(rangeEnds("range:2026-09-01..")).toEqual(["2026-09-01", ""]);
    expect(rangeEnds("week")).toEqual(["", ""]);
  });
});

describe("dateFilterLabel", () => {
  it("names presets, months and ranges", () => {
    expect(dateFilterLabel("any")).toBe("Any time");
    expect(dateFilterLabel("last-week")).toBe("Last week");
    expect(dateFilterLabel("month:2026-10")).toBe(new Date(2026, 9, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
    const sept1 = new Date(2026, 8, 1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    const sept15 = new Date(2026, 8, 15).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    expect(dateFilterLabel("range:2026-09-01..2026-09-15")).toBe(`${sept1} to ${sept15}`);
    expect(dateFilterLabel("range:2026-09-01..")).toBe(`From ${sept1}`);
    expect(dateFilterLabel("range:..2026-09-15")).toBe(`Until ${sept15}`);
  });
});
