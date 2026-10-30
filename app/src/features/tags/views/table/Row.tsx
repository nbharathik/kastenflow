// One row: a note's cells. Rows are memoised on what they show (the note,
// its place, which of its cells is active or edited) with stable callbacks,
// so an edit, a keypress or a scroll redraws only the rows it touches.

import { memo, useContext } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import { Cell } from "./Cell";
import type { Column } from "./columns";
import type { TableCtx } from "./context";
import { RowToolsContext } from "./row-tools";
import type { Fold } from "./subitems";
import { useOrderDrop } from "./useOrderDrop";
import { useRowDrop } from "./useRowDrop";

export interface RowProps {
  note: NoteMeta;
  /** Its place among the rows shown, from 0. */
  row: number;
  /** Its place among the rows drawn when group headers sit between them; else its row. */
  pos?: number;
  columns: Column[];
  /** The active cell's column in this row, or -1. */
  activeCol: number;
  /** The key edited in this row, if any. */
  editingKey: string | null;
  seed: string | null;
  /** Just added from the table: it glows for a moment. */
  fresh: boolean;
  ctx: TableCtx;
  idBase: string;
  /** Sub-items: how far inside other rows it is, its fold ("none" when sub-items are off), and whether it shows only for a match below it. */
  depth: number;
  fold: Fold;
  dim: boolean;
  /** The row is picked (its checkbox is ticked). */
  selected?: boolean;
}

/** A cell's element id, for the grid's active descendant. */
export const cellId = (base: string, row: number, col: number) => `${base}-${row}-${col}`;

export const Row = memo(function Row({ note, row, pos = row, columns, activeCol, editingKey, seed, fresh, ctx, idBase, depth, fold, dim, selected = false }: RowProps) {
  const tree = fold !== "none";
  const drop = useRowDrop(note, ctx, tree);
  const order = useOrderDrop(note, useContext(RowToolsContext));
  const className = `kasten-table-row${fresh ? " is-fresh" : ""}${dim ? " is-dim" : ""}${selected ? " is-picked" : ""}`;
  return (
    <div
      role="row"
      aria-rowindex={pos + 2}
      aria-level={tree ? depth + 1 : undefined}
      aria-expanded={fold === "open" ? true : fold === "closed" ? false : undefined}
      aria-selected={selected || undefined}
      className={className}
      data-drop={order.mark ?? drop.mark ?? undefined}
      {...drop.handlers}
      {...order.handlers}
    >
      {columns.map((column, col) => (
        <Cell
          key={column.key}
          note={note}
          column={column}
          row={row}
          col={col}
          active={activeCol === col}
          editing={editingKey === column.key}
          seed={editingKey === column.key ? seed : null}
          ctx={ctx}
          id={cellId(idBase, row, col)}
          depth={depth}
          fold={fold}
          dim={dim}
          selected={selected}
        />
      ))}
      <div role="presentation" className="kasten-table-fill" />
    </div>
  );
});
