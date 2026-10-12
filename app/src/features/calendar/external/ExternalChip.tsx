// An event from a subscribed calendar, on a day: in the calendar's colour,
// with its time before its title. It is not draggable and has no page to
// open; a click shows its details (EventPopover), in the Calendar's one
// popover when there is one, else in a popover of its own.

import { memo, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { swatch } from "../../panel/properties/schemas";
import { toneStyle } from "../actions";
import { EventPopover } from "./EventPopover";
import { useShowEvent } from "./EventPopoverProvider";
import { hoursOf } from "./external";
import { useFeeds } from "./store";
import type { EventPart } from "./types";

interface ChipProps {
  part: EventPart;
  /** Two lines, with where it is or which calendar, for the week's columns. */
  large?: boolean;
}

export const ExternalChip = memo(function ExternalChip({ part, large }: ChipProps) {
  const { event } = part;
  const calendar = useFeeds((s) => s.list?.find((c) => c.id === event.calendar));
  const tone = useMemo(() => toneStyle(swatch(calendar?.color)), [calendar?.color]);
  const show = useShowEvent();
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLDivElement>(null);
  const hours = hoursOf(part);
  const days = part.span ? ` (day ${part.span[0]} of ${part.span[1]})` : "";
  const where = event.location ?? calendar?.name ?? "";
  const label = `${hours ? `${hours} ` : ""}${event.title}${days}${calendar ? `, ${calendar.name}` : ""}`;
  const toggle = () => {
    if (show && chip.current) show(part, chip.current);
    else setOpen((o) => !o);
  };
  const onKeyDown = (key: KeyboardEvent<HTMLElement>) => {
    if (key.key !== "Enter" && key.key !== " ") return;
    key.preventDefault();
    toggle();
  };
  return (
    <>
      <div
        ref={chip}
        role="button"
        tabIndex={0}
        draggable={false}
        data-chip={`event:${part.key}`}
        aria-haspopup="dialog"
        aria-expanded={show ? undefined : open}
        aria-label={label}
        title={`${label}\nFrom a subscribed calendar: it only shows here.`}
        className={`kasten-cal-chip is-event${large ? " is-large" : ""}${event.tentative ? " is-tentative" : ""}`}
        style={tone}
        onClick={(click) => {
          click.stopPropagation();
          toggle();
        }}
        onKeyDown={onKeyDown}
      >
        <span className="kasten-cal-chip-title">
          {hours && (
            <time className="kasten-cal-chip-time" dateTime={part.at ?? undefined}>
              {hours}
            </time>
          )}
          {event.title}
          {days && <span className="kasten-cal-chip-days">{days}</span>}
        </span>
        {large && where && <span className="kasten-cal-chip-meta">{where}</span>}
      </div>
      {open && !show && <EventPopover part={part} calendar={calendar} anchor={chip} tone={tone} onClose={() => setOpen(false)} />}
    </>
  );
});
