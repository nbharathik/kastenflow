import { describe, expect, it } from "vitest";

import { parseWhen, whenMarkdown } from "./natural-date";

// Wednesday 7 October 2026, 10:30. Weeks start on Monday unless a test says so.
const NOW = new Date(2026, 9, 7, 10, 30);
const day = (text: string, options: { now?: Date; weekStart?: number } = {}) => parseWhen(text, { now: NOW, ...options })?.day ?? null;
const time = (text: string) => parseWhen(text, { now: NOW })?.time ?? null;

describe("days by name", () => {
  it("reads today, tomorrow and yesterday, even half typed", () => {
    expect(day("today")).toBe("2026-10-07");
    expect(day("tomorrow")).toBe("2026-10-08");
    expect(day("yesterday")).toBe("2026-10-06");
    expect(day("tod")).toBe("2026-10-07");
    expect(day("tom")).toBe("2026-10-08");
    expect(day("tmrw")).toBe("2026-10-08");
    expect(day("yest")).toBe("2026-10-06");
    expect(day("  Tomorrow ")).toBe("2026-10-08");
  });

  it("crosses the end of a month and a year", () => {
    const eve = new Date(2026, 11, 31, 8);
    expect(day("tomorrow", { now: eve })).toBe("2027-01-01");
    expect(day("yesterday", { now: new Date(2026, 10, 1) })).toBe("2026-10-31");
  });

  it("reads a weekday as the first one on or after today", () => {
    expect(day("friday")).toBe("2026-10-09");
    expect(day("fri")).toBe("2026-10-09");
    expect(day("wed")).toBe("2026-10-07");
    expect(day("mon")).toBe("2026-10-12");
    expect(day("tues")).toBe("2026-10-13");
    expect(day("thurs")).toBe("2026-10-08");
    expect(day("weds")).toBe("2026-10-07");
    expect(day("this fri")).toBe("2026-10-09");
    expect(day("sun")).toBe("2026-10-11");
  });

  it("reads next and last weekdays in the week after or before this one", () => {
    expect(day("next fri")).toBe("2026-10-16");
    expect(day("next monday")).toBe("2026-10-12");
    expect(day("next sun")).toBe("2026-10-18");
    expect(day("last fri")).toBe("2026-10-02");
    expect(day("last mon")).toBe("2026-09-28");
    expect(day("last sunday")).toBe("2026-10-04");
  });

  it("follows the day the week starts on", () => {
    // Sunday 11 October is the last day of a Monday week and the first of a Sunday one.
    const sunday = new Date(2026, 9, 11);
    expect(day("next mon", { now: sunday })).toBe("2026-10-12");
    expect(day("next mon", { now: sunday, weekStart: 0 })).toBe("2026-10-19");
    expect(day("next week", { now: sunday })).toBe("2026-10-12");
    expect(day("next week", { now: sunday, weekStart: 0 })).toBe("2026-10-18");
    expect(day("last week", { now: sunday, weekStart: 0 })).toBe("2026-10-04");
  });

  it("reads next week as the first day of next week", () => {
    expect(day("next week")).toBe("2026-10-12");
    expect(day("next week", { weekStart: 0 })).toBe("2026-10-11");
    expect(day("next week", { weekStart: 6 })).toBe("2026-10-10");
    expect(day("last week")).toBe("2026-09-28");
  });

  it("reads in N days, weeks and months", () => {
    expect(day("in 3 days")).toBe("2026-10-10");
    expect(day("in 1 day")).toBe("2026-10-08");
    expect(day("in 2 weeks")).toBe("2026-10-21");
    expect(day("in a week")).toBe("2026-10-14");
    expect(day("in 3d")).toBe("2026-10-10");
    expect(day("in 2w")).toBe("2026-10-21");
    expect(day("in 2 months")).toBe("2026-12-07");
    expect(day("in 1 month", { now: new Date(2027, 0, 31) })).toBe("2027-02-28");
    expect(day("in 30 days")).toBe("2026-11-06");
  });
});

describe("days by date", () => {
  it("reads a month and day, the next one coming", () => {
    expect(day("oct 12")).toBe("2026-10-12");
    expect(day("October 12")).toBe("2026-10-12");
    expect(day("oct 7")).toBe("2026-10-07");
    expect(day("oct 5")).toBe("2027-10-05");
    expect(day("jan 1")).toBe("2027-01-01");
    expect(day("sept 3")).toBe("2027-09-03");
    expect(day("12 oct")).toBe("2026-10-12");
    expect(day("12th of october")).toBe("2026-10-12");
    expect(day("oct 12th")).toBe("2026-10-12");
    expect(day("dec. 25")).toBe("2026-12-25");
  });

  it("keeps the year it is given, past or future", () => {
    expect(day("12 oct 2027")).toBe("2027-10-12");
    expect(day("oct 12 2027")).toBe("2027-10-12");
    expect(day("oct 12, 2027")).toBe("2027-10-12");
    expect(day("5 oct 2020")).toBe("2020-10-05");
  });

  it("waits for the next leap year for Feb 29", () => {
    expect(day("feb 29")).toBe("2028-02-29");
    expect(day("feb 29 2028")).toBe("2028-02-29");
  });

  it("rejects days that do not exist", () => {
    expect(day("feb 30")).toBeNull();
    expect(day("feb 29 2026")).toBeNull();
    expect(day("apr 31")).toBeNull();
    expect(day("oct 0")).toBeNull();
    expect(day("oct 32")).toBeNull();
    expect(day("2026-13-45")).toBeNull();
    expect(day("2026-02-29")).toBeNull();
    expect(day("2026-00-10")).toBeNull();
    expect(day("32 oct")).toBeNull();
  });

  it("reads ISO days", () => {
    expect(day("2026-10-07")).toBe("2026-10-07");
    expect(day("2024-02-29")).toBe("2024-02-29");
    expect(day("2026/10/07")).toBe("2026-10-07");
    expect(day("2026-1-5")).toBe("2026-01-05");
  });

  it("does not read a month name that is no month", () => {
    expect(day("octx 12")).toBeNull();
    expect(day("ma 12")).toBeNull();
    expect(day("banana 12")).toBeNull();
  });
});

describe("times", () => {
  it("reads 24-hour and 12-hour times", () => {
    expect(time("14:00")).toBe("14:00");
    expect(time("9:05")).toBe("09:05");
    expect(time("0:30")).toBe("00:30");
    expect(time("2pm")).toBe("14:00");
    expect(time("2 pm")).toBe("14:00");
    expect(time("2:30 pm")).toBe("14:30");
    expect(time("2:30pm")).toBe("14:30");
    expect(time("12am")).toBe("00:00");
    expect(time("12pm")).toBe("12:00");
    expect(time("12:15 am")).toBe("00:15");
    expect(time("9AM")).toBe("09:00");
  });

  it("reads noon, midnight and now", () => {
    expect(time("noon")).toBe("12:00");
    expect(time("midnight")).toBe("00:00");
    expect(time("now")).toBe("10:30");
    expect(time("at 3pm")).toBe("15:00");
    expect(time("@14:00")).toBe("14:00");
  });

  it("rejects times that do not exist", () => {
    expect(parseWhen("25:00", { now: NOW })).toBeNull();
    expect(parseWhen("9:60", { now: NOW })).toBeNull();
    expect(parseWhen("13pm", { now: NOW })).toBeNull();
    expect(parseWhen("0pm", { now: NOW })).toBeNull();
    expect(parseWhen("24:00", { now: NOW })).toBeNull();
    expect(parseWhen("fri 25:00", { now: NOW })).toBeNull();
  });

  it("makes today of a time alone, and says so", () => {
    expect(parseWhen("14:00", { now: NOW })).toEqual({ day: "2026-10-07", time: "14:00", dated: false });
    expect(parseWhen("now", { now: NOW })).toEqual({ day: "2026-10-07", time: "10:30", dated: false });
    expect(parseWhen("noon", { now: NOW })).toEqual({ day: "2026-10-07", time: "12:00", dated: false });
  });
});

describe("a day and a time together", () => {
  it("reads next fri 3pm", () => {
    expect(parseWhen("next fri 3pm", { now: NOW })).toEqual({ day: "2026-10-16", time: "15:00", dated: true });
  });

  it("reads the time before or after the day", () => {
    expect(parseWhen("tomorrow 9:05", { now: NOW })).toEqual({ day: "2026-10-08", time: "09:05", dated: true });
    expect(parseWhen("3pm tomorrow", { now: NOW })).toEqual({ day: "2026-10-08", time: "15:00", dated: true });
    expect(parseWhen("tomorrow at 9am", { now: NOW })).toEqual({ day: "2026-10-08", time: "09:00", dated: true });
    expect(parseWhen("2026-10-07 14:00", { now: NOW })).toEqual({ day: "2026-10-07", time: "14:00", dated: true });
    expect(parseWhen("oct 12 2pm", { now: NOW })).toEqual({ day: "2026-10-12", time: "14:00", dated: true });
    expect(parseWhen("12 oct 2027 noon", { now: NOW })).toEqual({ day: "2027-10-12", time: "12:00", dated: true });
    expect(parseWhen("in 3 days 9am", { now: NOW })).toEqual({ day: "2026-10-10", time: "09:00", dated: true });
    expect(parseWhen("fri, 3 pm", { now: NOW })).toEqual({ day: "2026-10-09", time: "15:00", dated: true });
  });

  it("gives no time to a day alone", () => {
    expect(parseWhen("friday", { now: NOW })).toEqual({ day: "2026-10-09", time: null, dated: true });
  });
});

describe("what is not a date", () => {
  it("is null", () => {
    for (const text of ["", "   ", "banana", "next", "last week fri", "this week", "12", "in", "in 3", "in 3 apples", "in a", "tomorrow 9", "2026"]) {
      expect(parseWhen(text, { now: NOW }), text).toBeNull();
    }
  });
});

describe("whenMarkdown", () => {
  it("writes the day as a link and the time as text", () => {
    expect(whenMarkdown({ day: "2026-10-07", time: "09:00", dated: true })).toBe("[[2026-10-07]] 09:00");
    expect(whenMarkdown({ day: "2026-10-07", time: null, dated: true })).toBe("[[2026-10-07]]");
  });
});
