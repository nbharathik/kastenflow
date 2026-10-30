// A table row as a place to drop a row that is being put in order by hand: the
// upper half puts the dragged row above it, the lower half below. Only the row
// passed over redraws.

import { useState, type DragEvent } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import { ORDER_TYPE, type RowTools } from "./row-tools";

export function useOrderDrop(note: NoteMeta, tools: RowTools) {
  const [mark, setMark] = useState<"before" | "after" | null>(null);
  if (!tools.ordering) return { mark: null, handlers: {} };
  const after = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.height > 0 && event.clientY - box.top >= box.height / 2;
  };
  const handlers = {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!event.dataTransfer.types.includes(ORDER_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setMark(after(event) ? "after" : "before");
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setMark(null);
    },
    onDrop(event: DragEvent<HTMLElement>) {
      setMark(null);
      const dragged = event.dataTransfer.getData(ORDER_TYPE);
      if (!dragged) return;
      event.preventDefault();
      tools.dropRow(dragged, note, after(event));
    },
  };
  return { mark, handlers };
}
