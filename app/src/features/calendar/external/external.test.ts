import { describe, expect, it } from "vitest";

import { byTime, freshness, hoursOf, partsByDay, partsOf, shownEvents, whenText } from "./external";
import type { CalendarInfo, ExternalEvent } from "./types";

let n = 0;
function event(over: Partial<ExternalEvent>): ExternalEvent {
  n += 1;
  return { calendar: "cal", id: `e${n}`, uid: `u${n}`, title: `Event ${n}`, allDay: false, start: "2026-10-12T09:00", end: "2026-10-12T10:00", location: null, description: null, link: null, tentative: false, zoneGuess: false, ...over };
}

const calendar = (over: Partial<CalendarInfo>): CalendarInfo => ({ id: "cal", name: "Work", color: "blue", refreshMinutes: 30, shown: true, host: "x.example", masked: "x.example/…", lastUpdated: null, lastChecked: null, error: null, ...over });

describe("placing events on days", () => {
  it("puts a timed event on its day with its hours", () => {
    const [part, ...rest] = partsOf(event({ start: "2026-10-12T09:00", end: "2026-10-12T10:30" }), "2026-10-01", "2026-10-31");
    expect(rest).toEqual([]);
    expect(part).toMatchObject({ day: "2026-10-12", at: "09:00", until: "10:30", span: null });
    expect(hoursOf(part!)).toBe("09:00–10:30");
  });

  it("puts an all-day event on each day it covers, with its place in them", () => {
    const parts = partsOf(event({ allDay: true, start: "2026-10-20", end: "2026-10-22" }), "2026-10-01", "2026-10-31");
    expect(parts.map((p) => [p.day, p.at, p.span])).toEqual([
      ["2026-10-20", null, [1, 3]],
      ["2026-10-21", null, [2, 3]],
      ["2026-10-22", null, [3, 3]],
    ]);
    expect(hoursOf(parts[0]!)).toBeNull();
  });

  it("splits a timed event that runs past midnight, each day with its own hours", () => {
    const parts = partsOf(event({ start: "2026-10-30T23:30", end: "2026-11-01T01:15" }), "2026-10-01", "2026-11-30");
    expect(parts.map((p) => [p.day, p.at, p.until, p.span])).toEqual([
      ["2026-10-30", "23:30", "24:00", [1, 3]],
      ["2026-10-31", "00:00", "24:00", [2, 3]],
      ["2026-11-01", "00:00", "01:15", [3, 3]],
    ]);
    // Only the days of the range are kept.
    expect(partsOf(event({ start: "2026-10-30T23:30", end: "2026-11-01T01:15" }), "2026-10-31", "2026-10-31").map((p) => p.day)).toEqual(["2026-10-31"]);
  });

  it("does not touch the day an event ends at midnight", () => {
    const parts = partsOf(event({ start: "2026-11-20T20:00", end: "2026-11-21T00:00" }), "2026-11-01", "2026-11-30");
    expect(parts.map((p) => [p.day, p.at, p.until])).toEqual([["2026-11-20", "20:00", "24:00"]]);
    expect(partsOf(event({ start: "2026-11-20T20:00", end: "2026-11-21T00:00" }), "2026-11-21", "2026-11-21")).toEqual([]);
  });

  it("keeps an event with no length to its start", () => {
    const [part] = partsOf(event({ start: "2026-10-15T17:00", end: "2026-10-15T17:00" }), "2026-10-01", "2026-10-31");
    expect(part).toMatchObject({ at: "17:00", until: "17:00" });
    expect(hoursOf(part!)).toBe("17:00");
  });

  it("leaves out an event outside the days asked for", () => {
    expect(partsOf(event({ start: "2026-12-01T09:00", end: "2026-12-01T10:00" }), "2026-10-01", "2026-10-31")).toEqual([]);
    expect(partsOf(event({ allDay: true, start: "2026-09-29", end: "2026-09-30" }), "2026-10-01", "2026-10-31")).toEqual([]);
    // An all-day event that began before the range still shows in it.
    expect(partsOf(event({ allDay: true, start: "2026-09-29", end: "2026-10-02" }), "2026-10-01", "2026-10-31").map((p) => [p.day, p.span])).toEqual([
      ["2026-10-01", [3, 4]],
      ["2026-10-02", [4, 4]],
    ]);
  });

  it("orders a day: all-day first, then by time, then by title", () => {
    const events = [
      event({ title: "Lunch", start: "2026-10-12T12:00", end: "2026-10-12T13:00" }),
      event({ title: "Holiday", allDay: true, start: "2026-10-12", end: "2026-10-12" }),
      event({ title: "Standup", start: "2026-10-12T09:00", end: "2026-10-12T09:15" }),
      event({ title: "Another", start: "2026-10-12T09:00", end: "2026-10-12T09:30" }),
    ];
    const day = partsByDay(events, "2026-10-12", "2026-10-12").get("2026-10-12")!;
    expect(day.map((p) => p.event.title)).toEqual(["Holiday", "Another", "Standup", "Lunch"]);
    expect([...day].sort(byTime).map((p) => p.event.title)).toEqual(day.map((p) => p.event.title));
  });

  it("gives each part of each event its own key", () => {
    const parts = partsOf(event({ allDay: true, start: "2026-10-20", end: "2026-10-22" }), "2026-10-01", "2026-10-31");
    expect(new Set(parts.map((p) => p.key)).size).toBe(3);
  });
});

describe("what is shown", () => {
  it("leaves out the events of hidden calendars, once the calendars are known", () => {
    const a = event({ calendar: "a" });
    const b = event({ calendar: "b" });
    const list = [calendar({ id: "a" }), calendar({ id: "b", shown: false })];
    expect(shownEvents([a, b], list)).toEqual([a]);
    expect(shownEvents([a, b], null)).toEqual([a, b]);
  });

  it("says when an event is, in words", () => {
    expect(whenText(event({ start: "2026-10-12T09:00", end: "2026-10-12T09:30" }))).toContain("09:00–09:30");
    expect(whenText(event({ start: "2026-10-12T09:00", end: "2026-10-12T09:00" }))).toMatch(/, 09:00$/);
    expect(whenText(event({ allDay: true, start: "2026-10-12", end: "2026-10-12" }))).toMatch(/, all day$/);
    expect(whenText(event({ allDay: true, start: "2026-10-20", end: "2026-10-22" }))).toMatch(/, 3 days$/);
    expect(whenText(event({ start: "2026-10-30T23:30", end: "2026-10-31T00:30" }))).toMatch(/23:30 to .*00:30$/);
  });

  it("says how fresh a calendar is, and that it is the last copy when it could not be refreshed", () => {
    const now = Date.UTC(2026, 9, 12, 12, 0, 0);
    expect(freshness({ lastUpdated: null, error: null }, now)).toBe("Not fetched yet");
    expect(freshness({ lastUpdated: now / 1000 - 5 * 60, error: null }, now)).toBe("Updated 5 minutes ago");
    const stale = freshness({ lastUpdated: now / 1000 - 3 * 3600, error: "Could not reach x" }, now);
    expect(stale).toContain("Updated 3 hours ago");
    expect(stale).toContain("showing the last copy");
  });
});
