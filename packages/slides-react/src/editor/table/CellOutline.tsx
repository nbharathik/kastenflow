import type { JSX } from "react";

import { cellRect, layoutTable } from "../../render/table-layout.ts";
import { frame } from "../canvas/Overlay.tsx";
import type { EditorSession } from "../session/session.ts";
import { useEditor } from "../useEditor.ts";
import { gridOf, rangeOfSelection } from "./cells.ts";
import "./cells.css";

const sum = (sizes: readonly number[]): number => sizes.reduce((total, size) => total + size, 0);

/**
 * The cells picked in a table, outlined over the slide: the block they make, and in a block of several the cell the arrow keys move from.
 * Turned with the table (it is never mirrored). Drawn in screen pixels like the rest of the selection, so its lines stay thin at any zoom.
 */
export function CellOutline({ session, zoom }: { session: EditorSession; zoom: number }): JSX.Element | null {
  const state = useEditor(session);
  const { cells } = state;
  if (!cells) return null;
  const table = session.scope.find((element) => element.id === cells.table);
  const box = table?.type === "table" ? session.elements.boxOf(table) : null;
  if (table?.type !== "table" || !box) return null;
  const laid = layoutTable(table, box.w, box.h);
  const range = rangeOfSelection(table, cells);
  const left = sum(laid.columns.slice(0, range.left));
  const top = sum(laid.rows.slice(0, range.top));
  const width = sum(laid.columns.slice(range.left, range.right + 1));
  const height = sum(laid.rows.slice(range.top, range.bottom + 1));
  const focus = cellRect(laid, cells.focus);
  const several = gridOf(table).cells.filter((cell) => cell.row >= range.top && cell.row + cell.rowSpan - 1 <= range.bottom && cell.col >= range.left && cell.col + cell.colSpan - 1 <= range.right).length > 1;
  const at = (x: number, y: number, w: number, h: number) => ({ left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom });
  return (
    <div className="ks-overlay" aria-hidden="true">
      <div className="ks-cell-frame" data-chrome="" style={frame({ ...box, rotation: table.rotation ?? 0 }, zoom)}>
        <div className={`ks-cell-range${state.editing === null ? "" : " is-editing"}`} data-cells={`${range.top},${range.left}:${range.bottom},${range.right}`} style={at(left, top, width, height)} />
        {several && focus && state.editing === null ? <div className="ks-cell-focus" style={at(focus.x, focus.y, focus.w, focus.h)} /> : null}
      </div>
    </div>
  );
}
