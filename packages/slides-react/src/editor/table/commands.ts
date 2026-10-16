// What the editor does to the cells picked in a table. Each is one operation of the engine (or one batch, which is one step of undo), so the
// table's rows, columns, merged cells and size are never worked out here: the operations do that, and refuse in words when they cannot.

import type { Element, Fill, Text } from "@kasten-slides/wasm";

import { textOfWords } from "../clipboard/table.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditStart } from "../session/types.ts";
import { type CellRange, type CellSelection, type Grid, type Place, colsIn, gridOf, rangeOfSelection, rowsIn, sameSelection, selectionOfRange } from "./cells.ts";

type TableEl = Extract<Element, { type: "table" }>;
type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

/** What is picked: the table, the cells, the block they make, and the table's grid. */
export interface Picked {
  table: TableEl;
  cells: CellSelection;
  range: CellRange;
  grid: Grid;
}

const corners = (range: CellRange): { from: Place; to: Place } => ({ from: { row: range.top, col: range.left }, to: { row: range.bottom, col: range.right } });

export class TableCommands {
  constructor(private readonly s: EditorSession) {}

  /** The table whose cells are picked, with what is picked of it; null when none is. */
  picked(): Picked | null {
    const cells = this.s.state.cells;
    if (!cells) return null;
    const table = this.s.scope.find((element) => element.id === cells.table);
    if (table?.type !== "table") return null;
    return { table, cells, range: rangeOfSelection(table, cells), grid: gridOf(table) };
  }

  private get slide(): string {
    return this.s.state.slideId;
  }

  // ---- the pick

  /** Picks cells of a table and selects it, or, with null, takes the cells off and leaves the table selected. Nothing is open for writing afterwards. */
  pick(cells: CellSelection | null): void {
    const { state } = this.s;
    if (cells && this.s.scope.find((element) => element.id === cells.table)?.type !== "table") return;
    const selection = cells ? [cells.table] : state.selection;
    const alone = state.slideSelection.length === 1 && state.slideSelection[0] === state.slideId;
    if (sameSelection(cells, state.cells) && selection.length === state.selection.length && selection.every((id, i) => id === state.selection[i]) && state.editing === null && alone) return;
    this.s.patch({ selection, cells, editing: null, editFrom: null, tool: "select", slideSelection: [state.slideId] });
  }

  /** Opens the cell at the focus of `cells` for writing, with the caret where `from` says (a press) or at the end of its words. */
  open(cells: CellSelection, from?: EditStart): void {
    const table = this.s.scope.find((element) => element.id === cells.table);
    if (table?.type !== "table" || table.locked) return;
    this.s.patch({ selection: [cells.table], cells, editing: cells.table, editFrom: from ?? null, tool: "select", slideSelection: [this.s.state.slideId] });
  }

  // ---- words

  /** Writes the words of one cell: the way the editor leaves a cell. `slide` is where the cell was opened, which the person may have left since. */
  setCell(id: string, at: Place, text: Text, slide: string = this.slide): void {
    // The table may be gone by the time the edit ends (deleted, undone away): nothing to write to, and nothing to say.
    const held = this.s.state.deck.slides.find((candidate) => candidate.id === slide);
    if (!held || findElement(held.elements, id)?.type !== "table") return;
    this.s.run(() => this.s.core.apply("set_cells", { slide, id, at, cells: [[{ text }]], grow: false }));
  }

  /** Empties the cells picked: their words and nothing else. */
  clear(): void {
    const picked = this.picked();
    if (!picked) return;
    this.s.run(() => this.s.core.apply("clear_cells", { slide: this.slide, id: picked.cells.table, ...corners(picked.range) }));
  }

  /**
   * The words of the cells picked, row by row, for a copy. A cell that a merged cell covers has none: the words are at the merged cell's
   * first place, as a spreadsheet has them.
   */
  copy(): Text[][] | null {
    const picked = this.picked();
    if (!picked) return null;
    const { grid, range } = picked;
    const texts: Text[][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      const line: Text[] = [];
      for (let col = range.left; col <= range.right; col++) {
        const cell = grid.at(row, col);
        line.push(cell && cell.row === row && cell.col === col ? cell.cell.text : textOfWords(""));
      }
      texts.push(line);
    }
    return texts;
  }

  /**
   * Puts rows of cells in the table from the first cell picked, adding the rows and columns it needs, and picks what was put in. A block
   * that would cut a merged cell is refused by the engine, and the person is told which rows and columns.
   */
  paste(texts: readonly (readonly Text[])[]): void {
    const picked = this.picked();
    const first = texts[0];
    if (!picked || !first) return;
    const at = { row: picked.range.top, col: picked.range.left };
    const done = this.s.run(() => this.s.core.apply("set_cells", { slide: this.slide, id: picked.cells.table, at, cells: texts.map((row) => row.map((text) => ({ text }))), grow: true }));
    if (!done) return;
    this.s.selectCells({ table: picked.cells.table, anchor: at, focus: { row: at.row + texts.length - 1, col: at.col + Math.max(...texts.map((row) => row.length)) - 1 } });
  }

  // ---- rows and columns

  /** Puts as many rows as are picked above or below them. What was picked stays what is picked. */
  insertRows(where: "above" | "below"): void {
    const picked = this.picked();
    if (!picked) return;
    const count = rowsIn(picked.range);
    const at = where === "above" ? picked.range.top : picked.range.bottom + 1;
    if (!this.s.run(() => this.s.core.apply("insert_rows", { slide: this.slide, id: picked.cells.table, at, count }))) return;
    if (where === "above") this.shift(picked.cells, count, 0);
  }

  /** Puts as many columns as are picked to the left or right of them. */
  insertColumns(where: "left" | "right"): void {
    const picked = this.picked();
    if (!picked) return;
    const count = colsIn(picked.range);
    const at = where === "left" ? picked.range.left : picked.range.right + 1;
    if (!this.s.run(() => this.s.core.apply("insert_columns", { slide: this.slide, id: picked.cells.table, at, count }))) return;
    if (where === "left") this.shift(picked.cells, 0, count);
  }

  /** Adds a row at the end of table `id` (Tab on the last cell). Answers the first place of the new row, or null if it could not be added. */
  appendRow(id: string): Place | null {
    const table = this.s.scope.find((element) => element.id === id);
    if (table?.type !== "table") return null;
    const rows = gridOf(table).rows;
    if (!this.s.run(() => this.s.core.apply("insert_rows", { slide: this.slide, id, at: rows, count: 1 }))) return null;
    return { row: rows, col: 0 };
  }

  deleteRows(): void {
    const picked = this.picked();
    if (!picked) return;
    this.s.run(() => this.s.core.apply("delete_rows", { slide: this.slide, id: picked.cells.table, from: picked.range.top, count: rowsIn(picked.range) }));
  }

  deleteColumns(): void {
    const picked = this.picked();
    if (!picked) return;
    this.s.run(() => this.s.core.apply("delete_columns", { slide: this.slide, id: picked.cells.table, from: picked.range.left, count: colsIn(picked.range) }));
  }

  /** The same cells picked after rows or columns went in front of them. */
  private shift(cells: CellSelection, rows: number, cols: number): void {
    const move = (place: Place): Place => ({ row: place.row + rows, col: place.col + cols });
    this.s.selectCells({ table: cells.table, anchor: move(cells.anchor), focus: move(cells.focus) });
  }

  // ---- merging and looks

  /** Whether the cells picked are several, which is what merging needs. */
  get canMerge(): boolean {
    const picked = this.picked();
    return picked !== null && picked.grid.cells.filter((cell) => cell.row >= picked.range.top && cell.row + cell.rowSpan - 1 <= picked.range.bottom && cell.col >= picked.range.left && cell.col + cell.colSpan - 1 <= picked.range.right).length > 1;
  }

  /** Whether any of the cells picked is merged. */
  get canUnmerge(): boolean {
    const picked = this.picked();
    return picked !== null && this.mergedIn(picked).length > 0;
  }

  private mergedIn(picked: Picked): { row: number; col: number }[] {
    const { range } = picked;
    return picked.grid.cells.filter((cell) => (cell.rowSpan > 1 || cell.colSpan > 1) && cell.row >= range.top && cell.row <= range.bottom && cell.col >= range.left && cell.col <= range.right).map((cell) => ({ row: cell.row, col: cell.col }));
  }

  /** Joins the cells picked into one, which keeps their words (the engine joins them). Picks the new cell. */
  merge(): void {
    const picked = this.picked();
    if (!picked) return;
    if (!this.s.run(() => this.s.core.apply("merge_cells", { slide: this.slide, id: picked.cells.table, ...corners(picked.range) }))) return;
    this.s.selectCells(selectionOfRange(picked.cells.table, picked.range));
  }

  /** Splits every merged cell among the cells picked back into the places it covered: one step of undo. */
  unmerge(): void {
    const picked = this.picked();
    if (!picked) return;
    const merged = this.mergedIn(picked);
    if (merged.length === 0) return;
    const operations: Operations = merged.map((at) => ["unmerge_cells", { slide: this.slide, id: picked.cells.table, at }]);
    this.s.run(() => this.s.core.applyBatch(operations));
  }

  /** Fills the cells picked with a colour, or takes their fill away with null. */
  setFill(fill: Fill | null): void {
    const picked = this.picked();
    if (!picked) return;
    this.s.run(() => this.s.core.apply("set_cell_fill", { slide: this.slide, id: picked.cells.table, ...corners(picked.range), ...(fill ? { fill } : {}) }));
  }

  /** Picks every cell of the table whose cells are picked. */
  selectAll(): void {
    const picked = this.picked();
    if (!picked) return;
    this.s.selectCells({ table: picked.cells.table, anchor: { row: 0, col: 0 }, focus: { row: picked.grid.rows - 1, col: picked.grid.cols - 1 } });
  }

  /** The fill the focus cell has now, for a control that shows it; undefined when there is none. */
  fillOfFocus(): Fill | null {
    const picked = this.picked();
    if (!picked) return null;
    return picked.grid.at(picked.cells.focus.row, picked.cells.focus.col)?.cell.fill ?? null;
  }
}
