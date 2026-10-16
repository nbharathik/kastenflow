// A day anywhere in the window (the journal's list, its month, its page) that
// takes an event of a subscribed calendar dropped on it: a note is made for
// that day, with Undo. The Calendar's own days do the same through its drag
// code (use-drag.ts).

import { useState, type DragEvent } from "react";

import { carriesEvent, droppedEvent } from "./event-drag";
import { makeEventNote } from "./meeting-note";

export interface EventDrop {
  /** An event is being carried over the day. */
  over: boolean;
  /** Spread on the element that is the day. */
  props: {
    onDragEnter(event: DragEvent<HTMLElement>): void;
    onDragOver(event: DragEvent<HTMLElement>): void;
    onDragLeave(event: DragEvent<HTMLElement>): void;
    onDrop(event: DragEvent<HTMLElement>): void;
  };
}

export function useEventDrop(day: string): EventDrop {
  const [over, setOver] = useState(false);
  const hold = (event: DragEvent<HTMLElement>) => {
    if (!carriesEvent(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  return {
    over,
    props: {
      onDragEnter: hold,
      onDragOver: hold,
      onDragLeave: (event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setOver(false);
      },
      onDrop: (event) => {
        setOver(false);
        const dropped = carriesEvent(event) ? droppedEvent(event) : null;
        if (!dropped) return;
        event.preventDefault();
        void makeEventNote(dropped, day);
      },
    },
  };
}
