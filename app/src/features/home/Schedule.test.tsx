// Home's "Today": the day's events from subscribed calendars and the to-dos due
// today, in the order of the day, all-day first; one line when the day is quiet.

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

import { useFeeds } from "../calendar/external/store";
import { Schedule } from "./Schedule";

const today = dayFrom(0);
const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1_700_000_000, lastChecked: 1_700_000_000, error: null };

let count = 0;
function event(over: Partial<ExternalEvent> = {}): ExternalEvent {
  count += 1;
  return { calendar: "c1", id: `e${count}`, uid: `u${count}`, title: `Event ${count}`, allDay: false, start: `${today}T09:00`, end: `${today}T10:00`, location: null, description: null, link: null, tentative: false, zoneGuess: false, ...over };
}

let line = 0;
const todo = (text: string, over: Partial<TaskRow> = {}): TaskRow => ({ path: "journal/2026/day.md", title: "A day", icon: null, line: line++, done: false, text, due: today, at: null, ...over });

beforeEach(() => {
  desktop = true;
  calendars = [work];
  events = [];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
  useTaskRows.setState({ rows: [] });
});
afterEach(cleanup);

/** What each row says, in the order drawn. */
const lines = (card: HTMLElement) => [...card.querySelectorAll("ul > li")].map((li) => li.textContent);

describe("Home → Today", () => {
  it("lists today's events by time with the all-day ones first", async () => {
    events = [
      event({ title: "Lunch", start: `${today}T12:00`, end: `${today}T13:00`, location: "The corner place" }),
      event({ title: "Company holiday", allDay: true, start: today, end: today }),
      event({ title: "Standup", start: `${today}T09:00`, end: `${today}T09:15` }),
      event({ title: "Tomorrow's thing", start: `${dayFrom(1)}T09:00`, end: `${dayFrom(1)}T10:00` }),
    ];
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(lines(card)).toHaveLength(3));
    expect(lines(card)).toEqual(["All dayCompany holiday", "09:00–09:15Standup", "12:00–13:00Lunch"]);
    expect(within(card).queryByText(/Tomorrow/)).toBeNull();
    // Where the event is and whose it is are in its tooltip, so a row keeps to one line.
    expect(within(card).getByRole("button", { name: /Lunch/ }).title).toBe("12:00–13:00 · Lunch · Work · The corner place");
  });

  it("puts the to-dos due today among them: timed ones by their time, the rest after", async () => {
    events = [event({ title: "Standup", start: `${today}T09:00`, end: `${today}T09:15` }), event({ title: "Lunch", start: `${today}T12:00`, end: `${today}T13:00` })];
    useTaskRows.setState({
      rows: [
        todo("Water the plants"),
        todo("Call the printer", { at: "10:30" }),
        todo("Not today", { due: dayFrom(1) }),
        todo("Already done", { done: true }),
        todo("In a template", { path: "templates/journal.md" }),
        todo("No day at all", { due: null }),
      ],
    });
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(lines(card)).toHaveLength(4));
    expect(lines(card)).toEqual(["09:00–09:15Standup", "10:30Call the printer", "12:00–13:00Lunch", "Water the plants"]);
    expect(within(card).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Call the printer", "Water the plants"]);
  });

  it("shows five at most, then how many more, which opens the Calendar", async () => {
    const go = vi.fn();
    useWorkspace.setState({ go });
    events = Array.from({ length: 7 }, (_, i) => event({ title: `Event ${i}`, start: `${today}T0${i + 1}:00`, end: `${today}T0${i + 1}:30` }));
    render(<Schedule />);
    const card = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(lines(card)).toHaveLength(5));
    fireEvent.click(within(card).getByRole("button", { name: "2 more" }));
    expect(go).toHaveBeenCalledWith({ view: "calendar" });
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

  it("holds its place while the to-dos are read", () => {
    useTaskRows.setState({ rows: null });
    render(<Schedule />);
    const card = screen.getByRole("region", { name: "Today" });
    expect(card.querySelector(".kasten-todo-skeleton")).not.toBeNull();
    expect(card.textContent).not.toContain("Nothing on today.");
  });

  it("shows an event's details on a click", async () => {
    events = [event({ title: "Standup", location: "Zoom room 4" })];
    render(<Schedule />);
    fireEvent.click(await screen.findByRole("button", { name: /Standup/ }));
    const dialog = await screen.findByRole("dialog", { name: "Event: Standup" });
    expect(within(dialog).getByText("Zoom room 4")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Make meeting note" })).toBeTruthy();
  });

  it("goes to the Calendar from its link", async () => {
    const go = vi.fn();
    useWorkspace.setState({ go });
    events = [event()];
    render(<Schedule />);
    fireEvent.click(await screen.findByRole("button", { name: "Calendar" }));
    expect(go).toHaveBeenCalledWith({ view: "calendar" });
  });
});

describe("Home's Today section", () => {
  it("loads its code and shows the card, with or without the desktop app", async () => {
    events = [event({ title: "Standup" })];
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
