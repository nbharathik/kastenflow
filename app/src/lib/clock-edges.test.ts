// Days across midnight and clock changes. A day is not always 24 hours (the
// clocks go forward or back), so these walk a whole year, whatever time zone
// this computer is in: a zone with daylight saving walks through its changes.

import { describe, expect, it } from "vitest";

import { addDays, dateOf, dayFrom, daysBetween, isoDay, startOfWeek } from "./dates";
import { msToMidnight } from "./use-today";

const YEAR_START = new Date(2026, 0, 1);

describe("days across a year, in this time zone", () => {
  it("dayFrom steps one calendar day at a time, never skipping or repeating one", () => {
    let expected = "2026-01-01";
    for (let i = 0; i < 365; i++) {
      expect(dayFrom(i, YEAR_START)).toBe(expected);
      expected = addDays(expected, 1);
    }
    expect(expected).toBe("2027-01-01");
  });

  it("the next midnight is a midnight, at noon, at 00:30 and at 23:30 of every day", () => {
    for (let i = 0; i < 366; i++) {
      for (const [h, m] of [[0, 30], [12, 0], [23, 30]] as const) {
        const now = new Date(2026, 0, 1 + i, h, m);
        const next = new Date(now.getTime() + msToMidnight(now));
        expect([next.getHours(), next.getMinutes()]).toEqual([0, 0]);
        expect(isoDay(next)).toBe(addDays(isoDay(now), 1));
      }
    }
  });

  it("whole days between two days ignore the length of the days in between", () => {
    for (let i = 0; i < 365; i += 7) {
      const from = dayFrom(i, YEAR_START);
      expect(daysBetween(from, addDays(from, 30))).toBe(30);
      expect(daysBetween(addDays(from, 30), from)).toBe(-30);
    }
  });

  it("a week starts on its first day all year, even over a change of the clocks", () => {
    for (let i = 0; i < 365; i++) {
      const date = new Date(2026, 0, 1 + i, 12);
      const start = startOfWeek(date, 1);
      expect(start.getDay()).toBe(1);
      expect(start.getHours()).toBe(0);
      expect(daysBetween(isoDay(start), isoDay(date))).toBeLessThan(7);
      expect(daysBetween(isoDay(start), isoDay(date))).toBeGreaterThanOrEqual(0);
    }
  });

  it("a day written as text comes back as the same day", () => {
    for (let i = 0; i < 366; i++) {
      const day = dayFrom(i, YEAR_START);
      expect(isoDay(dateOf(day))).toBe(day);
    }
  });

  it("never waits less than a second for the next midnight", () => {
    expect(msToMidnight(new Date(2026, 9, 29, 23, 59, 59, 900))).toBe(1000);
  });
});
