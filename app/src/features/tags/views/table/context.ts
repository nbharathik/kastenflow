// What the table's rows and cells share: one stable object of callbacks
// (so a row redraws only when its own note or state changes), the handle
// keys reach the active cell through, and the row geometry.

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { NoteMeta } from "../../../../lib/vault/types";
import type { OpenHow } from "../../../workspace/store";
import { sameValue } from "./format";
import type { SubDrop } from "./sub-drop";

/** Row and header heights, in px; rows are all one height so they can be
 * windowed. They match --row-h and --head-h in table.css. */
export const ROW_HEIGHT = 36;
export const HEAD_HEIGHT = 36;

/** Where the active cell goes after an edit: Tab moves on, Shift+Tab back. */
export type Move = "next" | "prev" | null;

/** How keys pressed on the grid reach the active cell. */
export interface CellHandle {
  /** A key pressed while the cell is active and not editing; true when it used the key. */
  onKey(event: KeyboardEvent): boolean;
  /** Asked first about a key that would move the active cell (arrows, Tab...);
   * true when the cell used it instead. */
  onNav?(event: KeyboardEvent): boolean;
}

/** What the table's sub-items do, for the title cells; set by the table. */
export interface SubApi {
  /** Sub-items are on for this view. */
  enabled: boolean;
  /** Opens or shuts a row's sub-items (`want` to say which; else flips). */
  toggle(note: NoteMeta, want?: boolean): void;
  /** Asks for the title of a new sub-item of the row, and opens the row. */
  addUnder(note: NoteMeta): void;
  indent(note: NoteMeta): void;
  outdent(note: NoteMeta): void;
  /** The row's menu, at a point on the screen. */
  menu(note: NoteMeta, x: number, y: number): void;
  /** What dropping the dragged rows on `over` would do, `fraction` of the way down it. */
  plan(dragged: readonly string[] | null, over: NoteMeta, fraction: number): SubDrop | null;
  /** Does what a plan says. */
  drop(plan: SubDrop, dragged: readonly string[], over: NoteMeta): void;
}

export interface TableCtx {
  /** The table's sub-items, once it has set them. */
  sub: RefObject<SubApi | null>;
  /** The active cell's handle, while it is drawn. */
  handle: RefObject<CellHandle | null>;
  /** Makes a cell the active one; keys go to the grid. */
  activate(row: number, col: number): void;
  /** Opens a cell's editor, with the character typed to open it. */
  edit(path: string, key: string, seed?: string | null): void;
  /** Closes a cell's editor, moving on for Tab; keys go back to the grid
   * unless the editor closed because something else was clicked. */
  done(path: string, key: string, move?: Move, refocus?: boolean): void;
  open(path: string, how: OpenHow): void;
  /** Writes one property; false when the core refused it. */
  save(path: string, key: string, value: unknown): Promise<boolean>;
}

/** Keeps a ref pointing at this render's value, for handlers made once. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Makes this cell's key handler the grid's while the cell is active. */
export function useCellHandle(ctx: TableCtx, active: boolean, onKey: (event: KeyboardEvent) => boolean, onNav?: (event: KeyboardEvent) => boolean): void {
  const latest = useLatest(onKey);
  const nav = useLatest(onNav);
  useLayoutEffect(() => {
    if (!active) return;
    const handle: CellHandle = { onKey: (event) => latest.current(event), onNav: (event) => nav.current?.(event) ?? false };
    ctx.handle.current = handle;
    return () => {
      if (ctx.handle.current === handle) ctx.handle.current = null;
    };
  }, [active, ctx, latest, nav]);
}

interface Pending {
  value: unknown;
  /** Which save this is, so an older one finishing leaves a newer one shown. */
  token: object;
}

/** A value shown as saved at once while the core writes it; if the core
 * refuses, the saved value shows again. */
export function usePending(saved: unknown, write: (value: unknown) => Promise<boolean>): [unknown, (value: unknown) => void] {
  const [pending, setPending] = useState<Pending | null>(null);
  const shown = pending ? pending.value : saved;
  const latest = useLatest({ shown, write });
  const save = useCallback(
    (value: unknown) => {
      if (sameValue(latest.current.shown, value)) return;
      const token = {};
      setPending({ value, token });
      void latest.current.write(value).finally(() => setPending((p) => (p?.token === token ? null : p)));
    },
    [latest],
  );
  return [shown, save];
}
