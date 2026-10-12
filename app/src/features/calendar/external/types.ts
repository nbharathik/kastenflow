// Subscribed calendars, as the desktop app tells the window about them
// (app/src-tauri/src/calendars, serde camelCase). Read-only: nothing here is
// ever written back to a calendar or to the vault.

/** One subscription. The feed's address is a secret kept in the system
 * keychain, so the window never sees it: only the host and a masked form. */
export interface CalendarInfo {
  id: string;
  name: string;
  /** A tag colour name (`teal`) or `#rrggbb`, as the Tag Database draws them. */
  color: string;
  refreshMinutes: number;
  shown: boolean;
  host: string;
  /** `calendar.google.com/….ics`: where the address would be. */
  masked: string;
  /** When the last copy was known to be current, in seconds since 1970. */
  lastUpdated: number | null;
  lastChecked: number | null;
  /** Why the last refresh failed; the events shown are then the last copy. */
  error: string | null;
}

/** One event on one stretch of the calendar, on this computer's clock. */
export interface ExternalEvent {
  /** The subscription it belongs to. */
  calendar: string;
  /** Tells this occurrence from the others of its event. */
  id: string;
  uid: string;
  title: string;
  allDay: boolean;
  /** `2026-10-12` for an all-day event, else `2026-10-12T14:30`. */
  start: string;
  /** The same, where it ends; an all-day event's last day, not the day after. */
  end: string;
  location: string | null;
  description: string | null;
  /** A web address for it: its own link, or a meeting link found in it. */
  link: string | null;
  tentative: boolean;
  /** The time zone was not found, so the time is a guess. */
  zoneGuess: boolean;
}

export interface CalendarEvents {
  events: ExternalEvent[];
  /** Some events are missing: there were too many to give. */
  truncated: boolean;
}

/** What may be changed on a subscription; what is left out stays. */
export interface CalendarChange {
  name?: string;
  color?: string;
  shown?: boolean;
  refreshMinutes?: number;
  /** A new address for the same calendar. */
  url?: string;
}

/** The part of an event on one day: a multi-day all-day event has one on each
 * day it covers; a timed one that runs past midnight has one on each day it
 * touches. */
export interface EventPart {
  event: ExternalEvent;
  day: string;
  /** `HH:MM` it starts at on this day; null for an all-day event. */
  at: string | null;
  /** `HH:MM` it ends at on this day; `24:00` when it runs on past midnight. */
  until: string | null;
  /** This day's place in an event of several days: `[2, 3]`. */
  span: [number, number] | null;
  /** A stable handle for lists. */
  key: string;
}
