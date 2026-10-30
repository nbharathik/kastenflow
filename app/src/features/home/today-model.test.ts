// What Today lists for a given time of day: numeric order, what is over, what
// is next, overlaps, and the words for them.

import { describe, expect, it } from "vitest";

import type { TaskRow } from "../../lib/vault/types";
import type { EventPart } from "../calendar/external/types";
import { buildToday, inWords, minutesOf, namesOf, spanWords } from "./today-model";

const DAY = "2026-10-29";
let n = 0;
function part(title: string, at: string | null, until: string | null, span: [number, number] | null = null): EventPart {
  n += 1;
  const event = { calendar: "c", id: `e${n}`, uid: `u${n}`, title, allDay: at === null, start: DAY, end: DAY, location: null, description: null, link: null, tentative: false, zoneGuess: false };
  return { event, day: DAY, at, until, span, key: `k${n}` };
}
const row = (text: string, at: string | null = null): TaskRow => ({ path: "p.md", title: "P", icon: null, line: n++, done: false, text, due: DAY, at });

describe("minutesOf", () => {
  it("reads HH:MM as minutes, and 24:00 as the end of the day", () => {
    expect(minutesOf("09:05")).toBe(545);
    expect(minutesOf("9:05")).toBe(545);
    expect(minutesOf("24:00")).toBe(1440);
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf(null)).toBeNull();
    expect(minutesOf("soon")).toBeNull();
  });
});

describe("buildToday", () => {
  it("sorts by the number of minutes, not by the text of the time", () => {
    const day = buildToday([part("Late", "10:00", "11:00"), part("Early", "9:00", "9:30"), part("Noon", "12:00", "13:00")], [], DAY, 0);
    expect(day.upcoming.map((m) => m.part.event.title)).toEqual(["Early", "Late", "Noon"]);
  });

  it("splits what is over from the meeting on now and the ones to come, and names the next", () => {
    const day = buildToday([part("Standup", "09:00", "09:15"), part("Planning", "10:00", "11:00"), part("Lunch", "12:00", "13:00")], [], DAY, 10 * 60 + 30);
    expect(day.earlier.map((m) => m.part.event.title)).toEqual(["Standup"]);
    expect(day.upcoming.map((m) => m.part.event.title)).toEqual(["Planning", "Lunch"]);
    expect(day.next?.meeting.part.event.title).toBe("Lunch");
    expect(day.next?.minutes).toBe(90);
  });

  it("counts a meeting as over at the minute it ends", () => {
    const day = buildToday([part("Standup", "09:00", "09:15")], [], DAY, 9 * 60 + 15);
    expect(day.earlier).toHaveLength(1);
    expect(day.next).toBeNull();
  });

  it("keeps all-day events apart from the meetings", () => {
    const day = buildToday([part("Holiday", null, null), part("Standup", "09:00", "09:15")], [], DAY, 0);
    expect(day.allDay.map((p) => p.event.title)).toEqual(["Holiday"]);
    expect(day.upcoming).toHaveLength(1);
  });

  it("notices overlaps, but not the full-day piece of a long event", () => {
    const day = buildToday([part("A", "09:00", "10:00"), part("B", "09:30", "10:30"), part("C", "10:30", "11:00"), part("Offsite", "00:00", "24:00", [2, 3])], [], DAY, 0);
    const by = Object.fromEntries(day.upcoming.map((m) => [m.part.event.title, m.overlaps]));
    expect(by).toEqual({ A: ["B"], B: ["A"], C: [], Offsite: [] });
  });

  it("lists the to-dos due today: timed ones by minutes, then the rest", () => {
    const day = buildToday([], [row("Plain"), row("Ten", "10:30"), row("Nine", "9:05")], DAY, 0);
    expect(day.due.map((t) => t.row.text)).toEqual(["Nine", "Ten", "Plain"]);
  });
});

describe("words", () => {
  it("says how long until", () => {
    expect(inWords(0)).toBe("now");
    expect(inWords(12)).toBe("in 12 min");
    expect(inWords(60)).toBe("in 1 h");
    expect(inWords(80)).toBe("in 1 h 20 min");
  });
  it("says which day of a long event", () => {
    expect(spanWords(part("x", "00:00", "24:00", [2, 3]))).toBe("day 2 of 3");
    expect(spanWords(part("x", "09:00", "10:00"))).toBe("");
  });
  it("lists calendar names", () => {
    expect(namesOf([])).toBe("your calendar");
    expect(namesOf(["Work"])).toBe("Work");
    expect(namesOf(["Work", "Home"])).toBe("Work and Home");
    expect(namesOf(["Work", "Home", "Travel"])).toBe("Work, Home and Travel");
  });
});
