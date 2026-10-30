// One note on the timeline: a bar from its start through its end day, or a
// marker (data-kind="point") when it has a start only. Press the body to
// carry it, an edge to resize it; click or Enter opens the note beside the
// page; the keys are in keys.ts. A bar of calculated dates cannot be moved.
// Memoised: it redraws only when its note, its place or its drag changes.

import { memo, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

import { briefRange, dayLabel } from "../../../calendar/layout";
import { useParentTitle } from "../../sub-items";
import type { Item } from "./items";
import { boxOf, carry, type Grip, type Scale } from "./layout";
import type { Preview } from "./use-bar-drag";

export interface BarProps {
  item: Item;
  /** The first day of the grid, and the scale: they place the bar. */
  from: string;
  scale: Scale;
  /** Its row in the lane, and the row height. */
  top: number;
  /** Today, for dates in words. */
  today: string;
  /** The one bar a Tab reaches. */
  active: boolean;
  /** Set while this bar is being carried. */
  preview: Preview | null;
  hint: string;
  onPress(event: PointerEvent<HTMLElement>, id: string, grip: Grip): void;
  onOpen(event: MouseEvent<HTMLElement>, id: string): void;
  onKey(event: KeyboardEvent<HTMLElement>, id: string): void;
  onFocusBar(id: string): void;
}

/** What a screen reader says: the title, the days, and anything odd about them. */
export function describe(item: Item, today: string): string {
  const dates = item.dates;
  if (!dates) return `${item.title}, no dates`;
  const end = dates.end;
  const when = end !== null && end >= dates.start && end !== dates.start ? briefRange(dates.start, end, today) : dayLabel(dates.start, today);
  return [item.title, when, item.reversed ? "its end is before its start" : "", item.locked ? "dates are calculated" : ""].filter(Boolean).join(", ");
}

export const Bar = memo(
  function Bar({ item, from, scale, top, today, active, preview, hint, onPress, onOpen, onKey, onFocusBar }: BarProps) {
    const dates = item.dates!;
    const shown = preview ? carry(dates, preview.grip, preview.delta) : dates;
    const box = boxOf(shown.start, shown.end, from, scale);
    const point = shown.end === null || shown.end < shown.start;
    const edges = !point && !item.locked;
    const parent = useParentTitle(item.note);
    const text = describe({ ...item, dates: shown }, today) + (parent ? `, sub-item of ${parent}` : "");
    return (
      <div
        role="button"
        tabIndex={active ? 0 : -1}
        data-bar={item.id}
        data-kind={point ? "point" : "bar"}
        data-start={shown.start}
        data-end={shown.end ?? undefined}
        data-locked={item.locked ? "" : undefined}
        data-reversed={item.reversed ? "" : undefined}
        data-carried={preview ? "" : undefined}
        aria-label={text}
        aria-describedby={hint}
        title={text}
        className="kasten-tl-bar"
        style={{ left: box.left, width: box.width, top }}
        onPointerDown={(event) => {
          if (item.locked) return;
          const grip = (event.target as HTMLElement).closest<HTMLElement>("[data-grip]")?.dataset.grip;
          onPress(event, item.id, grip === "start" || grip === "end" ? grip : "move");
        }}
        onClick={(event) => onOpen(event, item.id)}
        onKeyDown={(event) => onKey(event, item.id)}
        onFocus={() => onFocusBar(item.id)}
      >
        {edges && <span data-grip="start" className="kasten-tl-grip is-start" aria-hidden="true" />}
        {point && <span className="kasten-tl-dot" aria-hidden="true" />}
        <span className="kasten-tl-name">{item.title}</span>
        {edges && <span data-grip="end" className="kasten-tl-grip is-end" aria-hidden="true" />}
      </div>
    );
  },
  (a, b) =>
    a.item.note === b.item.note &&
    a.item.dates?.start === b.item.dates?.start &&
    a.item.dates?.end === b.item.dates?.end &&
    a.item.locked === b.item.locked &&
    a.from === b.from &&
    a.scale === b.scale &&
    a.top === b.top &&
    a.today === b.today &&
    a.active === b.active &&
    a.preview?.delta === b.preview?.delta &&
    a.preview?.grip === b.preview?.grip &&
    a.hint === b.hint &&
    a.onPress === b.onPress &&
    a.onOpen === b.onOpen &&
    a.onKey === b.onKey &&
    a.onFocusBar === b.onFocusBar,
);
