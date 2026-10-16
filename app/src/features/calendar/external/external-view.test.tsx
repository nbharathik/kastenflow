// Events of subscribed calendars in the Calendar: placed on their days,
// opened for details, made into a meeting note on a click, shown or hidden
// per calendar, and in the week's hour grid.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { CALENDAR_SHOW, usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { cell, openCalendar, today } from "../test-kit";
import { HOUR_PX } from "./hours";
import { useFeeds } from "./store";
import type { CalendarInfo, ExternalEvent } from "./types";

// What the desktop app would answer; the browser preview answers nothing.
let desktop = true;
let calendars: CalendarInfo[] = [];
let events: ExternalEvent[] = [];
let changed: (() => void) | null = null;

vi.mock("./api", () => ({
  canSubscribe: () => desktop,
  calendarsList: vi.fn(async () => calendars),
  calendarEvents: vi.fn(async (from: string, to: string) => ({ events: events.filter((e) => e.end.slice(0, 10) >= from && e.start.slice(0, 10) <= to), truncated: false })),
  calendarRefresh: vi.fn(async () => calendars),
  calendarAdd: vi.fn(),
  calendarRemove: vi.fn(),
  calendarEdit: vi.fn(async (id: string, change: Partial<CalendarInfo>) => {
    calendars = calendars.map((c) => (c.id === id ? { ...c, ...change } : c));
    return calendars.find((c) => c.id === id)!;
  }),
  // The store listens once per window, so the listener outlives each test.
  onCalendarsChanged: (then: () => void) => {
    changed = then;
    return Promise.resolve(() => {});
  },
}));

vi.mock("../../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/api")>()), openUrl: vi.fn(async () => {}) }));

import { openUrl } from "../../../lib/api";
import * as api from "./api";

const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1_700_000_000, lastChecked: 1_700_000_000, error: null };

let count = 0;
function event(over: Partial<ExternalEvent> = {}): ExternalEvent {
  count += 1;
  return { calendar: "c1", id: `e${count}`, uid: `u${count}`, title: `Event ${count}`, allDay: false, start: `${today}T09:00`, end: `${today}T10:00`, location: null, description: null, link: null, tentative: false, zoneGuess: false, ...over };
}

const standup = () => event({ title: "Team standup", location: "Zoom room 4", description: "Quick sync.", link: "https://meet.example.com/abc" });

const SEED = {
  "library/idea.md": "---\ntitle: An idea\n---\nText.\n",
  "templates/meeting.md": '---\ntitle: "{{title}}"\ntype: page\ntags: [meeting]\nprops:\n  date: "{{date}}"\n---\n**When:** [[{{date}}]]\n\n## Agenda\n',
};

beforeEach(() => {
  localStorage.clear();
  desktop = true;
  calendars = [work];
  events = [];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
  usePrefs.setState({ calendarShow: CALENDAR_SHOW, peekMode: "center" });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

describe("Calendar: events of subscribed calendars", () => {
  it("shows an event on its day with its hours, and an all-day one above the notes", async () => {
    events = [standup(), event({ title: "Company holiday", allDay: true, start: today, end: today })];
    await openCalendar(SEED);
    fireEvent.keyDown(window, { key: "w" });
    const day = cell(today);
    const chip = await within(day).findByRole("button", { name: "09:00–10:00 Team standup, Work" });
    // It does not move, but it can be carried to a day to make a note for it (event-drop.test.tsx).
    expect(chip.getAttribute("draggable")).toBe("true");
    expect(chip.querySelector("time.kasten-cal-chip-time")?.textContent).toBe("09:00–10:00");
    const names = within(day)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((name) => /Company holiday|Team standup/.test(name ?? ""));
    // All-day first, then the timed one.
    expect(names).toEqual(["Company holiday, Work", "09:00–10:00 Team standup, Work"]);
    expect(api.calendarEvents).toHaveBeenCalled();
  });

  it("looks at the calendars not asked for lately when it opens", async () => {
    await openCalendar(SEED);
    await waitFor(() => expect(api.calendarRefresh).toHaveBeenCalledWith(null, 5));
  });

  it("shows nothing, and asks for nothing, in the browser preview", async () => {
    desktop = false;
    events = [standup()];
    await openCalendar(SEED);
    expect(screen.queryByRole("button", { name: /Team standup/ })).toBeNull();
    expect(api.calendarsList).not.toHaveBeenCalled();
    expect(api.calendarEvents).not.toHaveBeenCalled();
    expect(api.calendarRefresh).not.toHaveBeenCalled();
  });

  it("shows an event that arrives later, when the desktop app says a calendar changed", async () => {
    await openCalendar(SEED);
    await waitFor(() => expect(changed).not.toBeNull());
    events = [standup()];
    await act(async () => changed!());
    expect(await screen.findByRole("button", { name: /Team standup/ })).toBeTruthy();
  });

  it("opens an event's details, and its link in the system browser", async () => {
    events = [standup()];
    await openCalendar(SEED);
    fireEvent.click(await screen.findByRole("button", { name: /Team standup/ }));
    const dialog = await screen.findByRole("dialog", { name: "Event: Team standup" });
    expect(within(dialog).getByText("Zoom room 4")).toBeTruthy();
    expect(within(dialog).getByText("Quick sync.")).toBeTruthy();
    expect(within(dialog).getByText("Work")).toBeTruthy();
    expect(within(dialog).getByText(/09:00–10:00/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open the link" }));
    expect(openUrl).toHaveBeenCalledWith("https://meet.example.com/abc");
    // Escape closes it.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Event: Team standup" })).toBeNull());
  });

  it("says when an event's time zone was a guess", async () => {
    events = [event({ title: "Strange zone", zoneGuess: true })];
    await openCalendar(SEED);
    fireEvent.click(await screen.findByRole("button", { name: /Strange zone/ }));
    expect((await screen.findByRole("dialog", { name: "Event: Strange zone" })).textContent).toContain("time zone could not be found");
  });

  it("makes a meeting note from the template only when asked, titled, dated and with the link", async () => {
    events = [standup()];
    const vault = await openCalendar(SEED);
    const before = (await vault.list()).length;
    fireEvent.click(await screen.findByRole("button", { name: /Team standup/ }));
    // Looking at an event writes nothing to the notes.
    expect((await vault.list()).length).toBe(before);
    const dialog = await screen.findByRole("dialog", { name: "Event: Team standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make meeting note" }));
    await waitFor(() => expect(useWorkspace.getState().place.path).toMatch(/team-standup/));
    const note = await vault.read(useWorkspace.getState().place.path!);
    expect(note.text).toContain("title: Team standup");
    expect(note.text).toContain("tags: [meeting]");
    expect(note.text).toMatch(/url:\s*"?https:\/\/meet\.example\.com\/abc/);
    expect(note.text).toContain(`[[${today}]]`);
    expect((await vault.list()).length).toBe(before + 1);
  });

  it("makes a plain page, still tagged and dated, when the vault has no meeting template", async () => {
    events = [event({ title: "Planning", link: null })];
    const vault = await openCalendar({ "library/idea.md": SEED["library/idea.md"] });
    fireEvent.click(await screen.findByRole("button", { name: /Planning/ }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Event: Planning" })).getByRole("button", { name: "Make meeting note" }));
    await waitFor(() => expect(useWorkspace.getState().place.path).toMatch(/planning/));
    const note = await vault.read(useWorkspace.getState().place.path!);
    expect(note.text).toContain("title: Planning");
    expect(note.text).toMatch(/meeting/);
    expect(note.text).toContain(today);
    expect(note.text).not.toContain("url:");
  });
});

describe("Calendar: Show menu", () => {
  it("has a switch for each subscribed calendar, which hides its events", async () => {
    calendars = [work, { ...work, id: "c2", name: "Home", color: "pink" }];
    events = [standup(), event({ calendar: "c2", title: "Dentist" })];
    await openCalendar(SEED);
    await screen.findByRole("button", { name: /Dentist/ });
    fireEvent.click(screen.getByRole("button", { name: /Show/ }));
    const menu = await screen.findByRole("dialog", { name: "Show on the calendar" });
    const home = within(menu).getByRole("menuitemcheckbox", { name: /Home/ });
    expect(home.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(home);
    await waitFor(() => expect(api.calendarEdit).toHaveBeenCalledWith("c2", { shown: false }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Dentist/ })).toBeNull());
    expect(screen.getByRole("button", { name: /Team standup/ })).toBeTruthy();
    // The badge counts what is hidden.
    expect(screen.getByLabelText("1 hidden")).toBeTruthy();
  });

  it("shows nothing of a calendar that is hidden", async () => {
    calendars = [{ ...work, shown: false }];
    events = [standup()];
    await openCalendar(SEED);
    await waitFor(() => expect(api.calendarsList).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Team standup/ })).toBeNull();
    expect(api.calendarEvents).not.toHaveBeenCalled();
  });
});

describe("Calendar: the week by the hour", () => {
  const hours = () => screen.findByRole("region", { name: "Hours of the week" });

  it("places timed events and to-dos with a time on their hours, and keeps all-day ones above", async () => {
    events = [standup(), event({ title: "Company holiday", allDay: true, start: today, end: today })];
    await openCalendar({ ...SEED, "library/day.md": `---\ntitle: Day\n---\n- [ ] Call Sam [[${today}]] 14:00\n- [ ] Anytime @${today}\n` });
    fireEvent.keyDown(window, { key: "w" });
    expect(screen.queryByRole("region", { name: "Hours of the week" })).toBeNull();
    fireEvent.keyDown(window, { key: "h" });
    const grid = await hours();
    expect(within(grid).getAllByRole("group")).toHaveLength(7);
    const column = grid.querySelector(`[data-day="${today}"]`) as HTMLElement;
    const block = (name: RegExp) => within(column).getByRole("button", { name }).closest(".kasten-cal-block") as HTMLElement;
    // 09:00 to 10:00: nine hours down, one hour tall.
    const meeting = block(/Team standup/);
    expect(meeting.style.top).toBe(`${9 * HOUR_PX}px`);
    expect(meeting.style.height).toBe(`${HOUR_PX}px`);
    expect(meeting.style.left).toBe("0%");
    expect(meeting.style.width).toBe("100%");
    // A to-do with a time: a short stretch from its time.
    const call = await waitFor(() => block(/Call Sam/));
    expect(call.style.top).toBe(`${14 * HOUR_PX}px`);
    expect(call.style.height).toBe(`${0.5 * HOUR_PX}px`);
    // No hour: in the all-day row, not on the hours.
    expect(within(column).queryByRole("button", { name: /Company holiday/ })).toBeNull();
    expect(within(cell(today)).getByRole("button", { name: /Company holiday/ })).toBeTruthy();
    expect(within(cell(today)).getByRole("button", { name: /Anytime/ })).toBeTruthy();
    expect(localStorage.getItem("kasten.calendar.hours")).toBe("1");
  });

  it("shares the column between events that overlap", async () => {
    events = [event({ title: "First", start: `${today}T09:00`, end: `${today}T10:30` }), event({ title: "Second", start: `${today}T09:30`, end: `${today}T10:00` })];
    await openCalendar(SEED);
    fireEvent.keyDown(window, { key: "w" });
    fireEvent.keyDown(window, { key: "h" });
    const column = (await hours()).querySelector(`[data-day="${today}"]`) as HTMLElement;
    const block = async (name: RegExp) => (await within(column).findByRole("button", { name })).closest(".kasten-cal-block") as HTMLElement;
    const first = await block(/First/);
    const second = await block(/Second/);
    expect([first.style.left, first.style.width]).toEqual(["0%", "50%"]);
    expect([second.style.left, second.style.width]).toEqual(["50%", "50%"]);
  });

  it("is switched on and off by the Hours button, and remembered", async () => {
    await openCalendar(SEED);
    fireEvent.keyDown(window, { key: "w" });
    const button = screen.getByRole("button", { name: "Hours" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    await hours();
    expect(screen.getByRole("button", { name: "Hours" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("kasten.calendar.hours")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Hours of the week" })).toBeNull());
    expect(localStorage.getItem("kasten.calendar.hours")).toBe("0");
    // H does nothing in the month.
    fireEvent.keyDown(window, { key: "m" });
    fireEvent.keyDown(window, { key: "h" });
    expect(screen.queryByRole("button", { name: "Hours" })).toBeNull();
    expect(localStorage.getItem("kasten.calendar.hours")).toBe("0");
  });
});
