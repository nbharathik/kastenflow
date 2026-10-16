import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { dayFrom } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { IconButton } from "../../ui/Button";
import { useEventDrop } from "../calendar/external/use-event-drop";
import { Popup } from "../pages/page/Popup";
import { howFrom, useWorkspace, type OpenHow } from "../workspace/store";
import { daysBack, relativeDay, type DayMark } from "./feed";
import { MiniCalendar } from "./MiniCalendar";

/** Days drawn at first and added as the list scrolls. */
const STEP = 30;

interface DayListProps {
  today: string;
  /** The day open beside the list. */
  current: string;
  /** Journal pages by day. */
  pages: ReadonlyMap<string, NoteMeta>;
  marks: Map<string, DayMark>;
  onPick: (day: string, how?: OpenHow) => void;
}

const date = (day: string, options: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, options);
};

/** Beside the journal's page: every day back from today, newest first, to
 * scroll through and pick. A day with writing shows its first lines; a day
 * without keeps to one short line. Planned days come first. */
export function DayList({ today, current, pages, marks, onPick }: DayListProps) {
  const notes = useWorkspace((s) => s.notes);
  const [limit, setLimit] = useState(STEP);
  const [calendar, setCalendar] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLDivElement>(null);
  const days = useMemo(() => daysBack(notes, today), [notes, today]);
  const upcoming = useMemo(() => [...pages.keys()].filter((d) => d > today).sort(), [pages, today]);
  const shown = days.slice(0, Math.max(limit, days.indexOf(current) + 5));
  const yesterday = dayFrom(-1);
  const tomorrow = dayFrom(1);

  useEffect(() => {
    const sentinel = more.current;
    if (!sentinel || typeof IntersectionObserver === "undefined" || shown.length >= days.length) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((n) => n + STEP), { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shown.length, days.length]);

  // The open day stays in sight when it changes from elsewhere.
  useEffect(() => {
    document.querySelector(`.kasten-journal-days [data-day="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const row = (day: string, index: number, list: readonly string[]) => {
    const month = day.slice(0, 7);
    const newMonth = index > 0 && list[index - 1]!.slice(0, 7) !== month;
    return (
      <div key={day} role="listitem">
        {newMonth && <p className="kasten-journal-month">{date(day, { month: "long", year: "numeric" })}</p>}
        <DayRow day={day} note={pages.get(day)} current={day === current} relative={relativeDay(day, today, yesterday, tomorrow)} onPick={onPick} />
      </div>
    );
  };

  return (
    <aside className="kasten-journal-days" aria-label="Days">
      <header className="kasten-journal-days-head">
        <h2>Days</h2>
        <IconButton ref={button} icon="calendar-days" label="Go to a day" size="sm" active={calendar} onClick={() => setCalendar((open) => !open)} />
        {calendar && (
          <Popup label="Go to a day" anchor={button} onClose={() => setCalendar(false)} className="kasten-journal-cal">
            <MiniCalendar
              today={today}
              current={current}
              marks={marks}
              onPick={(day) => {
                setCalendar(false);
                onPick(day);
              }}
            />
          </Popup>
        )}
      </header>
      <div className="kasten-journal-days-list" role="list">
        {upcoming.length > 0 && <p className="kasten-journal-month">Planned ahead</p>}
        {upcoming.map((day, i, list) => row(day, i, list))}
        {upcoming.length > 0 && <p className="kasten-journal-month">Today and before</p>}
        {shown.map((day, i, list) => row(day, i, list))}
        <div ref={more} className="kasten-journal-end">
          {shown.length < days.length ? null : <span>The first day of this journal</span>}
        </div>
      </div>
    </aside>
  );
}

interface DayRowProps {
  day: string;
  note: NoteMeta | undefined;
  current: boolean;
  relative: string | null;
  onPick: (day: string, how?: OpenHow) => void;
}

function DayRow({ day, note, current, relative, onPick }: DayRowProps) {
  const text = note?.excerpt.trim();
  // An event of a subscribed calendar dropped on the day makes a note for it.
  const drop = useEventDrop(day);
  return (
    <button
      type="button"
      data-day={day}
      aria-current={current ? "date" : undefined}
      className={`kasten-journal-row${text ? "" : " is-empty"}${current ? " is-current" : ""}${drop.over ? " is-event-over" : ""}`}
      onClick={(e: MouseEvent) => onPick(day, howFrom(e))}
      {...drop.props}
    >
      <span className="kasten-journal-row-date">
        <span className="kasten-journal-row-day">{relative ?? date(day, { weekday: "short" })}</span>
        <span>{date(day, { day: "numeric", month: "short" })}</span>
      </span>
      {text ? <span className="kasten-journal-row-text">{text}</span> : <span className="kasten-journal-row-none">No entry</span>}
    </button>
  );
}
