import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_REVIEW, readSaved, useReviewPrefs } from "./review-prefs";
import { lastLine, reminderDay, reminderDue } from "./reminder";

// 2026-10-11 is a Sunday, so 2026-10-09 is the Friday before it.
const SUNDAY = "2026-10-11";

describe("the weekly reminder", () => {
  it("is off until it is asked for", () => {
    expect(DEFAULT_REVIEW.remind).toBe(false);
    expect(reminderDue(DEFAULT_REVIEW, SUNDAY)).toBe(false);
    expect(readSaved(undefined).remind).toBe(false);
    expect(readSaved({ remind: "yes" }).remind).toBe(false);
  });

  it("finds the latest day that is the chosen weekday, today included", () => {
    expect(reminderDay(SUNDAY, 5)).toBe("2026-10-09");
    expect(reminderDay("2026-10-09", 5)).toBe("2026-10-09");
    expect(reminderDay("2026-10-10", 5)).toBe("2026-10-09");
    expect(reminderDay(SUNDAY, 0)).toBe(SUNDAY);
    expect(reminderDay("2026-10-12", 0)).toBe(SUNDAY);
  });

  const on = { ...DEFAULT_REVIEW, remind: true };

  it("shows when its weekday has come and no weekly review was marked since", () => {
    expect(reminderDue(on, SUNDAY)).toBe(true);
    expect(reminderDue(on, "2026-10-09")).toBe(true);
    // Before the Friday of the week it is a Thursday: the last Friday has been, a review since then has not.
    expect(reminderDue({ ...on, last: { daily: null, weekly: "2026-10-02" } }, "2026-10-08")).toBe(false);
    expect(reminderDue({ ...on, last: { daily: null, weekly: "2026-10-01" } }, SUNDAY)).toBe(true);
  });

  it("is quiet once the week's review is marked, and for the rest of a day it was put off", () => {
    expect(reminderDue({ ...on, last: { daily: null, weekly: "2026-10-09" } }, SUNDAY)).toBe(false);
    expect(reminderDue({ ...on, last: { daily: null, weekly: SUNDAY } }, SUNDAY)).toBe(false);
    expect(reminderDue({ ...on, snoozed: SUNDAY }, SUNDAY)).toBe(false);
    // Put off yesterday, it is back today.
    expect(reminderDue({ ...on, snoozed: "2026-10-10" }, SUNDAY)).toBe(true);
  });

  it("does not show for a daily review being marked", () => {
    expect(reminderDue({ ...on, last: { daily: SUNDAY, weekly: null } }, SUNDAY)).toBe(true);
  });
});

describe("saying when a review was last done", () => {
  it("says there has been none yet, or since which day: never an error", () => {
    expect(lastLine("weekly", null, SUNDAY)).toBe("No weekly review yet");
    expect(lastLine("weekly", "2026-10-02", SUNDAY)).toMatch(/^No weekly review since .*\b2\b/);
    expect(lastLine("weekly", "2026-10-08", SUNDAY)).toMatch(/^Last weekly review: .*\b8\b/);
    expect(lastLine("weekly", SUNDAY, SUNDAY)).toBe("The weekly review is marked done for today");
    expect(lastLine("daily", "2026-10-10", SUNDAY)).toBe("No daily review since yesterday");
  });
});

describe("what is remembered", () => {
  beforeEach(() => localStorage.clear());

  it("keeps only the valid parts of what was saved", () => {
    expect(readSaved({ remind: true, weekday: 9, last: { daily: "nope", weekly: "2026-10-02" }, snoozed: 3, highlights: false })).toEqual({
      remind: true,
      weekday: DEFAULT_REVIEW.weekday,
      last: { daily: null, weekly: "2026-10-02" },
      snoozed: null,
      highlights: false,
    });
  });

  it("keeps the choices of each vault apart, and for the next time", () => {
    useReviewPrefs.getState().set("Vault A", { remind: true, weekday: 1 });
    useReviewPrefs.getState().set("Vault B", { highlights: false });
    expect(useReviewPrefs.getState().saved["Vault A"]).toMatchObject({ remind: true, weekday: 1, highlights: true });
    expect(useReviewPrefs.getState().saved["Vault B"]).toMatchObject({ remind: false, highlights: false });
    expect(JSON.parse(localStorage.getItem("kasten.reviews")!)["Vault A"].weekday).toBe(1);
  });
});
