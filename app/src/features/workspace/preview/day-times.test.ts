// The same cases as the core's (src/dates_tests.rs), so the preview's
// calendar and to-dos read days and times as the app's do.

import { describe, expect, it } from "vitest";

import { dueAt, isRealDay, timeAfter } from "./day-times";
import { MemoryVault } from "./memory-vault";

describe("days on the calendar", () => {
  it("knows the days that exist", () => {
    for (const day of ["2026-10-06", "2026-12-31", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31", "2026-04-30"]) expect(isRealDay(day), day).toBe(true);
  });

  it("refuses days that only look like days", () => {
    for (const day of ["2026-02-30", "2026-13-45", "2026-00-10", "2026-10-00", "2026-04-31", "2025-02-29", "1900-02-29", "2100-02-29", "0000-01-01", "2026-1-05", "2026-10-6", "2026-10-066", "2026/10/06", "2026-10-06 ", "", "today", "٢٠٢٦-١٠-٠٦"]) {
      expect(isRealDay(day), JSON.stringify(day)).toBe(false);
    }
  });
});

describe("a 24-hour time after a space", () => {
  it("reads H:MM and HH:MM as HH:MM", () => {
    expect(timeAfter(" 09:00")).toBe("09:00");
    expect(timeAfter(" 9:05")).toBe("09:05");
    expect(timeAfter("  23:59 then")).toBe("23:59");
    expect(timeAfter("\t0:00.")).toBe("00:00");
    expect(timeAfter(" 14:30, with Sam")).toBe("14:30");
    expect(timeAfter(" 09:00-10:00")).toBe("09:00");
  });

  it("reads nothing else as a time", () => {
    for (const text of ["", " ", "09:00", " 24:00", " 25:00", " 9:60", " 09:0", " 09:005", " 123:00", " 9:5", " 09:00pm", " 9:05am", " 09:00:30", " x09:00", " :30", " 09-00"]) {
      expect(timeAfter(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe("the day a to-do names", () => {
  it("takes a day link, then @date, then the calendar sign, with the time of the first two", () => {
    expect(dueAt("Call Sam [[2026-10-07]] 09:00 about it")).toEqual({ day: "2026-10-07", at: "09:00" });
    expect(dueAt("[[2026-10-07|tomorrow]] 14:30")).toEqual({ day: "2026-10-07", at: "14:30" });
    expect(dueAt("Dentist [[2026-10-07]]")).toEqual({ day: "2026-10-07", at: null });
    expect(dueAt("[[2026-10-07]]09:00")).toEqual({ day: "2026-10-07", at: null });
    expect(dueAt("[[2026-10-07]] 25:00")).toEqual({ day: "2026-10-07", at: null });
    expect(dueAt("[[2026-10-07]] 09:00 and [[2026-10-08]] 10:00")).toEqual({ day: "2026-10-07", at: "09:00" });
    expect(dueAt("Book room @2026-10-07 9:05")).toEqual({ day: "2026-10-07", at: "09:05" });
    expect(dueAt("@2026-10-07")).toEqual({ day: "2026-10-07", at: null });
    expect(dueAt("@2026-01-01 [[2026-02-02]] 10:00")).toEqual({ day: "2026-02-02", at: "10:00" });
    expect(dueAt("📅 2026-03-03 @2026-01-01 08:15")).toEqual({ day: "2026-01-01", at: "08:15" });
    expect(dueAt("call 📅 2026-12-24 10:00 now")).toEqual({ day: "2026-12-24", at: null });
  });

  it("leaves a date that is not on the calendar as text", () => {
    expect(dueAt("[[2026-02-30]] 09:00")).toBeNull();
    expect(dueAt("[[2026-13-45]]")).toBeNull();
    expect(dueAt("@2026-13-45 09:00")).toBeNull();
    expect(dueAt("📅 2026-02-30")).toBeNull();
    expect(dueAt("no date 2026-12-24")).toBeNull();
    expect(dueAt("[[2026-02-30]] @2026-03-01 08:00")).toEqual({ day: "2026-03-01", at: "08:00" });
    expect(dueAt("[[2026-02-30]] then [[2026-03-02]] 07:30")).toEqual({ day: "2026-03-02", at: "07:30" });
  });
});

describe("the preview's to-dos and mentions keep their times", () => {
  const PLAN =
    "---\ntitle: Plan\n---\nKickoff [[2026-10-07]] 09:00 with the team.\nLunch with Sam @2026-10-08 12:30\nReview [[2026-10-09]] later.\nLate [[2026-10-10]] 25:00 call.\n- [ ] Call Sam [[2026-10-07]] 14:15\n- [ ] Book room @2026-10-08 9:05\n- [ ] Pay rent [[2026-10-09]]\n- [ ] Not a day [[2026-02-30]] 10:00\n- [ ] Not a day either @2026-13-45\n- [x] Sign form 📅 2026-10-11 16:00\n";

  it("lists to-dos with their day and time (tests/core/index_times.rs)", async () => {
    const vault = new MemoryVault({ "library/plan.md": PLAN });
    const tasks = (await vault.tasks()).filter((t) => t.path === "library/plan.md");
    expect(tasks.map((t) => [t.text, t.due, t.at])).toEqual([
      ["Call Sam 2026-10-07 14:15", "2026-10-07", "14:15"],
      ["Book room @2026-10-08 9:05", "2026-10-08", "09:05"],
      ["Pay rent 2026-10-09", "2026-10-09", null],
      ["Not a day 2026-02-30 10:00", null, null],
      ["Not a day either @2026-13-45", null, null],
      ["Sign form 📅 2026-10-11 16:00", "2026-10-11", null],
    ]);
  });

  it("lists day mentions with the time after the link", async () => {
    const vault = new MemoryVault({ "library/plan.md": PLAN });
    const mentions = (await vault.dayMentions("2026-10-01", "2026-10-31")).filter((m) => m.path === "library/plan.md");
    // Lines that are to-dos are tasks, and `@date` is no link.
    expect(mentions.map((m) => [m.day, m.at])).toEqual([
      ["2026-10-07", "09:00"],
      ["2026-10-09", null],
      ["2026-10-10", null],
    ]);
  });
});
