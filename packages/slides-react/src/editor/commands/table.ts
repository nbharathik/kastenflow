import type { Command } from "./types.ts";

/** Whether cells are picked in a table: what the commands below work on. */
const picked: Command["enabled"] = (state) => state.cells !== null;

/**
 * What a person does to the cells picked in a table: rows and columns, merging, emptying them, and the table itself. They are in the
 * context menu of the cells, the Table menu, the Format options and the palette; none has a key of its own.
 */
export const tableCommands: Command[] = [
  { id: "table.insert-row-above", label: "Insert row above", icon: "table", enabled: picked, run: ({ session }) => session.tables.insertRows("above") },
  { id: "table.insert-row-below", label: "Insert row below", icon: "table", enabled: picked, run: ({ session }) => session.tables.insertRows("below") },
  { id: "table.insert-column-left", label: "Insert column left", icon: "table", enabled: picked, run: ({ session }) => session.tables.insertColumns("left") },
  { id: "table.insert-column-right", label: "Insert column right", icon: "table", enabled: picked, run: ({ session }) => session.tables.insertColumns("right") },
  { id: "table.delete-rows", label: "Delete rows", icon: "trash", enabled: picked, run: ({ session }) => session.tables.deleteRows() },
  { id: "table.delete-columns", label: "Delete columns", icon: "trash", enabled: picked, run: ({ session }) => session.tables.deleteColumns() },
  {
    id: "table.merge-cells",
    label: "Merge cells",
    icon: "grid-2x2",
    enabled: (state, _ui, _host, context) => (context ? context.session.tables.canMerge : state.cells !== null),
    run: ({ session }) => session.tables.merge(),
  },
  {
    id: "table.unmerge-cells",
    label: "Unmerge cells",
    icon: "grid-3x3",
    enabled: (state, _ui, _host, context) => (context ? context.session.tables.canUnmerge : state.cells !== null),
    run: ({ session }) => session.tables.unmerge(),
  },
  { id: "table.clear-cells", label: "Clear cells", icon: "circle-x", enabled: picked, run: ({ session }) => session.tables.clear() },
  { id: "table.select-cells", label: "Select all cells", icon: "table", enabled: picked, run: ({ session }) => session.tables.selectAll() },
  // The frame of the table is what is then selected: Delete takes the table away, and the arrow keys move it.
  { id: "table.select", label: "Select table", icon: "table", enabled: picked, run: ({ session }) => session.selectCells(null) },
  {
    id: "table.delete",
    label: "Delete table",
    icon: "trash",
    enabled: picked,
    run: ({ session }) => {
      const cells = session.state.cells;
      if (cells) session.elements.remove([cells.table]);
    },
  },
];
