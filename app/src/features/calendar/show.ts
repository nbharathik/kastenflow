// What the Calendar shows on its days, as the header's Show menu
// and Settings both list it. The choice is a preference of this window
// (`calendarShow`), not content.

import { CALENDAR_SHOW, type CalendarShow } from "../workspace/prefs";

export const SHOW_OPTIONS: readonly { key: keyof CalendarShow; label: string; detail: string }[] = [
  { key: "journal", label: "Journal", detail: "Each day’s journal page" },
  { key: "dated", label: "Dated notes", detail: "Notes by a date property: a task’s due day, a trip from start to end" },
  { key: "tasks", label: "To-dos", detail: "Open to-dos that name a day, such as “call the bank @2026‑10‑02”" },
  { key: "mentions", label: "Mentions", detail: "Pages that link a day, such as [[2026‑10‑02]]" },
  { key: "made", label: "Made that day", detail: "Notes created on the day" },
];

/** How many kinds shown by default are hidden, for the Show button's badge. */
export const hiddenCount = (show: CalendarShow) => SHOW_OPTIONS.filter((o) => CALENDAR_SHOW[o.key] && !show[o.key]).length;

/** How many subscribed calendars are hidden: they count in the badge too. */
export const hiddenCalendars = (calendars: readonly { shown: boolean }[] | null) => calendars?.filter((c) => !c.shown).length ?? 0;
