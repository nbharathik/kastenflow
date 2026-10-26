// A table row as a place to drop another row, when the table shows
// sub-items: the middle puts the dragged row inside it, an edge (the gap
// between rows) puts it at this row's own level. Only the row passed over
// redraws; what a drop does is the table's (ctx.sub).

import { useState, type DragEvent } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import { carriesNotes, draggedNotes, droppedNotes } from "../../../workspace/drag";
import type { TableCtx } from "./context";

/** Where on the row the dragged one would land: inside it, or above or below it. */
export type DropMark = "into" | "before" | "after";

export function useRowDrop(note: NoteMeta, ctx: TableCtx, enabled: boolean) {
  const [mark, setMark] = useState<DropMark | null>(null);
  if (!enabled) return { mark: null, handlers: {} };
  const fraction = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.height > 0 ? (event.clientY - box.top) / box.height : 0.5;
  };
  const handlers = {
    onDragOver(event: DragEvent<HTMLElement>) {
      const sub = ctx.sub.current;
      if (!sub || !carriesNotes(event)) return setMark(null);
      const f = fraction(event);
      const plan = sub.plan(draggedNotes(), note, f);
      if (!plan) return setMark(null);
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setMark(plan.kind === "into" || plan.kind === "refuse" ? "into" : f < 0.5 ? "before" : "after");
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setMark(null);
    },
    onDrop(event: DragEvent<HTMLElement>) {
      setMark(null);
      const sub = ctx.sub.current;
      if (!sub || !carriesNotes(event)) return;
      const dragged = droppedNotes(event);
      const plan = sub.plan(dragged, note, fraction(event));
      if (!plan) return;
      event.preventDefault();
      event.stopPropagation();
      sub.drop(plan, dragged, note);
    },
  };
  return { mark, handlers };
}
