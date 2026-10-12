import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CalendarInfo } from "./types";

let calendars: CalendarInfo[] = [];
let changed: (() => void) | null = null;

vi.mock("./api", () => ({
  canSubscribe: () => true,
  calendarsList: vi.fn(async () => calendars),
  calendarEvents: vi.fn(async () => ({ events: [], truncated: false })),
  calendarRefresh: vi.fn(async () => calendars),
  calendarAdd: vi.fn(),
  calendarRemove: vi.fn(),
  calendarEdit: vi.fn(),
  onCalendarsChanged: (then: () => void) => {
    changed = then;
    return Promise.resolve(() => {});
  },
}));

import * as api from "./api";
import { useFeeds } from "./store";

const work: CalendarInfo = { id: "c1", name: "Work", color: "teal", refreshMinutes: 30, shown: true, host: "calendar.example.com", masked: "calendar.example.com/….ics", lastUpdated: 1, lastChecked: 1, error: null };

beforeEach(() => {
  calendars = [work];
  vi.clearAllMocks();
  useFeeds.setState({ list: null, version: 0 });
});

describe("the subscribed calendars this window knows", () => {
  it("asks once when several views ask together, and again when told to", async () => {
    await Promise.all([useFeeds.getState().load(), useFeeds.getState().load(), useFeeds.getState().load()]);
    expect(api.calendarsList).toHaveBeenCalledTimes(1);
    expect(useFeeds.getState().list).toEqual([work]);
    await useFeeds.getState().load();
    expect(api.calendarsList).toHaveBeenCalledTimes(2);
  });

  it("asks again when the desktop app says a calendar changed", async () => {
    await useFeeds.getState().load();
    const before = useFeeds.getState().version;
    calendars = [work, { ...work, id: "c2", name: "Home" }];
    changed!();
    await vi.waitFor(() => expect(useFeeds.getState().list).toHaveLength(2));
    expect(useFeeds.getState().version).toBeGreaterThan(before);
  });

  it("keeps an empty list when the desktop app cannot answer", async () => {
    vi.mocked(api.calendarsList).mockRejectedValueOnce(new Error("no"));
    await useFeeds.getState().load(true);
    expect(useFeeds.getState().list).toEqual([]);
  });

  it("refreshes the calendars not asked for lately, or one at once", async () => {
    await useFeeds.getState().refresh(5);
    expect(api.calendarRefresh).toHaveBeenLastCalledWith(null, 5);
    await useFeeds.getState().refresh(null, "c1");
    expect(api.calendarRefresh).toHaveBeenLastCalledWith("c1", null);
    // A refresh that fails leaves the list as it was.
    vi.mocked(api.calendarRefresh).mockRejectedValueOnce(new Error("no"));
    await expect(useFeeds.getState().refresh(5)).resolves.toBeUndefined();
  });

  it("puts a changed calendar in its place, and a removed one out of the list even when the keychain failed", async () => {
    await useFeeds.getState().load();
    vi.mocked(api.calendarEdit).mockResolvedValueOnce({ ...work, shown: false });
    await useFeeds.getState().edit("c1", { shown: false });
    expect(useFeeds.getState().list).toEqual([{ ...work, shown: false }]);
    vi.mocked(api.calendarRemove).mockRejectedValueOnce(new Error("The calendar was removed, but its address could not be removed from the keychain"));
    calendars = [];
    await expect(useFeeds.getState().remove("c1")).rejects.toThrow(/keychain/);
    expect(useFeeds.getState().list).toEqual([]);
  });

  it("adds a calendar and then asks for the list", async () => {
    vi.mocked(api.calendarAdd).mockImplementationOnce(async (name, _url, color) => {
      calendars = [...calendars, { ...work, id: "c2", name, color }];
      return calendars.at(-1)!;
    });
    const made = await useFeeds.getState().add("Home", "https://example.com/a.ics", "pink");
    expect(made.id).toBe("c2");
    expect(useFeeds.getState().list?.map((c) => c.name)).toEqual(["Work", "Home"]);
  });
});
