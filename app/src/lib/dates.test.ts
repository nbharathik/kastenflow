import { describe, expect, it } from "vitest";

import { daysInMonth, isDay, isoDay, longDay, relativeTime, stampDay, startOfWeek } from "./dates";

describe("isDay", () => {
  it("accepts days that exist, leap days included", () => {
    expect(isDay("2026-10-01")).toBe(true);
    expect(isDay("2024-02-29")).toBe(true);
    expect(isDay("2000-02-29")).toBe(true);
    expect(isDay("2026-12-31")).toBe(true);
  });

  it("rejects days the calendar does not have", () => {
    expect(isDay("2026-13-45")).toBe(false);
    expect(isDay("2026-00-10")).toBe(false);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("1900-02-29")).toBe(false);
    expect(isDay("2026-04-31")).toBe(false);
    expect(isDay("2026-06-00")).toBe(false);
  });

  it("rejects text that is not shaped like a day", () => {
    expect(isDay("2026-1-01")).toBe(false);
    expect(isDay("2026-10-01 ")).toBe(false);
    expect(isDay("someday")).toBe(false);
  });
});

describe("daysInMonth", () => {
  it("knows the short months and leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("startOfWeek", () => {
  // 2026-10-07 is a Wednesday.
  const wednesday = new Date(2026, 9, 7);
  it("starts on the day asked for", () => {
    expect(isoDay(startOfWeek(wednesday, 1))).toBe("2026-10-05");
    expect(isoDay(startOfWeek(wednesday, 0))).toBe("2026-10-04");
    expect(isoDay(startOfWeek(wednesday, 6))).toBe("2026-10-03");
  });

  it("stays put on the first day itself and crosses months", () => {
    expect(isoDay(startOfWeek(new Date(2026, 9, 5), 1))).toBe("2026-10-05");
    expect(isoDay(startOfWeek(new Date(2026, 9, 1), 1))).toBe("2026-09-28");
  });
});

describe("longDay", () => {
  it("writes a day as the locale does", () => {
    const expected = new Date(2026, 8, 24).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    expect(longDay("2026-09-24")).toBe(expected);
  });

  it("leaves text that is not a day alone", () => {
    expect(longDay("someday")).toBe("someday");
  });

  it("formats thousands of days quickly", () => {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) longDay(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`);
    // Formatting with a new formatter per call took about 20 ms per 1,000.
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("relativeTime", () => {
  it("writes an older time as a short date", () => {
    const then = new Date(2026, 0, 5).getTime();
    const expected = new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    expect(relativeTime(then, new Date(2026, 8, 24).getTime())).toBe(expected);
  });

  it("says just now and yesterday", () => {
    const now = new Date(2026, 8, 24, 12).getTime();
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
  });
});

describe("stampDay", () => {
  it("reads the day as written, in any time zone", () => {
    const expected = new Date(2026, 8, 24).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    expect(stampDay("2026-09-24")).toBe(expected);
    expect(stampDay("2026-09-24T00:30:00+14:00")).toBe(expected);
    expect(stampDay("2026-09-24T23:30:00-11:00")).toBe(expected);
    expect(stampDay("someday")).toBe("");
  });
});
