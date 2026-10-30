// The table's keyboard and focus: which cell is active, which is being
// edited, and the keys that move between cells. Arrows, Home, End and the
// page keys move; Tab and Shift+Tab move across and leave the grid past
// either end; Escape lets go of the cell; other keys go to the active cell
// (Enter edits or opens, a character starts typing, Space ticks). Keys
// with Ctrl, Cmd or Alt are left to the window's shortcuts. The active cell
// stays on its note and column when a sort, a filter or a new row moves
// them, so keys never act on a note that slid under it.

import { useCallback, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import { useWorkspace } from "../../../workspace/store";
import { setValue } from "../../actions";
import type { Column } from "./columns";
import { HEAD_HEIGHT, ROW_HEIGHT, useLatest, type CellHandle, type SubApi, type TableCtx } from "./context";
import { locate, moveFor, reveal, type Active, type Bounds, type CellAt } from "./grid";

export interface Editing {
  path: string;
  key: string;
  seed: string | null;
}

const NAV = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Tab"]);

export interface Grid {
  /** Where the active cell is now, if there is one. */
  at: CellAt | null;
  editing: Editing | null;
  ctx: TableCtx;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  /** Tabbing into the grid makes its first cell active, as grids do. */
  onFocus(event: FocusEvent<HTMLDivElement>): void;
  /** Scrolls a row into view without making it active. */
  reveal(row: number): void;
  /** Closes the editor without moving (its row went out of view). */
  stopEditing(): void;
}

/** How the rows are laid out: their height, and where each note's row sits
 * among the rows drawn when some of them are group headers (else the same). */
export interface GridLayout {
  rowHeight: number;
  /** Per note row, its place in the drawn rows. */
  itemOf?: readonly number[] | null;
  /** Height of what sticks to the bottom (the calculations). */
  footHeight?: number;
}

const PLAIN: GridLayout = { rowHeight: ROW_HEIGHT };

function boundsOf(el: HTMLElement | null, rows: number, cols: number, rowHeight: number): Bounds {
  const height = el?.clientHeight ?? 0;
  return { rows, cols, page: height > 0 ? Math.max(1, Math.floor((height - HEAD_HEIGHT) / rowHeight) - 1) : 10 };
}

/** `foot` holds what Tab reaches after the last cell (the table's New). */
export function useGrid(
  scroller: RefObject<HTMLDivElement | null>,
  foot: RefObject<HTMLElement | null>,
  notes: readonly NoteMeta[],
  columns: readonly Column[],
  widths: readonly number[],
  layout: GridLayout = PLAIN,
): Grid {
  const [active, setActive] = useState<Active | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  // Read by callbacks at once, before the next render.
  const editingRef = useRef<Editing | null>(null);
  const handle = useRef<CellHandle | null>(null);
  const sub = useRef<SubApi | null>(null);
  const at = useMemo(() => locate(active, notes, columns), [active, notes, columns]);
  const latest = useLatest({ at, notes, columns, widths, layout });

  const setEditing = useCallback((next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  }, []);

  const tools = useMemo(() => {
    const focusGrid = () => scroller.current?.focus({ preventScroll: true });

    /** Scrolls so the cell shows below the sticky header and beside the sticky title. */
    const revealCell = ({ row, col }: CellAt) => {
      const el = scroller.current;
      if (!el || el.clientHeight === 0) return;
      const { rowHeight, itemOf, footHeight = 0 } = latest.current.layout;
      const place = itemOf?.[row] ?? row;
      const top = reveal(el.scrollTop, el.clientHeight - footHeight, HEAD_HEIGHT + place * rowHeight, rowHeight, HEAD_HEIGHT);
      if (top !== el.scrollTop) el.scrollTop = top;
      if (col === 0 || el.clientWidth === 0) return;
      const { widths } = latest.current;
      let left = 0;
      for (let i = 0; i < col; i++) left += widths[i] ?? 0;
      const x = reveal(el.scrollLeft, el.clientWidth, left, widths[col] ?? 0, widths[0] ?? 0);
      if (x !== el.scrollLeft) el.scrollLeft = x;
    };

    /** Makes the cell at (row, col) of the rows drawn last the active one. */
    const point = ({ row, col }: CellAt) => {
      const { notes, columns } = latest.current;
      const note = notes[row];
      const column = columns[col];
      if (note && column) setActive({ path: note.path, key: column.key, row, col });
    };

    const select = (cell: CellAt) => {
      point(cell);
      revealCell(cell);
    };

    const stopEditing = () => {
      // Keys stay with the table if they were in the editor going away, or
      // were lost with it (its row was removed before this ran).
      const focused = document.activeElement;
      const lost = !focused || focused === document.body;
      const ours = lost || scroller.current?.contains(focused) || focused.closest(".kasten-table-pop") !== null;
      setEditing(null);
      if (ours) focusGrid();
    };

    const ctx: TableCtx = {
      handle,
      sub,
      activate(row, col) {
        point({ row, col });
        const el = scroller.current;
        if (el && !el.contains(document.activeElement)) focusGrid();
      },
      edit(path, key, seed = null) {
        setEditing({ path, key, seed });
      },
      done(path, key, move = null, refocus = true) {
        const current = editingRef.current;
        if (!current || current.path !== path || current.key !== key) return;
        setEditing(null);
        const { at, notes, columns } = latest.current;
        const next = move && at ? moveFor("Tab", move === "prev", at, boundsOf(scroller.current, notes.length, columns.length, latest.current.layout.rowHeight)) : null;
        if (next) select(next);
        if (refocus) focusGrid();
      },
      open(path, how) {
        useWorkspace.getState().openPath(path, how);
      },
      async save(path, key, value) {
        return (await setValue(path, key, value)) !== null;
      },
    };
    return { ctx, select, stopEditing, reveal: (row: number) => revealCell({ row, col: 0 }) };
  }, [scroller, latest, setEditing, sub]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Editors and menus handle their own keys.
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || editingRef.current) return;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (NAV.has(event.key) && plain) {
      // A title cell with sub-items takes ← → Tab for opening, shutting and indenting.
      if (at && handle.current?.onNav?.(event)) {
        event.preventDefault();
        return;
      }
      if (!at) {
        if (event.key === "Tab" || notes.length === 0) return;
        event.preventDefault();
        tools.select({ row: 0, col: 0 });
        return;
      }
      const next = moveFor(event.key, event.shiftKey, at, boundsOf(scroller.current, notes.length, columns.length, layout.rowHeight));
      if (!next) {
        // Tab past the last cell goes on to the table's foot, not to the
        // header's buttons that come next in the page; Shift+Tab past the
        // first leaves the usual way.
        const after = event.shiftKey ? null : foot.current?.querySelector<HTMLElement>("button, input");
        if (after) {
          event.preventDefault();
          after.focus();
        }
        return;
      }
      event.preventDefault();
      tools.select(next);
      return;
    }
    if (!at) return;
    if (event.key === "Escape" && plain) {
      event.preventDefault();
      setActive(null);
      return;
    }
    if (handle.current?.onKey(event)) event.preventDefault();
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || at || notes.length === 0) return;
    // A click focuses the grid too, just before it picks its own cell.
    let keyboard = false;
    try {
      keyboard = event.currentTarget.matches(":focus-visible");
    } catch {
      // A browser without :focus-visible waits for the first key instead.
    }
    if (keyboard) tools.select({ row: 0, col: 0 });
  };

  return { at, editing, ctx: tools.ctx, onKeyDown, onFocus, reveal: tools.reveal, stopEditing: tools.stopEditing };
}
