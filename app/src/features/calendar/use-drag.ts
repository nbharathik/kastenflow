// Dragging chips and range bars between days with the browser's own drag and
// drop (no library): the days a drop would cover light up, a drop moves the
// note, and holding it over ‹ or › turns the page so it can go to another
// month. A bar moves as a whole, by as many days as it is carried; its right
// edge moves only its end.

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { DATE_DRAG, type CalendarActions, type Dragged } from "./actions";
import { carriesEvent, droppedEvent } from "./external/event-drag";
import type { ExternalEvent } from "./external/types";
import { itemId, landing } from "./layout";
import { rangeId } from "./ranges";

/** How long a chip rests on ‹ or › before the page turns. */
export const TURN_DELAY = 650;

type DragActions = Pick<CalendarActions, "dragStart" | "dragEnd" | "dragOver" | "dragLeave" | "drop" | "dragStep" | "dragStepEnd">;

export interface DragCallbacks {
  /** What a drag from another calendar carries, by its id and kind. */
  find(carried: Carried): Dragged | undefined;
  drop(dragged: Dragged, day: string): void;
  /** An event of a subscribed calendar dropped on a day: a note is made for that day; the event stays as it is. */
  event(dropped: ExternalEvent, day: string): void;
  turn(step: 1 | -1): void;
}

/** What the drag data says, so another calendar can take the drop. */
export interface Carried {
  kind: Dragged["kind"];
  id: string;
  from?: string;
}

export interface Drag {
  /** What is being dragged, by id: an item's or a range's, and a range's with
   * `#end` while its end is. */
  dragging: string | null;
  /** The days a drop where the pointer is would cover: the day under it for
   * a chip (or a drag from another calendar), all a range's days for a range. */
  lit: { start: string; end: string } | null;
  actions: DragActions;
}

/** A dragged thing's id, as chips and bars know it. */
export const draggedId = (dragged: Dragged) => (dragged.kind === "item" ? itemId(dragged.item) : dragged.kind === "range" ? rangeId(dragged.range) : `${rangeId(dragged.range)}#end`);

/** The day a drop there changes nothing. */
const homeDay = (dragged: Dragged) => (dragged.kind === "item" ? dragged.item.day : dragged.kind === "range" ? dragged.from : dragged.range.end);

const ours = (event: { dataTransfer: DataTransfer }) => Array.from(event.dataTransfer.types).includes(DATE_DRAG) || carriesEvent(event);

/** What a drop here does to what is carried: an event is copied to the day, a note or range moved. */
const effectOf = (event: { dataTransfer: DataTransfer }) => (carriesEvent(event) ? "copy" : "move");

function carried(event: { dataTransfer: DataTransfer }): Carried | null {
  try {
    const data = JSON.parse(event.dataTransfer.getData(DATE_DRAG)) as Carried;
    return typeof data?.id === "string" ? data : null;
  } catch {
    return null;
  }
}

export function useDrag(callbacks: DragCallbacks): Drag {
  // Set once the browser has its picture of the chip, which it fades.
  const [dragged, setDragged] = useState<Dragged | null>(null);
  // The day under the pointer, and what is over it (null from another calendar).
  const [over, setOver] = useState<{ day: string; what: Dragged | null } | null>(null);
  const latest = useRef(callbacks);
  useLayoutEffect(() => {
    latest.current = callbacks;
  });
  const current = useRef<Dragged | null>(null);
  const turning = useRef<{ step: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  const actions = useMemo<DragActions>(() => {
    const stopTurning = () => {
      clearTimeout(turning.current?.timer);
      turning.current = null;
    };
    const end = () => {
      current.current = null;
      window.removeEventListener("mousemove", end);
      stopTurning();
      setDragged(null);
      setOver(null);
    };
    return {
      dragStart: (what, event) => {
        current.current = what;
        event.dataTransfer.effectAllowed = "move";
        const id = what.kind === "item" ? itemId(what.item) : rangeId(what.range);
        event.dataTransfer.setData(DATE_DRAG, JSON.stringify({ kind: what.kind, id, from: what.kind === "range" ? what.from : undefined } satisfies Carried));
        // After the browser has taken its picture of the chip.
        setTimeout(() => {
          if (current.current !== what) return;
          setDragged(what);
          // No mouse moves reach the page during a drag: the first one means
          // it ended, even when the chip it began on left with a turned page.
          window.addEventListener("mousemove", end);
        }, 0);
      },
      dragEnd: end,
      dragOver: (day, event) => {
        if (!current.current && !ours(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = effectOf(event);
        const what = current.current;
        setOver((now) => (now?.day === day && now.what === what ? now : { day, what }));
      },
      dragLeave: (day, event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        setOver((now) => (now?.day === day ? null : now));
      },
      drop: (day, event) => {
        const dropped = carriesEvent(event) ? droppedEvent(event) : null;
        if (dropped) {
          event.preventDefault();
          end();
          latest.current.event(dropped, day);
          return;
        }
        const found = carried(event);
        const what = current.current ?? (found ? latest.current.find(found) : undefined);
        if (!what) return end();
        event.preventDefault();
        end();
        if (homeDay(what) !== day) latest.current.drop(what, day);
      },
      dragStep: (step, event) => {
        if (!current.current && !ours(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = effectOf(event);
        setOver(null);
        if (turning.current?.step === step) return;
        stopTurning();
        // Resting there keeps turning, a page each time.
        turning.current = {
          step,
          timer: setTimeout(() => {
            turning.current = null;
            latest.current.turn(step);
          }, TURN_DELAY),
        };
      },
      dragStepEnd: stopTurning,
    };
  }, []);

  const lit = useMemo(() => (over ? (over.what ? landing(over.what, over.day) : { start: over.day, end: over.day }) : null), [over]);
  return { dragging: dragged ? draggedId(dragged) : null, lit, actions };
}
