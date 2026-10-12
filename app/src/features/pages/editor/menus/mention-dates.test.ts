import { describe, expect, it, vi } from "vitest";

import { dateChoices, dateItems } from "./mention-dates";

// Wednesday 7 October 2026, 10:30.
const NOW = new Date(2026, 9, 7, 10, 30);
const keys = (query: string, weekStart = 1) => dateChoices(query, { now: NOW, weekStart }).map((c) => c.key);

describe("the date rows of the @ menu", () => {
  it("offer today, tomorrow and yesterday for a bare @", () => {
    expect(dateChoices("", { now: NOW }).map((c) => c.label)).toEqual(["Today", "Tomorrow", "Yesterday"]);
    expect(keys("")).toEqual(["day:2026-10-07", "day:2026-10-08", "day:2026-10-06"]);
  });

  it("keep to those whose names start with what is typed", () => {
    expect(dateChoices("to", { now: NOW }).map((c) => c.label)).toEqual(["Today", "Tomorrow"]);
    // One letter is more often a page's name than a weekday's.
    expect(dateChoices("t", { now: NOW }).map((c) => c.label)).toEqual(["Today", "Tomorrow"]);
    expect(dateChoices("tu", { now: NOW }).map((c) => c.label)).toEqual(["Tuesday"]);
  });

  it("offer weekdays and next week", () => {
    expect(dateChoices("fr", { now: NOW }).map((c) => c.label)).toEqual(["Friday"]);
    expect(keys("fri")).toEqual(["day:2026-10-09"]);
    expect(dateChoices("ne", { now: NOW }).map((c) => c.label)).toEqual(["Next week"]);
    expect(keys("next week")).toEqual(["day:2026-10-12"]);
    expect(keys("next week", 0)).toEqual(["day:2026-10-11"]);
  });

  it("name a weekday that is today or tomorrow by its day too", () => {
    expect(dateChoices("wed", { now: NOW }).map((c) => c.label)).toEqual(["Wednesday"]);
    expect(dateChoices("thu", { now: NOW }).map((c) => c.label)).toEqual(["Thursday"]);
  });

  it("read what is typed as a date or time", () => {
    const [next] = dateChoices("next fri 3pm", { now: NOW });
    expect(next).toMatchObject({ key: "day:2026-10-16 15:00", hint: "2026-10-16" });
    expect(next!.label).toMatch(/, 15:00$/);
    expect(keys("oct 12")).toEqual(["day:2026-10-12"]);
    expect(keys("12 oct 2027")).toEqual(["day:2027-10-12"]);
    expect(keys("2026-10-01")).toEqual(["day:2026-10-01"]);
    expect(keys("in 3 days")).toEqual(["day:2026-10-10"]);
  });

  it("read a time alone as today at that time", () => {
    expect(dateChoices("14:00", { now: NOW })).toMatchObject([{ key: "day:2026-10-07 14:00", label: "Today, 14:00" }]);
    expect(keys("now")).toEqual(["day:2026-10-07 10:30"]);
    expect(keys("noon")).toEqual(["day:2026-10-07 12:00"]);
  });

  it("offer tomorrow at a time", () => {
    expect(dateChoices("tomorrow 9am", { now: NOW })).toMatchObject([{ key: "day:2026-10-08 09:00", label: "Tomorrow, 09:00" }]);
  });

  it("offer no day that does not exist", () => {
    expect(keys("2026-13-45")).toEqual([]);
    expect(keys("2026-02-29")).toEqual([]);
    expect(keys("feb 30")).toEqual([]);
    expect(keys("25:00")).toEqual([]);
  });

  it("offer nothing for a name that is not a date", () => {
    expect(keys("dupl")).toEqual([]);
    expect(keys("Sam")).toEqual([]);
  });
});

describe("picking a date row", () => {
  it("hands over the day and, with a time, the text that follows the link", () => {
    const pick = vi.fn();
    const [row] = dateItems("next fri 3pm", { now: NOW }, pick);
    row!.onPick!();
    expect(pick).toHaveBeenCalledWith("2026-10-16", " 15:00");
    const [today] = dateItems("", { now: NOW }, pick);
    today!.onPick!();
    expect(pick).toHaveBeenLastCalledWith("2026-10-07", "");
    expect(row!.icon).toBe("icon:clock");
    expect(today!.icon).toBe("icon:calendar");
  });
});
