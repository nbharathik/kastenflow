// Settings → Subscribed calendars: the list, show or hide, refresh, remove
// with a confirmation, and subscribing with an address that is checked first.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../workspace/store";
import { CalendarFeeds } from "./CalendarFeeds";
import { useFeeds } from "./store";
import type { CalendarInfo } from "./types";

// What the desktop app would answer; the browser preview answers nothing.
let desktop = true;
let calendars: CalendarInfo[] = [];

vi.mock("./api", () => ({
  canSubscribe: () => desktop,
  calendarsList: vi.fn(async () => calendars),
  calendarEvents: vi.fn(async () => ({ events: [], truncated: false })),
  calendarRefresh: vi.fn(async () => calendars),
  calendarAdd: vi.fn(),
  calendarRemove: vi.fn(async () => {
    calendars = [];
    return calendars;
  }),
  calendarEdit: vi.fn(async (id: string, change: Partial<CalendarInfo>) => {
    calendars = calendars.map((c) => (c.id === id ? { ...c, ...change } : c));
    return calendars.find((c) => c.id === id)!;
  }),
  onCalendarsChanged: () => Promise.resolve(() => {}),
}));

import * as api from "./api";

const NOW = Math.floor(Date.now() / 1000);
const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: NOW - 5 * 60, lastChecked: NOW - 60, error: null };
const toast = vi.fn();

async function show() {
  render(<CalendarFeeds />);
  return screen.findByRole("region", { name: "Subscribed calendars" });
}

beforeEach(() => {
  desktop = true;
  calendars = [work];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
  useWorkspace.setState({ toast });
});
afterEach(cleanup);

describe("Settings → Subscribed calendars", () => {
  it("says it needs the desktop app in the browser preview, and asks for nothing", async () => {
    desktop = false;
    const section = await show();
    expect(section.textContent).toContain("needs the desktop app");
    expect(within(section).queryByRole("button", { name: /Subscribe/ })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "About Calendars from Google or Outlook" }));
    expect(section.textContent).toContain("cannot keep their addresses safely");
    expect(api.calendarsList).not.toHaveBeenCalled();
  });

  it("lists each calendar by name and where it is, never its address, with how fresh it is", async () => {
    const section = await show();
    const feed = await within(section).findByRole("group", { name: "Work" });
    expect(feed.textContent).toContain("calendar.example.com/….ics");
    expect(feed.textContent).toContain("Updated 5 minutes ago");
    // What they are and are not is behind the heading's ?.
    expect(section.textContent).not.toContain("Nothing is written to your notes");
    fireEvent.click(within(section).getByRole("button", { name: "About Subscribed calendars" }));
    expect(section.textContent).toContain("Nothing is written to your notes");
    expect(within(feed).getByRole("switch", { name: "Show Work" })).toHaveProperty("checked", true);
  });

  it("shows the last copy and why a refresh failed", async () => {
    calendars = [{ ...work, error: "Could not reach calendar.example.com: connection refused" }];
    const section = await show();
    const feed = await within(section).findByRole("group", { name: "Work" });
    expect(within(feed).getByRole("status").textContent).toContain("Could not reach calendar.example.com");
    expect(feed.textContent).toContain("showing the last copy");
  });

  it("shows or hides a calendar from here", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("switch", { name: "Show Work" }));
    await waitFor(() => expect(api.calendarEdit).toHaveBeenCalledWith("c1", { shown: false }));
    await waitFor(() => expect((within(section).getByRole("switch", { name: "Show Work" }) as HTMLInputElement).checked).toBe(false));
  });

  it("refreshes one calendar on request", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Refresh Work" }));
    await waitFor(() => expect(api.calendarRefresh).toHaveBeenCalledWith("c1", null));
  });

  it("removes a calendar only after asking, saying what that forgets", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Remove Work" }));
    expect(api.calendarRemove).not.toHaveBeenCalled();
    expect(section.textContent).toContain("forgets the address on this computer");
    // Keeping it cancels.
    fireEvent.click(within(section).getByRole("button", { name: "Keep" }));
    expect(within(section).queryByRole("button", { name: "Confirm removing Work" })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Remove Work" }));
    fireEvent.click(within(section).getByRole("button", { name: "Confirm removing Work" }));
    await waitFor(() => expect(api.calendarRemove).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(within(section).queryByRole("group", { name: "Work" })).toBeNull());
    expect(toast).toHaveBeenCalledWith("Removed Work");
  });
});

describe("Settings → Subscribe…", () => {
  const open = async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Subscribe…" }));
    return within(await within(section).findByRole("form", { name: "Subscribe to a calendar" }));
  };

  it("says where to find the address, and that it is a secret kept in the keychain", async () => {
    const form = await open();
    expect(form.getByText(/anyone who has one can read the calendar/)).toBeTruthy();
    expect(form.getByText(/system keychain/)).toBeTruthy();
    expect(form.getByText(/Secret address in iCal format/)).toBeTruthy();
    expect(form.getByText(/Publish a calendar/)).toBeTruthy();
    expect((form.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("subscribes with the address, a name and a colour, then closes", async () => {
    vi.mocked(api.calendarAdd).mockImplementation(async (name, _url, color) => {
      calendars = [...calendars, { ...work, id: "c2", name: name || "From the feed", color }];
      return calendars.at(-1)!;
    });
    const form = await open();
    fireEvent.change(form.getByRole("textbox", { name: "Calendar address" }), { target: { value: "webcal://calendar.example.com/ical/private-0123/basic.ics" } });
    fireEvent.change(form.getByRole("textbox", { name: "Calendar name" }), { target: { value: "Home" } });
    fireEvent.click(form.getByRole("radio", { name: "pink" }));
    fireEvent.click(form.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(api.calendarAdd).toHaveBeenCalledWith("Home", "webcal://calendar.example.com/ical/private-0123/basic.ics", "pink"));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Subscribe to a calendar" })).toBeNull());
    expect(toast).toHaveBeenCalledWith("Subscribed to Home");
    // The new calendar is in the list, and the address is nowhere on the page.
    expect(await screen.findByRole("group", { name: "Home" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-0123");
  });

  it("keeps the form and says why when the address is refused", async () => {
    vi.mocked(api.calendarAdd).mockRejectedValue(new Error("calendar.example.com did not give a calendar. Use the calendar's iCal (.ics) address"));
    const form = await open();
    fireEvent.change(form.getByRole("textbox", { name: "Calendar address" }), { target: { value: "https://calendar.example.com/page" } });
    fireEvent.click(form.getByRole("button", { name: "Subscribe" }));
    expect((await form.findByRole("alert")).textContent).toContain("did not give a calendar");
    expect((form.getByRole("textbox", { name: "Calendar address" }) as HTMLInputElement).value).toBe("https://calendar.example.com/page");
    expect((form.getByRole("button", { name: "Subscribe" }) as HTMLButtonElement).disabled).toBe(false);
    expect(calendars).toEqual([work]);
  });

  it("can be cancelled", async () => {
    const form = await open();
    fireEvent.click(form.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(screen.queryByRole("form", { name: "Subscribe to a calendar" })).toBeNull();
    expect(api.calendarAdd).not.toHaveBeenCalled();
  });
});
