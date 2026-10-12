// The groups of the toolbar for what is selected, in the order of the row, and how soon each goes into the more menu when the row is
// too narrow (see chrome/overflow.ts: 0 never goes; the larger the number, the sooner).

import type { Slot } from "../chrome/overflow.ts";
import type { BarMode } from "./useBarMode.ts";

export type GroupId = "history" | "zoom" | "insert" | "slide" | "font" | "marks" | "paragraph" | "shape" | "diagram" | "arrange";

export interface BarSlot extends Pick<Slot, "drop"> {
  id: GroupId;
}

/** The groups to show, left to right. */
export function slotsFor(mode: BarMode): BarSlot[] {
  const slots: BarSlot[] = [
    { id: "history", drop: 0 },
    { id: "zoom", drop: 0 },
  ];
  if (!mode.selected) {
    // Nothing selected: what can be put on the slide, and the slide's own settings.
    slots.push({ id: "insert", drop: 0 }, { id: "slide", drop: 1 });
    return slots;
  }
  if (mode.text) slots.push({ id: "font", drop: 0 }, { id: "marks", drop: 2 }, { id: "paragraph", drop: 3 });
  if (mode.shape) slots.push({ id: "shape", drop: 4 });
  if (mode.diagram) slots.push({ id: "diagram", drop: 5 });
  slots.push({ id: "arrange", drop: 6 });
  return slots;
}
