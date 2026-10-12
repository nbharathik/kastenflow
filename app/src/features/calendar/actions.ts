// What a day cell and a chip can ask of the Calendar view. One stable object
// through context, so memoised cells redraw only when their own day does.

import { createContext, useContext, type CSSProperties, type DragEvent } from "react";

import { chipStyle, type Swatch } from "../panel/properties/schemas";
import type { OpenHow } from "../workspace/store";
import type { DateItem } from "./dates";
import type { DateRange } from "./ranges";

/** Where a click or key asks to open something: its modifier keys and button. */
export type OpenEvent = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number };

/** What a day's "+" adds: a to-do in the day's journal, a task
 * page due that day, or a card or page dated that day. */
export type AddKind = "todo" | "task" | "note" | "page";

/** The day a quick-add field is open on, and what it adds. */
export interface Adding {
  day: string;
  kind: AddKind;
}

/** What is being dragged: a chip; a range, held by one of its days (`from`);
 * or a range's end, by the handle on its right edge. */
export type Dragged = { kind: "item"; item: DateItem } | { kind: "range"; range: DateRange; from: string } | { kind: "end"; range: DateRange };

export interface CalendarActions {
  /** Opens a note: in place, or as the event's modifiers ask. */
  open(path: string, how: OpenEvent | OpenHow): void;
  /** Shows the day's journal page, over the calendar as Settings says
   * pages open; a day nobody wrote in offers to start it. */
  openDay(day: string, event: OpenEvent): void;
  /** Makes the day's journal page if need be, and opens it to write in. */
  writeDay(day: string): void;
  /** Opens a quick-add field on a day for `kind` (a task by default), or
   * with null closes it. */
  addOn(day: string | null, kind?: AddKind): void;
  /** Adds a `kind` titled `title` on `day`; resolves once it is in the vault. */
  add(day: string, kind: AddKind, title: string): Promise<boolean>;
  /** Shows every entry of a day ("+N more"), or with null closes it. */
  expand(day: string | null): void;
  dragStart(dragged: Dragged, event: DragEvent<HTMLElement>): void;
  dragEnd(): void;
  dragOver(day: string, event: DragEvent<HTMLElement>): void;
  dragLeave(day: string, event: DragEvent<HTMLElement>): void;
  drop(day: string, event: DragEvent<HTMLElement>): void;
  /** A chip held over ‹ or › turns to the period before or after. */
  dragStep(step: 1 | -1, event: DragEvent<HTMLElement>): void;
  dragStepEnd(): void;
  /** Moves an item by `days` from the keyboard, keeping focus on it. */
  nudge(item: DateItem, days: number): void;
  /** Moves a range by `days` from the keyboard, or with `end` only its
   * last day, keeping focus on it. */
  nudgeRange(range: DateRange, days: number, end: boolean): void;
}

export const ActionsContext = createContext<CalendarActions | null>(null);

export function useCalendarActions(): CalendarActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Calendar parts need the Calendar view around them");
  return actions;
}

/** The data type chips carry while dragged. */
export const DATE_DRAG = "application/x-kasten-date";

/** A chip's colours, the ones the Tag Database draws its tags in; the accent without a tone. */
export const toneStyle = (tone: Swatch | null): CSSProperties | undefined => chipStyle(tone);
