// Home's "Today": all-day chips, the meetings (past ones folded, the next one
// marked, overlaps and multi-day events said), the to-dos due today, each
// group with its own cap that opens in place; one line when the day is quiet,
// and a line of its own when a calendar could not be read.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { TaskRow } from "../../lib/vault/types";
import type { CalendarInfo, ExternalEvent } from "../calendar/external/types";
import { useTaskRows } from "../dashboard/task-rows";
import { HomeSectionView } from "./HomeSections";
import { HOME_DEFAULT, homeSections } from "./sections";
import { useWorkspace } from "../workspace/store";

let desktop = true;
let calendars: CalendarInfo[] = [];
let events: ExternalEvent[] = [];

vi.mock("../calendar/external/api", () => ({
  canSubscribe: () => desktop,
  calendarsList: vi.fn(async () => calendars),
  calendarEvents: vi.fn(async (from: string, to: string) => ({ events: events.filter((e) => e.end.slice(0, 10) >= from && e.start.slice(0, 10) <= to), truncated: false })),
  calendarRefresh: vi.fn(async () => calendars),
  calendarAdd: vi.fn(),
  calendarRemove: vi.fn(),
  calendarEdit: vi.fn(),
  onCalendarsChanged: () => Promise.resolve(() => {}),
}));

import { calendarEvents } from "../calendar/external/api";
import { useFeeds } from "../calendar/external/store";
import { Schedule } from "./Schedule";

const today = dayFrom(0);
const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1_700_000_000, lastChecked: 1_700_000_000, error: null };

let count = 0;
function event(over: Partial<ExternalEvent> = {}): ExternalEvent {
  count += 1;
  return { calendar: "c1", id: `e${count}`, uid: `u${count}`, title: `Event ${count}`, allDay: false, start: `${today}T09:00`, end: `${today}T10:00`, location: null, description: null, link: null, tentative: false, zoneGuess: false, ...over };
}
const at = (from: string, to: string, over: Partial<ExternalEvent> = {}) => event({ start: `${today}T${from}`, end: `${today}T${to}`, ...over });

let line = 0;
const todo = (text: string, over: Partial<TaskRow> = {}): TaskRow => ({ path: "journal/2026/day.md", title: "A day", icon: null, line: line++, done: false, text, due: today, at: null, ...over });

/** The clock of the test: only the date is faked, so promises and queries still run. */
const base = new Date();
const clock = (h: number, m = 0) => vi.setSystemTime(new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock(8);
  desktop = true;
  calendars = [work];
  events = [];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
  useTaskRows.setState({ rows: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** What each row of a group says, in order drawn, leaving out rows in a part that is folded shut. */
const rowsOf = (group: HTMLElement) => [...group.querySelectorAll("li")].filter((li) => !li.closest("[inert]")).map((li) => li.querySelector(".kasten-dash-row-title")?.textContent ?? li.textContent);
const meetings = async () => within(await screen.findByRole("region", { name: "Today" })).findByRole("region", { name: "Meetings" });

describe("Home → Today", () => {
  it("puts all-day events in a row of chips and the timed ones under Meetings, by time", async () => {
    events = [at("12:00", "13:00", { title: "Lunch", location: "The corner place" }), event({ title: "Company holiday", allDay: true, start: today, end: today }), at("09:00", "09:15", { title: "Standup" }), at("10:00", "10:30", { title: "Review" }), event({ title: "Tomorrow's thing", start: `${dayFrom(1)}T09:00`, end: `${dayFrom(1)}T10:00` })];
    render(<Schedule />);
    const group = await meetings();
    expect(rowsOf(group)).toEqual(["09:00–09:15Standup", "10:00–10:30Review", "12:00–13:00Lunch"]);
    const card = screen.getByRole("region", { name: "Today" });
    expect(rowsOf(within(card).getByRole("list", { name: "All day" }))).toEqual(["Company holiday"]);
    expect(within(card).queryByText(/Tomorrow/)).toBeNull();
    // Where the event is and whose it is are in its tooltip, so a row keeps to one line.
    expect(within(card).getByRole("button", { name: /Lunch/ }).title).toBe("12:00–13:00 · Lunch · Work · The corner place");
  });

  it("marks the next meeting with how long until it", async () => {
    events = [at("08:12", "08:30", { title: "Standup" }), at("10:00", "11:00", { title: "Review" })];
    render(<Schedule />);
    await meetings();
    expect(screen.getByText("Next up · in 12 min")).toBeTruthy();
    expect(screen.queryByText(/Next up · in 2 h/)).toBeNull();
  });

  it("folds the meetings that are over into 'N earlier', which opens in place, above a line for now", async () => {
    clock(11);
    events = [at("09:00", "09:15", { title: "Standup" }), at("09:30", "10:00", { title: "Planning" }), at("12:00", "13:00", { title: "Lunch" })];
    render(<Schedule />);
    const group = await meetings();
    expect(rowsOf(group)).toEqual(["12:00–13:00Lunch"]);
    expect(screen.getByText("Next up · in 1 h")).toBeTruthy();
    expect(within(group).getByRole("separator", { name: "Now" })).toBeTruthy();
    const toggle = within(group).getByRole("button", { name: "2 earlier" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rowsOf(group)).toEqual(["09:00–09:15Standup", "09:30–10:00Planning", "12:00–13:00Lunch"]);
  });

  it("calls the meeting on now 'Now'", async () => {
    clock(12, 30);
    events = [at("12:00", "13:00", { title: "Lunch" })];
    render(<Schedule />);
    await meetings();
    expect(screen.getByText("Now")).toBeTruthy();
    expect(screen.queryByText(/Next up/)).toBeNull();
  });

  it("shows four meetings, then '+N more' that opens the rest in place; Open calendar still leaves", async () => {
    const go = vi.fn();
    useWorkspace.setState({ go });
    clock(0, 30);
    events = Array.from({ length: 7 }, (_, i) => at(`0${i + 1}:00`, `0${i + 1}:30`, { title: `Event ${i + 1}` }));
    render(<Schedule />);
    const group = await meetings();
    expect(rowsOf(group)).toHaveLength(4);
    const more = within(group).getByRole("button", { name: "+3 more" });
    fireEvent.click(more);
    expect(go).not.toHaveBeenCalled();
    expect(rowsOf(group)).toHaveLength(7);
    expect(within(group).getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(screen.getByRole("region", { name: "Today" })).getByRole("button", { name: "Open calendar" }));
    expect(go).toHaveBeenCalledWith({ view: "calendar" });
  });

  it("lists the to-dos due today in their own group, timed ones by time, each group with its own cap", async () => {
    events = [at("09:00", "09:15", { title: "Standup" })];
    useTaskRows.setState({
      rows: [
        todo("Water the plants"),
        todo("Call the printer", { at: "10:30" }),
        todo("Early call", { at: "9:05" }),
        todo("Not today", { due: dayFrom(1) }),
        todo("Already done", { done: true }),
        todo("In a template", { path: "templates/journal.md" }),
        todo("No day at all", { due: null }),
      ],
    });
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    const due = await within(card).findByRole("region", { name: "Due today" });
    expect(rowsOf(await meetings())).toEqual(["09:00–09:15Standup"]);
    expect(rowsOf(due)).toEqual(["9:05Early call", "10:30Call the printer", "Water the plants"]);
    expect(within(due).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Early call", "Call the printer", "Water the plants"]);
  });

  it("caps the to-dos by themselves and opens the rest in place", async () => {
    useTaskRows.setState({ rows: Array.from({ length: 6 }, (_, i) => todo(`Task ${i + 1}`)) });
    render(<Schedule />);
    const due = await within(await screen.findByRole("region", { name: "Today" })).findByRole("region", { name: "Due today" });
    expect(rowsOf(due)).toHaveLength(4);
    fireEvent.click(within(due).getByRole("button", { name: "+2 more" }));
    expect(rowsOf(due)).toHaveLength(6);
  });

  it("says when two meetings overlap and which day of a long one it is", async () => {
    events = [at("09:00", "10:00", { title: "Design review" }), at("09:30", "10:30", { title: "Dentist" }), event({ title: "Offsite", start: `${dayFrom(-1)}T10:00`, end: `${dayFrom(1)}T10:00` }), event({ title: "Conference", allDay: true, start: dayFrom(-1), end: dayFrom(1) })];
    render(<Schedule />);
    const group = await meetings();
    const row = (name: RegExp) => within(group).getByRole("button", { name }).closest("li")!;
    expect(row(/Design review/).textContent).toContain("overlaps");
    expect(row(/Dentist/).textContent).toContain("overlaps");
    expect(row(/Offsite/).textContent).toContain("day 2 of 3");
    expect(row(/Offsite/).textContent).not.toContain("overlaps");
    expect(within(screen.getByRole("list", { name: "All day" })).getByText("day 2 of 3")).toBeTruthy();
  });

  it("says a calendar could not be reached, and tries again from a button", async () => {
    events = [at("09:00", "09:15", { title: "Standup" })];
    vi.mocked(calendarEvents).mockRejectedValueOnce(new Error("offline"));
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(card.textContent).toContain("Couldn't reach Work —"));
    expect(card.textContent).not.toContain("Nothing on today.");
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await within(card).findByRole("button", { name: /Standup/ })).toBeTruthy();
    expect(card.textContent).not.toContain("Couldn't reach");
  });

  it("says so in one line when the day is quiet, in the browser preview too", async () => {
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    expect(card.textContent).toContain("Nothing on today.");
    cleanup();
    desktop = false;
    events = [event()];
    useFeeds.setState({ list: null, version: 0 });
    render(<Schedule />);
    expect((await screen.findByRole("region", { name: "Today" })).textContent).toContain("Nothing on today.");
    cleanup();
    desktop = true;
    calendars = [{ ...work, shown: false }];
    useFeeds.setState({ list: null, version: 0 });
    render(<Schedule />);
    await waitFor(() => expect(useFeeds.getState().list).not.toBeNull());
    expect(screen.getByRole("region", { name: "Today" }).textContent).toContain("Nothing on today.");
  });

  it("says nothing more is on once the day's meetings are all over", async () => {
    clock(15);
    events = [at("09:00", "09:15", { title: "Standup" })];
    render(<Schedule />);
    const group = await meetings();
    expect(within(group).getByRole("button", { name: "1 earlier" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Today" }).textContent).toContain("Nothing more today.");
  });

  it("holds its place while the to-dos are read", () => {
    useTaskRows.setState({ rows: null });
    render(<Schedule />);
    const card = screen.getByRole("region", { name: "Today" });
    expect(card.querySelector(".kasten-todo-skeleton")).not.toBeNull();
    expect(card.textContent).not.toContain("Nothing on today.");
  });

  it("shows an event's details on a click", async () => {
    events = [at("09:00", "10:00", { title: "Standup", location: "Zoom room 4" })];
    render(<Schedule />);
    fireEvent.click(await screen.findByRole("button", { name: /Standup/ }));
    const dialog = await screen.findByRole("dialog", { name: "Event: Standup" });
    expect(within(dialog).getByText("Zoom room 4")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Make meeting note" })).toBeTruthy();
  });

  it("moves between the rows with the arrow keys, Home and End", async () => {
    events = [at("09:00", "09:15", { title: "Standup" }), at("10:00", "10:30", { title: "Review" }), event({ title: "Holiday", allDay: true, start: today, end: today })];
    useTaskRows.setState({ rows: [todo("Water the plants")] });
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    const standup = await within(card).findByRole("button", { name: /Standup/ });
    standup.focus();
    fireEvent.keyDown(standup, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: /Review/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(card).getByRole("checkbox", { name: "Water the plants" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: /Holiday/ }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(within(card).getByRole("checkbox", { name: "Water the plants" }));
  });
});

describe("Home's Today section", () => {
  it("loads its code and shows the card, with or without the desktop app", async () => {
    events = [at("09:00", "10:00", { title: "Standup" })];
    const desktopHome = render(<HomeSectionView id="schedule" />);
    expect(await desktopHome.findByRole("button", { name: /Standup/ })).toBeTruthy();
    cleanup();
    desktop = false;
    const preview = render(<HomeSectionView id="schedule" />);
    expect(await preview.findByRole("region", { name: "Today" })).toBeTruthy();
    await waitFor(() => expect(preview.container.textContent).toContain("Nothing on today."));
  });
});

describe("Home's sections", () => {
  it("has Today among the usual ones, after the list and before the to-dos", () => {
    expect(HOME_DEFAULT).toContain("schedule");
    const list = homeSections(null);
    expect(list.indexOf("schedule")).toBe(list.indexOf("recent") + 1);
    expect(list.indexOf("schedule")).toBe(list.indexOf("todo") - 1);
  });
});
