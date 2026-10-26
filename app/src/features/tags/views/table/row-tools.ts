// What a row's cells can ask of the table beyond editing: pick the row, put it
// in order by hand, open it beside the table. One stable object for the whole
// table (its methods read the latest state), so picking a row redraws only
// that row; it changes only when ordering by hand is switched on or off.

import { createContext, type DragEvent } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";

/** The drag type of a row being put in order, so other drags are left alone. */
export const ORDER_TYPE = "application/x-kasten-row-order";

export interface RowTools {
  /** Picks or unpicks a row; with Shift, everything from the last one picked. */
  pick(path: string, shift: boolean): void;
  /** Rows can be dragged into a new order (the view has no sort). */
  ordering: boolean;
  /** A row's grip starts a drag. */
  startDrag(event: DragEvent<HTMLElement>, note: NoteMeta): void;
  /** A dragged row was dropped before or after `over`. */
  dropRow(dragged: string, over: NoteMeta, after: boolean): void;
  /** Opens the row in the side peek. */
  openSide(path: string): void;
}

const NOTHING = () => {};

export const NO_TOOLS: RowTools = { pick: NOTHING, ordering: false, startDrag: NOTHING, dropRow: NOTHING, openSide: NOTHING };

export const RowToolsContext = createContext<RowTools>(NO_TOOLS);
