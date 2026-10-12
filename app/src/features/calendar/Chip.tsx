// A note, a range or a to-do on a day. Note chips open on click and move by
// drag or Alt+arrows; range chips (in a day's "+N more") move their whole
// range; to-do chips only open their page (no op edits a to-do's day).

import { memo, type KeyboardEvent, type MouseEvent } from "react";

import { dayFrom, isDay } from "../../lib/dates";
import type { TaskRow } from "../../lib/vault/types";
import type { Swatch } from "../panel/properties/schemas";
import { iconOf, titleOf } from "../workspace/names";
import { toneStyle, useCalendarActions, type CalendarActions } from "./actions";
import type { DateItem } from "./dates";
import { ExternalChip } from "./external/ExternalChip";
import { briefRange, chipTone, dayLabel, fullDay, isDone, itemId, nudgeDays, rangeLabel, stretchDays, taskText, type Entry } from "./layout";
import { rangeDays, rangeId, type DateRange } from "./ranges";
import { IconOrEmoji } from "../../ui/IconOrEmoji";

interface ChipProps {
  /** Two lines with the property and tag, for the week's taller cells. */
  large?: boolean;
}

/** Keeps the middle button from starting to scroll, so it can open a tab. */
export const noAutoScroll = (event: MouseEvent) => event.button === 1 && event.preventDefault();

const MOVE_HINT = "Drag to another day (rest it on ‹ or › to turn the page), or Alt+← / Alt+→ a day and Alt+↑ / Alt+↓ a week";

export const RANGE_HINT = "Drag to move it, drag its right edge to change the last day; Alt+← / Alt+→ a day, Alt+↑ / Alt+↓ a week, Alt+Shift+← / → the last day";

/** A range's tooltip: title, keys and days, and what moves it. */
export function rangeTitle(range: DateRange): string {
  const days = rangeDays(range);
  const done = isDone(range.note) ? " (done)" : "";
  return `${titleOf(range.note)}\n${range.startKey} → ${range.endKey}: ${rangeLabel(range.start, range.end, dayFrom(0))}, ${days} ${days === 1 ? "day" : "days"}${done}\n${RANGE_HINT}`;
}

/** Keys on a focused range, bar or chip: Alt+arrows move it, Alt+Shift+←/→ its end, Enter opens it. */
export function onRangeKey(event: KeyboardEvent<HTMLElement>, range: DateRange, actions: CalendarActions): void {
  const stretch = stretchDays(event);
  const days = stretch ?? nudgeDays(event);
  if (days !== null) {
    // Before the window's Alt+← (Back) sees it.
    event.preventDefault();
    event.stopPropagation();
    actions.nudgeRange(range, days, stretch !== null);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    actions.open(range.path, event);
  }
}

export const NoteChip = memo(function NoteChip({ item, tone, dragging, large }: ChipProps & { item: DateItem; tone: Swatch | null; dragging: boolean }) {
  const actions = useCalendarActions();
  const title = titleOf(item.note);
  const done = isDone(item.note);
  const meta = item.tag ? `${item.key} · #${item.tag}` : item.key;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const days = nudgeDays(event);
    if (days !== null) {
      // Before the window's Alt+← (Back) sees it.
      event.preventDefault();
      event.stopPropagation();
      actions.nudge(item, days);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions.open(item.path, event);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-chip={itemId(item)}
      aria-label={title}
      title={`${title}\n${meta}: ${fullDay(item.day)}${done ? " (done)" : ""}\n${MOVE_HINT}`}
      className={`kasten-cal-chip${large ? " is-large" : ""}${done ? " is-done" : ""}${dragging ? " is-dragging" : ""}`}
      style={toneStyle(tone)}
      onClick={(event) => actions.open(item.path, event)}
      onMouseDown={noAutoScroll}
      onAuxClick={(event) => event.button === 1 && actions.open(item.path, "tab")}
      onKeyDown={onKeyDown}
      onDragStart={(event) => actions.dragStart({ kind: "item", item }, event)}
      onDragEnd={actions.dragEnd}
    >
      <span className="kasten-cal-chip-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(item.note)} />
      </span>
      <span className="kasten-cal-chip-title">{title}</span>
      {large && <span className="kasten-cal-chip-meta">{meta}</span>}
    </div>
  );
});

/** A range in a day's list ("+N more"): dragged from here, it moves as if
 * held by that day. */
export const RangeChip = memo(function RangeChip({ range, day, tone, dragging }: { range: DateRange; day: string; tone: Swatch | null; dragging: boolean }) {
  const actions = useCalendarActions();
  const title = titleOf(range.note);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-chip={rangeId(range)}
      aria-label={`${title}, ${rangeLabel(range.start, range.end, dayFrom(0))}`}
      title={rangeTitle(range)}
      className={`kasten-cal-chip is-range${isDone(range.note) ? " is-done" : ""}${dragging ? " is-dragging" : ""}`}
      style={toneStyle(tone)}
      onClick={(event) => actions.open(range.path, event)}
      onMouseDown={noAutoScroll}
      onAuxClick={(event) => event.button === 1 && actions.open(range.path, "tab")}
      onKeyDown={(event) => onRangeKey(event, range, actions)}
      onDragStart={(event) => actions.dragStart({ kind: "range", range, from: day }, event)}
      onDragEnd={actions.dragEnd}
    >
      <span className="kasten-cal-chip-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(range.note)} />
      </span>
      <span className="kasten-cal-chip-title">{title}</span>
      <span className="kasten-cal-chip-span">{briefRange(range.start, range.end, dayFrom(0))}</span>
    </div>
  );
});

/** The time a to-do or mention carries (`[[2026-10-07]] 09:00`), small before its title. */
function Time({ at }: { at: string | null | undefined }) {
  return at ? (
    <time className="kasten-cal-chip-time" dateTime={at}>
      {at}
    </time>
  ) : null;
}

/** "09:00 " before a label, or nothing. */
const atLabel = (at: string | null | undefined) => (at ? `${at} ` : "");

export const TaskChip = memo(function TaskChip({ task, large }: ChipProps & { task: TaskRow }) {
  const actions = useCalendarActions();
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      aria-label={`${atLabel(task.at)}${taskText(task)}`}
      title={`${atLabel(task.at)}To-do in “${task.title}”: ${task.text}\nOpen the page to change its day; to-dos can’t be dragged.`}
      className={`kasten-cal-chip is-task${large ? " is-large" : ""}`}
      onClick={(event) => actions.open(task.path, event)}
      onMouseDown={noAutoScroll}
      onAuxClick={(event) => event.button === 1 && actions.open(task.path, "tab")}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        actions.open(task.path, event);
      }}
    >
      <svg className="kasten-cal-chip-box" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="2.5" width="11" height="11" rx="3" />
      </svg>
      <span className="kasten-cal-chip-title">
        <Time at={task.at} />
        {taskText(task)}
      </span>
      {large && (
        <span className="kasten-cal-chip-meta">
          <IconOrEmoji icon={iconOf({ icon: task.icon, kind: "page" })} /> {task.title}
        </span>
      )}
    </div>
  );
});

/** A note that names the day in its text (`[[2026-10-01]]`), or was made
 * on it: it opens, and it does not move (its day is not a property). */
const LinkChip = memo(function LinkChip({ path, icon, title, why, kind, large, at }: ChipProps & { path: string; icon: string; title: string; why: string; kind: "mention" | "made"; at?: string | null }) {
  const actions = useCalendarActions();
  const meta = kind === "mention" ? "Mentions this day" : "Made this day";
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      aria-label={`${atLabel(at)}${title}, ${meta.toLowerCase()}`}
      title={`${atLabel(at)}${title}\n${why}`}
      className={`kasten-cal-chip is-${kind}${large ? " is-large" : ""}`}
      onClick={(event) => actions.open(path, event)}
      onMouseDown={noAutoScroll}
      onAuxClick={(event) => event.button === 1 && actions.open(path, "tab")}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        actions.open(path, event);
      }}
    >
      <span className="kasten-cal-chip-icon" aria-hidden="true">
        <IconOrEmoji icon={icon} />
      </span>
      <span className="kasten-cal-chip-title">
        <Time at={at} />
        {title}
      </span>
      {large && <span className="kasten-cal-chip-meta">{meta}</span>}
    </div>
  );
});

/** Any kind of entry, with its tone and drag state; `day` is the day it is
 * listed on (where a range is held when dragged from the list). */
export function EntryChip({ entry, colors, dragging, large, day }: ChipProps & { entry: Entry; colors: ReadonlyMap<string, string>; dragging: string | null; day: string }) {
  if (entry.kind === "task") return <TaskChip task={entry.task} large={large} />;
  if (entry.kind === "event") return <ExternalChip part={entry.part} large={large} />;
  if (entry.kind === "mention") {
    const { mention } = entry;
    // A journal page is called by its day: "Journal, October 2".
    const title = mention.kind === "journal" && isDay(mention.title) ? `Journal, ${dayLabel(mention.title, dayFrom(0))}` : mention.title;
    return <LinkChip kind="mention" path={mention.path} icon={iconOf(mention)} title={title} why={`Mentions this day: “${mention.snippet}”`} large={large} at={mention.at} />;
  }
  if (entry.kind === "made") return <LinkChip kind="made" path={entry.note.path} icon={iconOf(entry.note)} title={titleOf(entry.note)} why={`Made this day${entry.note.excerpt ? `: “${entry.note.excerpt.slice(0, 120)}”` : ""}`} large={large} />;
  if (entry.kind === "range") return <RangeChip range={entry.range} day={day} tone={chipTone(entry.range, colors)} dragging={dragging === rangeId(entry.range)} />;
  return <NoteChip item={entry.item} tone={chipTone(entry.item, colors)} dragging={dragging === itemId(entry.item)} large={large} />;
}

/** A stable React key for an entry. */
export function entryKey(entry: Entry): string {
  if (entry.kind === "note") return itemId(entry.item);
  if (entry.kind === "range") return rangeId(entry.range);
  if (entry.kind === "task") return `${entry.task.path}:${entry.task.line}`;
  if (entry.kind === "event") return entry.part.key;
  return `${entry.kind}:${entry.kind === "mention" ? entry.mention.path : entry.note.path}`;
}
