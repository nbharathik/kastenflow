// The cards Home keeps in reserve: the week ahead and the journal.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import type { CalendarInfo, ExternalEvent } from "../calendar/external/types";
import { useTaskRows } from "../dashboard/task-rows";

let events: ExternalEvent[] = [];
const calendar: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "h", masked: "h", lastUpdated: 1, lastChecked: 1, error: null };
vi.mock("../calendar/external/api", () => ({
  canSubscribe: () => true,
  calendarsList: vi.fn(async () => [calendar]),
  calendarEvents: vi.fn(async (from: string, to: string) => ({ events: events.filter((e) => e.end.slice(0, 10) >= from && e.start.slice(0, 10) <= to), truncated: false })),
  calendarRefresh: vi.fn(async () => [calendar]),
  onCalendarsChanged: () => Promise.resolve(() => {}),
}));
import { useFeeds } from "../calendar/external/store";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { ExtraCard } from "./ExtraCards";

let line = 0;
const todo = (text: string, due: string | null, over: Partial<TaskRow> = {}): TaskRow => ({ path: "library/plans.md", title: "Plans", icon: null, line: line++, done: false, text, due, at: null, ...over });

const day = (iso: string, excerpt = ""): NoteMeta => ({
  path: `journal/${iso.slice(0, 4)}/${iso}.md`,
  id: null,
  title: iso,
  kind: "journal",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt,
  words: 0,
  props: {},
  locked: false,
});

const openJournal = vi.fn(async () => {});
const go = vi.fn();
beforeEach(() => {
  openJournal.mockClear();
  go.mockClear();
  useWorkspace.setState({ client: null, notes: [], ...derive(initialLayout()), openJournal, go });
  useTaskRows.setState({ rows: [] });
  events = [];
  useFeeds.setState({ list: null, version: 0 });
});
afterEach(cleanup);

describe("Home's week", () => {
  it("is the next seven days, today marked, each with the to-dos due on it", () => {
    useTaskRows.setState({
      rows: [todo("A", dayFrom(1)), todo("B", dayFrom(1)), todo("C", dayFrom(3)), todo("Done", dayFrom(2), { done: true }), todo("Far", dayFrom(9)), todo("Late", dayFrom(-1)), todo("None", null)],
    });
    render(<ExtraCard id="week" />);
    const days = within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button");
    expect(days).toHaveLength(7);
    expect(days[0]!.className).toContain("is-today");
    expect(days.map((d) => d.querySelector(".kasten-week-count")?.textContent)).toEqual(["", "2", "", "1", "", "", ""]);
    expect(days[1]!.getAttribute("aria-label")).toMatch(/: 2 to-dos$/);
    expect(days[3]!.getAttribute("aria-label")).toMatch(/: 1 to-do$/);
    expect(days[2]!.getAttribute("aria-label")).not.toMatch(/to-do/);
  });

  it("counts the calendar's events with the to-dos, and says which are which", async () => {
    const e = (id: string, start: string, end: string, allDay = false) => ({ calendar: "c1", id, uid: id, title: id, allDay, start, end, location: null, description: null, link: null, tentative: false, zoneGuess: false });
    events = [e("a", `${dayFrom(1)}T09:00`, `${dayFrom(1)}T10:00`), e("b", `${dayFrom(1)}T11:00`, `${dayFrom(1)}T12:00`), e("c", dayFrom(2), dayFrom(2), true)];
    useTaskRows.setState({ rows: [todo("A", dayFrom(1))] });
    render(<ExtraCard id="week" />);
    const days = within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button");
    await waitFor(() => expect(days[1]!.getAttribute("aria-label")).toMatch(/: 2 events, 1 to-do$/));
    expect(days[1]!.querySelector(".kasten-week-count")?.textContent).toBe("3");
    expect(days[2]!.getAttribute("aria-label")).toMatch(/: 1 event$/);
    expect(days[0]!.getAttribute("aria-label")).not.toMatch(/event|to-do/);
  });

  it("moves between the days with the left and right arrows", () => {
    render(<ExtraCard id="week" />);
    const days = within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button");
    days[0]!.focus();
    fireEvent.keyDown(days[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(days[1]);
    fireEvent.keyDown(days[1]!, { key: "End" });
    expect(document.activeElement).toBe(days[6]);
    fireEvent.keyDown(days[6]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(days[5]);
  });

  it("opens a day's journal, and the Calendar from its link", () => {
    render(<ExtraCard id="week" />);
    fireEvent.click(within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button")[2]!);
    expect(openJournal).toHaveBeenCalledWith(dayFrom(2));
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(go).toHaveBeenCalledWith({ view: "calendar" });
  });
});

describe("Home's journal", () => {
  it("lists the latest four days, newest first, with a line of what they hold", () => {
    useWorkspace.setState({ notes: [day("2026-10-01", "First"), day("2026-10-05"), day("2026-10-03", "Third"), day("2026-10-06", "Sixth"), day("2026-10-02", "Second")] });
    render(<ExtraCard id="journal" />);
    const rows = within(screen.getByRole("region", { name: "Journal" })).getAllByRole("button").filter((b) => b.className.includes("kasten-dash-row"));
    expect(rows.map((r) => r.querySelector(".kasten-dash-row-detail")?.textContent)).toEqual(["Sixth", "No entry", "Third", "Second"]);
    fireEvent.click(screen.getByRole("button", { name: "Write today" }));
    expect(openJournal).toHaveBeenCalled();
  });

  it("says so, in one line, while no day is written", () => {
    render(<ExtraCard id="journal" />);
    expect(screen.getByRole("region", { name: "Journal" }).textContent).toContain("No days written yet.");
  });
});
