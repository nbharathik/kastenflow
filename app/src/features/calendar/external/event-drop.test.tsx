// An event of a subscribed calendar dropped on a day: a note for that day is
// made (undoable), the event stays where it is, and nothing is written to the
// calendar. Also the keyboard's way (the popover's "Note for a day…") and the
// journal's days as drop targets.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { DayList } from "../../journal/DayList";
import { MiniCalendar } from "../../journal/MiniCalendar";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { CALENDAR_SHOW, usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { addDays } from "../dates";
import { cell, openCalendar, today, transfer } from "../test-kit";
import { EVENT_DRAG, carryEvent, droppedEvent } from "./event-drag";
import { useFeeds } from "./store";
import type { CalendarInfo, ExternalEvent } from "./types";

let calendars: CalendarInfo[] = [];
let events: ExternalEvent[] = [];

vi.mock("./api", () => ({
  canSubscribe: () => true,
  calendarsList: vi.fn(async () => calendars),
  calendarEvents: vi.fn(async (from: string, to: string) => ({ events: events.filter((e) => e.end.slice(0, 10) >= from && e.start.slice(0, 10) <= to), truncated: false })),
  calendarRefresh: vi.fn(async () => calendars),
  calendarAdd: vi.fn(),
  calendarRemove: vi.fn(),
  calendarEdit: vi.fn(),
  onCalendarsChanged: () => Promise.resolve(() => {}),
}));

import * as api from "./api";

const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1, lastChecked: 1, error: null };
const tomorrow = addDays(today, 1);

function standup(over: Partial<ExternalEvent> = {}): ExternalEvent {
  return { calendar: "c1", id: "e1", uid: "u1", title: "Team standup", allDay: false, start: `${today}T09:00`, end: `${today}T09:30`, location: null, description: null, link: "https://meet.example.com/abc", tentative: false, zoneGuess: false, ...over };
}

const SEED = {
  "library/idea.md": "---\ntitle: An idea\n---\nText.\n",
  "templates/meeting.md": '---\ntitle: "{{title}}"\ntype: page\ntags: [meeting]\nprops:\n  date: "{{date}}"\n---\n**When:** [[{{date}}]]\n\n## Agenda\n',
};

beforeEach(() => {
  localStorage.clear();
  calendars = [work];
  events = [];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
  usePrefs.setState({ calendarShow: CALENDAR_SHOW, peekMode: "center" });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

const titled = async (vault: MemoryVault, title: string) => (await vault.list()).filter((n) => n.title === title && n.kind !== "template");

describe("carrying an event", () => {
  it("puts the event on the drag under its own type, and reads it back checked", () => {
    const data = transfer();
    carryEvent({ dataTransfer: data as unknown as DataTransfer }, standup());
    expect(data.effectAllowed).toBe("copy");
    expect(data.types).toContain(EVENT_DRAG);
    expect(droppedEvent({ dataTransfer: data as unknown as DataTransfer })).toEqual(standup());
  });

  it("takes nothing it cannot read as an event: no title, a time that is not one, a link that is not a web address", () => {
    const drop = (value: unknown) => {
      const data = transfer();
      data.setData(EVENT_DRAG, typeof value === "string" ? value : JSON.stringify(value));
      return droppedEvent({ dataTransfer: data as unknown as DataTransfer });
    };
    expect(drop("not json")).toBeNull();
    expect(drop(null)).toBeNull();
    expect(drop([])).toBeNull();
    expect(drop({ ...standup(), title: 7 })).toBeNull();
    expect(drop({ ...standup(), start: "yesterday" })).toBeNull();
    expect(drop({ ...standup(), allDay: "yes" })).toBeNull();
    expect(drop({ ...standup(), title: "x".repeat(501) })).toBeNull();
    // A link that is not http(s) is dropped from the event, the rest is kept.
    expect(drop({ ...standup(), link: "javascript:alert(1)" })?.link).toBeNull();
    expect(drop({ ...standup(), link: "file:///etc/passwd" })?.link).toBeNull();
    // Unknown fields are not carried along.
    expect(Object.keys(drop({ ...standup(), extra: "x" })!)).not.toContain("extra");
  });
});

describe("the Calendar's days", () => {
  it("take an event: a note for that day, dated and linked, Undo takes it away, the event stays", async () => {
    events = [standup()];
    const vault = await openCalendar(SEED);
    const chip = await screen.findByRole("button", { name: /Team standup/ });
    expect(chip.getAttribute("draggable")).toBe("true");
    const target = cell(tomorrow);
    const data = transfer();
    fireEvent.dragStart(chip, { dataTransfer: data });
    fireEvent.dragEnter(target, { dataTransfer: data });
    fireEvent.dragOver(target, { dataTransfer: data });
    // The day lights up and the pointer shows a copy.
    expect(target.className).toContain("is-over");
    expect(data.dropEffect).toBe("copy");
    await act(async () => fireEvent.drop(target, { dataTransfer: data }));
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(1));
    const [made] = await titled(vault, "Team standup");
    const text = (await vault.read(made!.path)).text;
    expect(text).toContain("tags: [meeting]");
    expect(text).toMatch(/url:\s*"?https:\/\/meet\.example\.com\/abc/);
    // For tomorrow, at the event's hour; the template links the day.
    expect(text).toContain(`[[${tomorrow}]]`);
    expect(made!.props.date).toBe(tomorrow);
    expect(target.className).not.toContain("is-over");
    expect(useWorkspace.getState().toasts.at(-1)?.text).toMatch(/^Made “Team standup” for /);
    // The event is still on its own day; the calendar was not asked to change.
    expect(within(cell(today)).getByRole("button", { name: /Team standup/ })).toBeTruthy();
    expect(api.calendarAdd).not.toHaveBeenCalled();
    expect(api.calendarEdit).not.toHaveBeenCalled();
    expect(api.calendarRemove).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(0));
  });

  it("makes a plain page, still tagged and dated, when the vault has no meeting template", async () => {
    events = [standup({ link: null })];
    const vault = await openCalendar({ "library/idea.md": SEED["library/idea.md"] });
    const data = transfer();
    fireEvent.dragStart(await screen.findByRole("button", { name: /Team standup/ }), { dataTransfer: data });
    fireEvent.dragOver(cell(tomorrow), { dataTransfer: data });
    await act(async () => fireEvent.drop(cell(tomorrow), { dataTransfer: data }));
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(1));
    const [made] = await titled(vault, "Team standup");
    expect(made!.tags).toEqual(["meeting"]);
    expect(made!.props).toEqual({ date: tomorrow });
    // A plain page links the day, with the event's hour, so the day lists it.
    expect((await vault.read(made!.path)).text).toContain(`**When:** [[${tomorrow}]] 09:00`);
  });

  it("ignores what was carried under the type but is not an event, and stops lighting the day", async () => {
    events = [standup()];
    const vault = await openCalendar(SEED);
    const before = (await vault.list()).length;
    const data = transfer();
    data.setData(EVENT_DRAG, '{"title": 3}');
    fireEvent.dragOver(cell(tomorrow), { dataTransfer: data });
    await act(async () => fireEvent.drop(cell(tomorrow), { dataTransfer: data }));
    expect((await vault.list()).length).toBe(before);
    expect(cell(tomorrow).className).not.toContain("is-over");
  });

  it("makes the note from the event's popover too, for any day, by the keyboard", async () => {
    events = [standup()];
    const vault = await openCalendar(SEED);
    fireEvent.click(await screen.findByRole("button", { name: /Team standup/ }));
    const dialog = await screen.findByRole("dialog", { name: "Event: Team standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Note for a day…" }));
    const form = within(await screen.findByRole("form", { name: "Make a note for a day" }));
    const day = form.getByLabelText("Day for the note") as HTMLInputElement;
    expect(day.value).toBe(today);
    fireEvent.change(day, { target: { value: tomorrow } });
    await act(async () => fireEvent.click(form.getByRole("button", { name: "Make note" })));
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(1));
    expect((await titled(vault, "Team standup"))[0]!.props.date).toBe(tomorrow);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Event: Team standup" })).toBeNull());
    // Looking at an event, and asking for its form, wrote nothing before this.
    expect(useWorkspace.getState().toasts.at(-1)?.action?.label).toBe("Undo");
  });
});

describe("the journal's days", () => {
  const stage = async (seed: Record<string, string> = SEED) => {
    const vault = new MemoryVault(seed);
    useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
    return vault;
  };

  const carry = (event = standup()) => {
    const data = transfer();
    carryEvent({ dataTransfer: data as unknown as DataTransfer }, event);
    return data;
  };

  it("take an event dropped on a day in the list, with the same note and Undo", async () => {
    const vault = await stage();
    render(<DayList today={today} current={today} pages={new Map()} marks={new Map()} onPick={() => {}} />);
    // Today's row is always in the list.
    const row = document.querySelector(`.kasten-journal-days [data-day="${today}"]`)!;
    const day = today;
    const data = carry();
    fireEvent.dragOver(row, { dataTransfer: data });
    expect(row.className).toContain("is-event-over");
    expect(data.dropEffect).toBe("copy");
    await act(async () => fireEvent.drop(row, { dataTransfer: data }));
    expect(row.className).not.toContain("is-event-over");
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(1));
    expect((await titled(vault, "Team standup"))[0]!.props.date).toBe(day);
  });

  it("leave alone a drag that holds no event", async () => {
    const vault = await stage();
    render(<DayList today={today} current={today} pages={new Map()} marks={new Map()} onPick={() => {}} />);
    const row = document.querySelector(`.kasten-journal-days [data-day="${today}"]`)!;
    const before = (await vault.list()).length;
    const data = transfer();
    data.setData("text/plain", "something");
    fireEvent.dragOver(row, { dataTransfer: data });
    expect(row.className).not.toContain("is-event-over");
    await act(async () => fireEvent.drop(row, { dataTransfer: data }));
    expect((await vault.list()).length).toBe(before);
  });

  it("take an event dropped on a day of the month beside the page", async () => {
    const vault = await stage();
    render(<MiniCalendar today={today} current={today} marks={new Map()} onPick={() => {}} />);
    const day = document.querySelector<HTMLElement>(`.kasten-mini-day[data-day="${today}"]`)!;
    await act(async () => fireEvent.drop(day, { dataTransfer: carry(standup({ id: "e2", allDay: true, start: tomorrow, end: tomorrow })) }));
    await waitFor(async () => expect(await titled(vault, "Team standup")).toHaveLength(1));
    // An all-day event keeps no hour: the note is for the day dropped on.
    expect((await titled(vault, "Team standup"))[0]!.props.date).toBe(today);
  });
});
