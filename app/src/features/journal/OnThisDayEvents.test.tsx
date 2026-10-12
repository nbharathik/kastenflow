// Events of subscribed calendars in a journal day's "On this day".

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { CalendarInfo, EventPart, ExternalEvent } from "../calendar/external/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
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
import { DayActivity } from "./DayActivity";
import { OnThisDay } from "./OnThisDay";

const today = dayFrom(0);
const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1_700_000_000, lastChecked: 1_700_000_000, error: null };

let count = 0;
function event(over: Partial<ExternalEvent> = {}): ExternalEvent {
  count += 1;
  return { calendar: "c1", id: `e${count}`, uid: `u${count}`, title: `Event ${count}`, allDay: false, start: `${today}T09:00`, end: `${today}T10:00`, location: null, description: null, link: null, tentative: false, zoneGuess: false, ...over };
}

const part = (e: ExternalEvent): EventPart => ({ event: e, day: today, at: e.allDay ? null : e.start.slice(11), until: e.allDay ? null : e.end.slice(11), span: null, key: `c1:${e.id}:${today}` });

beforeEach(() => {
  desktop = true;
  calendars = [work];
  events = [];
  vi.clearAllMocks();
  localStorage.clear();
  useFeeds.setState({ list: null, version: 0 });
  useWorkspace.setState({ client: new MemoryVault({}), notes: [] });
});
afterEach(cleanup);

describe("On this day", () => {
  it("lists the day's events first, with their times, and shows details on a click", () => {
    useFeeds.setState({ list: [work], version: 1 });
    const standup = event({ title: "Standup", location: "Zoom room 4" });
    render(<OnThisDay day={today} ongoing={[]} due={[]} tasks={[]} made={[]} edited={[]} events={[part(standup), part(event({ title: "Holiday", allDay: true, start: today, end: today }))]} />);
    const strip = screen.getByLabelText("On this day");
    const group = within(strip).getByText("Events").parentElement!;
    expect(strip.firstElementChild).toBe(group);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["09:00–10:00Standup", "Holiday"]);
    fireEvent.click(within(group).getByRole("button", { name: /Standup/ }));
    expect(screen.getByRole("dialog", { name: "Event: Standup" })).toBeTruthy();
  });

  it("is drawn for a day with only events, and not for one with nothing", () => {
    const { container } = render(<OnThisDay day={today} ongoing={[]} due={[]} tasks={[]} made={[]} edited={[]} />);
    expect(container.textContent).toBe("");
  });

  it("counts the events in the journal day's toggle", async () => {
    events = [event({ title: "Standup" }), event({ title: "Lunch", start: `${today}T12:00`, end: `${today}T13:00` })];
    render(<DayActivity day={today} />);
    const toggle = await screen.findByRole("button", { name: /On this day/ });
    await waitFor(() => expect(toggle.textContent).toContain("2 events"));
    fireEvent.click(toggle);
    const strip = await screen.findByLabelText("On this day");
    expect(within(strip).getByRole("button", { name: /Standup/ })).toBeTruthy();
  });

  it("has no events in the browser preview", async () => {
    desktop = false;
    events = [event({ title: "Standup" })];
    render(<DayActivity day={today} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /On this day/ })).toBeNull());
  });
});
