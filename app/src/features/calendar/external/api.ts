// The desktop app's calendar commands. The browser preview has none: it
// answers no subscriptions and no events, and Settings says it needs the
// desktop app.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { CalendarChange, CalendarEvents, CalendarInfo } from "./types";

/** Whether this window can subscribe to calendars (the desktop app only). */
export const canSubscribe = (): boolean => isTauri();

export const calendarsList = async (): Promise<CalendarInfo[]> => (isTauri() ? invoke<CalendarInfo[]>("calendars_list") : []);

/** Fetches and reads the feed once, then keeps it. Rejects, in words, when
 * the address is not a calendar or cannot be reached. */
export const calendarAdd = (name: string, url: string, color: string): Promise<CalendarInfo> => invoke<CalendarInfo>("calendar_add", { name, url, color });

export const calendarEdit = (id: string, change: CalendarChange): Promise<CalendarInfo> => invoke<CalendarInfo>("calendar_edit", { id, change });

/** Removes the subscription, its copy and its address in the keychain. */
export const calendarRemove = (id: string): Promise<CalendarInfo[]> => invoke<CalendarInfo[]>("calendar_remove", { id });

/** Refreshes one calendar, or every shown one; with `maxAgeMinutes`, only
 * those not asked for that recently. */
export const calendarRefresh = (id?: string | null, maxAgeMinutes?: number | null): Promise<CalendarInfo[]> =>
  isTauri() ? invoke<CalendarInfo[]>("calendar_refresh", { id: id ?? null, maxAgeMinutes: maxAgeMinutes ?? null }) : Promise.resolve([]);

/** This computer's time zone, as the events' clock. */
const zone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

const NONE: CalendarEvents = { events: [], truncated: false };

/** The events of the shown calendars on the days from `from` to `to`
 * (`2026-10-12`, both included, at most about 400 days). */
export const calendarEvents = (from: string, to: string): Promise<CalendarEvents> =>
  isTauri() ? invoke<CalendarEvents>("calendar_events", { from, to, zone: zone() }) : Promise.resolve(NONE);

/** Calls `then` when a calendar's copy, or whether it could be refreshed,
 * changed. Resolves to the way to stop listening. */
export function onCalendarsChanged(then: () => void): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen("calendars-changed", () => then());
}
