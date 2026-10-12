// Ranges as bars across a week: in each month row under the day
// numbers, and in the week's all-day band. A bar moves its whole range by
// drag or Alt+arrows; the handle on its right edge, where the range ends,
// moves only its last day (or Alt+Shift+← / →).

import { memo, type CSSProperties, type DragEvent } from "react";

import { dayFrom } from "../../lib/dates";
import type { Swatch } from "../panel/properties/schemas";
import { iconOf, titleOf } from "../workspace/names";
import { toneStyle, useCalendarActions } from "./actions";
import { noAutoScroll, onRangeKey, rangeTitle } from "./Chip";
import type { Bar } from "./lanes";
import { briefRange, chipTone, isDone, rangeLabel } from "./layout";
import { rangeId, type DateRange } from "./ranges";
import { IconOrEmoji } from "../../ui/IconOrEmoji";

interface LayerProps {
  /** The bars to draw (those in lanes that fit). */
  bars: readonly Bar[];
  week: readonly string[];
  colors: ReadonlyMap<string, string>;
  /** What is being dragged, by id (`#end` while a range's end is). */
  dragging: string | null;
}

/** A week's bars, laid over its cells (month) or columns (week). */
export function BarLayer({ bars, week, colors, dragging }: LayerProps) {
  if (!bars.length) return null;
  return (
    <div className="kasten-cal-bars">
      {bars.map((bar) => {
        const id = rangeId(bar.range);
        return (
          <RangeBar
            key={id}
            range={bar.range}
            lane={bar.lane}
            from={bar.from}
            to={bar.to}
            starts={bar.starts}
            ends={bar.ends}
            week={week}
            tone={chipTone(bar.range, colors)}
            dragging={dragging === id}
            resizing={dragging === `${id}#end`}
          />
        );
      })}
    </div>
  );
}

interface BarProps {
  range: DateRange;
  lane: number;
  from: number;
  to: number;
  starts: boolean;
  ends: boolean;
  week: readonly string[];
  tone: Swatch | null;
  dragging: boolean;
  resizing: boolean;
}

const RangeBar = memo(function RangeBar({ range, lane, from, to, starts, ends, week, tone, dragging, resizing }: BarProps) {
  const actions = useCalendarActions();
  const title = titleOf(range.note);
  const today = dayFrom(0);
  /** The day under the pointer as the drag starts: where the bar is held. */
  const held = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const cols = to - from + 1;
    const at = box.width > 0 ? Math.floor(((event.clientX - box.left) / box.width) * cols) : 0;
    return week[from + Math.min(cols - 1, Math.max(0, at))]!;
  };
  const style = { ...toneStyle(tone), "--lane": lane, "--from": from, "--span": to - from + 1 } as CSSProperties;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-chip={rangeId(range)}
      aria-label={`${title}, ${rangeLabel(range.start, range.end, today)}`}
      title={rangeTitle(range)}
      className={`kasten-cal-bar${starts ? " is-start" : ""}${ends ? " is-end" : ""}${isDone(range.note) ? " is-done" : ""}${dragging ? " is-dragging" : ""}${resizing ? " is-resizing" : ""}`}
      style={style}
      onClick={(event) => actions.open(range.path, event)}
      onMouseDown={noAutoScroll}
      onAuxClick={(event) => event.button === 1 && actions.open(range.path, "tab")}
      onKeyDown={(event) => onRangeKey(event, range, actions)}
      onDragStart={(event) => actions.dragStart({ kind: "range", range, from: held(event) }, event)}
      onDragEnd={actions.dragEnd}
    >
      <span className="kasten-cal-bar-icon" aria-hidden="true">
        <IconOrEmoji icon={iconOf(range.note)} />
      </span>
      <span className="kasten-cal-bar-title">{title}</span>
      <span className="kasten-cal-bar-span" aria-hidden="true">
        {briefRange(range.start, range.end, today)}
      </span>
      {ends && (
        <span
          className="kasten-cal-bar-end"
          draggable
          aria-hidden="true"
          title="Drag to change the last day"
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            // The handle's drag is its own, and shows the whole bar.
            event.stopPropagation();
            const bar = event.currentTarget.parentElement;
            if (bar) {
              const box = bar.getBoundingClientRect();
              event.dataTransfer.setDragImage?.(bar, event.clientX - box.left, event.clientY - box.top);
            }
            actions.dragStart({ kind: "end", range }, event);
          }}
          onDragEnd={actions.dragEnd}
        />
      )}
    </div>
  );
});
