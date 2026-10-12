import "../calendar/external/external.css";

import { useMemo, useRef, useState, type ReactNode } from "react";

import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { toneStyle } from "../calendar/actions";
import type { DateItem } from "../calendar/dates";
import { EventPopover } from "../calendar/external/EventPopover";
import { hoursOf } from "../calendar/external/external";
import { useFeeds } from "../calendar/external/store";
import type { EventPart } from "../calendar/external/types";
import { dayOfRange, rangeId, type DateRange } from "../calendar/ranges";
import { swatch } from "../panel/properties/schemas";
import { dragNotes } from "../workspace/drag";
import { iconOf, titleOf } from "../workspace/names";
import { howFromView, useWorkspace } from "../workspace/store";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Icon } from "../../ui/Icon";

interface OnThisDayProps {
  day: string;
  /** Ranges the day falls in, such as a trip. */
  ongoing: readonly DateRange[];
  due: readonly DateItem[];
  tasks: readonly TaskRow[];
  made: readonly NoteMeta[];
  edited: readonly NoteMeta[];
  /** The day's events from subscribed calendars. */
  events?: readonly EventPart[];
}

const SHOWN = 6;
const NO_EVENTS: readonly EventPart[] = [];

/** "day 2 of 5", or nothing for a one-day range. */
function dayOf(range: DateRange, day: string): string | undefined {
  const at = dayOfRange(range, day);
  return at.of > 1 ? `day ${at.day} of ${at.of}` : undefined;
}

/** Below a journal day: what is under way, what is
 * due, and the notes made or edited that day. Nothing to show, no strip. */
export function OnThisDay({ day, ongoing, due, tasks, made, edited, events = NO_EVENTS }: OnThisDayProps) {
  if (!ongoing.length && !due.length && !tasks.length && !made.length && !edited.length && !events.length) return null;
  return (
    <div className="kasten-otd" aria-label="On this day">
      {events.length > 0 && (
        <Group label="Events" tone="events">
          {events.map((part) => (
            <EventChip key={part.key} part={part} />
          ))}
        </Group>
      )}
      {ongoing.length > 0 && (
        <Group label="Ongoing" tone="ongoing">
          {ongoing.map((range) => (
            <Chip key={rangeId(range)} note={range.note} detail={`${range.startKey} → ${range.endKey}`} extra={dayOf(range, day)} />
          ))}
        </Group>
      )}
      {(due.length > 0 || tasks.length > 0) && (
        <Group label="Due" tone="due">
          {due.map((item) => (
            <Chip key={`${item.path}:${item.key}`} note={item.note} detail={item.tag ? `#${item.tag} · ${item.key}` : item.key} />
          ))}
          {tasks.map((task) => (
            <TaskChip key={`${task.path}:${task.line}`} task={task} />
          ))}
        </Group>
      )}
      {made.length > 0 && (
        <Group label="Made" tone="made">
          {made.map((note) => (
            <Chip key={note.path} note={note} />
          ))}
        </Group>
      )}
      {edited.length > 0 && (
        <Group label="Edited" tone="edited">
          {edited.map((note) => (
            <Chip key={note.path} note={note} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ label, tone, children }: { label: string; tone: string; children: ReactNode[] }) {
  const [all, setAll] = useState(false);
  const items = children.flat();
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <div className="kasten-otd-group">
      <span className={`kasten-otd-label is-${tone}`}>{label}</span>
      {shown}
      {items.length > shown.length && (
        <button type="button" className="kasten-otd-more" onClick={() => setAll(true)}>
          +{items.length - shown.length} more
        </button>
      )}
    </div>
  );
}

/** A note; `extra` follows its title, as "· day 2 of 5". */
function Chip({ note, detail, extra }: { note: NoteMeta; detail?: string; extra?: string }) {
  const title = titleOf(note);
  return (
    <button
      type="button"
      className="kasten-otd-chip"
      draggable
      onDragStart={(e) => dragNotes(e, [note.path])}
      aria-label={extra ? `${title} · ${extra}` : undefined}
      title={detail ? `${title} (${detail}${extra ? `, ${extra}` : ""})` : title}
      onClick={(e) => useWorkspace.getState().openPath(note.path, howFromView(e))}
      onAuxClick={(e) => e.button === 1 && useWorkspace.getState().openPath(note.path, "tab")}
    >
      <IconOrEmoji icon={iconOf(note)} />
      <span className="truncate">{title}</span>
      {extra && <span className="kasten-otd-extra"> · {extra}</span>}
    </button>
  );
}

/** An event of a subscribed calendar, with its time: a click shows its
 * details. It is read-only, so it has nothing to drag. */
function EventChip({ part }: { part: EventPart }) {
  const { event } = part;
  const calendar = useFeeds((s) => s.list?.find((c) => c.id === event.calendar));
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const tone = useMemo(() => toneStyle(swatch(calendar?.color)), [calendar?.color]);
  const hours = hoursOf(part);
  return (
    <>
      <button ref={chip} type="button" className="kasten-otd-chip" aria-haspopup="dialog" aria-expanded={open} title={calendar ? `${event.title} (${calendar.name})` : event.title} onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" className="size-3.5 text-muted" />
        <span className="truncate">
          {hours && <span className="kasten-ext-time">{hours}</span>}
          {event.title}
        </span>
      </button>
      {open && <EventPopover part={part} calendar={calendar} anchor={chip} tone={tone} onClose={() => setOpen(false)} />}
    </>
  );
}

function TaskChip({ task }: { task: TaskRow }) {
  return (
    <button
      type="button"
      className="kasten-otd-chip"
      title={`A to-do in ${task.title}`}
      onClick={(e) => useWorkspace.getState().openPath(task.path, howFromView(e))}
    >
      <Icon name={task.done ? "todo" : "stop"} className="size-3.5 text-muted" />
      <span className="truncate">{task.text}</span>
    </button>
  );
}
