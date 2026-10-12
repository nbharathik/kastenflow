// A page's date and the times after a day link: both show on the Calendar.

import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { CALENDAR_SHOW, usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { dayEntries, entryTime, taskText } from "./layout";
import { cell, openCalendar, today } from "./test-kit";

const SEED = {
  // No tag and no schema: a plain `date` is a calendar date.
  "library/trip.md": `---\ntitle: Trip planning\nprops:\n  date: ${today}\n---\nWhere to?\n`,
  "library/day.md": [
    "---",
    "title: Day",
    "---",
    `- [ ] Review at the end [[${today}]] 16:30`,
    `- [ ] Call Sam [[${today}]] 9:05`,
    `- [ ] Anytime @${today}`,
    `- [ ] Standup [[${today}]] 09:00`,
    "",
  ].join("\n"),
};

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ calendarShow: CALENDAR_SHOW });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

describe("Calendar times", () => {
  it("shows a page's plain date, and a to-do's time before its title, in time order", async () => {
    await openCalendar(SEED);
    // The week's columns show every entry, where a month's cell folds some under "+N more".
    fireEvent.keyDown(window, { key: "w" });
    // A date on a page with no tag at all.
    expect(within(cell(today)).getByRole("button", { name: "Trip planning" })).toBeTruthy();
    // To-dos load after the notes; allow for a busy machine.
    await within(cell(today)).findByRole("button", { name: /Standup/ }, { timeout: 5000 });
    const names = within(cell(today))
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((name): name is string => Boolean(name) && /Standup|Call Sam|Review|Anytime/.test(name!));
    // Timed to-dos in time order, the one without a time after them.
    expect(names.slice(0, 4)).toEqual(["09:00 Standup", "09:05 Call Sam", "16:30 Review at the end", "Anytime"]);
    const first = within(cell(today)).getByRole("button", { name: "09:00 Standup" });
    expect(first.querySelector("time.kasten-cal-chip-time")?.textContent).toBe("09:00");
    expect(within(cell(today)).getByRole("button", { name: "Anytime" }).querySelector("time")).toBeNull();
  });
});

describe("day entries by time", () => {
  const task = (text: string, at: string | null | undefined, line: number) => ({ path: "p.md", title: "P", icon: null, line, done: false, text, due: "2026-10-07", at });
  const mention = (path: string, at: string | null | undefined) => ({ day: "2026-10-07", path, title: path, icon: null, kind: "page", snippet: "", at });
  const label = (e: ReturnType<typeof dayEntries>[number]) => (e.kind === "task" ? `task ${e.task.text}` : e.kind === "mention" ? `mention ${e.mention.path}` : e.kind);

  it("lists timed to-dos and mentions by time, then those with none", () => {
    const entries = dayEntries([], [task("late", "16:00", 1), task("plain", null, 2), task("early", "08:30", 3)], [mention("a.md", "12:00"), mention("b.md", undefined), mention("c.md", "08:30")]);
    expect(entries.map(label)).toEqual(["task early", "mention c.md", "mention a.md", "task late", "task plain", "mention b.md"]);
    expect(entries.map((e) => entryTime(e))).toEqual(["08:30", "08:30", "12:00", "16:00", null, null]);
  });

  it("keeps the order it had when nothing has a time", () => {
    expect(dayEntries([], [task("one", null, 1), task("two", undefined, 2)]).map(label)).toEqual(["task one", "task two"]);
  });
});

describe("a to-do's text beside its time", () => {
  it("leaves the time to the chip", () => {
    expect(taskText({ text: "Call Sam [[2026-10-07]] 14:15", due: "2026-10-07", at: "14:15" })).toBe("Call Sam");
    expect(taskText({ text: "Book the room @2026-10-08 9:05", due: "2026-10-08", at: "09:05" })).toBe("Book the room");
    expect(taskText({ text: "Pay rent", due: "2026-10-01", at: null })).toBe("Pay rent");
    // A time that is not the one after the day stays.
    expect(taskText({ text: "Meet at 14:15 about 2026-10-07", due: "2026-10-07", at: "09:00" })).toBe("Meet at 14:15 about");
  });
});
