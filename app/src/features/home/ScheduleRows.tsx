// The rows of Home's "Today": a timed event, and an all-day event as a chip.
// A click shows the event's details, as in the Calendar; events are read-only.

import { useMemo, useRef, useState } from "react";

import { EventPopover } from "../calendar/external/EventPopover";
import { hoursOf } from "../calendar/external/external";
import { useFeeds } from "../calendar/external/store";
import type { EventPart } from "../calendar/external/types";
import { toneStyle } from "../calendar/actions";
import { swatch } from "../panel/properties/schemas";
import { spanWords, type Meeting } from "./today-model";

/** The calendar an event is in, its colour, and the popover state shared by both rows. */
function useEvent(part: EventPart) {
  const calendar = useFeeds((s) => s.list?.find((c) => c.id === part.event.calendar));
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const tone = useMemo(() => toneStyle(swatch(calendar?.color)), [calendar?.color]);
  return { calendar, open, setOpen, anchor, tone };
}

/** `caption` marks the meeting on now or the next one ("Next up · in 12 min"). */
export function EventRow({ meeting, past = false, caption = null }: { meeting: Meeting; past?: boolean; caption?: string | null }) {
  const { part } = meeting;
  const { event } = part;
  const { calendar, open, setOpen, anchor, tone } = useEvent(part);
  const hours = hoursOf(part);
  const span = spanWords(part);
  const overlaps = meeting.overlaps.length > 0;
  const full = [hours ?? "All day", event.title, calendar?.name, event.location, span, overlaps ? `Overlaps with ${meeting.overlaps.join(", ")}` : ""].filter(Boolean).join(" · ");
  return (
    <li className={`kasten-today-event${caption ? " is-next" : ""}${past ? " is-past" : ""}`}>
      {caption && <span className="kasten-next-cap">{caption}</span>}
      <button ref={anchor} type="button" data-rove="" className="kasten-dash-row" aria-haspopup="dialog" aria-expanded={open} title={full} onClick={() => setOpen((o) => !o)}>
        <span className="kasten-dash-row-icon" aria-hidden="true">
          <span className="kasten-feed-dot kasten-ext-dot" style={{ background: swatch(calendar?.color)?.fg ?? "var(--color-accent)" }} />
        </span>
        <span className="kasten-dash-row-title">
          <span className="kasten-ext-time">{hours ?? "All day"}</span>
          {event.title}
        </span>
        {span && <span className="kasten-today-note">{span}</span>}
        {overlaps && <span className="kasten-today-note is-overlap">overlaps</span>}
      </button>
      {open && <EventPopover part={part} calendar={calendar} anchor={anchor} tone={tone} onClose={() => setOpen(false)} />}
    </li>
  );
}

/** An all-day event: a chip in the row above the day. */
export function AllDayChip({ part }: { part: EventPart }) {
  const { event } = part;
  const { calendar, open, setOpen, anchor, tone } = useEvent(part);
  const span = spanWords(part);
  return (
    <li>
      <button ref={anchor} type="button" data-rove="" className="kasten-today-chip" aria-haspopup="dialog" aria-expanded={open} title={[event.title, "All day", span, calendar?.name].filter(Boolean).join(" · ")} onClick={() => setOpen((o) => !o)}>
        <span className="kasten-feed-dot kasten-ext-dot" aria-hidden="true" style={{ background: swatch(calendar?.color)?.fg ?? "var(--color-accent)" }} />
        <span className="kasten-today-chip-title">{event.title}</span>
        {span && <span className="kasten-today-chip-note">{span}</span>}
      </button>
      {open && <EventPopover part={part} calendar={calendar} anchor={anchor} tone={tone} onClose={() => setOpen(false)} />}
    </li>
  );
}
