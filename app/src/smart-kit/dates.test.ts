import { beforeAll, describe, expect, it } from "vitest";

import { loadKit, type Kit } from "./test-support/env";

let D: Kit;
let F: Kit;
beforeAll(() => {
  const kit = loadKit(["kit.js", "lib/dates.js", "lib/format.js"]);
  D = kit.dates;
  F = kit.format;
});

describe("daysUntil (calendar days)", () => {
  const cases: [string, string, Date, number][] = [
    ["same day", "2027-03-01", new Date(2027, 2, 1, 23, 59), 0],
    ["tomorrow from late evening", "2027-03-02", new Date(2027, 2, 1, 23, 59), 1],
    ["across a month end", "2027-03-01", new Date(2027, 1, 27), 2],
    ["across a leap day", "2028-03-01", new Date(2028, 1, 27), 3],
    ["across a year end", "2028-01-01", new Date(2027, 11, 31, 23, 59), 1],
    ["over a US clock change", "2027-03-15", new Date(2027, 2, 13, 0, 30), 2],
    ["over a European clock change", "2027-03-29", new Date(2027, 2, 27, 23, 30), 2],
    ["back over the autumn change", "2027-11-02", new Date(2027, 10, 1, 23, 59), 1],
    ["in the past", "2027-02-27", new Date(2027, 2, 1), -2],
    ["a long way off", "2028-03-01", new Date(2027, 2, 1), 366],
  ];
  it.each(cases)("%s", (_name, target, now, days) => {
    expect(D.daysUntil(target, now)).toBe(days);
  });

  it("returns null for dates that do not exist", () => {
    expect(D.daysUntil("2027-02-30", new Date(2027, 1, 1))).toBeNull();
    expect(D.daysUntil("soon", new Date(2027, 1, 1))).toBeNull();
    expect(D.daysUntil("2027-13-01", new Date(2027, 1, 1))).toBeNull();
  });

  it("ignores a time after the date", () => {
    expect(D.daysUntil("2027-03-03T18:00:00", new Date(2027, 2, 1))).toBe(2);
  });
});

describe("anywhere on Earth deadlines", () => {
  it("end at 23:59:59.999 in UTC-12, which is noon UTC the next day", () => {
    expect(D.aoeInstant("2027-03-03").toISOString()).toBe("2027-03-04T11:59:59.999Z");
    expect(D.aoeInstant("2027-12-31").toISOString()).toBe("2028-01-01T11:59:59.999Z");
  });

  const days: [string, string, number][] = [
    ["morning UTC on the next day is still the deadline day", "2027-03-04T10:00:00Z", 0],
    ["just before the end", "2027-03-04T11:59:00Z", 0],
    ["right after the end", "2027-03-04T12:00:00Z", -1],
    ["a day and a bit before", "2027-03-02T12:00:00Z", 1],
    ["late the day before in UTC-12", "2027-03-03T11:59:00Z", 1],
  ];
  it.each(days)("daysUntilAoE: %s", (_n, now, expected) => {
    expect(D.daysUntilAoE("2027-03-03", new Date(now))).toBe(expected);
  });

  it("aoeRemaining counts down to the instant and then up past it", () => {
    expect(D.aoeRemaining("2027-03-03", new Date("2027-03-04T06:30:00Z"))).toEqual({ passed: false, ms: 19799999, days: 0, hours: 5, minutes: 29, seconds: 59 });
    expect(D.aoeRemaining("2027-03-03", new Date("2027-03-01T11:59:59.999Z"))).toMatchObject({ passed: false, days: 3, hours: 0 });
    const late = D.aoeRemaining("2027-03-03", new Date("2027-03-04T14:00:00Z"));
    expect(late.passed).toBe(true);
    expect(late).toMatchObject({ days: 0, hours: 2 });
  });
});

describe("describeDays", () => {
  it.each([
    [0, "today"],
    [1, "tomorrow"],
    [-1, "yesterday"],
    [12, "in 12 days"],
    [-3, "3 days ago"],
    [null, "date unknown"],
  ])("%s", (n, text) => {
    expect(D.describeDays(n)).toBe(text);
  });
});

describe("dateInfo: estimated or announced", () => {
  const now = new Date(2027, 1, 20);
  it("a bare date is announced", () => {
    expect(D.dateInfo("2027-03-03", { now })).toEqual({ iso: "2027-03-03", announced: true, aoe: false, days: 11, label: "Mar 3, 2027" });
  });
  it("announced: false and status est/estimated are estimates", () => {
    expect(D.dateInfo({ date: "2027-03-03", announced: false }, { now }).label).toBe("est. Mar 3, 2027");
    expect(D.dateInfo({ date: "2027-03-03", status: "est" }, { now }).announced).toBe(false);
    expect(D.dateInfo({ date: "2027-03-03", status: "Estimated" }, { now }).announced).toBe(false);
    expect(D.dateInfo({ date: "2027-03-03", status: "announced" }, { now }).announced).toBe(true);
  });
  it("an AoE deadline counts days by the AoE calendar", () => {
    const at = new Date("2027-03-04T10:00:00Z");
    expect(D.dateInfo({ date: "2027-03-03", aoe: true }, { now: at })).toMatchObject({ aoe: true, days: 0 });
    expect(D.dateInfo({ date: "2027-03-03" }, { now: at }).days).toBe(D.daysUntil("2027-03-03", at));
  });
  it("an unreadable date has no day count and no label", () => {
    expect(D.dateInfo({ date: "someday", announced: false })).toMatchObject({ iso: null, days: null, label: "" });
  });
});

describe("other helpers", () => {
  it("addDays crosses months, years and leap days", () => {
    expect(D.addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(D.addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(D.addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(D.addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(D.addDays("nope", 1)).toBeNull();
  });
  it("isoDate and parseDate use the local calendar day", () => {
    expect(D.isoDate(new Date(2027, 0, 5, 23, 59))).toBe("2027-01-05");
    const d = D.parseDate("2027-01-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2027, 0, 5, 0]);
    expect(D.parseDate("2027-02-31")).toBeNull();
  });
  it("compareDates sorts by day, unreadable last", () => {
    expect(["2027-03-02", "bad", "2027-01-01"].sort(D.compareDates)).toEqual(["2027-01-01", "2027-03-02", "bad"]);
  });
  it("daysInMonth knows leap years", () => {
    expect(D.daysInMonth(2028, 2)).toBe(29);
    expect(D.daysInMonth(2027, 2)).toBe(28);
    expect(D.daysInMonth(2027, 12)).toBe(31);
  });
  it("formatDate shows the calendar date whatever the zone", () => {
    expect(D.formatDate("2027-03-03")).toBe("Mar 3, 2027");
    expect(D.formatDate("2027-03-03", { format: { weekday: "short" } })).toBe("Wed, Mar 3, 2027");
    expect(D.formatDate("junk")).toBe("");
  });
});

describe("format", () => {
  it("formats numbers, signs and percentages", () => {
    expect(F.number(1234.5)).toBe("1,235");
    expect(F.number(1234.5, { digits: 1 })).toBe("1,234.5");
    expect(F.number(NaN)).toBe("–");
    expect(F.compact(12400)).toBe("12.4K");
    expect(F.percent(0.256)).toBe("26%");
    expect(F.signed(5)).toBe("+5");
    expect(F.signed(-2)).toBe("−2");
    expect(F.signed(0)).toBe("0");
    expect(F.plural(1, "paper")).toBe("1 paper");
    expect(F.plural(3, "paper")).toBe("3 papers");
    expect(F.truncate("abcdefghij", 5)).toBe("abcd…");
  });
  it("seriesColor only returns kit variables", () => {
    expect(F.seriesColor(1)).toBe("var(--kit-series-1)");
    expect(F.seriesColor(9)).toBe("var(--kit-series-1)");
    expect(F.seriesColor(0)).toBe("var(--kit-series-8)");
    expect(F.seriesColor("danger")).toBe("var(--kit-series-4)");
    expect(F.seriesColor("#ff0000")).toBe("var(--kit-series-1)");
  });
});
