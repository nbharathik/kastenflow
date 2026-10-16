// An event of a subscribed calendar carried by the pointer to a day. The event
// travels as plain data under its own type, so only days that know it take it,
// and a drop makes a note for that day (meeting-note.ts): it never moves the
// event and never writes to the calendar. Anything dropped under this type
// from outside the window is read by its shape, not trusted.

import type { ExternalEvent } from "./types";

/** The data type an event is carried as. */
export const EVENT_DRAG = "application/x-kasten-event";

type Transfer = { dataTransfer: DataTransfer | null };

const DAY_OR_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.length <= max ? value : null);

/** Puts the event on the drag: a copy to a day, not a move. */
export function carryEvent(drag: Transfer, event: ExternalEvent): void {
  if (!drag.dataTransfer) return;
  drag.dataTransfer.effectAllowed = "copy";
  drag.dataTransfer.setData(EVENT_DRAG, JSON.stringify(event));
  drag.dataTransfer.setData("text/plain", event.title);
}

/** Whether the drag holds an event (readable while it is still over a day). */
export function carriesEvent(drag: Transfer): boolean {
  return Array.from(drag.dataTransfer?.types ?? []).includes(EVENT_DRAG);
}

/** The event a drop holds, checked field by field; null for anything else. */
export function droppedEvent(drag: Transfer): ExternalEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(drag.dataTransfer?.getData(EVENT_DRAG) ?? "");
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const title = text(e.title, 500);
  const start = text(e.start, 16);
  const end = text(e.end, 16);
  if (title === null || start === null || end === null || !DAY_OR_TIME.test(start) || !DAY_OR_TIME.test(end) || typeof e.allDay !== "boolean") return null;
  const link = text(e.link, 2000);
  return {
    calendar: text(e.calendar, 80) ?? "",
    id: text(e.id, 500) ?? "",
    uid: text(e.uid, 500) ?? "",
    title,
    allDay: e.allDay,
    start,
    end,
    location: text(e.location, 500),
    description: text(e.description, 2000),
    // Only a web address is kept as the link a note carries.
    link: link !== null && /^https?:\/\//i.test(link) ? link : null,
    tentative: e.tentative === true,
    zoneGuess: e.zoneGuess === true,
  };
}
