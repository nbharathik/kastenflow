// An event's details, over the chip it was opened from: when, where, the
// calendar it is from, its link and description, and "Make meeting note".
// Everything here is read-only; the one thing it can do to the notes is make
// a page, and only when asked.

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";

import { openUrl } from "../../../lib/api";
import { isDay } from "../../../lib/dates";
import { Icon } from "../../../ui/Icon";
import { Popup } from "../../pages/page/Popup";
import { whenText } from "./external";
import { makeEventNote, makeMeetingNote } from "./meeting-note";
import { placePopover, type Box, type Place } from "./place";
import type { CalendarInfo, EventPart } from "./types";

interface PopoverProps {
  part: EventPart;
  calendar: CalendarInfo | undefined;
  /** The chip that opened it. */
  anchor: RefObject<HTMLElement | null>;
  /** Where the chip was, used once it is gone (its list closed). */
  box?: Box;
  tone: CSSProperties | undefined;
  onClose(): void;
}

export function EventPopover({ part, calendar, anchor, box: last, tone, onClose }: PopoverProps) {
  const { event } = part;
  const host = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [day, setDay] = useState(event.start.slice(0, 10));
  const lastBox = useRef(last);

  // Placed before the first paint, and again as the window or a list scrolls.
  useLayoutEffect(() => {
    const put = () => {
      const chip = anchor.current;
      if (chip?.isConnected) lastBox.current = chip.getBoundingClientRect();
      const box = lastBox.current ?? chip?.getBoundingClientRect();
      const own = host.current?.getBoundingClientRect();
      if (!box || !own) return;
      const next = placePopover(box, own, { width: window.innerWidth, height: window.innerHeight });
      setPlace((p) => (p && p.left === next.left && p.top === next.top ? p : next));
    };
    put();
    window.addEventListener("resize", put);
    window.addEventListener("scroll", put, true);
    return () => {
      window.removeEventListener("resize", put);
      window.removeEventListener("scroll", put, true);
    };
  }, [anchor]);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    const note = await makeMeetingNote(event);
    setBusy(false);
    // The page opens (over the calendar, as pages do); the popover has done its work.
    if (note) onClose();
  };

  // The keyboard's way of dropping the event on a day: a note for that day, with Undo.
  const makeForDay = async () => {
    if (busy || !isDay(day)) return;
    setBusy(true);
    const note = await makeEventNote(event, day);
    setBusy(false);
    if (note) onClose();
  };

  return createPortal(
    <div ref={host} className="kasten-ext-pop-host" style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }}>
      <Popup label={`Event: ${event.title}`} anchor={anchor} onClose={onClose} className="kasten-ext-pop">
        <header className="kasten-ext-pop-head" style={tone}>
          <span className="kasten-ext-pop-dot" aria-hidden="true" />
          <h2 className="kasten-ext-pop-title">{event.title}</h2>
          <button type="button" className="kasten-ext-pop-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" className="size-4" />
          </button>
        </header>
        <p className="kasten-ext-pop-when">
          {whenText(event)}
          {event.tentative && <span className="kasten-ext-pop-tag">Tentative</span>}
        </p>
        {event.zoneGuess && <p className="kasten-ext-pop-note">This calendar’s time zone could not be found, so the time may be off.</p>}
        {calendar && (
          <p className="kasten-ext-pop-row">
            <Icon name="calendar" className="size-4 shrink-0" />
            <span>{calendar.name}</span>
          </p>
        )}
        {event.location && (
          <p className="kasten-ext-pop-row">
            <Icon name="pin" className="size-4 shrink-0" />
            <span>{event.location}</span>
          </p>
        )}
        {event.link && (
          <p className="kasten-ext-pop-row">
            <Icon name="link" className="size-4 shrink-0" />
            <button type="button" className="kasten-ext-pop-link" title={event.link} onClick={() => void openUrl(event.link!)}>
              Open the link
            </button>
          </p>
        )}
        {event.description && <div className="kasten-ext-pop-text">{event.description}</div>}
        <footer className="kasten-ext-pop-foot">
          <button type="button" className="ui-btn" disabled={busy} onClick={() => void make()}>
            <Icon name="compose" className="size-4 text-muted" />
            Make meeting note
          </button>
          <button type="button" className="ui-btn" aria-expanded={asking} onClick={() => setAsking((on) => !on)}>
            <Icon name="calendar" className="size-4 text-muted" />
            Note for a day…
          </button>
        </footer>
        {asking && (
          <form
            className="kasten-ext-pop-day"
            aria-label="Make a note for a day"
            onSubmit={(submit) => {
              submit.preventDefault();
              void makeForDay();
            }}
          >
            <input type="date" aria-label="Day for the note" required value={day} onChange={(change) => setDay(change.target.value)} />
            <button type="submit" className="ui-btn is-primary" disabled={busy || !isDay(day)}>
              Make note
            </button>
          </form>
        )}
      </Popup>
    </div>,
    document.body,
  );
}
